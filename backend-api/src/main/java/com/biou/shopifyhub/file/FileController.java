package com.biou.shopifyhub.file;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/file")
public class FileController {

    private final FileService fileService;
    private final ProductImageMapper imageMapper;

    public FileController(FileService fileService, ProductImageMapper imageMapper) {
        this.fileService = fileService;
        this.imageMapper = imageMapper;
    }

    /** 上传产品主图 → 入 product_image 表 + 返回 URL */
    @PostMapping("/product/{productId}/image")
    public Result<Map<String, Object>> uploadProductImage(
        @PathVariable Long productId,
        @RequestParam("file") MultipartFile file
    ) {
        FileService.UploadResult r = fileService.uploadProductImage(productId, file);

        // 写入 product_image 表；r2_key 跟 src 一并落，push 时 buildProductPayload
        // 才能把私有 R2 key 走 media_r2_keys[] 让 worker 拉下来（否则永远走 images[].src
        // 公网 URL 路径，私有桶图片就没法推到 Shopify）
        Long maxPos = imageMapper.selectCount(new QueryWrapper<ProductImage>().eq("product_id", productId));
        ProductImage img = new ProductImage();
        img.setProductId(productId);
        img.setSrc(r.url());
        img.setR2Key(r.key());
        img.setPosition(maxPos.intValue() + 1);
        img.setGiftCard(false);
        imageMapper.insert(img);

        return Result.ok(Map.of("imageId", img.getId(), "src", r.url(), "key", r.key()));
    }

    /** 上传通用文档（TipTap 富文本里粘贴的图片） → 不入业务表，仅返回 URL */
    @PostMapping("/upload-doc")
    public Result<Map<String, String>> uploadDoc(
        @RequestParam(value = "productId", required = false) Long productId,
        @RequestParam("file") MultipartFile file
    ) {
        FileService.UploadResult r = fileService.uploadDoc(productId == null ? 0L : productId, file);
        return Result.ok(Map.of("url", r.url(), "key", r.key()));
    }
}
