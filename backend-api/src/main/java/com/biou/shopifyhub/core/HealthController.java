package com.biou.shopifyhub.core;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/health")
public class HealthController {

    @Autowired(required = false)
    private DataSource dataSource;

    @Value("${spring.application.name}")
    private String appName;

    @Value("${APP_ENV:dev}")
    private String env;

    @GetMapping
    public Map<String, Object> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("app", appName);
        body.put("env", env);
        body.put("ts", Instant.now().toString());
        body.put("status", "UP");

        Map<String, Object> deps = new LinkedHashMap<>();
        deps.put("database", checkDatabase());
        body.put("dependencies", deps);

        return body;
    }

    private String checkDatabase() {
        if (dataSource == null) return "NOT_CONFIGURED";
        try (Connection c = dataSource.getConnection()) {
            return c.isValid(2) ? "UP" : "DOWN";
        } catch (Exception e) {
            return "DOWN: " + e.getClass().getSimpleName();
        }
    }
}
