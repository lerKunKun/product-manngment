package com.biou.shopifyhub.notification;

import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Component
public class InvitationEmailRenderer {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    public String renderInvitation(InvitationEmailContext ctx) {
        String roles = String.join("、", ctx.roleNames());
        return """
            <!doctype html>
            <html lang="zh-CN">
              <body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;background:#f4f4f5;padding:24px;">
                <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e4e4e7;">
                  <h2 style="margin:0 0 16px;color:#18181b;">您被邀请加入 %s</h2>
                  <p style="color:#3f3f46;line-height:1.6;">
                    %s 邀请您作为<strong>临时合作账号</strong>加入系统，绑定到 <strong>%s</strong>%s。
                  </p>
                  <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:16px;margin:20px 0;">
                    <div style="font-size:13px;color:#71717a;margin-bottom:6px;">您将获得的角色</div>
                    <div style="font-size:15px;color:#18181b;font-weight:500;">%s</div>
                    <div style="font-size:13px;color:#71717a;margin:14px 0 6px;">账号有效期至</div>
                    <div style="font-size:15px;color:#dc2626;font-weight:500;">%s（到期账号将自动失效）</div>
                  </div>
                  <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:20px 0;">
                    <div style="font-size:13px;color:#78350f;margin-bottom:6px;">临时密码（首次登录后请修改）</div>
                    <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:18px;color:#18181b;letter-spacing:0.05em;">%s</div>
                  </div>
                  <a href="%s" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:500;">接受邀请</a>
                  <p style="color:#a1a1aa;font-size:12px;margin-top:24px;line-height:1.6;">
                    此链接 48 小时内有效，请尽快接受。<br>
                    如非本人操作请忽略此邮件。
                  </p>
                </div>
              </body>
            </html>
            """.formatted(
                ctx.brandName(),
                escape(ctx.invitedByName()),
                escape(ctx.companyName()),
                ctx.deptName() == null ? "" : " · " + escape(ctx.deptName()),
                escape(roles),
                ctx.accountExpiresAt().format(DATE_FMT),
                escape(ctx.tempPassword()),
                ctx.acceptUrl()
            );
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    public record InvitationEmailContext(
        String brandName,
        String invitedByName,
        String companyName,
        String deptName,
        List<String> roleNames,
        LocalDateTime accountExpiresAt,
        String tempPassword,
        String acceptUrl
    ) {}
}
