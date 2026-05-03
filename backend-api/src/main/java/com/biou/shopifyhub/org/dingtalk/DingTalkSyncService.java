package com.biou.shopifyhub.org.dingtalk;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.dingtalk.DingTalkApiClient;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.org.entity.DingtalkSyncLog;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.mapper.DingtalkSyncLogMapper;
import com.biou.shopifyhub.org.mapper.SysOrgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 钉钉组织 + 员工同步服务（多组织化）。
 *
 * 关键设计：
 *  - syncDepartments(orgId)：BFS 拉钉钉部门树（topapi/v2/department/listsub），
 *    增量对账 sys_org（type=DEPT，绑 dingtalk_dept_id 主键化）。
 *    钉钉里没有但 sys_org 有的 → 软删（deleted_at=now()）。
 *  - syncUsers(orgId)：遍历各部门 user/listsimple → user/get 拿 unionId/userid，
 *    按 dingtalk_unionid 唯一键 upsert sys_user。
 *    **unionId 已存在则跳过 + 写 log，不覆盖任何字段**（保护本地用户身份不被钉钉覆盖）。
 *  - syncAll = dept + user，写 scope=ALL 的汇总日志。
 *
 * 钉钉 errcode != 0 → throw BusinessException 让前端拿到错误。
 */
@Service
public class DingTalkSyncService {

    private static final Logger log = LoggerFactory.getLogger(DingTalkSyncService.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String DEPT_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=";
    private static final String USER_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/user/list?access_token=";

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(8))
        .build();

    private final DingTalkConfigService configService;
    private final DingTalkApiClient dingApi;
    private final SysOrgMapper orgMapper;
    private final SysUserMapper userMapper;
    private final DingtalkSyncLogMapper logMapper;

    public DingTalkSyncService(DingTalkConfigService configService,
                               DingTalkApiClient dingApi,
                               SysOrgMapper orgMapper,
                               SysUserMapper userMapper,
                               DingtalkSyncLogMapper logMapper) {
        this.configService = configService;
        this.dingApi = dingApi;
        this.orgMapper = orgMapper;
        this.userMapper = userMapper;
        this.logMapper = logMapper;
    }

    public SyncResult syncAll(Long orgId, String triggerSource) {
        SyncResult dept = syncDepartments(orgId, triggerSource);
        SyncResult user = syncUsers(orgId, triggerSource);
        // 写一条 ALL 汇总
        DingtalkSyncLog all = new DingtalkSyncLog();
        all.setOrgId(orgId);
        all.setScope("ALL");
        all.setTriggerSource(triggerSource);
        all.setAdded(dept.added + user.added);
        all.setSkipped(dept.skipped + user.skipped);
        all.setFailed(dept.failed + user.failed);
        all.setStartedAt(dept.startedAt);
        all.setFinishedAt(LocalDateTime.now());
        if (dept.errorMsg != null || user.errorMsg != null) {
            all.setErrorMsg(combine(dept.errorMsg, user.errorMsg));
        }
        logMapper.insert(all);
        return new SyncResult(dept.startedAt, all.getAdded(), all.getSkipped(), all.getFailed(), all.getErrorMsg());
    }

