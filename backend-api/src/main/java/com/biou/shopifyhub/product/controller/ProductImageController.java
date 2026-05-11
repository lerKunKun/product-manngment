package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.cache.CacheKeys;
import com.biou.shopifyhub.core.cache.CacheService;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.file.UploadConfig;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 产品图片 / 视频生命周期端点（F2 子轨道）。
 *
 * <p>上传走「先存本地 → r2_status=PENDING → 后台 {@code LocalToR2UploadJob} 推 R2」流程：
 * <ul>
 *   <li>POST /product/{productId}/image/upload — multipart 上传，立即返回 PENDING 行让前端轮询</li>
 *   <li>GET  /product/{productId}/image       — 列表（含 r2_status / thumbnail_url 等新字段）</li>
 *   <li>POST /product/{productId}/image/reorder — 拖拽排序</li>
 *   <li>DELETE /product-image/{id}             — 仅删 DB（R2 清理由后续清理 job）</li>
 * </ul>
 */
@RestController
public class ProductImageController {

    private static final Logger log = LoggerFactory.getLogger(ProductImageController.class);
    private static final long MAX_SIZE = 200L * 1024 * 1024; // 200 MB（视频可能较大）

    private final ProductImageMapper mapper;
    private final CacheService cacheService;
    private final UploadConfig uploadConfig;
    private final ObjectMapper objectMapper;

    public ProductImageController(
        ProductImageMapper mapper,
        CacheService cacheService,
        UploadConfig uploadConfig,
        ObjectMapper objectMapper
    ) {
        this.mapper = mapper;
        this.cacheService = cacheService;
        this.uploadConfig = uploadConfig;
        this.objectMapper = objectMapper;
    }

    /** 列表（前端 PENDING 状态轮询用） */
    @GetMapping("/product/{productId}/image")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<List<ProductImage>> list(@PathVariable Long productId) {
        return Result.ok(mapper.selectList(new QueryWrapper<ProductImage>()
            .eq("product_id", productId)
            .orderByAsc("position")
            .orderByDesc("id")));
    }

    /**
     * 新版上传：先存本地，R2 上传走后台 job。
     *
     * <p>入参（multipart/form-data）：
     * <ul>
     *   <li>file：必填，图片或视频</li>
     *   <li>tags：必填，JSON 数组字符串（前端 JSON.stringify(["主图","白底"])），至少 1 个</li>
     *   <li>remark：选填，备注</li>
     *   <li>position：选填，1-based 位置；不传则取当前最大 + 1</li>
     * </ul>
     */
    @PostMapping("/product/{productId}/image/upload")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Map<String, Object>> upload(
        @PathVariable Long productId,
        @RequestParam("file") MultipartFile file,
        @RequestParam("tags") String tagsJson,
        @RequestParam(value = "remark", required = false) String remark,
        @RequestParam(value = "position", required = false) Integer position
    ) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "文件为空");
        }
        if (file.getSize() > MAX_SIZE) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "文件超过 200MB（当前 " + (file.getSize() / 1024 / 1024) + " MB）");
        }
        // tags 必填校验
        List<String> tags = parseTags(tagsJson);
        if (tags == null || tags.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "标签至少填一个");
        }

        // 媒体类型判定：image/* → IMAGE；video/* → VIDEO；其他拒绝
        String mime = file.getContentType() == null ? "" : file.getContentType();
        String mediaType;
        if (mime.startsWith("image/")) {
            mediaType = "IMAGE";
        } else if (mime.startsWith("video/")) {
            mediaType = "VIDEO";
        } else {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "仅支持图片或视频，当前 mime=" + mime);
        }

        // 落本地：<UPLOAD_DIR>/<uuid>.<ext>
        String ext = guessExt(file.getOriginalFilename(), mime);
        String localName = UUID.randomUUID().toString().replace("-", "") + ext;
        Path localPath = uploadConfig.getLocalDirPath().resolve("product-image").resolve(localName);
        try {
            Files.createDirectories(localPath.getParent());
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, localPath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "本地暂存失败: " + e.getMessage());
        }

        // 计算 position
        int pos;
        if (position != null && position > 0) {
            pos = position;
        } else {
            Long count = mapper.selectCount(new QueryWrapper<ProductImage>().eq("product_id", productId));
            pos = (count == null ? 0 : count.intValue()) + 1;
        }

        ProductImage img = new ProductImage();
        img.setProductId(productId);
        img.setSrc(""); // R2 上传完成前 src 留空，前端按 r2_status 显示占位
        img.setPosition(pos);
        img.setGiftCard(false);
        img.setTags(tags);
        img.setRemark(remark);
        img.setLocalPath(localPath.toString());
        img.setR2Status("PENDING");
        img.setMediaType(mediaType);
        mapper.insert(img);
        cacheService.invalidate(CacheKeys.productDetail(productId));
        log.info("[image-upload] 已落本地待 R2 推送 id={} mediaType={} local={}", img.getId(), mediaType, localPath);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("id", img.getId());
        resp.put("r2Status", "PENDING");
        resp.put("mediaType", mediaType);
        return Result.ok(resp);
    }

    @DeleteMapping("/product-image/{id}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Void> delete(@PathVariable Long id) {
        ProductImage img = mapper.selectById(id);
        if (img == null) throw new BusinessException(ResultCode.NOT_FOUND);
        mapper.deleteById(id);
        cacheService.invalidate(CacheKeys.productDetail(img.getProductId()));
        return Result.ok();
    }

    @PostMapping("/product/{productId}/image/reorder")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    @Transactional
    public Result<Map<String, Integer>> reorder(@PathVariable Long productId, @RequestBody ReorderReq req) {
        if (req.ids == null || req.ids.isEmpty()) {
            return Result.ok(Map.of("updated", 0));
        }
        List<ProductImage> rows = mapper.selectList(new QueryWrapper<ProductImage>()
            .eq("product_id", productId));
        Map<Long, ProductImage> byId = new HashMap<>();
        for (ProductImage r : rows) byId.put(r.getId(), r);
        int updated = 0;
        for (int i = 0; i < req.ids.size(); i++) {
            ProductImage r = byId.get(req.ids.get(i));
            if (r == null) continue;
            r.setPosition(i + 1);
            mapper.updateById(r);
            updated++;
        }
        cacheService.invalidate(CacheKeys.productDetail(productId));
        return Result.ok(Map.of("updated", updated));
    }

    private List<String> parseTags(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "tags 必须是 JSON 数组：" + e.getMessage());
        }
    }

    private static String guessExt(String filename, String mime) {
        if (filename != null && filename.contains(".")) {
            return filename.substring(filename.lastIndexOf('.')).toLowerCase();
        }
        if (mime == null) return "";
        return switch (mime) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            case "image/svg+xml" -> ".svg";
            case "video/mp4" -> ".mp4";
            case "video/webm" -> ".webm";
            case "video/quicktime" -> ".mov";
            default -> "";
        };
    }

    public static class ReorderReq { public List<Long> ids; }
}
