package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.file.UploadConfig;
import com.biou.shopifyhub.product.entity.ProductDoc;
import com.biou.shopifyhub.product.mapper.ProductDocMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 产品媒体 / 需求文档 CRUD：
 *  - FILE 类型：multipart 上传 → 走「先存本地 → 后台 worker 推 R2」流程（F2 子轨道）
 *  - RICH_TEXT 类型：直接保存 TipTap JSON
 *  - 删除时同步删 R2 对象
 *
 * <p>F2 改动：
 *  - 上传新增 tags（必填 JSON 数组）+ remark 字段
 *  - office 类（doc/docx/xls/xlsx/ppt/pptx/pdf）落 scan_status='NOT_SCANNED'，下载前需调
 *    {@link com.biou.shopifyhub.file.FileScanController} 检查（占位实现）
 */
@RestController
public class ProductDocController {

    private static final Logger log = LoggerFactory.getLogger(ProductDocController.class);

    /** 走病毒扫描占位的 office mime 集合 */
    private static final Set<String> OFFICE_MIME = Set.of(
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/pdf"
    );

    private final ProductDocMapper mapper;
    private final FileService fileService;
    private final S3Client s3;
    private final UploadConfig uploadConfig;
    private final ObjectMapper objectMapper;

    @Value("${R2_PRODUCT_MEDIA_BUCKET:product-media}")
    private String mediaBucket;

    public ProductDocController(
        ProductDocMapper mapper,
        FileService fileService,
        S3Client s3,
        UploadConfig uploadConfig,
        ObjectMapper objectMapper
    ) {
        this.mapper = mapper;
        this.fileService = fileService;
        this.s3 = s3;
        this.uploadConfig = uploadConfig;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/product/{productId}/doc")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<List<ProductDoc>> list(@PathVariable Long productId) {
        return Result.ok(mapper.selectList(new QueryWrapper<ProductDoc>()
            .eq("product_id", productId)
            .orderByAsc("sort")
            .orderByDesc("created_at")));
    }

    /**
     * 文件上传：先落本地 → r2_status=PENDING → 后台 job 推 R2。
     *
     * <p>入参（multipart）：file + tags(JSON 数组字符串) + remark + title?
     */
    @PostMapping("/product/{productId}/doc/upload")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Map<String, Object>> upload(
        @PathVariable Long productId,
        @RequestParam("file") MultipartFile file,
        @RequestParam("tags") String tagsJson,
        @RequestParam(value = "remark", required = false) String remark,
        @RequestParam(value = "title", required = false) String title
    ) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "文件为空");
        }
        List<String> tags = parseTags(tagsJson);
        if (tags == null || tags.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "标签至少填一个");
        }

        String origName = file.getOriginalFilename() == null ? "file" : file.getOriginalFilename();
        String ext = origName.contains(".") ? origName.substring(origName.lastIndexOf('.')) : "";
        String localName = UUID.randomUUID().toString().replace("-", "") + ext;
        Path localPath = uploadConfig.getLocalDirPath().resolve("product-doc").resolve(localName);
        try {
            Files.createDirectories(localPath.getParent());
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, localPath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "本地暂存失败: " + e.getMessage());
        }

        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;

        ProductDoc doc = new ProductDoc();
        doc.setProductId(productId);
        doc.setType("FILE");
        doc.setFileName(origName);
        doc.setFileSize(file.getSize());
        doc.setFileMime(file.getContentType());
        doc.setTitle(title != null ? title : origName);
        doc.setSort(0);
        doc.setCreatedBy(uid);
        doc.setTags(tags);
        doc.setRemark(remark);
        doc.setLocalPath(localPath.toString());
        doc.setR2Status("PENDING");
        // office / pdf 走病毒扫描占位流程；其他类型直接 CLEAN
        if (file.getContentType() != null && OFFICE_MIME.contains(file.getContentType())) {
            doc.setScanStatus("NOT_SCANNED");
        } else {
            doc.setScanStatus("CLEAN");
        }
        mapper.insert(doc);
        log.info("[doc-upload] 已落本地待 R2 推送 id={} local={}", doc.getId(), localPath);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("id", doc.getId());
        resp.put("r2Status", "PENDING");
        resp.put("scanStatus", doc.getScanStatus());
        resp.put("fileName", origName);
        resp.put("fileSize", file.getSize());
        return Result.ok(resp);
    }

    /** 保存 TipTap 富文本 JSON */
    @PostMapping("/product/{productId}/doc/rich")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Map<String, Long>> saveRich(
        @PathVariable Long productId,
        @RequestBody RichDocReq req
    ) {
        if (req.json == null || req.json.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "json 必填");
        }
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;

        ProductDoc doc;
        if (req.id != null) {
            doc = mapper.selectById(req.id);
            if (doc == null) throw new BusinessException(ResultCode.NOT_FOUND);
            doc.setRichTextJson(req.json);
            if (req.title != null) doc.setTitle(req.title);
            mapper.updateById(doc);
        } else {
            doc = new ProductDoc();
            doc.setProductId(productId);
            doc.setType("RICH_TEXT");
            doc.setRichTextJson(req.json);
            doc.setTitle(req.title != null ? req.title : "需求文档");
            doc.setSort(0);
            doc.setCreatedBy(uid);
            mapper.insert(doc);
        }
        return Result.ok(Map.of("id", doc.getId()));
    }

    @DeleteMapping("/doc/{id}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Void> delete(@PathVariable Long id) {
        ProductDoc doc = mapper.selectById(id);
        if (doc == null) throw new BusinessException(ResultCode.NOT_FOUND);
        // 同步删 R2 对象
        if ("FILE".equals(doc.getType()) && doc.getFileR2Key() != null) {
            try {
                s3.deleteObject(DeleteObjectRequest.builder()
                    .bucket(mediaBucket).key(doc.getFileR2Key()).build());
                log.info("[doc-delete] R2 对象删除 key={}", doc.getFileR2Key());
            } catch (Exception e) {
                log.warn("[doc-delete] R2 对象删除失败（本地软删继续）key={} err={}",
                    doc.getFileR2Key(), e.getMessage());
            }
        }
        // 同步删本地暂存（如果还在）
        if (doc.getLocalPath() != null) {
            try {
                Files.deleteIfExists(Path.of(doc.getLocalPath()));
            } catch (Exception ignored) {}
        }
        mapper.deleteById(id);
        return Result.ok();
    }

    private List<String> parseTags(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "tags 必须是 JSON 数组：" + e.getMessage());
        }
    }

    public static class RichDocReq {
        public Long id;
        public String title;
        public String json;
    }
}
