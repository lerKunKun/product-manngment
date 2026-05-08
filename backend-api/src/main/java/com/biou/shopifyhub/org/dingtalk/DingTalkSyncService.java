package com.biou.shopifyhub.org.dingtalk;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.dingtalk.DingTalkApiClient;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.entity.SysUserRole;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.mapper.SysUserRoleMapper;
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
    private final SysUserRoleMapper userRoleMapper;
    private final SysRoleMapper roleMapper;
    private final DingtalkSyncLogMapper logMapper;

    public DingTalkSyncService(DingTalkConfigService configService,
                               DingTalkApiClient dingApi,
                               SysOrgMapper orgMapper,
                               SysUserMapper userMapper,
                               SysUserRoleMapper userRoleMapper,
                               SysRoleMapper roleMapper,
                               DingtalkSyncLogMapper logMapper) {
        this.configService = configService;
        this.dingApi = dingApi;
        this.orgMapper = orgMapper;
        this.userMapper = userMapper;
        this.userRoleMapper = userRoleMapper;
        this.roleMapper = roleMapper;
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

                // tenantId 可能为 null（COMPANY 节点未填 tenant_id 时）。MyBatis-Plus 的 .eq("col", null)
                // 生成的是 col = NULL（永远 false），不是 col IS NULL —— 必须分支处理，否则永远命不中已存在记录，
                // 走到 INSERT 撞 sys_org.code unique 约束。
                QueryWrapper<SysOrg> findExisting = new QueryWrapper<SysOrg>()
                    .eq("dingtalk_dept_id", deptId);
                if (tenantId == null) findExisting.isNull("tenant_id");
                else findExisting.eq("tenant_id", tenantId);
                SysOrg local = orgMapper.selectOne(findExisting);
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
            QueryWrapper<SysOrg> qLocalDepts = new QueryWrapper<SysOrg>()
                .eq("type", "DEPT")
                .eq("dingtalk_corp_id", cfg.corpId())
                .isNotNull("dingtalk_dept_id");
            if (tenantId == null) qLocalDepts.isNull("tenant_id");
            else qLocalDepts.eq("tenant_id", tenantId);
            List<SysOrg> localDepts = orgMapper.selectList(qLocalDepts);
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
        // 诊断用：每个部门「成功 / 跳过原因」明细，最后写 sync_log.error_msg
        // 即使整次同步成功，也把每个部门的拉取结果写进去，方便排查"为什么只拉到 1 个人"。
        int deptOk = 0, deptSkippedNoPerm = 0, deptEmpty = 0;
        java.util.Map<String, String> deptDiag = new java.util.LinkedHashMap<>();

        // 关联用：把 sys_user 与 sys_user_role 建上 (org_id=本地部门 id, role_id=EMPLOYEE)。
        // 没有 link 时前端按组织过滤就拉不到人 —— 这是 G3 用户/组织未关联的根因。
        Long employeeRoleId;
        {
            SysRole employee = roleMapper.selectOne(
                new QueryWrapper<SysRole>().eq("code", "EMPLOYEE"));
            if (employee == null) {
                throw new BusinessException(ResultCode.DEPENDENCY_DOWN,
                    "默认角色 EMPLOYEE 不存在（V2 seed 缺失？）");
            }
            employeeRoleId = employee.getId();
        }
        // 同步内累计「新建 user_role」「跳过已存在」「失败」计数，写到诊断
        int userRoleAdded = 0, userRoleExisting = 0;

        try {
            SysOrg companyOrg = orgMapper.selectById(orgId);
            if (companyOrg == null) {
                throw new BusinessException(ResultCode.NOT_FOUND, "组织不存在 orgId=" + orgId);
            }
            Long tenantId = companyOrg.getTenantId();

            // 拿当前组织下所有 dept dingtalk id（包含 root=1）
            // 同 syncDepartments：tenantId 可能为 null，必须分支用 isNull，否则查空 → 用户同步只对 root 跑一次。
            QueryWrapper<SysOrg> qDepts = new QueryWrapper<SysOrg>()
                .eq("type", "DEPT")
                .eq("dingtalk_corp_id", cfg.corpId())
                .isNotNull("dingtalk_dept_id");
            if (tenantId == null) qDepts.isNull("tenant_id");
            else qDepts.eq("tenant_id", tenantId);
            List<SysOrg> depts = orgMapper.selectList(qDepts);
            Set<String> deptIds = new HashSet<>();
            deptIds.add("1");
            for (SysOrg d : depts) deptIds.add(d.getDingtalkDeptId());
            // 钉钉 dept_id → 本地 sys_org.id 的快速 map（避免每个 user 走 SQL）
            java.util.Map<String, Long> dingDeptToLocal = new HashMap<>();
            dingDeptToLocal.put("1", orgId); // root 映射到 COMPANY 自身
            for (SysOrg d : depts) dingDeptToLocal.put(d.getDingtalkDeptId(), d.getId());

            for (String deptId : deptIds) {
                long cursor = 0;
                int deptUsersFetched = 0;
                int deptUsersAdded = 0;
                int deptUsersSkipped = 0;
                String deptSkipReason = null;
                while (true) {
                    String body = "{\"dept_id\":" + deptId + ",\"cursor\":" + cursor + ",\"size\":50}";
                    JsonNode resp = postDingtalk(USER_LIST_URL + token, body);
                    int errcode = resp.path("errcode").asInt(-1);
                    if (errcode != 0) {
                        String msg = resp.path("errmsg").asText("user list failed");
                        log.warn("[dingtalk-sync] user list dept={} errcode={} msg={}", deptId, errcode, msg);
                        if (errcode == 60003 || errcode == 88) {
                            deptSkippedNoPerm++;
                            deptSkipReason = "errcode=" + errcode + " " + msg;
                            break; // 跳过此部门
                        }
                        throw new BusinessException(ResultCode.DEPENDENCY_DOWN,
                            "钉钉 user_list 失败 errcode=" + errcode + " msg=" + msg);
                    }
                    JsonNode result = resp.path("result");
                    Long localDeptId = dingDeptToLocal.get(deptId);
                    for (JsonNode u : result.path("list")) {
                        deptUsersFetched++;
                        String unionId = u.path("unionid").asText(null);
                        String userid = u.path("userid").asText(null);
                        String name = u.path("name").asText("");
                        String mobile = u.path("mobile").asText(null);
                        String email = u.path("email").asText(null);
                        // v2 user/list 同时返回这些（之前漏读 → 头像 / 工号 / 职位都没存）
                        String avatar = u.path("avatar").asText(null);
                        String jobNumber = u.path("job_number").asText(null);
                        String title = u.path("title").asText(null);
                        if (unionId == null || unionId.isBlank()) {
                            skipped++;
                            deptUsersSkipped++;
                            continue;
                        }
                        SysUser exists = userMapper.selectOne(new QueryWrapper<SysUser>()
                            .eq("dingtalk_unionid", unionId));
                        Long resolvedUserId;
                        if (exists != null) {
                            // unionId 已存在：**只更新可变 profile 字段**（avatar/phone/email/title）；
                            // username/employeeNo 不覆盖（保护本地登录名 + HR 工号）。
                            // 仍要补 user_role 关联（之前漏建导致组织过滤拉不到人）。
                            SysUser patch = new SysUser();
                            patch.setId(exists.getId());
                            boolean dirty = false;
                            if (notBlank(avatar) && !avatar.equals(exists.getAvatarUrl())) {
                                patch.setAvatarUrl(avatar); dirty = true;
                            }
                            if (notBlank(mobile) && !mobile.equals(exists.getPhone())) {
                                patch.setPhone(mobile); dirty = true;
                            }
                            if (notBlank(email) && !email.equals(exists.getEmail())) {
                                patch.setEmail(email); dirty = true;
                            }
                            if (notBlank(title) && !title.equals(exists.getPosition())) {
                                patch.setPosition(title); dirty = true;
                            }
                            // 占位用户名 dt_xxx 时用钉钉 name 回填
                            if (notBlank(name)
                                && (exists.getUsername() == null || exists.getUsername().startsWith("dt_"))
                                && !name.equals(exists.getUsername())) {
                                patch.setUsername(name); dirty = true;
                            }
                            // employeeNo 仅本地空时回填
                            if (notBlank(jobNumber)
                                && (exists.getEmployeeNo() == null || exists.getEmployeeNo().isBlank())
                                && !jobNumber.equals(exists.getEmployeeNo())) {
                                patch.setEmployeeNo(jobNumber); dirty = true;
                            }
                            if (dirty) userMapper.updateById(patch);
                            skipped++;
                            deptUsersSkipped++;
                            resolvedUserId = exists.getId();
                            log.info("[dingtalk-sync] user exists unionId={} localId={} profileDirty={}",
                                unionId, exists.getId(), dirty);
                        } else {
                            SysUser n = new SysUser();
                            n.setUsername(notBlank(name) ? name : ("dt_" + userid));
                            n.setEmployeeNo(notBlank(jobNumber) ? jobNumber : userid);
                            n.setEmail(email);
                            n.setPhone(mobile);
                            n.setAvatarUrl(avatar);
                            n.setPosition(title);
                            n.setDingtalkUnionid(unionId);
                            n.setDingtalkUserid(userid);
                            n.setDingtalkCorpId(cfg.corpId());
                            n.setDefaultTenantId(tenantId);
                            n.setUserType("STAFF");
                            n.setStatus("ACTIVE");
                            n.setPasswordMustChange(true);
                            userMapper.insert(n);
                            added++;
                            deptUsersAdded++;
                            resolvedUserId = n.getId();
                        }
                        // 建 user_role 关联：(user, EMPLOYEE 角色, 当前部门)，已存在跳过
                        if (localDeptId != null && resolvedUserId != null) {
                            Long existsRel = userRoleMapper.selectCount(
                                new QueryWrapper<SysUserRole>()
                                    .eq("user_id", resolvedUserId)
                                    .eq("role_id", employeeRoleId)
                                    .eq("org_id", localDeptId));
                            if (existsRel == null || existsRel == 0) {
                                SysUserRole ur = new SysUserRole();
                                ur.setUserId(resolvedUserId);
                                ur.setRoleId(employeeRoleId);
                                ur.setOrgId(localDeptId);
                                ur.setCreatedAt(LocalDateTime.now());
                                userRoleMapper.insert(ur);
                                userRoleAdded++;
                            } else {
                                userRoleExisting++;
                            }
                        }
                    }
                    boolean hasMore = result.path("has_more").asBoolean(false);
                    if (!hasMore) break;
                    cursor = result.path("next_cursor").asLong(0);
                    if (cursor == 0) break;
                }
                if (deptSkipReason != null) {
                    deptDiag.put(deptId, "SKIP " + deptSkipReason);
                } else if (deptUsersFetched == 0) {
                    deptOk++;
                    deptEmpty++;
                    deptDiag.put(deptId, "EMPTY");
                } else {
                    deptOk++;
                    deptDiag.put(deptId, "OK fetched=" + deptUsersFetched
                        + " added=" + deptUsersAdded + " skipped=" + deptUsersSkipped);
                }
                log.info("[dingtalk-sync] user list dept={} fetched={} added={} skipped={} skipReason={}",
                    deptId, deptUsersFetched, deptUsersAdded, deptUsersSkipped, deptSkipReason);
            }
            // 总览写到 errorMsg（即使没失败）
            String summary = String.format(
                "depts total=%d ok=%d empty=%d skipped(no-perm)=%d | users added=%d skipped=%d | user_role added=%d existing=%d",
                deptIds.size(), deptOk, deptEmpty, deptSkippedNoPerm,
                added, skipped, userRoleAdded, userRoleExisting);
            err.append(summary);
            if (deptSkippedNoPerm > 0) {
                // 列出最多 20 个被跳过的部门 + errcode（防止 errorMsg 过长）
                StringBuilder skipDetail = new StringBuilder(" | skipped depts: ");
                int n = 0;
                for (java.util.Map.Entry<String, String> e : deptDiag.entrySet()) {
                    if (!e.getValue().startsWith("SKIP")) continue;
                    if (n++ >= 20) { skipDetail.append("..."); break; }
                    skipDetail.append(e.getKey()).append(" ").append(e.getValue()).append("; ");
                }
                err.append(skipDetail);
                err.append(" | hint: 钉钉应用「通讯录管理-成员信息读权限」可见范围未覆盖这些部门");
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
        // 同上：tenantId 为 null 必须 isNull
        QueryWrapper<SysOrg> q = new QueryWrapper<SysOrg>().eq("dingtalk_dept_id", deptId);
        Long tid = companyOrg.getTenantId();
        if (tid == null) q.isNull("tenant_id");
        else q.eq("tenant_id", tid);
        SysOrg n = orgMapper.selectOne(q);
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

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private static String combine(String a, String b) {
        if (a == null) return b;
        if (b == null) return a;
        return a + " | " + b;
    }

    public record SyncResult(LocalDateTime startedAt, int added, int skipped, int failed, String errorMsg) {}
}
