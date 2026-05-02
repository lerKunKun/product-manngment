package com.biou.shopifyhub.snapshot;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Converts Shopify product JSON (one product) into Shopify-style CSV rows.
 *
 * <p>W2-SNAP-04 minimal subset (15 of 42 columns); expand to full 42 in W3-PUR/W3-MED phases.
 * Empty cells are emitted for the remaining 27 columns when downstream code needs the full
 * 42-column shape — this writer outputs only the 15 it knows.
 *
 * <p>Output is one row per variant. Product-level columns (Handle, Title, …) repeat per row,
 * matching Shopify's official CSV export. UTF-8 BOM is prepended so Excel opens the file
 * with the correct encoding.
 */
public final class ShopifyJsonCsvWriter {

    /** 15-column header subset (W2-SNAP-04). */
    public static final List<String> HEADERS = List.of(
        "Handle",
        "Title",
        "Body (HTML)",
        "Vendor",
        "Product Category",
        "Type",
        "Tags",
        "Published",
        "Option1 Name",
        "Option1 Value",
        "Variant SKU",
        "Variant Price",
        "Variant Compare At Price",
        "Variant Inventory Qty",
        "Image Src"
    );

    private static final byte[] UTF8_BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    private ShopifyJsonCsvWriter() {}

    /**
     * Writes UTF-8 BOM + header + rows; one row per variant. Returns bytes.
     *
     * <p>Tolerant of missing JSON fields: any absent path becomes an empty cell.
     */
    public static byte[] write(JsonNode product) {
        if (product == null) {
            product = com.fasterxml.jackson.databind.node.MissingNode.getInstance();
        }

        String handle = textOrEmpty(product, "handle");
        String title = textOrEmpty(product, "title");
        String bodyHtml = textOrEmpty(product, "body_html");
        String vendor = textOrEmpty(product, "vendor");
        String productCategory = textOrEmpty(product, "product_category");
        String type = textOrEmpty(product, "product_type");
        String tags = renderTags(product.path("tags"));
        // Shopify Admin returns "status" = active|draft|archived. Published column is TRUE/FALSE.
        String status = textOrEmpty(product, "status");
        String published = "active".equalsIgnoreCase(status) ? "TRUE" : "FALSE";

        // Option1 Name from product.options[0].name
        JsonNode options = product.path("options");
        String option1Name = (options.isArray() && options.size() > 0)
            ? textOrEmpty(options.get(0), "name")
            : "";

        // Variants: emit one row per variant. If no variants, emit a single product-level row.
        JsonNode variants = product.path("variants");
        // Image Src: take first product image as fallback. Variant-specific image_id mapping is
        // a future refinement (full 42-col expansion); for the 15-col subset we use product[0].
        String firstImageSrc = "";
        JsonNode images = product.path("images");
        if (images.isArray() && images.size() > 0) {
            firstImageSrc = textOrEmpty(images.get(0), "src");
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try {
            baos.write(UTF8_BOM);
            try (Writer w = new OutputStreamWriter(baos, StandardCharsets.UTF_8)) {
                writeRow(w, HEADERS);

                if (variants.isArray() && variants.size() > 0) {
                    for (JsonNode variant : variants) {
                        String option1Value = textOrEmpty(variant, "option1");
                        // Shopify variant exports often store the option value under "title" too
                        // when only one option exists; fall back to that.
                        if (option1Value.isEmpty()) {
                            option1Value = textOrEmpty(variant, "title");
                        }
                        String sku = textOrEmpty(variant, "sku");
                        String price = textOrEmpty(variant, "price");
                        String compareAt = textOrEmpty(variant, "compare_at_price");
                        String inventoryQty = textOrEmpty(variant, "inventory_quantity");

                        List<String> row = List.of(
                            handle,
                            title,
                            bodyHtml,
                            vendor,
                            productCategory,
                            type,
                            tags,
                            published,
                            option1Name,
                            option1Value,
                            sku,
                            price,
                            compareAt,
                            inventoryQty,
                            firstImageSrc
                        );
                        writeRow(w, row);
                    }
                } else {
                    // No variants → emit one product-level row with empty variant cells.
                    List<String> row = List.of(
                        handle,
                        title,
                        bodyHtml,
                        vendor,
                        productCategory,
                        type,
                        tags,
                        published,
                        option1Name,
                        "",
                        "",
                        "",
                        "",
                        "",
                        firstImageSrc
                    );
                    writeRow(w, row);
                }
            }
        } catch (IOException e) {
            // ByteArrayOutputStream / OutputStreamWriter never throw IO in practice.
            throw new RuntimeException("CSV serialization failed: " + e.getMessage(), e);
        }
        return baos.toByteArray();
    }

    private static void writeRow(Writer w, List<String> cells) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(csvEscape(cells.get(i)));
        }
        sb.append("\r\n");
        w.write(sb.toString());
    }

    static String csvEscape(String v) {
        if (v == null) return "";
        boolean needsQuote = v.indexOf(',') >= 0
            || v.indexOf('"') >= 0
            || v.indexOf('\n') >= 0
            || v.indexOf('\r') >= 0;
        if (!needsQuote) return v;
        return "\"" + v.replace("\"", "\"\"") + "\"";
    }

    private static String textOrEmpty(JsonNode parent, String field) {
        if (parent == null) return "";
        JsonNode n = parent.path(field);
        if (n.isMissingNode() || n.isNull()) return "";
        if (n.isValueNode()) return n.asText("");
        // For non-value nodes (arrays/objects), just stringify; primary use should be value nodes.
        return n.toString();
    }

    /** Tags can be a comma-separated string OR an array. Normalize to comma-joined string. */
    private static String renderTags(JsonNode tags) {
        if (tags == null || tags.isMissingNode() || tags.isNull()) return "";
        if (tags.isTextual()) return tags.asText("");
        if (tags.isArray()) {
            List<String> parts = new ArrayList<>();
            for (JsonNode t : tags) {
                if (t.isValueNode()) parts.add(t.asText(""));
            }
            return String.join(", ", parts);
        }
        return tags.toString();
    }
}
