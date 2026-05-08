package com.biou.shopifyhub.file;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.BucketAlreadyExistsException;
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 启动期 R2 桶检查 / 自建。
 *
 * <p>目的：把"桶不存在"的 misconfiguration 在容器起来那一刻就暴露成清晰的启动失败，
 * 而不是等到第一次同步 / 上传产品图时才以一个被三层包装过的 IOException 形式爆出来
 * （现场常见症状：{@code worker /pull/files returned 5xx}，或 {@code R2 putObject failed}，
 * 甚至直接 {@code header parser received no bytes}，根因都指向缺桶）。
 *
 * <p>策略与 worker 端 {@code asset-worker/app/clients/r2.py#ensure_bucket} 对齐：
 * <ul>
 *   <li>headBucket 200 → 已存在，跳过</li>
 *   <li>headBucket 404 / NoSuchBucket → 尝试 createBucket</li>
 *   <li>headBucket 403 → 假设桶存在，凭据只是缺 list/head 权限（R2 数据面 token 常见）</li>
 *   <li>createBucket 失败且不是 *AlreadyOwned* → 抛 IllegalStateException 让 Spring 启动失败，
 *       消息里写清楚要去 Cloudflare 控制台手工建，或加 bucket-admin 权限，或关掉本检查</li>
 * </ul>
 *
 * <p>用 {@code shopify.r2.bucket-bootstrap.enabled=false} 关掉（默认 true）。
 */
@Component
public class R2BucketBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(R2BucketBootstrap.class);

    private final S3Client s3;

    @Value("${R2_BUCKET:}")
    private String bucket;

    @Value("${R2_PRODUCT_MEDIA_BUCKET:}")
    private String mediaBucket;

    @Value("${shopify.r2.bucket-bootstrap.enabled:true}")
    private boolean enabled;

    public R2BucketBootstrap(S3Client s3) {
        this.s3 = s3;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            log.info("[r2-bootstrap] disabled (shopify.r2.bucket-bootstrap.enabled=false)");
            return;
        }
        Set<String> targets = new LinkedHashSet<>();
        if (bucket != null && !bucket.isBlank()) targets.add(bucket);
        if (mediaBucket != null && !mediaBucket.isBlank()) targets.add(mediaBucket);
        if (targets.isEmpty()) {
            log.info("[r2-bootstrap] no bucket configured, skipping");
            return;
        }
        for (String b : targets) {
            ensureBucket(b);
        }
    }

    private void ensureBucket(String b) {
        boolean missing = false;
        try {
            s3.headBucket(r -> r.bucket(b));
            log.info("[r2-bootstrap] bucket '{}' OK", b);
            return;
        } catch (NoSuchBucketException e) {
            missing = true;
        } catch (S3Exception e) {
            int status = e.statusCode();
            if (status == 404) {
                missing = true;
            } else if (status == 403) {
                log.warn("[r2-bootstrap] head_bucket forbidden for '{}' (403) — token likely "
                    + "has object-only scope, assuming bucket exists", b);
                return;
            } else {
                log.warn("[r2-bootstrap] head_bucket bucket={} status={} err={} — assuming reachable",
                    b, status, e.getMessage());
                return;
            }
        } catch (Exception e) {
            log.warn("[r2-bootstrap] head_bucket transport error bucket={} err={} — assuming reachable",
                b, e.getMessage());
            return;
        }
        if (!missing) return;
        log.warn("[r2-bootstrap] bucket '{}' missing — attempting create", b);
        try {
            s3.createBucket(r -> r.bucket(b));
            log.info("[r2-bootstrap] bucket '{}' created", b);
        } catch (BucketAlreadyOwnedByYouException | BucketAlreadyExistsException e) {
            log.info("[r2-bootstrap] bucket '{}' already exists (raced)", b);
        } catch (Exception e) {
            throw new IllegalStateException(
                "R2 bucket '" + b + "' is missing and auto-create failed: " + e.getMessage()
                    + ". Create it manually in the Cloudflare R2 dashboard, "
                    + "or grant the access key bucket-admin permission, "
                    + "or set shopify.r2.bucket-bootstrap.enabled=false to skip.",
                e);
        }
    }
}
