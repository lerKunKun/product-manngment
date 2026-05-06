package com.biou.shopifyhub.template;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
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
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * AS6 · 模板版本（base_template_version）的查询 + metadata 编辑。
 *
 * <p>表结构由 V15 提供。**新建版本必须走 {@link BaseTemplateService#uploadVersion}**
 * （multipart 含 zip + sha256 + R2），因为 V15 的 zip_r2_key 是 NOT NULL，
 * 模板版本本质是一份带 zip 的初始化模板。
 *
 * <p>本 service 提供：
 * <ul>
 *   <li>分页 list（关键字搜 version / changelog）</li>
 *   <li>update：仅改 metadata 字段（version / changelog / defaultReplaceRulesJson / status）；
 *       不动 zip_r2_key / sha256 / bytes（要换 zip 走 W3-TPL-02 的多版本上传）</li>
 *   <li>delete：软删（@TableLogic 走 deleted_at）</li>
 * </ul>
 */
@Service
public class BaseTemplateVersionService {

    private static final Logger log = LoggerFactory.getLogger(BaseTemplateVersionService.class);

    /** semver-ish：major.minor.patch[-pre]，例 1.0.0 / 1.1.0-beta / 2.0.0-rc.1 */
    private static final Pattern VERSION_PATTERN =
        Pattern.compile("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$");

    private final BaseTemplateVersionMapper versionMapper;
    private final BaseTemplateMapper templateMapper;
    private final ObjectMapper objectMapper;

    public BaseTemplateVersionService(BaseTemplateVersionMapper versionMapper,
                                      BaseTemplateMapper templateMapper,
                                      ObjectMapper objectMapper) {
        this.versionMapper = versionMapper;
        this.templateMapper = templateMapper;
        this.objectMapper = objectMapper;
    }

    public Page<Map<String, Object>> list(int page, int size, String keyword) {
        Page<BaseTemplateVersion> p = new Page<>(page, size);
        LambdaQueryWrapper<BaseTemplateVersion> q = new LambdaQueryWrapper<BaseTemplateVersion>()
            .orderByDesc(BaseTemplateVersion::getCreatedAt);
        if (keyword != null && !keyword.isBlank()) {
            String kw = keyword.trim();
            q.and(w -> w.like(BaseTemplateVersion::getVersion, kw)
                .or().like(BaseTemplateVersion::getChangelog, kw));
        }
        Page<BaseTemplateVersion> raw = versionMapper.selectPage(p, q);

        // 给 list 增补 templateName（前端列表 "name" 列展示）
        List<Long> templateIds = raw.getRecords().stream()
            .map(BaseTemplateVersion::getTemplateId)
            .distinct()
            .collect(Collectors.toList());
        Map<Long, String> nameById = new LinkedHashMap<>();
        if (!templateIds.isEmpty()) {
            List<BaseTemplate> templates = templateMapper.selectBatchIds(templateIds);
            for (BaseTemplate t : templates) {
                nameById.put(t.getId(), t.getName());
            }
        }

        List<Map<String, Object>> enriched = raw.getRecords().stream()
            .map(v -> toView(v, nameById.get(v.getTemplateId())))
            .collect(Collectors.toList());

        Page<Map<String, Object>> out = new Page<>(p.getCurrent(), p.getSize(), p.getTotal());
        out.setRecords(enriched);
        return out;
    }

    public Map<String, Object> detail(Long id) {
        BaseTemplateVersion v = versionMapper.selectById(id);
        if (v == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "version not found");
        }
        BaseTemplate t = v.getTemplateId() == null ? null : templateMapper.selectById(v.getTemplateId());
        return toView(v, t == null ? null : t.getName());
    }

    public void update(Long id, UpdateRequest req) {
        BaseTemplateVersion v = versionMapper.selectById(id);
        if (v == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "version not found");
        }
        if (req.version() != null && !req.version().equals(v.getVersion())) {
            validateVersion(req.version());
            // 同 templateId 下 version 唯一
            BaseTemplateVersion clash = versionMapper.selectOne(
                new LambdaQueryWrapper<BaseTemplateVersion>()
                    .eq(BaseTemplateVersion::getTemplateId, v.getTemplateId())
                    .eq(BaseTemplateVersion::getVersion, req.version())
                    .ne(BaseTemplateVersion::getId, id));
            if (clash != null) {
                throw new BusinessException(ResultCode.VALIDATION_FAILED,
                    "version " + req.version() + " already exists for template " + v.getTemplateId());
            }
            v.setVersion(req.version());
        }
        if (req.description() != null) {
            v.setChangelog(req.description());
        }
        if (req.defaultReplaceRulesJson() != null) {
            validateJson(req.defaultReplaceRulesJson());
            v.setDefaultReplaceRulesJson(req.defaultReplaceRulesJson());
        }
        if (req.status() != null && !req.status().isBlank()) {
            String s = req.status().toUpperCase();
            if (!"DRAFT".equals(s) && !"PUBLISHED".equals(s) && !"DEPRECATED".equals(s)) {
                throw new BusinessException(ResultCode.VALIDATION_FAILED, "invalid status: " + req.status());
            }
            v.setStatus(s);
        }
        versionMapper.updateById(v);
        log.info("base_template_version updated id={}", id);
    }

    public void delete(Long id) {
        BaseTemplateVersion v = versionMapper.selectById(id);
        if (v == null) return;
        // V15 版本表带 deleted_at，@TableLogic 已配置 → MyBatis-Plus deleteById 自动软删
        versionMapper.deleteById(id);
        log.info("base_template_version soft-deleted id={}", id);
    }

    private void validateVersion(String version) {
        if (version == null || version.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "version required");
        }
        if (!VERSION_PATTERN.matcher(version).matches()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "version must be semver-ish, e.g. 1.0.0 / 1.1.0-beta");
        }
    }

    /** defaultReplaceRulesJson：null/blank 允许，非空必须是合法 JSON。 */
    private void validateJson(String json) {
        if (json == null || json.isBlank()) return;
        try {
            objectMapper.readTree(json);
        } catch (Exception e) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "defaultReplaceRulesJson 不是合法 JSON: " + e.getMessage());
        }
    }

    private Map<String, Object> toView(BaseTemplateVersion v, String templateName) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", v.getId());
        m.put("templateId", v.getTemplateId());
        m.put("templateName", templateName);
        m.put("version", v.getVersion());
        // 前端列 "description" 走 changelog
        m.put("description", v.getChangelog());
        m.put("changelog", v.getChangelog());
        m.put("defaultReplaceRulesJson", v.getDefaultReplaceRulesJson());
        m.put("rulesCount", countRuleKeys(v.getDefaultReplaceRulesJson()));
        m.put("zipR2Key", v.getZipR2Key());
        m.put("zipBytes", v.getZipBytes());
        m.put("zipSha256", v.getZipSha256());
        m.put("status", v.getStatus());
        m.put("createdBy", v.getCreatedBy());
        m.put("createdAt", v.getCreatedAt());
        m.put("updatedAt", v.getUpdatedAt());
        return m;
    }

    private int countRuleKeys(String json) {
        if (json == null || json.isBlank()) return 0;
        try {
            var node = objectMapper.readTree(json);
            if (node.isObject()) return node.size();
            return 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public record UpdateRequest(
        String version,
        String description,
        String defaultReplaceRulesJson,
        String status
    ) {}
}
