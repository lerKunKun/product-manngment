package com.biou.shopifyhub.newstore;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.guide.entity.GuideDoc;
import com.biou.shopifyhub.guide.mapper.GuideDocMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * W3-NEW-08: Saga GUIDE step.
 *
 * <p>Reads {@code guide_doc} rows that should appear in the saga GUIDE step
 * ({@code show_in_saga_step='GUIDE' AND status='PUBLISHED'}) and writes a
 * lightweight list (with frontend URL) into {@code ctx.stepOutputs.guides}
 * so the frontend wizard can render a "请阅读以下指南" panel.
 *
 * <p>Filtering rules:
 * <ul>
 *   <li>If {@code ctx.templateId()} is set: include rows whose
 *       {@code relatedTemplateId} matches, plus generic rows
 *       ({@code relatedTemplateId IS NULL}). Skip rows tied to a different
 *       template.</li>
 *   <li>If {@code ctx.templateId()} is null: include all rows regardless of
 *       template association.</li>
 * </ul>
 *
 * <p>This step never throws; an empty list is a valid outcome (no GUIDE
 * docs configured) and the saga still advances to THEME.
 */
@Service
public class SagaGuideStepService {

    private static final Logger log = LoggerFactory.getLogger(SagaGuideStepService.class);

    private final SagaService sagaService;
    private final GuideDocMapper guideMapper;

    public SagaGuideStepService(SagaService sagaService, GuideDocMapper guideMapper) {
        this.sagaService = sagaService;
        this.guideMapper = guideMapper;
    }

    public void run(Long taskId) {
        sagaService.executeStep(taskId, SagaStep.PRODUCTS, ctx -> {
            LambdaQueryWrapper<GuideDoc> q = new LambdaQueryWrapper<GuideDoc>()
                .eq(GuideDoc::getShowInSagaStep, "GUIDE")
                .eq(GuideDoc::getStatus, "PUBLISHED")
                .orderByAsc(GuideDoc::getCategory)
                .orderByAsc(GuideDoc::getId);
            List<GuideDoc> all = guideMapper.selectList(q);

            List<Map<String, Object>> selected = new ArrayList<>();
            for (GuideDoc g : all) {
                if (ctx.templateId() != null
                    && g.getRelatedTemplateId() != null
                    && !g.getRelatedTemplateId().equals(ctx.templateId())) {
                    continue;  // skip guides tied to a different template
                }
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("id", g.getId());
                entry.put("code", g.getCode());
                entry.put("title", g.getTitle());
                entry.put("category", g.getCategory());
                entry.put("frontendUrl", "/guides/" + g.getId());
                selected.add(entry);
            }

            Map<String, Object> outputs = new LinkedHashMap<>(
                ctx.stepOutputs() == null ? Map.of() : ctx.stepOutputs()
            );
            outputs.put("guides", selected);
            log.info("[saga-guide] taskId={} templateId={} guides={}",
                taskId, ctx.templateId(), selected.size());

            return new SagaContext(
                ctx.taskId(), ctx.tenantId(), ctx.storeId(), ctx.shopDomain(), ctx.shopAccessToken(),
                ctx.templateId(), ctx.replaceRules(), ctx.productIdsToPush(), outputs
            );
        });
    }
}
