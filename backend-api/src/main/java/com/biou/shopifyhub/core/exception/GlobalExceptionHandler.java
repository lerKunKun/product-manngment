package com.biou.shopifyhub.core.exception;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

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

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<Void>> fallback(Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Result.error(ResultCode.INTERNAL_ERROR, e.getClass().getSimpleName()));
    }
}
