package com.biou.shopifyhub.org.dingtalk;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.dingtalk.DingTalkProperties;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.entity.SysOrgDingtalkConfig;
import com.biou.shopifyhub.org.mapper.SysOrgDingtalkConfigMapper;
import com.biou.shopifyhub.org.mapper.SysOrgMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 钉钉配置解析器（多组织化）：
 *  - resolveByOrgId(orgId)  ：直接按 sys_org_dingtalk_config.org_id 查
 *  - resolveByTenantId(tid) ：找该 tenant 下顶层 COMPANY 节点 → 转 resolveByOrgId
 *  - 找不到 → 回退 env 中 DINGTALK_MAIN_*（向后兼容）
 *  - 任何路径都返回解密后的 secret；secret 永不入日志
 */
@Service
public class DingTalkConfigService {

    private static final Logger log = LoggerFactory.getLogger(DingTalkConfigService.class);

    private final SysOrgDingtalkConfigMapper configMapper;
    private final SysOrgMapper orgMapper;
    private final DingTalkProperties envProps;

    @Value("${ENCRYPT_KEY_AES_GCM:}")
    private String aesKey;

    public DingTalkConfigService(SysOrgDingtalkConfigMapper configMapper,
                                 SysOrgMapper orgMapper,
                                 DingTalkProperties envProps) {
        this.configMapper = configMapper;
        this.orgMapper = orgMapper;
        this.envProps = envProps;
    }

    /** 按 org（COMPANY 节点）解析；找不到 → env fallback。可能返回未配置。 */
    public DingTalkResolvedConfig resolveByOrgId(Long orgId) {
        if (orgId != null) {
            SysOrgDingtalkConfig c = configMapper.selectById(orgId);
            if (c != null && "ACTIVE".equals(c.getStatus())) {
                String secret = decryptSecret(c.getAppSecretEnc());
                return new DingTalkResolvedConfig(
                    c.getOrgId(),
                    c.getCorpId(),
                    c.getAgentId(),
                    c.getAppKey(),
                    secret,
                    c.getEventToken(),
                    c.getEventAesKey(),
                    DingTalkResolvedConfig.Source.DB
                );
            }
        }
        return envFallback();
    }

    /**
     * 按 tenantId 解析：在 sys_org 找该 tenant 的 COMPANY 节点，逐个尝试。
     * tenantId 可能为 null（系统级 / 未绑定），直接走 env。
     */
    public DingTalkResolvedConfig resolveByTenantId(Long tenantId) {
        if (tenantId == null) return envFallback();
        // 找该 tenant 下的 COMPANY 节点（一般只有一条；按 sort,id 取第一）
        java.util.List<SysOrg> companies = orgMapper.selectList(new QueryWrapper<SysOrg>()
            .eq("tenant_id", tenantId)
            .eq("type", "COMPANY")
            .orderByAsc("sort", "id"));
        for (SysOrg co : companies) {
            SysOrgDingtalkConfig c = configMapper.selectById(co.getId());
            if (c != null && "ACTIVE".equals(c.getStatus())) {
                String secret = decryptSecret(c.getAppSecretEnc());
                return new DingTalkResolvedConfig(
                    c.getOrgId(),
                    c.getCorpId(),
                    c.getAgentId(),
                    c.getAppKey(),
                    secret,
                    c.getEventToken(),
                    c.getEventAesKey(),
                    DingTalkResolvedConfig.Source.DB
                );
            }
        }
        return envFallback();
    }

    private DingTalkResolvedConfig envFallback() {
        return new DingTalkResolvedConfig(
            null,
            envProps.getMainCorpId(),
            envProps.getMainAgentId(),
            envProps.getMainAppKey(),
            envProps.getMainAppSecret(),
            envProps.getEventToken(),
            envProps.getEventAesKey(),
            DingTalkResolvedConfig.Source.ENV
        );
    }

