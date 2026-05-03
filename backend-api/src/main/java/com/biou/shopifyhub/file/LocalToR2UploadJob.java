package com.biou.shopifyhub.file;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.product.entity.ProductDoc;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.mapper.ProductDocMapper;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.util.List;

/**
 * F2 子轨道：本地暂存 → R2 后台搬运任务。
 *
 * <p><b>架构选型说明</b>（用户问题 F2 步骤 4「后端→worker 通讯」）：
 * 本项目的 asset-worker 是 FastAPI 服务，<b>不消费 RabbitMQ</b>，且没有直接 DB 访问 / 共享文件
 * 系统挂载。给 worker 加 DB / 共享卷的成本远大于「backend 在进程内自己搬」，因为 R2 上传无非
 * {@link S3Client#putObject} 一行 SDK 调用，backend 已经拥有 {@link FileService} / {@link S3Client}。
 *
 * <p>所以本批选型：<b>方案 B 的变体 —— backend 进程内调度轮询</b>。
 * <ul>
 *   <li>每 5s 扫 product_image / product_doc 中 r2_status='PENDING' 的行（命中 V30 加的 idx_r2_status 索引）</li>
 *   <li>读 local_path → S3Client.putObject → 写 src/file_url + r2_status=DONE + 删本地文件</li>
 *   <li>失败 → r2_status=FAILED + r2_error</li>
 * </ul>
 *
 * <p><b>视频缩略图</b>：backend 在 JVM 里做 ffmpeg 抽帧成本高（要装 native binary + JNI），
 * 此批选择 <b>留 TODO + 前端 fallback</b>：thumbnail_url 写 NULL，前端用 {@code <video poster="">}
 * 不传 poster 时浏览器自动显示视频第一帧。真缩略图后续在 asset-worker 里用 ffmpeg-python 实现，
 * 见 {@code asset-worker/app/services/upload_local_to_r2.py} 占位文件。
 *
 * <p><b>病毒扫描</b>：scan_status 字段已留好；本批不接真扫描引擎，office 文件落 NOT_SCANNED；
 * 见 {@link FileScanController} 占位接口。
 */
@Component
public class LocalToR2UploadJob {

