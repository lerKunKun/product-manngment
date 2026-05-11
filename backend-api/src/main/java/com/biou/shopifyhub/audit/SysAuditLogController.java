package com.biou.shopifyhub.audit;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.audit.entity.SysAuditLog;
import com.biou.shopifyhub.audit.mapper.SysAuditLogMapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Admin 审计日志查询。`sensitive` 列为 MySQL 保留字，需用 QueryWrapper 显式带反引号。
 */
@RestController
@RequestMapping("/admin/audit-log")
public class SysAuditLogController {

    private static final int EXPORT_PAGE_SIZE = 500;
    private static final DateTimeFormatter FILE_TS = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    private final SysAuditLogMapper auditMapper;

    public SysAuditLogController(SysAuditLogMapper auditMapper) {
        this.auditMapper = auditMapper;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_AUDIT:READ')")
    public Result<Page<SysAuditLog>> list(@RequestParam(required = false) Long userId,
                                          @RequestParam(required = false) String module,
                                          @RequestParam(required = false) String action,
                                          @RequestParam(required = false) Boolean sensitive,
                                          @RequestParam(required = false) Instant from,
                                          @RequestParam(required = false) Instant to,
                                          @RequestParam(defaultValue = "1") int page,
                                          @RequestParam(defaultValue = "50") int size) {
        int safeSize = Math.min(Math.max(1, size), 200);
        int safePage = Math.max(1, page);
        QueryWrapper<SysAuditLog> q = buildWrapper(userId, module, action, sensitive, from, to);
        Page<SysAuditLog> p = auditMapper.selectPage(new Page<>(safePage, safeSize), q);
        return Result.ok(p);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_AUDIT:READ')")
    public Result<SysAuditLog> get(@PathVariable Long id) {
        SysAuditLog row = auditMapper.selectById(id);
        if (row == null) return Result.error(ResultCode.NOT_FOUND);
        return Result.ok(row);
    }

    /**
     * T19: 流式导出 CSV。同 list 过滤参数；分页拉（每页 {@value EXPORT_PAGE_SIZE}）写入 OutputStream。
     * UTF-8 BOM + header「时间,用户,模块,action,URI,IP,状态码,sensitive」。
     */
    @GetMapping("/export")
    @PreAuthorize("hasAuthority('PERM_AUDIT:READ')")
    public ResponseEntity<StreamingResponseBody> export(@RequestParam(required = false) Long userId,
                                                        @RequestParam(required = false) String module,
                                                        @RequestParam(required = false) String action,
                                                        @RequestParam(required = false) Boolean sensitive,
                                                        @RequestParam(required = false) Instant from,
                                                        @RequestParam(required = false) Instant to) {
        QueryWrapper<SysAuditLog> q = buildWrapper(userId, module, action, sensitive, from, to);

        StreamingResponseBody body = out -> {
            try (PrintWriter w = new PrintWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8))) {
                w.write('﻿'); // UTF-8 BOM
                w.println("时间,用户,模块,action,URI,IP,状态码,sensitive");
                long pageNo = 1;
                while (true) {
                    Page<SysAuditLog> req = new Page<>(pageNo, EXPORT_PAGE_SIZE);
                    req.setSearchCount(false);
                    Page<SysAuditLog> p = auditMapper.selectPage(req, q);
                    if (p.getRecords().isEmpty()) break;
                    for (SysAuditLog r : p.getRecords()) {
                        String userText = r.getUsername() != null
                            ? r.getUsername()
                            : (r.getUserId() != null ? "#" + r.getUserId() : "");
                        w.print(csvEscape(r.getCreatedAt() == null ? "" : r.getCreatedAt().toString()));
                        w.print(',');
                        w.print(csvEscape(userText));
                        w.print(',');
                        w.print(csvEscape(r.getModule() == null ? "" : r.getModule()));
                        w.print(',');
                        w.print(csvEscape(r.getAction() == null ? "" : r.getAction()));
                        w.print(',');
                        w.print(csvEscape(r.getRequestUri() == null ? "" : r.getRequestUri()));
                        w.print(',');
                        w.print(csvEscape(r.getIp() == null ? "" : r.getIp()));
                        w.print(',');
                        w.print(csvEscape(r.getResponseStatus() == null ? "" : String.valueOf(r.getResponseStatus())));
                        w.print(',');
                        w.print(csvEscape(Boolean.TRUE.equals(r.getSensitive()) ? "true" : "false"));
                        w.println();
                    }
                    w.flush();
                    if (p.getRecords().size() < EXPORT_PAGE_SIZE) break;
                    pageNo++;
                }
            }
        };

        String filename = "audit-log-" + LocalDateTime.now().format(FILE_TS) + ".csv";
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("text/csv; charset=utf-8"))
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .body(body);
    }

    private QueryWrapper<SysAuditLog> buildWrapper(Long userId, String module, String action,
                                                   Boolean sensitive, Instant from, Instant to) {
        QueryWrapper<SysAuditLog> q = new QueryWrapper<>();
        if (userId != null) q.eq("user_id", userId);
        if (module != null && !module.isBlank()) q.eq("module", module);
        if (action != null && !action.isBlank()) q.eq("action", action);
        if (sensitive != null) q.eq("`sensitive`", sensitive);
        if (from != null) q.ge("created_at", LocalDateTime.ofInstant(from, ZoneId.systemDefault()));
        if (to != null) q.le("created_at", LocalDateTime.ofInstant(to, ZoneId.systemDefault()));
        q.orderByDesc("id");
        return q;
    }

    private static String csvEscape(String s) {
        if (s == null) return "";
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }
}