    /** 同步部门：BFS 钉钉子部门列表 + 与 sys_org 对账。 */
    @Transactional
    public SyncResult syncDepartments(Long orgId, String triggerSource) {
        DingTalkResolvedConfig cfg = requireConfig(orgId);
        String token = dingApi.getAccessTokenForCorp(cfg.corpId(), cfg.appKey(), cfg.appSecret());

        DingtalkSyncLog logRow = new DingtalkSyncLog();
        logRow.setOrgId(orgId);
        logRow.setScope("DEPT");
        logRow.setTriggerSource(triggerSource);
        logRow.setStartedAt(LocalDateTime.now());
        int added = 0, skipped = 0, failed = 0;
        StringBuilder err = new StringBuilder();

        try {
            // 收集钉钉所有 dept_id（包含根 1）
            Set<String> remoteDeptIds = new HashSet<>();
            Map<String, String> remoteParent = new HashMap<>();
            Map<String, String> remoteName = new HashMap<>();
            // 钉钉 listsub 不返回 name；name 走 v2/department/get（这里精简：先收集 id 关系，
            // 再单次拉 v2/department/listsubid 不可用 → 用 listsub 把所有节点带 name 收下来）
            Deque<String> q = new ArrayDeque<>();
            q.push("1"); // 根
            while (!q.isEmpty()) {
                String pid = q.poll();
                JsonNode resp = postDingtalk(DEPT_LIST_URL + token,
                    "{\"dept_id\":" + pid + "}");
                int errcode = resp.path("errcode").asInt(-1);
                if (errcode != 0) {
                    String msg = resp.path("errmsg").asText("dept_listsub failed");
                    if (errcode == 60003 || errcode == 88) {
                        // 部门不存在 / 权限问题：跳过此节点，不阻断
                        log.warn("[dingtalk-sync] dept listsub skip pid={} errcode={} msg={}", pid, errcode, msg);
                        continue;
                    }
                    throw new BusinessException(ResultCode.DEPENDENCY_DOWN,
                        "钉钉 dept_listsub 失败 errcode=" + errcode + " msg=" + msg);
                }
                for (JsonNode child : resp.path("result")) {
                    String deptId = child.path("dept_id").asText();
                    String name = child.path("name").asText("");
                    remoteDeptIds.add(deptId);
                    remoteParent.put(deptId, pid);
                    remoteName.put(deptId, name);
                    q.push(deptId);
                }
            }

            // 与本地对账：按 dingtalk_dept_id 找
            SysOrg companyOrg = orgMapper.selectById(orgId);
            if (companyOrg == null) {
                throw new BusinessException(ResultCode.NOT_FOUND, "组织不存在 orgId=" + orgId);
            }
            Long tenantId = companyOrg.getTenantId();

            // 1) upsert
            for (String deptId : remoteDeptIds) {
                String name = remoteName.get(deptId);
                String parentDeptId = remoteParent.get(deptId);
                Long localParentId = "1".equals(parentDeptId) ? orgId
                    : findLocalIdByDeptId(parentDeptId, orgId);
                if (localParentId == null) localParentId = orgId; // 兜底挂 COMPANY

                SysOrg local = orgMapper.selectOne(new QueryWrapper<SysOrg>()
                    .eq("dingtalk_dept_id", deptId)
                    .eq("tenant_id", tenantId));
                if (local == null) {
                    SysOrg n = new SysOrg();
                    n.setName(name == null || name.isBlank() ? ("钉钉部门-" + deptId) : name);
                    n.setCode("dt_" + cfg.corpId() + "_" + deptId);
                    n.setType("DEPT");
                    n.setDingtalkDeptId(deptId);
                    n.setDingtalkCorpId(cfg.corpId());
                    n.setParentId(localParentId);
                    n.setTenantId(tenantId);
                    n.setStatus("ACTIVE");
                    n.setSort(0);
                    n.setPath("/?/");
                    orgMapper.insert(n);
                    SysOrg parent = orgMapper.selectById(localParentId);
                    n.setPath((parent == null ? "/" : parent.getPath()) + n.getId() + "/");
                    orgMapper.updateById(n);
                    added++;
                } else {
                    boolean dirty = false;
                    if (name != null && !name.isBlank() && !name.equals(local.getName())) {
                        local.setName(name);
                        dirty = true;
                    }
                    if (localParentId != null && !localParentId.equals(local.getParentId())) {
                        local.setParentId(localParentId);
                        dirty = true;
                    }
                    if (dirty) orgMapper.updateById(local);
                    else skipped++;
                }
            }

            // 2) 软删除：本地 dept 存在但钉钉已删除
            List<SysOrg> localDepts = orgMapper.selectList(new QueryWrapper<SysOrg>()
                .eq("tenant_id", tenantId)
                .eq("type", "DEPT")
                .eq("dingtalk_corp_id", cfg.corpId())
                .isNotNull("dingtalk_dept_id"));
            for (SysOrg d : localDepts) {
                if (!remoteDeptIds.contains(d.getDingtalkDeptId())) {
                    orgMapper.deleteById(d.getId()); // logic delete (deleted_at=NOW())
                    log.info("[dingtalk-sync] dept removed remotely, soft-delete local id={} ding_id={}",
                        d.getId(), d.getDingtalkDeptId());
                }
            }
        } catch (BusinessException e) {
            failed++;
            err.append(e.getMessage());
            throw e;
        } catch (Exception e) {
            failed++;
            err.append(e.getMessage());
            log.error("[dingtalk-sync] dept sync failed orgId={}", orgId, e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "部门同步失败: " + e.getMessage());
        } finally {
            logRow.setAdded(added);
            logRow.setSkipped(skipped);
            logRow.setFailed(failed);
            logRow.setErrorMsg(err.length() == 0 ? null : truncate(err.toString(), 2000));
            logRow.setFinishedAt(LocalDateTime.now());
            logMapper.insert(logRow);
        }
        return new SyncResult(logRow.getStartedAt(), added, skipped, failed, logRow.getErrorMsg());
    }

