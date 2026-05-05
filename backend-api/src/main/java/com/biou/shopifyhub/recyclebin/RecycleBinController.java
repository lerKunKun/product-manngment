package com.biou.shopifyhub.recyclebin;

import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.ResultCode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 回收站 API。Wave 1 简化：
 *  - 列表：select * where deleted_at IS NOT NULL；返回 90 天倒计时
 *  - 恢复：update set deleted_at=NULL（仅平台超管/分公司管理员）
 *  - 仅覆盖 sys_user / user_invitation / sys_org 三个表（未来按需扩展白名单）
 */
@RestController
@RequestMapping("/recyclebin")
public class RecycleBinController {

    private static final Set<String> ALLOWED_TABLES = Set.of("sys_user", "user_invitation", "sys_org");

    private final JdbcTemplate jdbc;

    public RecycleBinController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/{table}")
    @PreAuthorize("hasAuthority('PERM_RECYCLE_BIN:VIEW')")
    public Result<List<Map<String, Object>>> list(@PathVariable String table) {
        ensureAllowed(table);
        // 注意：rsults 包含 raw 列（含敏感字段如 password_hash）—— 上线前应过滤
        // Wave 1 简化版：仅暴露 id/email/name/deleted_at + 计算 days_left
        String sql = switch (table) {
            case "sys_user" -> "SELECT id, employee_no, username, email, status, deleted_at, "
                + "DATEDIFF(deleted_at + INTERVAL 90 DAY, NOW()) AS days_left "
                + "FROM sys_user WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC";
            // user_invitation 没有 deleted_at 列；REVOKED 视作"已删"，倒计时按 revoked_at + 90d
            case "user_invitation" -> "SELECT id, email, status, revoked_at AS deleted_at, revoke_reason, "
                + "DATEDIFF(revoked_at + INTERVAL 90 DAY, NOW()) AS days_left "
                + "FROM user_invitation WHERE status='REVOKED' ORDER BY revoked_at DESC";
            case "sys_org" -> "SELECT id, name, code, type, deleted_at, "
                + "DATEDIFF(deleted_at + INTERVAL 90 DAY, NOW()) AS days_left "
                + "FROM sys_org WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC";
            default -> throw new IllegalStateException();
        };
        return Result.ok(jdbc.queryForList(sql));
    }

    @RequireSensitiveOp("RECYCLE_RESTORE")
    @PreAuthorize("hasAuthority('PERM_RECYCLE_BIN:RESTORE')")
    @PostMapping("/{table}/{id}/restore")
    public Result<Void> restore(@PathVariable String table, @PathVariable Long id) {
        ensureAllowed(table);
        int n = jdbc.update("UPDATE " + table + " SET deleted_at = NULL WHERE id = ?", id);
        if (n == 0) throw new BusinessException(ResultCode.NOT_FOUND, "记录不存在或未在回收站中");
        return Result.ok();
    }

    private void ensureAllowed(String table) {
        if (!ALLOWED_TABLES.contains(table)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "不支持的表: " + table);
        }
    }
}
