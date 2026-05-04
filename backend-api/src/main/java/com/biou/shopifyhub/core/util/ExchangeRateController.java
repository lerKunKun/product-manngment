package com.biou.shopifyhub.core.util;

import com.biou.shopifyhub.core.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * 通用工具类端点。当前只有汇率展示用。
 * 路径 /util/** 默认走 SecurityConfig 的 .authenticated()（AppShell 内已登录）。
 */
@RestController
@RequestMapping("/util")
public class ExchangeRateController {

    private final ExchangeRateService service;

    public ExchangeRateController(ExchangeRateService service) {
        this.service = service;
    }

    @GetMapping("/usd-cny-rate")
    public Result<Map<String, Object>> usdCny() {
        ExchangeRateService.Snapshot s = service.getUsdCny();
        Map<String, Object> body = new HashMap<>();
        body.put("rate", s.rate());           // BigDecimal 或 null
        body.put("fetchedAt", s.fetchedAt()); // epoch millis
        body.put("source", s.source());
        if (s.error() != null) body.put("error", s.error());
        return Result.ok(body);
    }
}
