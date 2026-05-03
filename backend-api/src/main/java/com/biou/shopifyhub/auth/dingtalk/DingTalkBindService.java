package com.biou.shopifyhub.auth.dingtalk;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.audit.entity.SysAuditLog;
import com.biou.shopifyhub.audit.mapper.SysAuditLogMapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.org.dingtalk.DingTalkConfigService;
import com.biou.shopifyhub.org.dingtalk.DingTalkResolvedConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 个人中心「绑定钉钉」专用服务。
 *
 * 与 {@link com.biou.shopifyhub.auth.service.DingTalkLoginService#loginOrRegister}
 * 的关键区别：
 *  - 这里**只更新当前已登录用户**的 dingtalk_* 字段，不切换账号、不创建新用户
 *  - 若该 unionId 已被其他 sys_user 占用 → 拒绝（10005 VALIDATION_FAILED）
 *  - 不动 username / employeeNo / passwordHash 等敏感字段
 *
 * 入口：{@link DingTalkAuthController#bindCallback}。
 */
@Service
public class DingTalkBindService {

    private static final Logger log = LoggerFactory.getLogger(DingTalkBindService.class);

    private final SysUserMapper userMapper;
    private final DingTalkStateService stateService;
    private final DingTalkConfigService configService;
    private final DingTalkApiClient apiClient;
    private final SysAuditLogMapper auditMapper;

    public DingTalkBindService(SysUserMapper userMapper,
                               DingTalkStateService stateService,
                               DingTalkConfigService configService,
                               DingTalkApiClient apiClient,
                               SysAuditLogMapper auditMapper) {
        this.userMapper = userMapper;
        this.stateService = stateService;
        this.configService = configService;
        this.apiClient = apiClient;
        this.auditMapper = auditMapper;
    }

    /** 签发绑定流程 state（带 currentUserId + tenantId）。 */
    public String issueBindState(Long currentUserId, Long tenantId) {
        return stateService.issueForBind(currentUserId, tenantId);
    }

    /**
     * 将钉钉账号绑定到当前用户。
     *
     * @param currentUserId 当前已登录用户（从 state 中解出）
     * @param unionId       钉钉 unionId（必填）
     * @param dingUserId    可选：corp 下的 userId（无法解析时传 null）
     * @param corpId        可选：corp id（无法解析时传 null）
     * @param ip            审计用
     * @param userAgent     审计用
     */
    @Transactional
    public void bind(Long currentUserId, String unionId, String dingUserId, String corpId,
                     String ip, String userAgent) {
        if (currentUserId == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        if (unionId == null || unionId.isBlank()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "钉钉返回缺 unionId");
        }

        SysUser current = userMapper.selectById(currentUserId);
        if (current == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "当前用户不存在");
        }

        // 校验：unionId 没被其他 sys_user 占用
        SysUser conflict = userMapper.selectOne(new QueryWrapper<SysUser>()
            .eq("dingtalk_unionid", unionId)
            .ne("id", currentUserId));
        if (conflict != null) {
            log.warn("[dingtalk-bind] unionId already bound to other user. currentUserId={} otherUserId={} unionId={}",
                currentUserId, conflict.getId(), unionId);
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "该钉钉账号已被其他人绑定，请联系管理员");
        }

        // 只更新 dingtalk_* 三个字段（不动 username / employeeNo / passwordHash 等）
        SysUser patch = new SysUser();
        patch.setId(currentUserId);
        patch.setDingtalkUnionid(unionId);
        if (dingUserId != null && !dingUserId.isBlank()) patch.setDingtalkUserid(dingUserId);
        if (corpId != null && !corpId.isBlank()) patch.setDingtalkCorpId(corpId);
        userMapper.updateById(patch);

        log.info("[dingtalk-bind] success userId={} unionId={} dingUserId={} corpId={}",
            currentUserId, unionId, dingUserId, corpId);

        // 写审计（仿 AdminUserService.impersonate 写法）
        try {
            SysAuditLog row = new SysAuditLog();
            row.setUserId(currentUserId);
            row.setUsername(current.getUsername());
            row.setEmployeeNo(current.getEmployeeNo());
            row.setTenantId(current.getDefaultTenantId());
            row.setModule("auth/dingtalk-bind");
            row.setAction("BIND");
            row.setResourceType("user");
            row.setResourceId(String.valueOf(currentUserId));
            row.setRequestMethod("GET");
            row.setRequestUri("/auth/dingtalk/bind/callback");
            row.setRequestPayload("{\"unionId\":\"" + safe(unionId)
                + "\",\"dingUserId\":\"" + safe(dingUserId)
                + "\",\"corpId\":\"" + safe(corpId) + "\"}");
            row.setResponseStatus(200);
            row.setIp(ip);
            row.setUserAgent(userAgent);
            row.setSensitive(true);
            row.setCreatedAt(LocalDateTime.now());
            auditMapper.insert(row);
        } catch (Exception e) {
            log.warn("dingtalk-bind audit insert failed: {}", e.getMessage());
        }
    }

    /**
     * 通过 OAuth 拿到的 unionId 反查 (dingUserId, corpId)。
     * 思路：按当前用户的 defaultTenantId resolve corp 配置 → 调 getbyunionid。
     * resolve 失败或返回不到时，返回 (null, null) — 调用方仍允许只写 unionId。
     */
    public ResolvedDingUser tryResolveDingUser(SysUser current, String unionId) {
        try {
            DingTalkResolvedConfig cfg = configService.resolveByTenantId(current.getDefaultTenantId());
            if (!cfg.isConfigured()) {
                return new ResolvedDingUser(null, null);
            }
            String token;
            if (cfg.source() == DingTalkResolvedConfig.Source.DB) {
                token = apiClient.getAccessTokenForCorp(cfg.corpId(), cfg.appKey(), cfg.appSecret());
            } else {
                token = apiClient.getAccessToken();
            }
            String dingUserId = apiClient.getUserIdByUnionId(token, unionId);
            return new ResolvedDingUser(dingUserId, cfg.corpId());
        } catch (Exception e) {
            log.warn("[dingtalk-bind] resolve dingUserId failed userId={} unionId={} err={}",
                current.getId(), unionId, e.getMessage());
            return new ResolvedDingUser(null, null);
        }
    }

    private static String safe(String s) {
        return s == null ? "" : s.replace("\"", "'").replace("\\", "/");
    }

    public record ResolvedDingUser(String dingUserId, String corpId) {}
}
