package com.biou.shopifyhub.template;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.template.entity.BaseTemplate;
import com.biou.shopifyhub.template.entity.BaseTemplateVersion;
import com.biou.shopifyhub.template.mapper.BaseTemplateMapper;
import com.biou.shopifyhub.template.mapper.BaseTemplateVersionMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * W3-TPL-02: 基础模板（base_template）+ 版本（base_template_version）CRUD + R2 zip 上传。
 *
 * <p>表结构由 V15 提供（Day 1）。本服务仅负责业务逻辑：
 * <ul>
 *   <li>模板列表 / 详情 / 新建 / 修改 / 发布 / 弃用 / 软删除</li>
 *   <li>版本上传（zip → R2 + sha256） / 设置默认版本</li>
 * </ul>
 *
 * <p>RBAC：PLATFORM_SUPER 限制 TODO（待 W3-RBAC 落地后激活）。
 */
@Service
public class BaseTemplateService {

    private static final Logger log = LoggerFactory.getLogger(BaseTemplateService.class);

    private final BaseTemplateMapper templateMapper;
    private final BaseTemplateVersionMapper versionMapper;
    private final FileService fileService;
    private final ObjectMapper objectMapper;

    public BaseTemplateService(BaseTemplateMapper templateMapper,
                               BaseTemplateVersionMapper versionMapper,
                               FileService fileService,
                               ObjectMapper objectMapper) {
        this.templateMapper = templateMapper;
        this.versionMapper = versionMapper;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
    }

    public Page<BaseTemplate> list(int page, int size, String category, String status, String keyword) {
        Page<BaseTemplate> p = new Page<>(page, size);
        LambdaQueryWrapper<BaseTemplate> q = new LambdaQueryWrapper<BaseTemplate>()
            .orderByDesc(BaseTemplate::getUpdatedAt);
        if (category != null && !category.isBlank()) {
            q.eq(BaseTemplate::getCategory, category);
        }
        if (status != null && !status.isBlank()) {
            q.eq(BaseTemplate::getStatus, status);
        }
        if (keyword != null && !keyword.isBlank()) {
            q.and(w -> w.like(BaseTemplate::getName, keyword)
                .or().like(BaseTemplate::getCode, keyword)
                .or().like(BaseTemplate::getDescription, keyword));
        }
        return templateMapper.selectPage(p, q);
    }

