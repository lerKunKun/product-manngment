package com.biou.shopifyhub.product.csv;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.product.entity.Product;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import com.biou.shopifyhub.product.mapper.ProductMapper;
import com.biou.shopifyhub.product.mapper.ProductVariantMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.Writer;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CSV 42 列导入/导出。
 * 设计权衡（Wave 1）：
 *  - 同 handle 下多行（Shopify 把 variants/images 平铺为多行）→ 第一行包含 product 字段，后续行只有 Variant/Image 列
 *  - 解析时按 handle 聚合
 *  - 部分成功：每行独立校验，错误行收集报告
 *  - 仅支持 UTF-8 with BOM 或 UTF-8（Shopify 默认导出格式）
 */
@Service
public class ProductCsvService {

    private static final Logger log = LoggerFactory.getLogger(ProductCsvService.class);

    private final ProductMapper productMapper;
    private final ProductVariantMapper variantMapper;
    private final ProductImageMapper imageMapper;

    public ProductCsvService(
        ProductMapper productMapper,
        ProductVariantMapper variantMapper,
        ProductImageMapper imageMapper
    ) {
        this.productMapper = productMapper;
        this.variantMapper = variantMapper;
        this.imageMapper = imageMapper;
    }

    @Transactional
    public ImportReport importCsv(InputStream in, Long ownerCompanyId, Long ownerDeptId, Long createdBy) {
        ImportReport report = new ImportReport();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            // 跳过 BOM
            reader.mark(1);
            int first = reader.read();
            if (first != 0xFEFF && first != -1) reader.reset();

            // 一次性读取所有内容（支持引号内的多行 HTML / 嵌入换行 — RFC 4180）
            StringBuilder all = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) > 0) all.append(buf, 0, n);

            List<List<String>> rows = parseCsv(all.toString());
            if (rows.isEmpty()) throw new BusinessException(ResultCode.VALIDATION_FAILED, "CSV 文件为空");

            List<String> headers = rows.get(0);
            Map<String, Integer> idx = new HashMap<>();
            for (int i = 0; i < headers.size(); i++) idx.put(headers.get(i).trim(), i);

            // 必备列校验
            for (String required : List.of("Handle", "Title", "Variant SKU", "Variant Price")) {
                if (!idx.containsKey(required)) {
                    throw new BusinessException(ResultCode.VALIDATION_FAILED,
                        "CSV 缺少必填列: " + required);
                }
            }

            // 按 handle 聚合行
            Map<String, List<List<String>>> byHandle = new java.util.LinkedHashMap<>();
            int handleIdx = idx.get("Handle");
            for (int i = 1; i < rows.size(); i++) {
                List<String> cols = rows.get(i);
                if (cols.size() == 1 && cols.get(0).isBlank()) continue;
                String handle = handleIdx < cols.size() ? cols.get(handleIdx).trim() : "";
                if (handle.isBlank()) {
                    report.errors.add("第 " + (i + 1) + " 行：handle 为空，跳过");
                    continue;
                }
                byHandle.computeIfAbsent(handle, k -> new ArrayList<>()).add(cols);
            }

            // 逐 handle 写入
            for (Map.Entry<String, List<List<String>>> e : byHandle.entrySet()) {
                try {
                    importOneHandle(e.getKey(), e.getValue(), idx, ownerCompanyId, ownerDeptId, createdBy);
                    report.success++;
                } catch (Exception ex) {
                    report.errors.add("handle=" + e.getKey() + " 失败: " + ex.getMessage());
                    log.warn("CSV import handle={} fail: {}", e.getKey(), ex.getMessage());
                }
            }
        } catch (IOException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "读取 CSV 失败: " + e.getMessage());
        }
        return report;
    }

    private void importOneHandle(String handle, List<List<String>> rows, Map<String, Integer> idx,
                                 Long ownerCompanyId, Long ownerDeptId, Long createdBy) {
        // 检查同 handle 是否已存在
        Product existing = productMapper.selectOne(
            new QueryWrapper<Product>().eq("handle", handle));
        Product p = existing != null ? existing : new Product();
        List<String> first = rows.get(0);

        p.setHandle(handle);
        if (val(first, idx, "Title") != null) p.setTitle(val(first, idx, "Title"));
        p.setBodyHtml(val(first, idx, "Body (HTML)"));
        p.setVendor(val(first, idx, "Vendor"));
        p.setProductCategory(val(first, idx, "Product Category"));
        p.setType(val(first, idx, "Type"));
        p.setTags(val(first, idx, "Tags"));
        p.setPublished(boolVal(first, idx, "Published", false));
        p.setSeoTitle(val(first, idx, "SEO Title"));
        p.setSeoDescription(val(first, idx, "SEO Description"));
        String status = val(first, idx, "Status");
        p.setStatus(status != null && !status.isBlank() ? status.toLowerCase() : "draft");
        p.setOwnerCompanyId(ownerCompanyId);
        p.setOwnerDeptId(ownerDeptId);
        if (existing == null) {
            p.setCreatedBy(createdBy);
            productMapper.insert(p);
        } else {
            productMapper.updateById(p);
        }

        // 重写 variants / images（简化策略：先删后插）
        if (existing != null) {
            variantMapper.delete(new QueryWrapper<ProductVariant>().eq("product_id", p.getId()));
            imageMapper.delete(new QueryWrapper<ProductImage>().eq("product_id", p.getId()));
        }

        int variantPos = 1;
        int imagePos = 1;
        for (List<String> row : rows) {
            // Variant
            String sku = val(row, idx, "Variant SKU");
            String price = val(row, idx, "Variant Price");
            if (sku != null || price != null) {
                ProductVariant v = new ProductVariant();
                v.setProductId(p.getId());
                v.setPosition(variantPos++);
                v.setSku(sku);
                v.setOption1(val(row, idx, "Option1 Value"));
                v.setOption2(val(row, idx, "Option2 Value"));
                v.setOption3(val(row, idx, "Option3 Value"));
                v.setGrams(decimal(row, idx, "Variant Grams"));
                v.setWeightUnit(orDefault(val(row, idx, "Variant Weight Unit"), "g"));
                v.setInventoryTracker(val(row, idx, "Variant Inventory Tracker"));
                v.setInventoryQty(intVal(row, idx, "Variant Inventory Qty", 0));
                v.setInventoryPolicy(orDefault(val(row, idx, "Variant Inventory Policy"), "continue"));
                v.setFulfillmentService(orDefault(val(row, idx, "Variant Fulfillment Service"), "manual"));
                v.setPrice(decimal(row, idx, "Variant Price"));
                v.setCompareAtPrice(decimal(row, idx, "Variant Compare At Price"));
                v.setRequiresShipping(boolVal(row, idx, "Variant Requires Shipping", true));
                v.setTaxable(boolVal(row, idx, "Variant Taxable", true));
                v.setBarcode(val(row, idx, "Variant Barcode"));
                v.setVariantImage(val(row, idx, "Variant Image"));
                v.setTaxCode(val(row, idx, "Variant Tax Code"));
                v.setCostPerItem(decimal(row, idx, "Cost per item"));
                variantMapper.insert(v);
            }

            // Image
            String src = val(row, idx, "Image Src");
            if (src != null && !src.isBlank()) {
                ProductImage img = new ProductImage();
                img.setProductId(p.getId());
                img.setSrc(src);
                img.setPosition(intVal(row, idx, "Image Position", imagePos++));
                img.setAltText(val(row, idx, "Image Alt Text"));
                img.setGiftCard(boolVal(row, idx, "Gift Card", false));
                imageMapper.insert(img);
            }
        }
    }

    /** 导出当前所有产品为 CSV（按 owner_company_id 过滤）。 */
    public void exportCsv(Long ownerCompanyId, Writer writer) {
        try (PrintWriter pw = new PrintWriter(writer)) {
            pw.write('﻿'); // UTF-8 BOM
            pw.println(String.join(",", CsvFieldMapping.COLUMNS.stream().map(this::esc).toList()));

            QueryWrapper<Product> q = new QueryWrapper<>();
            if (ownerCompanyId != null) q.eq("owner_company_id", ownerCompanyId);
            List<Product> products = productMapper.selectList(q);
            for (Product p : products) {
                List<ProductVariant> variants = variantMapper.selectList(
                    new QueryWrapper<ProductVariant>().eq("product_id", p.getId()).orderByAsc("position"));
                List<ProductImage> images = imageMapper.selectList(
                    new QueryWrapper<ProductImage>().eq("product_id", p.getId()).orderByAsc("position"));

                int rowCount = Math.max(1, Math.max(variants.size(), images.size()));
                for (int i = 0; i < rowCount; i++) {
                    ProductVariant v = i < variants.size() ? variants.get(i) : null;
                    ProductImage img = i < images.size() ? images.get(i) : null;
                    String[] row = new String[42];
                    row[0] = p.getHandle();
                    if (i == 0) {
                        row[1] = p.getTitle();
                        row[2] = p.getBodyHtml();
                        row[3] = p.getVendor();
                        row[4] = p.getProductCategory();
                        row[5] = p.getType();
                        row[6] = p.getTags();
                        row[7] = boolStr(p.getPublished());
                        row[32] = p.getSeoTitle();
                        row[33] = p.getSeoDescription();
                        row[38] = p.getStatus();
                    }
                    if (v != null) {
                        row[9] = v.getOption1();
                        row[12] = v.getOption2();
                        row[15] = v.getOption3();
                        row[17] = v.getSku();
                        row[18] = decStr(v.getGrams());
                        row[19] = v.getInventoryTracker();
                        row[20] = intStr(v.getInventoryQty());
                        row[21] = v.getInventoryPolicy();
                        row[22] = v.getFulfillmentService();
                        row[23] = decStr(v.getPrice());
                        row[24] = decStr(v.getCompareAtPrice());
                        row[25] = boolStr(v.getRequiresShipping());
                        row[26] = boolStr(v.getTaxable());
                        row[27] = v.getBarcode();
                        row[34] = v.getVariantImage();
                        row[35] = v.getWeightUnit();
                        row[36] = v.getTaxCode();
                        row[37] = decStr(v.getCostPerItem());
                    }
                    if (img != null) {
                        row[28] = img.getSrc();
                        row[29] = intStr(img.getPosition());
                        row[30] = img.getAltText();
                        row[31] = boolStr(img.getGiftCard());
                    }
                    pw.println(String.join(",", java.util.Arrays.stream(row)
                        .map(this::esc).toList()));
                }
            }
        }
    }

    // ===== utils =====

    private static String val(List<String> row, Map<String, Integer> idx, String col) {
        Integer i = idx.get(col);
        if (i == null || i >= row.size()) return null;
        String v = row.get(i);
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String orDefault(String v, String d) { return v == null ? d : v; }

    private static Integer intVal(List<String> row, Map<String, Integer> idx, String col, int def) {
        String v = val(row, idx, col);
        if (v == null) return def;
        try { return Integer.parseInt(v); } catch (Exception e) { return def; }
    }

    private static Boolean boolVal(List<String> row, Map<String, Integer> idx, String col, boolean def) {
        String v = val(row, idx, col);
        if (v == null) return def;
        return "TRUE".equalsIgnoreCase(v) || "true".equalsIgnoreCase(v) || "1".equals(v) || "yes".equalsIgnoreCase(v);
    }

    private static BigDecimal decimal(List<String> row, Map<String, Integer> idx, String col) {
        String v = val(row, idx, col);
        if (v == null) return null;
        try { return new BigDecimal(v); } catch (Exception e) { return null; }
    }

    private static String decStr(BigDecimal d) { return d == null ? "" : d.toPlainString(); }
    private static String intStr(Integer i) { return i == null ? "" : i.toString(); }
    private static String boolStr(Boolean b) { return Boolean.TRUE.equals(b) ? "TRUE" : "FALSE"; }

    /**
     * RFC 4180 CSV 解析：支持引号内的逗号 + 引号内换行 + 引号转义 ""。
     * 整个文件一次性解析，正确处理 Shopify CSV 的多行 Body (HTML)。
     */
    private static List<List<String>> parseCsv(String content) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuote = false;
        int len = content.length();
        for (int i = 0; i < len; i++) {
            char c = content.charAt(i);
            if (inQuote) {
                if (c == '"') {
                    if (i + 1 < len && content.charAt(i + 1) == '"') {
                        cur.append('"');
                        i++;
                    } else {
                        inQuote = false;
                    }
                } else {
                    cur.append(c);  // 引号内 \n / \r 都保留
                }
            } else {
                if (c == ',') {
                    row.add(cur.toString());
                    cur.setLength(0);
                } else if (c == '"') {
                    inQuote = true;
                } else if (c == '\r') {
                    // 兼容 \r\n：吃掉，下一字符 \n 触发换行
                } else if (c == '\n') {
                    row.add(cur.toString());
                    cur.setLength(0);
                    rows.add(row);
                    row = new ArrayList<>();
                } else {
                    cur.append(c);
                }
            }
        }
        // 文件末尾未以 \n 结尾时收尾
        if (cur.length() > 0 || !row.isEmpty()) {
            row.add(cur.toString());
            rows.add(row);
        }
        return rows;
    }

    private String esc(String v) {
        if (v == null) return "";
        boolean needQuote = v.contains(",") || v.contains("\"") || v.contains("\n");
        String s = v.replace("\"", "\"\"");
        return needQuote ? "\"" + s + "\"" : s;
    }

    public static class ImportReport {
        public int success = 0;
        public List<String> errors = new ArrayList<>();
        public int getSuccess() { return success; }
        public List<String> getErrors() { return errors; }
    }
}
