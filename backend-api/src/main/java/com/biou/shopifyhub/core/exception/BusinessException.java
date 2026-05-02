package com.biou.shopifyhub.core.exception;

import com.biou.shopifyhub.core.ResultCode;

public class BusinessException extends RuntimeException {
    private final ResultCode code;
    private final String detail;

    public BusinessException(ResultCode code) {
        super(code.message());
        this.code = code;
        this.detail = null;
    }

    public BusinessException(ResultCode code, String detail) {
        super(code.message() + ": " + detail);
        this.code = code;
        this.detail = detail;
    }

    public ResultCode code() { return code; }
    public String detail() { return detail; }
}
