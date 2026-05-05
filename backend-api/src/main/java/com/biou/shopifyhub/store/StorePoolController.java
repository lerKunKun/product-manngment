package com.biou.shopifyhub.store;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.store.entity.Store;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * W3-PV-01：合作者店铺池只读视图。
 *
 * 后续 W3-PV-03 会引入 preview_theme 表 + 容量限制；当前只暴露列表，
 * `available=true` 过滤暂为占位（TODO：W3-PV-03 落地后接 preview_theme 计数）。
 */
@RestController
@RequestMapping("/store/pool")
public class StorePoolController {

    private final StoreService service;

    public StorePoolController(StoreService service) {
        this.service = service;
    }

    @GetMapping("/partner-collab")
    @PreAuthorize("hasAuthority('PERM_STORE:READ')")
    public Result<List<Map<String, Object>>> listPartnerCollab(
            @RequestParam(required = false) Long tenantId,
            @RequestParam(required = false) Boolean available) {
        List<Store> stores = service.list(tenantId, Boolean.TRUE, null);
        // TODO(W3-PV-03)：当 available=true 时，按 preview_theme 容量过滤。
        // 当前 preview_theme 表尚未建立，所有 partner-collab 店铺一律视为可用。
        List<Map<String, Object>> dto = stores.stream().map(s -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", s.getId());
            m.put("brandName", s.getBrandName());
            m.put("myshopifyDomain", s.getMyshopifyDomain());
            m.put("isDevStore", s.getIsDevStore());
            m.put("isPartnerCollab", s.getIsPartnerCollab());
            m.put("status", s.getStatus());
            m.put("createdAt", s.getCreatedAt());
            m.put("lastRefreshAt", s.getLastRefreshAt());
            return m;
        }).toList();
        return Result.ok(dto);
    }
}
