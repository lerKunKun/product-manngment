package com.biou.shopifyhub.file;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 本地暂存目录配置（F2 子轨道）。
 *
 * <p>「上传先存本地 → 后台 worker 推 R2 → R2 完毕后删本地」流程的本地落点。
 * 启动时自动 mkdir，保证后端可写。
 */
@Component
@ConfigurationProperties(prefix = "upload")
public class UploadConfig {
    /** 本地暂存根目录（相对路径相对启动目录；生产建议挂卷以便 worker 也能读到） */
    private String localDir = "./data/uploads";

    private static final Logger log = LoggerFactory.getLogger(UploadConfig.class);

    public String getLocalDir() { return localDir; }
    public void setLocalDir(String localDir) { this.localDir = localDir; }

    public Path getLocalDirPath() {
        return Paths.get(localDir).toAbsolutePath().normalize();
    }

    @PostConstruct
    public void ensureDir() {
        try {
            Path p = getLocalDirPath();
            Files.createDirectories(p);
            log.info("[upload] 本地暂存目录就绪 path={}", p);
        } catch (Exception e) {
            // 不抛 — 启动期目录创建失败不该挡死整个应用，等真实上传时再炸
            log.warn("[upload] 本地暂存目录创建失败 dir={} err={}", localDir, e.getMessage());
        }
    }
}
