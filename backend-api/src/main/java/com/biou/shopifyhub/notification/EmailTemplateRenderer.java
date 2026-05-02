package com.biou.shopifyhub.notification;

import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * W4-MAIL-01：通用邮件模板渲染。与 {@link InvitationEmailRenderer} 风格一致：
 *  - 内联样式（多数邮箱客户端不读 &lt;style&gt; 块）
 *  - record-based context，调用方按需构造
 *  - 文本中的用户内容统一过 {@link #escape(String)} 防注入
 */
@Component
public class EmailTemplateRenderer {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    /** 忘记密码：一次性链接 + 30min 有效期 + 防钓鱼说明。 */
    public String renderPasswordReset(PasswordResetCtx ctx) {
        return """
            <!doctype html>
            <html lang="zh-CN">
              <body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;background:#f4f4f5;padding:24px;">
                <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e4e4e7;">
                  <h2 style="margin:0 0 16px;color:#18181b;">重置 %s 登录密码</h2>
                  <p style="color:#3f3f46;line-height:1.6;">
                    您好 %s，我们收到了重置您账号密码的请求。如非本人操作请<strong>立即忽略本邮件</strong>。
                  </p>
                  <a href="%s" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:500;margin:8px 0 16px;">立即重置密码</a>
                  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:14px;margin:8px 0 20px;">
                    <div style="font-size:13px;color:#991b1b;line-height:1.7;">
                      <strong>安全提醒</strong><br>
                      · 本链接 <strong>30 分钟内</strong>有效，仅可使用 <strong>一次</strong><br>
                      · 我们的工作人员<strong>不会</strong>主动向您索要密码或验证码<br>
                      · 申请来源 IP：<span style="font-family:'SF Mono',Menlo,Consolas,monospace;">%s</span>
                    </div>
                  </div>
                  <p style="color:#71717a;font-size:12px;line-height:1.6;word-break:break-all;">
                    如果按钮无法点击，请复制以下链接到浏览器：<br>
                    <span style="color:#3f3f46;">%s</span>
                  </p>
                  <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;">
                  <p style="color:#a1a1aa;font-size:12px;margin:0;line-height:1.6;">
                    本邮件由系统自动发送，请勿回复。<br>
                    如非本人申请，您的账号可能正被他人尝试登录，建议尽快登录系统检查最近登录记录。
                  </p>
                </div>
              </body>
            </html>
            """.formatted(
                escape(ctx.brandName()),
                escape(ctx.username()),
                ctx.resetUrl(),
                escape(ctx.requestIp() == null ? "未知" : ctx.requestIp()),
                ctx.resetUrl()
            );
    }

    /** 注册成功欢迎邮件 + 临时密码（如有）+ 首次登录引导。 */
    public String renderRegistrationWelcome(RegistrationCtx ctx) {
        String pwdBlock = ctx.tempPassword() == null || ctx.tempPassword().isBlank() ? "" : """
            <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:20px 0;">
              <div style="font-size:13px;color:#78350f;margin-bottom:6px;">临时密码（首次登录后请立即修改）</div>
              <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:18px;color:#18181b;letter-spacing:0.05em;">%s</div>
            </div>
            """.formatted(escape(ctx.tempPassword()));

        return """
            <!doctype html>
            <html lang="zh-CN">
              <body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;background:#f4f4f5;padding:24px;">
                <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e4e4e7;">
                  <h2 style="margin:0 0 16px;color:#18181b;">欢迎加入 %s</h2>
                  <p style="color:#3f3f46;line-height:1.6;">
                    您好 %s，您的账号已创建成功，可以开始使用了。
                  </p>
                  <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:16px;margin:20px 0;">
                    <div style="font-size:13px;color:#71717a;margin-bottom:6px;">登录用户名</div>
                    <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:15px;color:#18181b;">%s</div>
                  </div>
                  %s
                  <a href="%s" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:500;">立即登录</a>
                  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px;margin:20px 0 0;">
                    <div style="font-size:13px;color:#1e3a8a;line-height:1.7;">
                      <strong>首次登录建议</strong><br>
                      1. 修改默认密码<br>
                      2. 在「个人中心」绑定手机 / 钉钉以便接收通知<br>
                      3. 在「通知中心」查看分配给您的待办事项
                    </div>
                  </div>
                  <p style="color:#a1a1aa;font-size:12px;margin-top:24px;line-height:1.6;">
                    如非本人操作请忽略此邮件。<br>
                    本邮件由系统自动发送，请勿回复。
                  </p>
                </div>
              </body>
            </html>
            """.formatted(
                escape(ctx.brandName()),
                escape(ctx.username()),
                escape(ctx.username()),
                pwdBlock,
                ctx.loginUrl()
            );
    }

    /** 通用告警邮件：标题 + 级别色块 + 正文 + 时间。 */
    public String renderAlert(AlertCtx ctx) {
        AlertSeverity sev = ctx.severity() == null ? AlertSeverity.INFO : ctx.severity();
        return """
            <!doctype html>
            <html lang="zh-CN">
              <body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;background:#f4f4f5;padding:24px;">
                <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:0;overflow:hidden;border:1px solid #e4e4e7;">
                  <div style="background:%s;color:#fff;padding:16px 24px;">
                    <div style="font-size:12px;letter-spacing:0.08em;opacity:0.85;">%s · %s</div>
                    <div style="font-size:18px;font-weight:600;margin-top:4px;">%s</div>
                  </div>
                  <div style="padding:24px;">
                    <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:14px;color:#3f3f46;line-height:1.7;font-size:14px;white-space:pre-wrap;">%s</div>
                    %s
                    <p style="color:#a1a1aa;font-size:12px;margin-top:24px;line-height:1.6;">
                      告警时间：%s<br>
                      本邮件由系统自动发送，请勿回复。
                    </p>
                  </div>
                </div>
              </body>
            </html>
            """.formatted(
                sev.bgColor,
                escape(ctx.brandName()),
                sev.label,
                escape(ctx.title()),
                escape(ctx.body()),
                renderAlertLink(ctx.linkUrl(), ctx.linkText()),
                (ctx.occurredAt() == null ? LocalDateTime.now() : ctx.occurredAt()).format(DATE_FMT)
            );
    }

    private static String renderAlertLink(String url, String text) {
        if (url == null || url.isBlank()) return "";
        String label = (text == null || text.isBlank()) ? "查看详情" : text;
        return """
            <div style="margin-top:16px;">
              <a href="%s" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:500;">%s</a>
            </div>
            """.formatted(url, escape(label));
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    public enum AlertSeverity {
        INFO("提示", "#0284c7"),
        WARN("警告", "#d97706"),
        ERROR("错误", "#dc2626"),
        CRIT("严重", "#7f1d1d");
        public final String label;
        public final String bgColor;
        AlertSeverity(String label, String bgColor) { this.label = label; this.bgColor = bgColor; }
    }

    public record PasswordResetCtx(
        String brandName,
        String username,
        String resetUrl,
        String requestIp
    ) {}

    public record RegistrationCtx(
        String brandName,
        String username,
        String tempPassword,
        String loginUrl
    ) {}

    public record AlertCtx(
        String brandName,
        AlertSeverity severity,
        String title,
        String body,
        String linkUrl,
        String linkText,
        LocalDateTime occurredAt
    ) {}
}
