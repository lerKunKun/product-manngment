package com.biou.shopifyhub.store;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.cache.CacheKeys;
import com.biou.shopifyhub.core.cache.CacheService;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class StoreService {

    private static final Logger log = LoggerFactory.getLogger(StoreService.class);

    private final StoreMapper mapper;
    private final ShopifyApiClient shopify;
    private final CacheService cacheService;

    @Value("${ENCRYPT_KEY_AES_GCM:}")
    private String aesKey;

    public StoreService(StoreMapper mapper, ShopifyApiClient shopify, CacheService cacheService) {
        this.mapper = mapper;
        this.shopify = shopify;
        this.cacheService = cacheService;
    }

    public List<Store> list(Long tenantId) {
        return list(tenantId, null, null);
    }

    /**
     * W3-PV-01：支持按 partnerCollab / devStore 标记过滤。
     * W3-PERF-01：当 partnerCollab/devStore 都为 null（最常见的"列出本租户全部店铺"路径）时走 Redis 缓存；
     *           带过滤参数时直查 DB——避免给 cache key 多嵌入维度，简单优先。
     */
    public List<Store> list(Long tenantId, Boolean partnerCollab, Boolean devStore) {
        if (partnerCollab == null && devStore == null && tenantId != null) {
            return cacheService.getOrLoad(
                CacheKeys.storeList(tenantId),
                "store_list",
                new TypeReference<List<Store>>() {},
                () -> doList(tenantId, null, null)
            );
        }
        return doList(tenantId, partnerCollab, devStore);
    }

    private List<Store> doList(Long tenantId, Boolean partnerCollab, Boolean devStore) {
        QueryWrapper<Store> q = new QueryWrapper<Store>().orderByDesc("created_at");
        if (tenantId != null) q.eq("tenant_id", tenantId);
        if (partnerCollab != null) q.eq("is_partner_collab", partnerCollab ? 1 : 0);
        if (devStore != null) q.eq("is_dev_store", devStore ? 1 : 0);
        return mapper.selectList(q);
    }

    public Store getById(Long id) {
        Store s = mapper.selectById(id);
        if (s == null) throw new BusinessException(ResultCode.NOT_FOUND);
        return s;
    }

    @Transactional
    public Long connectCustomApp(ConnectCustomAppReq req, Long invitedByUserId) {
        if (aesKey == null || aesKey.isBlank()) {
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "AES 主密钥未配置");
        }
        // 校验域名
        String domain = (req.myshopifyDomain == null ? "" : req.myshopifyDomain.trim()).toLowerCase();
        if (!domain.endsWith(".myshopify.com")) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "请提供 *.myshopify.com 域名");
        }
        // 检查重复
        if (mapper.selectCount(new QueryWrapper<Store>().eq("myshopify_domain", domain)) > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "店铺已接入: " + domain);
        }

        // 立即用 token 调 shop.json 验证
        ShopifyApiClient.ShopInfo info = shopify.verifyToken(domain, req.accessToken);
        if (!info.ok()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "Shopify Token 验证失败: " + info.error());
        }

        Store s = new Store();
        s.setTenantId(req.tenantId);
        s.setDeptId(req.deptId);
        s.setMyshopifyDomain(domain);
        s.setBrandName(req.brandName != null ? req.brandName : info.name());
        s.setTokenType("custom_app");
        s.setEncryptedAccessToken(AesGcmUtil.encrypt(req.accessToken, aesKey));
        s.setExpiresAt(null); // custom app 永不过期
        s.setIsDevStore(Boolean.TRUE.equals(req.isDevStore));
        s.setIsPartnerCollab(Boolean.TRUE.equals(req.isPartnerCollab));
        s.setStatus("ACTIVE");
        mapper.insert(s);
        log.info("[store] connect custom_app id={} domain={} by={}", s.getId(), domain, invitedByUserId);
        invalidateListCache(s.getTenantId());
        return s.getId();
    }

    @Transactional
    public void delete(Long id, Long operatorUserId) {
        Store s = getById(id);
        log.info("[store] delete id={} domain={} by={}", id, s.getMyshopifyDomain(), operatorUserId);
        mapper.deleteById(id);
        invalidateListCache(s.getTenantId());
    }

    /** W3-PV-01：把店铺加入 / 移出合作者店铺池 */
    @Transactional
    public void setPartnerCollab(Long id, boolean partnerCollab, Long operatorUserId) {
        Store s = getById(id);
        s.setIsPartnerCollab(partnerCollab);
        mapper.updateById(s);
        log.info("[store] setPartnerCollab id={} domain={} value={} by={}",
                id, s.getMyshopifyDomain(), partnerCollab, operatorUserId);
        invalidateListCache(s.getTenantId());
    }

    /** W3-PV-01：标记 / 取消 dev store */
    @Transactional
    public void setDevStore(Long id, boolean devStore, Long operatorUserId) {
        Store s = getById(id);
        s.setIsDevStore(devStore);
        mapper.updateById(s);
        log.info("[store] setDevStore id={} domain={} value={} by={}",
                id, s.getMyshopifyDomain(), devStore, operatorUserId);
        invalidateListCache(s.getTenantId());
    }

    /** 按需取明文 token（敏感操作，仅 worker / 内部调用使用，不暴露给前端） */
    public String decryptToken(Store s) {
        if (aesKey == null || aesKey.isBlank()) throw new IllegalStateException("AES 主密钥未配置");
        return AesGcmUtil.decrypt(s.getEncryptedAccessToken(), aesKey);
    }

    /** W3-PERF-01：mutation 后主动失效列表缓存。tenantId 可能为 null（系统级 store），跳过即可。 */
    private void invalidateListCache(Long tenantId) {
        if (tenantId != null) {
            cacheService.invalidate(CacheKeys.storeList(tenantId));
        }
    }

    public static class ConnectCustomAppReq {
        public Long tenantId;
        public Long deptId;
        public String myshopifyDomain;
        public String brandName;
        public String accessToken;
        public Boolean isDevStore;
        public Boolean isPartnerCollab;
    }
}
