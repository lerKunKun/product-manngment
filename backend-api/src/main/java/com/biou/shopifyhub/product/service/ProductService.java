package com.biou.shopifyhub.product.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.cache.CacheKeys;
import com.biou.shopifyhub.core.cache.CacheService;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.Product;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import com.biou.shopifyhub.product.mapper.ProductMapper;
import com.biou.shopifyhub.product.mapper.ProductVariantMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

@Service
public class ProductService {

    private static final Logger log = LoggerFactory.getLogger(ProductService.class);
    private static final Pattern HANDLE_PATTERN = Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$");

    private final ProductMapper productMapper;
    private final ProductVariantMapper variantMapper;
    private final ProductImageMapper imageMapper;
    private final ProductStatusBroadcaster productStatusBroadcaster;
    private final CacheService cacheService;

    public ProductService(
        ProductMapper productMapper,
        ProductVariantMapper variantMapper,
        ProductImageMapper imageMapper,
        ProductStatusBroadcaster productStatusBroadcaster,
        CacheService cacheService
    ) {
        this.productMapper = productMapper;
        this.variantMapper = variantMapper;
        this.imageMapper = imageMapper;
        this.productStatusBroadcaster = productStatusBroadcaster;
        this.cacheService = cacheService;
    }

    /** 列表分页（含搜索 + 状态过滤） */
    public IPage<Product> list(int page, int size, String keyword, String status, Long ownerCompanyId) {
        QueryWrapper<Product> q = new QueryWrapper<Product>().orderByDesc("created_at");
        if (status != null && !status.isBlank()) q.eq("status", status);
        if (ownerCompanyId != null) q.eq("owner_company_id", ownerCompanyId);
        if (keyword != null && !keyword.isBlank()) {
            q.and(w -> w.like("title", keyword)
                .or().like("handle", keyword)
                .or().like("vendor", keyword)
                .or().like("tags", keyword));
        }
        return productMapper.selectPage(new Page<>(page, size), q);
    }

    /** 详情：基础信息 + 变体 + 图片。W3-PERF-01 走 Redis 缓存，DTO 是 LinkedHashMap，可序列化无 lazy 关联问题。 */
    public Map<String, Object> detail(Long id) {
        return cacheService.getOrLoad(
            CacheKeys.productDetail(id),
            "product_detail",
            new TypeReference<Map<String, Object>>() {},
            () -> doDetail(id)
        );
    }

    private Map<String, Object> doDetail(Long id) {
        Product p = productMapper.selectById(id);
        if (p == null) throw new BusinessException(ResultCode.NOT_FOUND);
        List<ProductVariant> variants = variantMapper.selectList(
            new QueryWrapper<ProductVariant>().eq("product_id", id).orderByAsc("position"));
        List<ProductImage> images = imageMapper.selectList(
            new QueryWrapper<ProductImage>().eq("product_id", id).orderByAsc("position"));

        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("product", p);
        dto.put("variants", variants);
        dto.put("images", images);
        return dto;
    }

    @Transactional
    public Long create(Product p, Long createdBy) {
        validateInput(p);
        if (productMapper.selectCount(new QueryWrapper<Product>().eq("handle", p.getHandle())) > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "handle 已存在: " + p.getHandle());
        }
        if (p.getStatus() == null) p.setStatus("draft");
        if (p.getPublished() == null) p.setPublished(false);
        p.setCreatedBy(createdBy);
        productMapper.insert(p);

