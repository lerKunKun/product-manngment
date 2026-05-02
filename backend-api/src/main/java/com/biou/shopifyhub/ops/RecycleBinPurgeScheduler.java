package com.biou.shopifyhub.ops;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * W1-AUD-02 软删除框架收尾：每天 04:00 物理删 deleted_at <= now-90d 的行。
 *
 * 当前覆盖：sys_user / sys_org / store（都用 @TableLogic 软删，含 deleted_at 列）
 * user_invitation 没有 deleted_at，REVOKED 状态作为审计记录长期保留，不参与 purge
 */
@Component
public class RecycleBinPurgeScheduler {

    private static final Logger log = LoggerFactory.getLogger(RecycleBinPurgeScheduler.class);
    private static final List<String> TABLES = List.of("sys_user", "sys_org", "store");

    private final JdbcTemplate jdbc;

    @Autowired
    public RecycleBinPurgeScheduler(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "${ops.recycle-purge-cron:0 0 4 * * *}")
    public void purge() {
        int total = 0;
        for (String t : TABLES) {
            try {
                int n = jdbc.update(
                    "DELETE FROM " + t + " WHERE deleted_at IS NOT NULL AND deleted_at <= NOW() - INTERVAL 90 DAY"
                );
                if (n > 0) log.info("[recycle-purge] {} deleted {} rows", t, n);
                total += n;
            } catch (Exception e) {
                log.error("[recycle-purge] table={} fail: {}", t, e.getMessage());
            }
        }
        if (total > 0) log.info("[recycle-purge] total {} rows physically deleted", total);
    }
}
