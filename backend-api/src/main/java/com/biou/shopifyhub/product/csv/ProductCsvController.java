package com.biou.shopifyhub.product.csv;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

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

    @GetMapping("/export")
    public void exportCsv(
        @RequestParam(required = false) Long ownerCompanyId,
        HttpServletResponse response
    ) throws IOException {
        response.setContentType("text/csv; charset=UTF-8");
        response.setHeader("Content-Disposition",
            "attachment; filename=\"products_export_" + System.currentTimeMillis() + ".csv\"");
        try (PrintWriter w = new PrintWriter(response.getOutputStream(), false, StandardCharsets.UTF_8)) {
            csvService.exportCsv(ownerCompanyId, w);
        }
    }
}
