package com.biou.shopifyhub.ops.audit;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.biou.shopifyhub.ops.audit.entity.AuditArchiveLog;
import com.biou.shopifyhub.ops.audit.mapper.AuditArchiveLogMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

/**
 * W4-OPS-01 审计日志月归档。
 *
 * <p>每月 1 号 02:30 归档「上上月」（now-2M）数据：
 *  1. INSERT audit_archive_log RUNNING
 *  2. SELECT sys_audit_log WHERE created_at ∈ [start, end)
 *  3. JSONL → gzip → AES-256-GCM（用 BACKUP_AES_KEY）
 *  4. 上传 R2（bucket=R2_AUDIT_ARCHIVE_BUCKET，key=audit-archive/YYYY/YYYY-MM.jsonl.gz.enc）
 *  5. 计算 SHA-256，UPDATE SUCCESS
 *  6. 校验通过后 DELETE 归档窗口的 sys_audit_log（注意：上传成功 + sha256 匹配才删）
 *
 * <p>失败：UPDATE FAILED + error_msg + 触发 BACKUP_FAIL 通知。
 */
@Component
public class AuditArchiveScheduler {

    private static final Logger log = LoggerFactory.getLogger(AuditArchiveScheduler.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final DateTimeFormatter MONTH_FMT = DateTimeFormatter.ofPattern("yyyy-MM");

    private final AuditArchiveLogMapper archiveMapper;
    private final JdbcTemplate jdbc;
    private final FileService fileService;
    private final NotificationDispatcher notifier;

    @Value("${ops.audit-archive-bucket:${R2_AUDIT_ARCHIVE_BUCKET:audit-archive}}")
    private String archiveBucket;

    @Value("${BACKUP_AES_KEY:}")
    private String backupAesKey;

    @Value("${ops.notify-fallback-user-id:0}")
    private Long fallbackUserId;

    public AuditArchiveScheduler(AuditArchiveLogMapper archiveMapper,
                                 JdbcTemplate jdbc,
                                 FileService fileService,
                                 NotificationDispatcher notifier) {
        this.archiveMapper = archiveMapper;
        this.jdbc = jdbc;
        this.fileService = fileService;
        this.notifier = notifier;
    }

    @Scheduled(cron = "${ops.audit-archive-cron:0 30 2 1 * *}")
    public void runScheduled() {
        YearMonth target = YearMonth.now().minusMonths(2);
        try {
            archive(target);
        } catch (Exception e) {
            log.error("[audit-archive] cron run failed for month={}", target, e);
        }
    }

    /** 手动 / 测试触发：归档指定月。月已存在 SUCCESS 直接跳过。 */
    public AuditArchiveLog archive(YearMonth month) {
        String monthKey = month.format(MONTH_FMT);
        AuditArchiveLog existing = archiveMapper.selectOne(
            new LambdaQueryWrapper<AuditArchiveLog>().eq(AuditArchiveLog::getArchiveMonth, monthKey));
        if (existing != null && "SUCCESS".equals(existing.getStatus())) {
            log.info("[audit-archive] month={} already SUCCESS, skip", monthKey);
            return existing;
        }
        if (backupAesKey == null || backupAesKey.isBlank()) {
            log.warn("[audit-archive] BACKUP_AES_KEY not configured; skip month={}", monthKey);
            return null;
        }

        AuditArchiveLog row = existing != null ? existing : new AuditArchiveLog();
        row.setArchiveMonth(monthKey);
        row.setStatus("RUNNING");
        row.setStartedAt(LocalDateTime.now());
        row.setR2Bucket(archiveBucket);
        row.setR2Key(buildKey(month));
        if (existing == null) archiveMapper.insert(row); else archiveMapper.updateById(row);

        try {
            LocalDateTime start = month.atDay(1).atStartOfDay();
            LocalDateTime end = month.plusMonths(1).atDay(1).atStartOfDay();

            List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM sys_audit_log WHERE created_at >= ? AND created_at < ? ORDER BY id",
                start, end);
            if (rows.isEmpty()) {
                row.setRowCount(0L);
                row.setStatus("SUCCESS");
                row.setFinishedAt(LocalDateTime.now());
                archiveMapper.updateById(row);
                log.info("[audit-archive] month={} no rows; mark SUCCESS empty", monthKey);
                return row;
            }

            row.setStartId(toLong(rows.get(0).get("id")));
            row.setEndId(toLong(rows.get(rows.size() - 1).get("id")));
            row.setRowCount((long) rows.size());

            byte[] jsonlGz = serializeJsonlGzip(rows);
            row.setBytesCompressed((long) jsonlGz.length);

            String encryptedB64 = AesGcmUtil.encrypt(java.util.Base64.getEncoder().encodeToString(jsonlGz), backupAesKey);
            byte[] encrypted = encryptedB64.getBytes(StandardCharsets.US_ASCII);
            row.setBytesEncrypted((long) encrypted.length);

            row.setSha256(sha256Hex(encrypted));

            fileService.uploadBytes(row.getR2Key(), encrypted, "application/octet-stream");

            row.setStatus("SUCCESS");
            row.setFinishedAt(LocalDateTime.now());
            archiveMapper.updateById(row);

            int deleted = jdbc.update(
                "DELETE FROM sys_audit_log WHERE created_at >= ? AND created_at < ?", start, end);
            log.info("[audit-archive] month={} rows={} bytes_enc={} sha={} deleted_src={}",
                monthKey, row.getRowCount(), row.getBytesEncrypted(), row.getSha256(), deleted);
            return row;
        } catch (Exception e) {
            log.error("[audit-archive] month={} FAILED", monthKey, e);
            row.setStatus("FAILED");
            row.setErrorMsg(e.getMessage());
            row.setFinishedAt(LocalDateTime.now());
            archiveMapper.updateById(row);
            try {
                if (fallbackUserId != null && fallbackUserId > 0) {
                    notifier.notifyUser(fallbackUserId, NotificationEventCode.BACKUP_FAIL,
                        "审计归档失败 " + monthKey,
                        "AuditArchiveScheduler month=" + monthKey + " 失败：" + e.getMessage(), null);
                }
            } catch (Exception ignored) { /* notify is best-effort */ }
            return row;
        }
    }

    private static String buildKey(YearMonth m) {
        return "audit-archive/" + m.getYear() + "/" + m.format(MONTH_FMT) + ".jsonl.gz.enc";
    }

    private static byte[] serializeJsonlGzip(List<Map<String, Object>> rows) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
            for (Map<String, Object> r : rows) {
                gz.write(JSON.writeValueAsBytes(r));
                gz.write('\n');
            }
        }
        return out.toByteArray();
    }

    private static String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static Long toLong(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(o.toString());
        } catch (Exception e) {
            return null;
        }
    }

    /** 仅用于手动触发端点；包内可见，由 Controller 调用。 */
    public AuditArchiveLog runForMonth(LocalDate anyDayInMonth) {
        return archive(YearMonth.from(anyDayInMonth));
    }
}