    /** 同步用户：遍历部门拉用户 → unionId 已存在跳过、否则插入。 */
    @Transactional
    public SyncResult syncUsers(Long orgId, String triggerSource) {
        DingTalkResolvedConfig cfg = requireConfig(orgId);
        String token = dingApi.getAccessTokenForCorp(cfg.corpId(), cfg.appKey(), cfg.appSecret());

        DingtalkSyncLog logRow = new DingtalkSyncLog();
        logRow.setOrgId(orgId);
        logRow.setScope("USER");
        logRow.setTriggerSource(triggerSource);
        logRow.setStartedAt(LocalDateTime.now());
        int added = 0, skipped = 0, failed = 0;
        StringBuilder err = new StringBuilder();

        try {
            SysOrg companyOrg = orgMapper.selectById(orgId);
            if (companyOrg == null) {
                throw new BusinessException(ResultCode.NOT_FOUND, "组织不存在 orgId=" + orgId);
            }
            Long tenantId = companyOrg.getTenantId();

            // 拿当前组织下所有 dept dingtalk id（包含 root=1）
            List<SysOrg> depts = orgMapper.selectList(new QueryWrapper<SysOrg>()
                .eq("tenant_id", tenantId)
                .eq("type", "DEPT")
                .eq("dingtalk_corp_id", cfg.corpId())
                .isNotNull("dingtalk_dept_id"));
            Set<String> deptIds = new HashSet<>();
            deptIds.add("1");
            for (SysOrg d : depts) deptIds.add(d.getDingtalkDeptId());

            for (String deptId : deptIds) {
                long cursor = 0;
                while (true) {
                    String body = "{\"dept_id\":" + deptId + ",\"cursor\":" + cursor + ",\"size\":50}";
                    JsonNode resp = postDingtalk(USER_LIST_URL + token, body);
                    int errcode = resp.path("errcode").asInt(-1);
                    if (errcode != 0) {
                        String msg = resp.path("errmsg").asText("user list failed");
                        log.warn("[dingtalk-sync] user list dept={} errcode={} msg={}", deptId, errcode, msg);
                        if (errcode == 60003 || errcode == 88) break; // 跳过此部门
                        throw new BusinessException(ResultCode.DEPENDENCY_DOWN,
                            "钉钉 user_list 失败 errcode=" + errcode + " msg=" + msg);
                    }
                    JsonNode result = resp.path("result");
                    for (JsonNode u : result.path("list")) {
                        String unionId = u.path("unionid").asText(null);
                        String userid = u.path("userid").asText(null);
                        String name = u.path("name").asText("");
                        String mobile = u.path("mobile").asText(null);
                        String email = u.path("email").asText(null);
                        if (unionId == null || unionId.isBlank()) {
                            skipped++;
                            continue;
                        }
                        SysUser exists = userMapper.selectOne(new QueryWrapper<SysUser>()
                            .eq("dingtalk_unionid", unionId));
                        if (exists != null) {
                            // unionId 已存在：**不覆盖**，仅 skip + log
                            skipped++;
                            log.info("[dingtalk-sync] user skip (unionId exists) unionId={} localId={}",
                                unionId, exists.getId());
                            continue;
                        }
                        SysUser n = new SysUser();
                        n.setUsername(name != null && !name.isBlank() ? name : ("dt_" + userid));
                        n.setEmployeeNo(userid);
                        n.setEmail(email);
                        n.setPhone(mobile);
                        n.setDingtalkUnionid(unionId);
                        n.setDingtalkUserid(userid);
                        n.setDingtalkCorpId(cfg.corpId());
                        n.setDefaultTenantId(tenantId);
                        n.setUserType("STAFF");
                        n.setStatus("ACTIVE");
                        n.setPasswordMustChange(true);
                        userMapper.insert(n);
                        added++;
                    }
                    boolean hasMore = result.path("has_more").asBoolean(false);
                    if (!hasMore) break;
                    cursor = result.path("next_cursor").asLong(0);
                    if (cursor == 0) break;
                }
            }
        } catch (BusinessException e) {
            failed++;
            err.append(e.getMessage());
            throw e;
        } catch (Exception e) {
            failed++;
            err.append(e.getMessage());
            log.error("[dingtalk-sync] user sync failed orgId={}", orgId, e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "用户同步失败: " + e.getMessage());
        } finally {
            logRow.setAdded(added);
            logRow.setSkipped(skipped);
            logRow.setFailed(failed);
            logRow.setErrorMsg(err.length() == 0 ? null : truncate(err.toString(), 2000));
            logRow.setFinishedAt(LocalDateTime.now());
            logMapper.insert(logRow);
        }
        return new SyncResult(logRow.getStartedAt(), added, skipped, failed, logRow.getErrorMsg());
    }

