package com.biou.shopifyhub.newstore;

/**
 * 一键开店 saga 步骤定义。
 * 流程：INIT → AUTH_DONE → MEDIA → COLLECTIONS → PRODUCTS → GUIDE → THEME → PUBLISH → SUCCESS
 * 任何步骤失败 → FAILED；可从最后失败点 retry。
 */
public enum SagaStep {
    INIT, AUTH_DONE, MEDIA, COLLECTIONS, PRODUCTS, GUIDE, THEME, PUBLISH, SUCCESS, FAILED;

    public boolean isTerminal() { return this == SUCCESS || this == FAILED; }

    /** Returns the next step on success, or null if terminal. */
    public SagaStep next() {
        return switch (this) {
            case INIT        -> AUTH_DONE;
            case AUTH_DONE   -> MEDIA;
            case MEDIA       -> COLLECTIONS;
            case COLLECTIONS -> PRODUCTS;
            case PRODUCTS    -> GUIDE;
            case GUIDE       -> THEME;
            case THEME       -> PUBLISH;
            case PUBLISH     -> SUCCESS;
            case SUCCESS, FAILED -> null;
        };
    }
}
