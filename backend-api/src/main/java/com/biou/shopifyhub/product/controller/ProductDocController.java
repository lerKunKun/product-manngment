package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.product.entity.ProductDoc;
import com.biou.shopifyhub.product.mapper.ProductDocMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;

import java.util.List;
import java.util.Map;

/**
 * 产品媒体 / 需求文档 CRUD：
 *  - FILE 类型：multipart 上传 → R2 product-media 桶 → 入库
 *  - RICH_TEXT 类型：直接保存 TipTap JSON
 *  - 删除时同步删 R2 对象
 */
@RestController
public class ProductDocController {

    private static final Logger log = LoggerFactory.getLogger(ProductDocController.class);

    private final ProductDocMapper mapper;
    private final FileService fileService;
    private final S3Client s3;

    @Value("${R2_PRODUCT_MEDIA_BUCKET:product-media}")
    private String mediaBucket;

    public ProductDocController(ProductDocMapper mapper, FileService fileService, S3Client s3) {
        this.mapper = mapper;
        this.fileService = fileService;
        this.s3 = s3;
    }

    @GetMapping("/product/{productId}/doc")
    public Result<List<ProductDoc>> list(@PathVariable Long productId) {
        return Result.ok(mapper.selectList(new QueryWrapper<ProductDoc>()
            .eq("product_id", productId)
            .orderByAsc("sort")
            .orderByDesc("created_at")));
    }

    /** 文件上传：直接 multipart 走 FileService → R2 → 落库 */
    @PostMapping("/product/{productId}/doc/upload")
    public Result<Map<String, Object>> upload(
        @PathVariable Long productId,
        @RequestParam("file") MultipartFile file,
        @RequestParam(value = "title", required = false) String title
    ) {
        FileService.UploadResult r = fileService.uploadDoc(productId, file);

        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;

        ProductDoc doc = new ProductDoc();
        doc.setProductId(productId);
        doc.setType("FILE");
        doc.setFileR2Key(r.key());
        doc.setFileUrl(r.url());
        doc.setFileName(file.getOriginalFilename());
        doc.setFileSize(file.getSize());
        doc.setFileMime(file.getContentType());
        doc.setTitle(title != null ? title : file.getOriginalFilename());
        doc.setSort(0);
        doc.setCreatedBy(uid);
        mapper.insert(doc);

        return Result.ok(Map.of(
            "id", doc.getId(),
            "url", r.url(),
            "key", r.key(),
            "fileName", file.getOriginalFilename(),
            "fileSize", file.getSize()
        ));
    }

    /** 保存 TipTap 富文本 JSON */
    @PostMapping("/product/{productId}/doc/rich")
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
        mapper.deleteById(id);
        return Result.ok();
    }

    public static class RichDocReq {
        public Long id;
        public String title;
        public String json;
    }
}
