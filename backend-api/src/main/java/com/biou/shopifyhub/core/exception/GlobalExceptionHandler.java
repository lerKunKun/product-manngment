package com.biou.shopifyhub.core.exception;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.NoHandlerFoundException;

import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<Result<Void>> business(BusinessException e) {
        log.warn("Business: code={} detail={}", e.code(), e.detail());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Result.error(e.code(), e.detail() == null ? "" : e.detail()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    public ResponseEntity<Result<Void>> validation(Exception e) {
        String detail;
        if (e instanceof MethodArgumentNotValidException me) {
            detail = me.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        } else if (e instanceof BindException be) {
            detail = be.getFieldErrors().stream()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        } else {
            detail = e.getMessage();
        }
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Result.error(ResultCode.VALIDATION_FAILED, detail));
    }

    /**
     * @RequestParam / @PathVariable 类型转换失败（如 Long 字段收到 "abc" 或空串）。
     * 之前走 fallback Exception → 500 + 仅类名。改成 400 + 显示参数名/值/期望类型。
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Result<Void>> typeMismatch(MethodArgumentTypeMismatchException e) {
        String name = e.getName();
        Object value = e.getValue();
        String expected = e.getRequiredType() == null ? "?" : e.getRequiredType().getSimpleName();
        String detail = "参数 " + name + "=\"" + value + "\" 不能转成 " + expected;
        log.warn("ParamTypeMismatch: {}", detail);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(Result.error(ResultCode.VALIDATION_FAILED, detail));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Result<Void>> missingParam(MissingServletRequestParameterException e) {
        String detail = "缺少必填参数 " + e.getParameterName() + " (" + e.getParameterType() + ")";
        log.warn("MissingParam: {}", detail);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(Result.error(ResultCode.VALIDATION_FAILED, detail));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Result<Void>> badJson(HttpMessageNotReadableException e) {
        log.warn("BadJson: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(Result.error(ResultCode.VALIDATION_FAILED, "请求体格式错误"));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Result<Void>> methodNotAllowed(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
            .body(Result.error(ResultCode.VALIDATION_FAILED, "方法不支持: " + e.getMethod()));
    }

    @ExceptionHandler(NoHandlerFoundException.class)
    public ResponseEntity<Result<Void>> notFound(NoHandlerFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(Result.error(ResultCode.NOT_FOUND, e.getRequestURL()));
    }

    /**
     * 上传超过 multipart 限制（默认 100MB / 单文件，200MB / 请求；env 可覆盖
     * UPLOAD_MAX_FILE_SIZE / UPLOAD_MAX_REQUEST_SIZE）。
     * 之前走 fallback 500 + 仅类名；改成 413 + 当前限额提示。
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Result<Void>> tooLarge(MaxUploadSizeExceededException e) {
        long maxBytes = e.getMaxUploadSize();
        String hint = maxBytes > 0
            ? "文件超过上传限制（单文件 ≤ " + (maxBytes / 1024 / 1024) + " MB）"
            : "文件超过上传限制";
        log.warn("MaxUploadSize: max={} bytes msg={}", maxBytes, e.getMessage());
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
            .body(Result.error(ResultCode.VALIDATION_FAILED, hint));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<Void>> fallback(Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Result.error(ResultCode.INTERNAL_ERROR, e.getClass().getSimpleName()));
    }
}
