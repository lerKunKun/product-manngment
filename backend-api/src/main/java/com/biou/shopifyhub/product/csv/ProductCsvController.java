package com.biou.shopifyhub.product.csv;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/product")
public class ProductCsvController {

    private final ProductCsvService csvService;

    public ProductCsvController(ProductCsvService csvService) {
        this.csvService = csvService;
    }

    @PostMapping("/import")
    public Result<ProductCsvService.ImportReport> importCsv(
        @RequestParam("file") MultipartFile file,
        @RequestParam("ownerCompanyId") Long ownerCompanyId,
        @RequestParam(value = "ownerDeptId", required = false) Long ownerDeptId
    ) {
        if (file.isEmpty()) throw new BusinessException(ResultCode.VALIDATION_FAILED, "文件为空");
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        try {
            return Result.ok(csvService.importCsv(file.getInputStream(), ownerCompanyId, ownerDeptId, uid));
        } catch (IOException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, e.getMessage());
        }
    }

    /**
     * 导出 CSV — F3 子轨道。两种模式：
     * <ul>
     *   <li>{@code mode=all}（默认，向后兼容）：按列表筛选条件全量导出。沿用 keyword / status / ownerCompanyId。</li>
     *   <li>{@code mode=selected}：按 {@code ids=1,2,3} 顺序导出指定 ids。上限 {@value ProductCsvService#EXPORT_SELECTED_MAX}。</li>
     * </ul>
     * 走 {@link StreamingResponseBody}，避免一次性把所有产品加载到内存。
     */
    @GetMapping("/export")
    public ResponseEntity<StreamingResponseBody> exportCsv(
        @RequestParam(required = false, defaultValue = "all") String mode,
        @RequestParam(required = false) String ids,
        @RequestParam(required = false) Long ownerCompanyId,
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) String status
    ) {
        boolean selected = "selected".equalsIgnoreCase(mode);

        // selected 模式：先在请求线程里解析 + 校验 ids，让 VALIDATION_FAILED 走标准 4xx 通路；
        // StreamingResponseBody 内抛业务异常时 response header 已发出无法转 JSON。
        final List<Long> selectedIds;
        if (selected) {
            selectedIds = parseIds(ids);
            if (selectedIds.isEmpty()) {
                throw new BusinessException(ResultCode.VALIDATION_FAILED, "ids 不能为空");
            }
            if (selectedIds.size() > ProductCsvService.EXPORT_SELECTED_MAX) {
                throw new BusinessException(ResultCode.VALIDATION_FAILED,
                    "选中导出数量上限 " + ProductCsvService.EXPORT_SELECTED_MAX + "，当前 " + selectedIds.size());
            }
        } else {
            selectedIds = null;
        }

        StreamingResponseBody body = out -> {
            try (PrintWriter w = new PrintWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8))) {
                if (selected) {
                    csvService.exportSelected(selectedIds, w);
                } else {
                    csvService.exportFiltered(ownerCompanyId, keyword, status, w);
                }
            }
        };

        String filename = "products_export_" + System.currentTimeMillis() + ".csv";
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .body(body);
    }

    /** 解析 ?ids=1,2,3，跳过非数字。 */
    private static List<Long> parseIds(String raw) {
        List<Long> out = new ArrayList<>();
        if (raw == null || raw.isBlank()) return out;
        for (String part : raw.split(",")) {
            String t = part.trim();
            if (t.isEmpty()) continue;
            try {
                out.add(Long.parseLong(t));
            } catch (NumberFormatException ignored) {
                // 跳过坏数据
            }
        }
        return out;
    }
}
