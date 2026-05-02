package com.biou.shopifyhub.store;

import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.store.entity.Store;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/store")
public class StoreController {

    private final StoreService service;

    public StoreController(StoreService service) {
        this.service = service;
    }

    @GetMapping
    public Result<List<Map<String, Object>>> list(
            @RequestParam(required = false) Long tenantId,
            @RequestParam(required = false) Boolean partnerCollab,
            @RequestParam(required = false) Boolean devStore) {
        List<Store> stores = service.list(tenantId, partnerCollab, devStore);
        List<Map<String, Object>> dto = stores.stream().map(s -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", s.getId());
            m.put("myshopifyDomain", s.getMyshopifyDomain());
            m.put("customDomain", s.getCustomDomain());
            m.put("brandName", s.getBrandName());
            m.put("tokenType", s.getTokenType());
            m.put("status", s.getStatus());
            m.put("expiresAt", s.getExpiresAt());
            m.put("isDevStore", s.getIsDevStore());
            m.put("isPartnerCollab", s.getIsPartnerCollab());
            m.put("createdAt", s.getCreatedAt());
            return m;
        }).toList();
        return Result.ok(dto);
    }

    @PostMapping("/connect/custom-app")
    public Result<Map<String, Long>> connectCustomApp(@RequestBody StoreService.ConnectCustomAppReq req) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        Long id = service.connectCustomApp(req, uid);
        return Result.ok(Map.of("storeId", id));
    }

    /** 删除店铺是危险操作 */
    @RequireSensitiveOp("STORE_DELETE")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.delete(id, uid);
        return Result.ok();
    }

    /** W3-PV-01：把店铺打入合作者店铺池 */
    @RequireSensitiveOp("STORE_MARK_PARTNER_COLLAB")
    @PostMapping("/{id}/mark-partner-collab")
    public Result<Void> markPartnerCollab(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.setPartnerCollab(id, true, uid);
        return Result.ok();
    }

    /** W3-PV-01：把店铺移出合作者店铺池 */
    @RequireSensitiveOp("STORE_MARK_PARTNER_COLLAB")
    @PostMapping("/{id}/unmark-partner-collab")
    public Result<Void> unmarkPartnerCollab(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.setPartnerCollab(id, false, uid);
        return Result.ok();
    }

    /** W3-PV-01：标记店铺为 dev store（影响计费 / 试用规则） */
    @RequireSensitiveOp("STORE_MARK_DEV_STORE")
    @PostMapping("/{id}/mark-dev-store")
    public Result<Void> markDevStore(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.setDevStore(id, true, uid);
        return Result.ok();
    }
}