        // 默认创建一个 variant（Shopify 至少要有一个）
        ProductVariant v = new ProductVariant();
        v.setProductId(p.getId());
        v.setSku("SKU-" + p.getId());
        v.setPosition(1);
        v.setPrice(java.math.BigDecimal.ZERO);
        v.setInventoryPolicy("continue");
        v.setInventoryQty(1000);
        v.setRequiresShipping(true);
        v.setTaxable(true);
        v.setWeightUnit("g");
        variantMapper.insert(v);
        log.info("[product] created id={} handle={} by={}", p.getId(), p.getHandle(), createdBy);
        // 新创建无旧缓存可清；若 detail 在 create 之前被调用过（NOT_FOUND→不缓存）则无需失效
        return p.getId();
    }

    /**
     * Update a product and, if {@code status} flipped, broadcast the change
     * to every store this product has been pushed to (W2-SYNC-03). The
     * broadcast runs <em>after</em> the local row commits and any failure is
     * swallowed so the HTTP request still returns 200 — the local update is
     * the source of truth, push fan-out is async/best-effort.
     */
    public void update(Long id, Product patch) {
        StatusChange change = applyUpdate(id, patch);
        // W3-PERF-01: 任何 update 都失效详情缓存（即便只改了非 status 字段，cached DTO 里也会陈旧）
        cacheService.invalidate(CacheKeys.productDetail(id));
        if (change != null && change.changed()) {
            try {
                productStatusBroadcaster.broadcastStatusChange(id, change.oldStatus(), change.newStatus());
            } catch (Exception e) {
                // Non-blocking: local product update is committed, the broadcast
                // is best-effort fan-out. Each per-store push has its own
                // task/failure row; this catches any orchestration-level throw
                // (e.g. mapper layer hiccup) so the caller still sees 200.
                log.warn("[product] status broadcast failed productId={} err={}", id, e.getMessage());
            }
        }
    }

    /**
     * Transactional core of {@link #update}. Returns the status delta (or
     * {@code null} if status was not part of the patch) so the caller can
     * fire the broadcast after commit.
     */
    @Transactional
    public StatusChange applyUpdate(Long id, Product patch) {
        Product cur = productMapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        String oldStatus = cur.getStatus();
        if (patch.getHandle() != null && !patch.getHandle().equals(cur.getHandle())) {
            validateHandle(patch.getHandle());
            if (productMapper.selectCount(new QueryWrapper<Product>()
                    .eq("handle", patch.getHandle()).ne("id", id)) > 0) {
                throw new BusinessException(ResultCode.CONFLICT, "handle 已存在");
            }
            cur.setHandle(patch.getHandle());
        }
        if (patch.getTitle() != null) cur.setTitle(patch.getTitle());
        if (patch.getBodyHtml() != null) cur.setBodyHtml(patch.getBodyHtml());
        if (patch.getVendor() != null) cur.setVendor(patch.getVendor());
        if (patch.getProductCategory() != null) cur.setProductCategory(patch.getProductCategory());
        if (patch.getType() != null) cur.setType(patch.getType());
        if (patch.getTags() != null) cur.setTags(patch.getTags());
        if (patch.getStatus() != null) cur.setStatus(patch.getStatus());
        if (patch.getSeoTitle() != null) cur.setSeoTitle(patch.getSeoTitle());
        if (patch.getSeoDescription() != null) cur.setSeoDescription(patch.getSeoDescription());
        if (patch.getPublished() != null) cur.setPublished(patch.getPublished());
        productMapper.updateById(cur);
        if (patch.getStatus() == null) return null;
        return new StatusChange(oldStatus, cur.getStatus());
    }

    /** Result of {@link #applyUpdate}: pre/post status. */
    public record StatusChange(String oldStatus, String newStatus) {
        public boolean changed() {
            return oldStatus != null && newStatus != null && !oldStatus.equals(newStatus);
        }
    }

    @Transactional
    public void delete(Long id) {
        Product p = productMapper.selectById(id);
        if (p == null) throw new BusinessException(ResultCode.NOT_FOUND);
        productMapper.deleteById(id);
        cacheService.invalidate(CacheKeys.productDetail(id));
    }

    private void validateInput(Product p) {
        if (p.getHandle() == null || p.getHandle().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "handle 必填");
        }
        validateHandle(p.getHandle());
        if (p.getTitle() == null || p.getTitle().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "title 必填");
        }
        if (p.getOwnerCompanyId() == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "ownerCompanyId 必填");
        }
    }

    private void validateHandle(String handle) {
        if (!HANDLE_PATTERN.matcher(handle).matches()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "handle 仅允许小写字母/数字/中划线，且不以中划线开头/结尾");
        }
    }
}