    private String decryptSecret(String enc) {
        if (enc == null || enc.isBlank()) return null;
        if (aesKey == null || aesKey.isBlank()) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "ENCRYPT_KEY_AES_GCM 未配置，无法解密钉钉 AppSecret");
        }
        return AesGcmUtil.decrypt(enc, aesKey);
    }

    /** 用于保存配置：明文加密入库。 */
    public String encryptSecret(String plaintext) {
        if (plaintext == null || plaintext.isBlank()) return null;
        if (aesKey == null || aesKey.isBlank()) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "ENCRYPT_KEY_AES_GCM 未配置，无法加密钉钉 AppSecret");
        }
        return AesGcmUtil.encrypt(plaintext, aesKey);
    }

    /** 保存或更新单个 COMPANY 的钉钉配置；secret 为 null/空 时不更新 secret。 */
    public void save(Long orgId, SaveConfigCmd cmd) {
        SysOrg org = orgMapper.selectById(orgId);
        if (org == null) throw new BusinessException(ResultCode.NOT_FOUND, "组织不存在");
        if (!"COMPANY".equalsIgnoreCase(org.getType())) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "钉钉配置只能挂在 COMPANY 节点上");
        }
        if (cmd.corpId == null || cmd.corpId.isBlank()
            || cmd.appKey == null || cmd.appKey.isBlank()
            || cmd.agentId == null || cmd.agentId.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "corpId / appKey / agentId 必填");
        }
        SysOrgDingtalkConfig existing = configMapper.selectById(orgId);
        boolean isNew = (existing == null);
        if (isNew && (cmd.appSecret == null || cmd.appSecret.isBlank())) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "首次保存必须提供 appSecret");
        }
        SysOrgDingtalkConfig row = isNew ? new SysOrgDingtalkConfig() : existing;
        row.setOrgId(orgId);
        row.setCorpId(cmd.corpId.trim());
        row.setAppKey(cmd.appKey.trim());
        row.setAgentId(cmd.agentId.trim());
        if (cmd.appSecret != null && !cmd.appSecret.isBlank()) {
            row.setAppSecretEnc(encryptSecret(cmd.appSecret.trim()));
        }
        row.setEventToken(cmd.eventToken == null ? null : cmd.eventToken.trim());
        row.setEventAesKey(cmd.eventAesKey == null ? null : cmd.eventAesKey.trim());
        row.setStatus(cmd.status == null || cmd.status.isBlank() ? "ACTIVE" : cmd.status.trim().toUpperCase());
        if (isNew) {
            configMapper.insert(row);
        } else {
            configMapper.updateById(row);
        }
        // 故意不输出 secret 字段
        log.info("[dingtalk-config] saved orgId={} corpId={} appKey={} new={}",
            orgId, row.getCorpId(), row.getAppKey(), isNew);
    }

    /** 给前端的脱敏视图（不带 secret）。 */
    public java.util.Map<String, Object> viewSafe(Long orgId) {
        SysOrgDingtalkConfig c = configMapper.selectById(orgId);
        java.util.Map<String, Object> r = new java.util.HashMap<>();
        if (c == null) {
            r.put("configured", false);
            return r;
        }
        r.put("configured", true);
        r.put("orgId", c.getOrgId());
        r.put("corpId", c.getCorpId());
        r.put("appKey", c.getAppKey());
        r.put("agentId", c.getAgentId());
        r.put("eventToken", c.getEventToken() == null ? null : maskTail(c.getEventToken()));
        r.put("eventAesKey", c.getEventAesKey() == null ? null : maskTail(c.getEventAesKey()));
        r.put("status", c.getStatus());
        r.put("appSecret", "***"); // 仅占位
        r.put("updatedAt", c.getUpdatedAt());
        return r;
    }

    private static String maskTail(String s) {
        if (s == null || s.length() < 6) return "***";
        return s.substring(0, 4) + "***";
    }

    /** 命令对象。 */
    public static class SaveConfigCmd {
        public String corpId;
        public String appKey;
        public String appSecret; // 可选；空表示不更新 secret
        public String agentId;
        public String eventToken;
        public String eventAesKey;
        public String status;
    }
}
