package com.biou.shopifyhub;

import org.mybatis.spring.annotation.MapperScan;
import org.redisson.spring.starter.RedissonAutoConfigurationV2;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(exclude = { RedissonAutoConfigurationV2.class })
@EnableScheduling
@EnableAsync
@ConfigurationPropertiesScan("com.biou.shopifyhub")
@MapperScan(basePackages = {
    "com.biou.shopifyhub.core.mapper",
    "com.biou.shopifyhub.invitation.mapper",
    "com.biou.shopifyhub.org.mapper",
    "com.biou.shopifyhub.audit.mapper",
    "com.biou.shopifyhub.store.mapper",
    "com.biou.shopifyhub.product.mapper",
    "com.biou.shopifyhub.purchase.mapper",
    "com.biou.shopifyhub.tenant.mapper",
    "com.biou.shopifyhub.asset.mapper",
    "com.biou.shopifyhub.asset.diff.mapper",
    "com.biou.shopifyhub.snapshot.mapper",
    "com.biou.shopifyhub.push.mapper",
    "com.biou.shopifyhub.template.mapper",
    "com.biou.shopifyhub.template.binding",
    "com.biou.shopifyhub.guide.mapper",
    "com.biou.shopifyhub.preview.mapper",
    "com.biou.shopifyhub.approval.mapper",
    "com.biou.shopifyhub.notification.subscription.mapper",
    "com.biou.shopifyhub.notification.inapp.mapper",
    "com.biou.shopifyhub.auth.password.mapper",
    "com.biou.shopifyhub.ops.audit.mapper"
})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
