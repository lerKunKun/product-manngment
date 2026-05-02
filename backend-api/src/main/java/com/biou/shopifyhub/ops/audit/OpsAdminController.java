package com.biou.shopifyhub.ops.audit;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.metrics.MetricsRegistry;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.ops.audit.entity.AuditArchiveLog;
import com.biou.shopifyhub.ops.audit.mapper.AuditArchiveLogMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * T14 admin 浏览器调用版：审计归档查看 / 下载 / 备份状态 / 手动触发。
 * 与 {@link BackupNotifyController} 区别：无 loopback 限制，敏感操作走 RequireSensitiveOp 二次确认。
 */
@RestController
@RequestMapping("/admin")
public class OpsAdminController {

    private final AuditArchiveLogMapper archiveMapper;
    private final FileService fileService;
    private final MetricsRegistry metricsRegistry;
    private final AuditArchiveScheduler auditArchiveScheduler;

    public OpsAdminController(AuditArchiveLogMapper archiveMapper,
                              FileService fileService,
                              MetricsRegistry metricsRegistry,
                              AuditArchiveScheduler auditArchiveScheduler) {
        this.archiveMapper = archiveMapper;
        this.fileService = fileService;
        this.metricsRegistry = metricsRegistry;
        this.auditArchiveScheduler = auditArchiveScheduler;
    }

    @GetMapping("/audit-archive")
    public Result<List<AuditArchiveLog>> list(@RequestParam(required = false) String from,
                                              @RequestParam(required = false) String to,
                                              @RequestParam(required = false) String status) {
        LambdaQueryWrapper<AuditArchiveLog> qw = new LambdaQueryWrapper<>();
        if (from != null && !from.isBlank()) qw.ge(AuditArchiveLog::getArchiveMonth, from);
        if (to != null && !to.isBlank()) qw.le(AuditArchiveLog::getArchiveMonth, to);
        if (status != null && !status.isBlank()) qw.eq(AuditArchiveLog::getStatus, status);
        qw.orderByDesc(AuditArchiveLog::getArchiveMonth);
        return Result.ok(archiveMapper.selectList(qw));
    }

    @GetMapping("/audit-archive/{id}/download")
    public Result<Map<String, Object>> download(@PathVariable Long id) {
        AuditArchiveLog row = archiveMapper.selectById(id);
        if (row == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "归档记录不存在");
        }
        if (!"SUCCESS".equals(row.getStatus())) {
            throw new BusinessException(ResultCode.CONFLICT, "未成功的归档不可下载");
        }
        String url = fileService.presignGet(row.getR2Bucket(), row.getR2Key(), Duration.ofMinutes(15));
        Map<String, Object> body = new HashMap<>();
        body.put("url", url);
        body.put("expiresIn", 900);
        body.put("sha256", row.getSha256());
        body.put("archiveMonth", row.getArchiveMonth());
        body.put("bytesEncrypted", row.getBytesEncrypted());
        return Result.ok(body);
    }

    @GetMapping("/ops/backup-status")
    public Result<Map<String, Object>> backupStatus() {
        Long backupAt = metricsRegistry.getBackupLastSuccessAt();
        Long archiveAt = metricsRegistry.getAuditArchiveLastSuccessAt();

        LocalDateTime sevenDaysAgo = LocalDateTime.now().minusDays(7);
        Long archiveFailed7d = archiveMapper.selectCount(new LambdaQueryWrapper<AuditArchiveLog>()
            .eq(AuditArchiveLog::getStatus, "FAILED")
            .ge(AuditArchiveLog::getStartedAt, sevenDaysAgo));

        Map<String, Object> body = new HashMap<>();
        body.put("backupLastSuccessSeconds", backupAt);
        body.put("archiveLastSuccessSeconds", archiveAt);
        body.put("archiveFailedCount7d", archiveFailed7d);
        body.put("backupFailedCount7d", 0);
        return Result.ok(body);
    }

    @PostMapping("/audit-archive/run")
    @RequireSensitiveOp("AUDIT_ARCHIVE_RUN")
    public Result<AuditArchiveLog> runArchive(@RequestBody ArchiveRunBody body) {
        if (body == null || body.month() == null || body.month().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "month 必填，格式 YYYY-MM");
        }
        YearMonth month;
        try {
            month = YearMonth.parse(body.month());
        } catch (Exception e) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "month 格式错误，应为 YYYY-MM");
        }
        return Result.ok(auditArchiveScheduler.archive(month));
    }

    public record ArchiveRunBody(String month) {}
}
