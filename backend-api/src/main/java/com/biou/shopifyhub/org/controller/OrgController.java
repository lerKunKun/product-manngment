package com.biou.shopifyhub.org.controller;

import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.service.OrgService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/org")
public class OrgController {

    private final OrgService service;

    public OrgController(OrgService service) {
        this.service = service;
    }

    @GetMapping("/tree")
    public Result<List<Map<String, Object>>> tree() {
        return Result.ok(service.tree());
    }

    @GetMapping
    public Result<List<SysOrg>> list() {
        return Result.ok(service.listAll());
    }

    @PostMapping
    public Result<Map<String, Long>> create(@RequestBody SysOrg input) {
        Long id = service.create(input);
        return Result.ok(Map.of("id", id));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody SysOrg patch) {
        service.update(id, patch);
        return Result.ok();
    }

    /** 删除组织节点是危险操作，需走二次确认 */
    @RequireSensitiveOp("ORG_DELETE")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        service.softDelete(id);
        return Result.ok();
    }
}
