package com.biou.shopifyhub.product.csv;

import java.util.List;

/**
 * Shopify 标准产品 CSV 42 列字段定义。
 * 顺序与 products_export.csv 模板对齐。
 */
public final class CsvFieldMapping {

    private CsvFieldMapping() {}

    /** 42 列固定顺序（用作 CSV header） */
    public static final List<String> COLUMNS = List.of(
        "Handle",                           // 0
        "Title",                            // 1
        "Body (HTML)",                      // 2
        "Vendor",                           // 3
        "Product Category",                 // 4
        "Type",                             // 5
        "Tags",                             // 6
        "Published",                        // 7
        "Option1 Name",                     // 8
        "Option1 Value",                    // 9
        "Option1 Linked To",                // 10
        "Option2 Name",                     // 11
        "Option2 Value",                    // 12
        "Option2 Linked To",                // 13
        "Option3 Name",                     // 14
        "Option3 Value",                    // 15
        "Option3 Linked To",                // 16
        "Variant SKU",                      // 17
        "Variant Grams",                    // 18
        "Variant Inventory Tracker",        // 19
        "Variant Inventory Qty",            // 20
        "Variant Inventory Policy",         // 21
        "Variant Fulfillment Service",      // 22
        "Variant Price",                    // 23
        "Variant Compare At Price",         // 24
        "Variant Requires Shipping",        // 25
        "Variant Taxable",                  // 26
        "Variant Barcode",                  // 27
        "Image Src",                        // 28
        "Image Position",                   // 29
        "Image Alt Text",                   // 30
        "Gift Card",                        // 31
        "SEO Title",                        // 32
        "SEO Description",                  // 33
        "Variant Image",                    // 34
        "Variant Weight Unit",              // 35
        "Variant Tax Code",                 // 36
        "Cost per item",                    // 37
        "Status",                           // 38
        "Included / United States",         // 39   （地区税务/上架开关，可空）
        "Price / United States",            // 40   （地区差价，可空）
        "Compare At Price / United States"  // 41
    );
}
