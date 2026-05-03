package com.biou.shopifyhub.file;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.ProductDoc;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.mapper.ProductDocMapper;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * F2 子轨道：文件病毒扫描状态查询（占位实现）。
 *
 * <p>真实集成需要接入 ClamAV / VirusTotal 之类的扫描引擎；本批仅做接口预留，让前端能在「下载」
 * 按钮前先过一道扫描闸门。
 *
 * <p>返回结构：
 * <pre>
 * { scanned: boolean, status: "NOT_SCANNED"|"CLEAN"|"INFECTED"|"FAILED", message: string }
 * </pre>
 *
 * <p>占位策略：
 * <ul>
 *   <li>image / video（type=image 或 type=video）— 不扫，直接返 {@code scanned:true, status:CLEAN}</li>
 *   <li>doc（type=doc）— 读 product_doc.scan_status，office/pdf 类型默认 NOT_SCANNED；
 *       前端遇 NOT_SCANNED 应弹「文件未通过扫描，仍需下载？」二次确认（或直接拦截）</li>
 * </ul>
 */
@RestController
public class FileScanController {

    private final ProductImageMapper imageMapper;
    private final ProductDocMapper docMapper;

    public FileScanController(ProductImageMapper imageMapper, ProductDocMapper docMapper) {
        this.imageMapper = imageMapper;
        this.docMapper = docMapper;
    }

    @GetMapping("/file/{type}/{id}/scan-status")
    public Result<Map<String, Object>> getScanStatus(
        @PathVariable("type") String type,
        @PathVariable("id") Long id
    ) {
        // TODO antivirus integration (ClamAV / VirusTotal) — 当前仅占位。
        // 接入后替换成：拉真扫描引擎结果（异步任务 + 结果缓存），写回 product_doc.scan_status。
        Map<String, Object> resp = new LinkedHashMap<>();
        switch (type.toLowerCase()) {
            case "image", "video" -> {
                ProductImage img = imageMapper.selectById(id);
                if (img == null) throw new BusinessException(ResultCode.NOT_FOUND);
                resp.put("scanned", true);
                resp.put("status", "CLEAN");
                resp.put("message", "图片 / 视频默认安全（占位实现，未接真扫描引擎）");
            }
            case "doc" -> {
                ProductDoc doc = docMapper.selectById(id);
                if (doc == null) throw new BusinessException(ResultCode.NOT_FOUND);
                String status = doc.getScanStatus() == null ? "NOT_SCANNED" : doc.getScanStatus();
                resp.put("scanned", !"NOT_SCANNED".equals(status));
                resp.put("status", status);
                resp.put("message", switch (status) {
                    case "CLEAN" -> "文件已通过扫描";
                    case "INFECTED" -> "文件检测到威胁，不建议下载";
                    case "FAILED" -> "扫描失败，请稍后重试";
                    default -> "文件尚未扫描（占位实现）";
                });
            }
            default -> throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "type 必须是 image / video / doc，当前 " + type);
        }
        return Result.ok(resp);
    }
}