    /** 该 orgId 是否已配置（DB 命中且 ACTIVE）。决定建组织时是否触发。 */
    public boolean isConfigured(Long orgId) {
        DingTalkResolvedConfig cfg = configService.resolveByOrgId(orgId);
        // 仅 DB 来源算"该组织已配置"，env fallback 不算（env 是全局兜底）
        return cfg.source() == DingTalkResolvedConfig.Source.DB && cfg.isConfigured();
    }

    private DingTalkResolvedConfig requireConfig(Long orgId) {
        DingTalkResolvedConfig cfg = configService.resolveByOrgId(orgId);
        if (!cfg.isConfigured()) {
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN,
                "组织未配置钉钉应用（org=" + orgId + "），请先在组织详情页保存配置");
        }
        return cfg;
    }

    private Long findLocalIdByDeptId(String deptId, Long companyOrgId) {
        if (deptId == null || "1".equals(deptId)) return companyOrgId;
        SysOrg companyOrg = orgMapper.selectById(companyOrgId);
        if (companyOrg == null) return null;
        SysOrg n = orgMapper.selectOne(new QueryWrapper<SysOrg>()
            .eq("dingtalk_dept_id", deptId)
            .eq("tenant_id", companyOrg.getTenantId()));
        return n == null ? null : n.getId();
    }

    private JsonNode postDingtalk(String url, String body) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(15))
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        return JSON.readTree(resp.body());
    }

    private static String truncate(String s, int max) {
        return s == null ? null : (s.length() <= max ? s : s.substring(0, max));
    }

    private static String combine(String a, String b) {
        if (a == null) return b;
        if (b == null) return a;
        return a + " | " + b;
    }

    public record SyncResult(LocalDateTime startedAt, int added, int skipped, int failed, String errorMsg) {}
}