    public Map<String, Object> detail(Long id) {
        BaseTemplate t = templateMapper.selectById(id);
        if (t == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "template not found");
        }
        List<BaseTemplateVersion> versions = versionMapper.selectList(
            new LambdaQueryWrapper<BaseTemplateVersion>()
                .eq(BaseTemplateVersion::getTemplateId, id)
                .orderByDesc(BaseTemplateVersion::getCreatedAt)
        );
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("template", t);
        resp.put("versions", versions);
        return resp;
    }

    public Long create(CreateRequest req, Long userId) {
        if (req == null || req.code() == null || req.code().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "code required");
        }
        if (req.name() == null || req.name().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "name required");
        }
        BaseTemplate t = new BaseTemplate();
        t.setCode(req.code());
        t.setName(req.name());
        t.setDescription(req.description());
        t.setCategory(req.category());
        t.setStatus("DRAFT");
        t.setCreatedBy(userId);
        templateMapper.insert(t);
        log.info("base_template created id={} code={} by={}", t.getId(), t.getCode(), userId);
        return t.getId();
    }

    public void update(Long id, UpdateRequest req) {
        BaseTemplate t = templateMapper.selectById(id);
        if (t == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        if (req.name() != null) t.setName(req.name());
        if (req.description() != null) t.setDescription(req.description());
        if (req.category() != null) t.setCategory(req.category());
        if (req.coverImageR2Key() != null) t.setCoverImageR2Key(req.coverImageR2Key());
        templateMapper.updateById(t);
    }

    public void publish(Long id) {
        BaseTemplate t = templateMapper.selectById(id);
        if (t == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        if (t.getDefaultTemplateVersionId() == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "must set default version before publishing");
        }
        t.setStatus("PUBLISHED");
        templateMapper.updateById(t);
        log.info("base_template published id={}", id);
    }

    public void delete(Long id) {
        BaseTemplate t = templateMapper.selectById(id);
        if (t == null) return;
        if (!"DEPRECATED".equals(t.getStatus()) && !"DRAFT".equals(t.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "deprecate before delete");
        }
        templateMapper.deleteById(id); // soft delete via @TableLogic
        log.info("base_template soft-deleted id={}", id);
    }

    public void deprecate(Long id) {
        BaseTemplate t = templateMapper.selectById(id);
        if (t == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        t.setStatus("DEPRECATED");
        templateMapper.updateById(t);
        log.info("base_template deprecated id={}", id);
    }

    /**
     * 上传新版本：zip multipart → R2 + sha256，落 base_template_version 行。
     */
    public Long uploadVersion(Long templateId, String version, byte[] zipBytes,
                              Map<String, Object> defaultReplaceRules, String changelog, Long userId) {
        BaseTemplate t = templateMapper.selectById(templateId);
        if (t == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "template not found");
        }
        if (version == null || version.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "version required");
        }
        if (zipBytes == null || zipBytes.length == 0) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "zip empty");
        }

        // 同 templateId 下 version 唯一
        BaseTemplateVersion existing = versionMapper.selectOne(
            new LambdaQueryWrapper<BaseTemplateVersion>()
                .eq(BaseTemplateVersion::getTemplateId, templateId)
                .eq(BaseTemplateVersion::getVersion, version));
        if (existing != null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "version " + version + " already exists");
        }

        // sha256 + size
        String sha256 = hashSha256Hex(zipBytes);
        long bytes = zipBytes.length;

        // R2 上传
        String r2Key = String.format("templates/%d/versions/%s/theme.zip", templateId, version);
        try {
            fileService.uploadBytes(r2Key, zipBytes, "application/zip");
        } catch (Exception e) {
            log.error("R2 upload failed key={}", r2Key, e);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "R2 upload failed: " + e.getMessage());
        }

        BaseTemplateVersion v = new BaseTemplateVersion();
        v.setTemplateId(templateId);
        v.setVersion(version);
        v.setZipR2Key(r2Key);
        v.setZipBytes(bytes);
        v.setZipSha256(sha256);
        if (defaultReplaceRules != null && !defaultReplaceRules.isEmpty()) {
            try {
                v.setDefaultReplaceRulesJson(objectMapper.writeValueAsString(defaultReplaceRules));
            } catch (Exception e) {
                log.warn("defaultReplaceRules serialize failed templateId={} version={}", templateId, version, e);
            }
        }
        v.setChangelog(changelog);
        v.setStatus("DRAFT");
        v.setCreatedBy(userId);
        versionMapper.insert(v);
        log.info("base_template_version inserted id={} templateId={} version={} bytes={} sha256={}",
            v.getId(), templateId, version, bytes, sha256);
        return v.getId();
    }

    /**
     * 把指定版本设为模板的默认版本（同时把版本切到 PUBLISHED）。
     */
    public void setDefaultVersion(Long templateId, Long versionId) {
        BaseTemplate t = templateMapper.selectById(templateId);
        if (t == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        BaseTemplateVersion v = versionMapper.selectById(versionId);
        if (v == null || !v.getTemplateId().equals(templateId)) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "version mismatch");
        }
        v.setStatus("PUBLISHED");
        versionMapper.updateById(v);
        t.setDefaultTemplateVersionId(versionId);
        templateMapper.updateById(t);
        log.info("base_template default version set templateId={} versionId={}", templateId, versionId);
    }

    private static String hashSha256Hex(byte[] data) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(data);
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    public record CreateRequest(String code, String name, String description, String category) {}

    public record UpdateRequest(String name, String description, String category, String coverImageR2Key) {}
}