    private static final Logger log = LoggerFactory.getLogger(LocalToR2UploadJob.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final int BATCH_SIZE = 20;

    private final ProductImageMapper imageMapper;
    private final ProductDocMapper docMapper;
    private final S3Client s3;
    private final UploadConfig uploadConfig;

    @Value("${R2_PRODUCT_MEDIA_BUCKET:product-media}")
    private String mediaBucket;

    @Value("${R2_PUBLIC_BASE:}")
    private String publicBase;

    public LocalToR2UploadJob(
        ProductImageMapper imageMapper,
        ProductDocMapper docMapper,
        S3Client s3,
        UploadConfig uploadConfig
    ) {
        this.imageMapper = imageMapper;
        this.docMapper = docMapper;
        this.s3 = s3;
        this.uploadConfig = uploadConfig;
    }

    /** 每 5s 跑一次；fixedDelay 让上一轮完成后再排下一轮，避免重叠。 */
    @Scheduled(fixedDelayString = "${upload.r2-job.fixed-delay-ms:5000}",
               initialDelayString = "${upload.r2-job.initial-delay-ms:10000}")
    public void run() {
        try {
            processImages();
        } catch (Exception e) {
            log.warn("[r2-upload-job] images 扫描异常 err={}", e.getMessage());
        }
        try {
            processDocs();
        } catch (Exception e) {
            log.warn("[r2-upload-job] docs 扫描异常 err={}", e.getMessage());
        }
    }

    private void processImages() {
        List<ProductImage> rows = imageMapper.selectList(new QueryWrapper<ProductImage>()
            .eq("r2_status", "PENDING")
            .isNotNull("local_path")
            .last("LIMIT " + BATCH_SIZE));
        for (ProductImage img : rows) {
            uploadOneImage(img);
        }
    }

    private void uploadOneImage(ProductImage img) {
        // 抢占：先把 r2_status 切到 UPLOADING，避免下一轮重复处理
        ProductImage claim = new ProductImage();
        claim.setId(img.getId());
        claim.setR2Status("UPLOADING");
        imageMapper.updateById(claim);

        try {
            Path file = Paths.get(img.getLocalPath());
            if (!Files.exists(file)) {
                throw new IOException("本地文件不存在: " + img.getLocalPath());
            }
            byte[] bytes = Files.readAllBytes(file);
            String ext = guessExt(img.getLocalPath());
            String key = "products/" + img.getProductId() + "/images/"
                + System.currentTimeMillis() + "-" + Long.toHexString(RNG.nextLong()) + ext;
            PutObjectRequest.Builder req = PutObjectRequest.builder()
                .bucket(mediaBucket)
                .key(key)
                .contentLength((long) bytes.length);
            String mime = guessMime(ext);
            if (mime != null) req.contentType(mime);
            s3.putObject(req.build(), RequestBody.fromBytes(bytes));

            String url = (publicBase != null && !publicBase.isBlank())
                ? publicBase.replaceAll("/$", "") + "/" + key
                : key; // 私有桶时前端走签名 URL；这里先存 key，src 解析交给前端层
            ProductImage update = new ProductImage();
            update.setId(img.getId());
            update.setSrc(url);
            update.setR2Key(key);
            update.setR2Status("DONE");
            update.setLocalPath(null); // 清空 local_path 表示已只在 R2
            // TODO 视频缩略图：当前 backend 不做 ffmpeg；asset-worker 接 ffmpeg-python 后回填 thumbnail_url
            imageMapper.updateById(update);

            // R2 写成功后删本地文件
            try {
                Files.deleteIfExists(file);
            } catch (Exception e) {
                log.warn("[r2-upload-job] 删本地失败 path={} err={}", file, e.getMessage());
            }
            log.info("[r2-upload-job] image 上传完成 id={} key={}", img.getId(), key);
        } catch (Exception e) {
            log.warn("[r2-upload-job] image 上传失败 id={} err={}", img.getId(), e.getMessage());
            ProductImage fail = new ProductImage();
            fail.setId(img.getId());
            fail.setR2Status("FAILED");
            fail.setR2Error(truncate(e.getMessage(), 1024));
            imageMapper.updateById(fail);
        }
    }

    private void processDocs() {
        List<ProductDoc> rows = docMapper.selectList(new QueryWrapper<ProductDoc>()
            .eq("r2_status", "PENDING")
            .eq("type", "FILE")
            .isNotNull("local_path")
            .last("LIMIT " + BATCH_SIZE));
        for (ProductDoc doc : rows) {
            uploadOneDoc(doc);
        }
    }

    private void uploadOneDoc(ProductDoc doc) {
        ProductDoc claim = new ProductDoc();
        claim.setId(doc.getId());
        claim.setR2Status("UPLOADING");
        docMapper.updateById(claim);

        try {
            Path file = Paths.get(doc.getLocalPath());
            if (!Files.exists(file)) {
                throw new IOException("本地文件不存在: " + doc.getLocalPath());
            }
            byte[] bytes = Files.readAllBytes(file);
            String safeName = sanitize(doc.getFileName() != null ? doc.getFileName() : "file");
            String key = "products/" + doc.getProductId() + "/docs/"
                + System.currentTimeMillis() + "-" + safeName;
            PutObjectRequest.Builder req = PutObjectRequest.builder()
                .bucket(mediaBucket)
                .key(key)
                .contentLength((long) bytes.length);
            if (doc.getFileMime() != null) req.contentType(doc.getFileMime());
            s3.putObject(req.build(), RequestBody.fromBytes(bytes));

            String url = (publicBase != null && !publicBase.isBlank())
                ? publicBase.replaceAll("/$", "") + "/" + key
                : key;
            ProductDoc update = new ProductDoc();
            update.setId(doc.getId());
            update.setFileR2Key(key);
            update.setFileUrl(url);
            update.setR2Status("DONE");
            update.setLocalPath(null);
            docMapper.updateById(update);

            try {
                Files.deleteIfExists(file);
            } catch (Exception e) {
                log.warn("[r2-upload-job] 删本地失败 path={} err={}", file, e.getMessage());
            }
            log.info("[r2-upload-job] doc 上传完成 id={} key={}", doc.getId(), key);
        } catch (Exception e) {
            log.warn("[r2-upload-job] doc 上传失败 id={} err={}", doc.getId(), e.getMessage());
            ProductDoc fail = new ProductDoc();
            fail.setId(doc.getId());
            fail.setR2Status("FAILED");
            fail.setR2Error(truncate(e.getMessage(), 1024));
            docMapper.updateById(fail);
        }
    }

    private static String guessExt(String localPath) {
        if (localPath == null) return "";
        int dot = localPath.lastIndexOf('.');
        return dot < 0 ? "" : localPath.substring(dot);
    }

    private static String guessMime(String ext) {
        if (ext == null) return null;
        return switch (ext.toLowerCase()) {
            case ".jpg", ".jpeg" -> "image/jpeg";
            case ".png" -> "image/png";
            case ".webp" -> "image/webp";
            case ".gif" -> "image/gif";
            case ".svg" -> "image/svg+xml";
            case ".mp4" -> "video/mp4";
            case ".webm" -> "video/webm";
            case ".pdf" -> "application/pdf";
            default -> null;
        };
    }

    private static String sanitize(String name) {
        if (name == null) return "file";
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
