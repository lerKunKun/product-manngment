package com.biou.shopifyhub.file;

import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.IOException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Set;

/**
 * R2 / S3 文件读写 + 折中签名（方案 B）。
 *
 * 当前实现：直接对象上传 + 拿短期 GET 预签名 URL（4h）。
 * file_sign_token 表 + scope_keys 限制留 Wave 2 完整化（当前直接返回 presigned URL，无 scope 校验）。
 */
@Service
public class FileService {

    private static final Logger log = LoggerFactory.getLogger(FileService.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final Set<String> ALLOWED_MIME = Set.of(
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml",
        "video/mp4", "video/webm",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "text/csv", "text/markdown", "text/plain"
    );
    private static final long MAX_SIZE = 20L * 1024 * 1024; // 20 MB

    private final S3Client s3;
    private final S3Presigner presigner;

    @Value("${R2_BUCKET:shopify-themes}")
    private String bucket;

    @Value("${R2_PRODUCT_MEDIA_BUCKET:product-media}")
    private String mediaBucket;

    @Value("${R2_PUBLIC_BASE:}")
    private String publicBase;

    public FileService(S3Client s3, S3Presigner presigner) {
        this.s3 = s3;
        this.presigner = presigner;
    }

    /** 上传产品图片到 R2 product-media 桶 → 返回可访问 URL */
    public UploadResult uploadProductImage(Long productId, MultipartFile file) {
        validate(file);
        String ext = guessExt(file.getContentType(), file.getOriginalFilename());
        String key = "products/" + productId + "/images/" + System.currentTimeMillis() + "-"
            + Long.toHexString(RNG.nextLong()) + ext;
        return uploadInternal(mediaBucket, key, file);
    }

    /** 上传通用文件（如富文本图片） */
    public UploadResult uploadDoc(Long productId, MultipartFile file) {
        validate(file);
        String key = "products/" + productId + "/docs/" + System.currentTimeMillis() + "-"
            + sanitize(file.getOriginalFilename());
        return uploadInternal(mediaBucket, key, file);
    }

    private UploadResult uploadInternal(String b, String key, MultipartFile file) {
        try {
            s3.putObject(PutObjectRequest.builder()
                    .bucket(b)
                    .key(key)
                    .contentType(file.getContentType())
                    .contentLength(file.getSize())
                    .build(),
                RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
        } catch (IOException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "上传失败: " + e.getMessage());
        } catch (Exception e) {
            log.error("R2 putObject error key={}", key, e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "对象存储不可用: " + e.getMessage());
        }
        // 公开桶时拼公开 URL；私有时返回 presigned
        String url = (publicBase != null && !publicBase.isBlank())
            ? publicBase.replaceAll("/$", "") + "/" + key
            : presignGet(b, key, Duration.ofHours(4));
        return new UploadResult(b, key, url);
    }

    /**
     * Raw byte upload to the default bucket (used by snapshot generation, W2-SNAP-04).
     *
     * @param key         object key, e.g. {@code tenants/1/stores/2/snapshots/3/product/snapshot.csv}
     * @param body        bytes to upload (full content; not streamed)
     * @param contentType MIME type, e.g. {@code text/csv}; if null, S3 will default
     */
    public void uploadBytes(String key, byte[] body, String contentType) throws IOException {
        try {
            PutObjectRequest.Builder req = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentLength((long) body.length);
            if (contentType != null && !contentType.isBlank()) {
                req.contentType(contentType);
            }
            s3.putObject(req.build(), RequestBody.fromBytes(body));
        } catch (Exception e) {
            throw new IOException("R2 putObject failed key=" + key + ": " + e.getMessage(), e);
        }
    }

    /**
     * Raw byte download from the default bucket (used by snapshot generation, W2-SNAP-04).
     *
     * @param key object key
     * @return full body bytes
     * @throws IOException on any S3/R2 error (object missing, network, etc.)
     */
    public byte[] downloadBytes(String key) throws IOException {
        try {
            ResponseBytes<GetObjectResponse> resp = s3.getObjectAsBytes(GetObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build());
            return resp.asByteArray();
        } catch (Exception e) {
            throw new IOException("R2 getObject failed key=" + key + ": " + e.getMessage(), e);
        }
    }

    /** 生成 presigned GET URL */
    public String presignGet(String b, String key, Duration ttl) {
        return presigner.presignGetObject(GetObjectPresignRequest.builder()
            .signatureDuration(ttl)
            .getObjectRequest(GetObjectRequest.builder().bucket(b).key(key).build())
            .build()).url().toString();
    }

    private void validate(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "文件为空");
        }
        if (file.getSize() > MAX_SIZE) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "文件超过 20MB（当前 " + (file.getSize() / 1024 / 1024) + " MB）");
        }
        String mime = file.getContentType();
        if (mime == null || !ALLOWED_MIME.contains(mime)) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "不支持的文件类型: " + mime);
        }
    }

    private static String guessExt(String mime, String name) {
        if (name != null && name.contains(".")) {
            return name.substring(name.lastIndexOf("."));
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
            case "application/pdf" -> ".pdf";
            default -> "";
        };
    }

    private static String sanitize(String name) {
        if (name == null) return "file";
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    public record UploadResult(String bucket, String key, String url) {}
}
