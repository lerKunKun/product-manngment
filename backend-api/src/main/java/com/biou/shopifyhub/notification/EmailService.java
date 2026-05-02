package com.biou.shopifyhub.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String configuredUser;

    @Value("${spring.mail.from:Biou x Shopify Control Center <noreply@biounetwork.com>}")
    private String defaultFrom;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    /**
     * 发送 HTML 邮件。
     * Wave 0 阶段如未配置 SMTP，记录日志并跳过（不抛异常），便于本地开发不依赖真实邮箱。
     */
    public void sendHtml(String to, String subject, String htmlBody) {
        if (configuredUser == null || configuredUser.isBlank()) {
            log.warn("[email-stub] SMTP 未配置，跳过实际发送。to={} subject={}\n--- BODY ---\n{}\n------------",
                to, subject, htmlBody);
            return;
        }
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, "UTF-8");
            helper.setFrom(defaultFrom);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(htmlBody, true);
            mailSender.send(msg);
            log.info("[email] sent to={} subject={}", to, subject);
        } catch (MessagingException e) {
            throw new IllegalStateException("Send mail failed: " + e.getMessage(), e);
        }
    }
}
