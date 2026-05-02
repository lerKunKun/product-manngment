package com.biou.shopifyhub.guide;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.guide.entity.GuideDoc;
import com.biou.shopifyhub.guide.mapper.GuideDocMapper;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * W3-GUIDE-02: 指导文档（guide_doc）薄 CRUD 控制器。
 *
 * <p>对应 Day 1 数据层（{@link GuideDoc} + {@link GuideDocMapper}）。
 * 业务逻辑简单（DRAFT → PUBLISHED → ARCHIVED），不抽 Service。
 */
@RestController
@RequestMapping("/guide-doc")
public class GuideDocController {

    private final GuideDocMapper mapper;

    public GuideDocController(GuideDocMapper mapper) {
        this.mapper = mapper;
    }

    @GetMapping
    public Result<Page<GuideDoc>> list(@RequestParam(defaultValue = "1") int page,
                                       @RequestParam(defaultValue = "20") int size,
                                       @RequestParam(required = false) String category,
                                       @RequestParam(required = false) String status,
                                       @RequestParam(required = false) String relatedTemplateId,
                                       @RequestParam(required = false) String keyword) {
        Page<GuideDoc> p = new Page<>(page, size);
        LambdaQueryWrapper<GuideDoc> q = new LambdaQueryWrapper<GuideDoc>()
            .orderByDesc(GuideDoc::getUpdatedAt);
        if (category != null && !category.isBlank()) {
            q.eq(GuideDoc::getCategory, category);
        }
        if (status != null && !status.isBlank()) {
            q.eq(GuideDoc::getStatus, status);
        }
        if (relatedTemplateId != null && !relatedTemplateId.isBlank()) {
            try {
                q.eq(GuideDoc::getRelatedTemplateId, Long.valueOf(relatedTemplateId));
            } catch (NumberFormatException ignore) {
                // 非法 id 无视
            }
        }
        if (keyword != null && !keyword.isBlank()) {
            q.and(w -> w.like(GuideDoc::getTitle, keyword)
                .or().like(GuideDoc::getCode, keyword));
        }
        return Result.ok(mapper.selectPage(p, q));
    }

    @GetMapping("/{id}")
    public Result<GuideDoc> get(@PathVariable Long id) {
        GuideDoc g = mapper.selectById(id);
        if (g == null) {
            return Result.error(ResultCode.NOT_FOUND, "guide not found");
        }
        return Result.ok(g);
    }

    @PostMapping
    public Result<Long> create(@RequestBody GuideDoc body) {
        if (body.getCode() == null || body.getCode().isBlank()) {
            return Result.error(ResultCode.VALIDATION_FAILED, "code required");
        }
        if (body.getTitle() == null || body.getTitle().isBlank()) {
            return Result.error(ResultCode.VALIDATION_FAILED, "title required");
        }
        if (body.getStatus() == null || body.getStatus().isBlank()) {
            body.setStatus("DRAFT");
        }
        body.setId(null);
        body.setCreatedBy(CurrentUser.userIdOrNull());
        mapper.insert(body);
        return Result.ok(body.getId());
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody GuideDoc body) {
        GuideDoc existing = mapper.selectById(id);
        if (existing == null) {
            return Result.error(ResultCode.NOT_FOUND, "guide not found");
        }
        body.setId(id);
        // 不允许通过 update 改 createdBy / 时间戳
        body.setCreatedBy(existing.getCreatedBy());
        body.setCreatedAt(existing.getCreatedAt());
        mapper.updateById(body);
        return Result.ok();
    }

    @PostMapping("/{id}/publish")
    @RequireSensitiveOp("GUIDE_PUBLISH")
    public Result<Void> publish(@PathVariable Long id) {
        GuideDoc g = mapper.selectById(id);
        if (g == null) {
            return Result.error(ResultCode.NOT_FOUND, "guide not found");
        }
        g.setStatus("PUBLISHED");
        mapper.updateById(g);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    @RequireSensitiveOp("GUIDE_DELETE")
    public Result<Void> delete(@PathVariable Long id) {
        mapper.deleteById(id);
        return Result.ok();
    }
}
