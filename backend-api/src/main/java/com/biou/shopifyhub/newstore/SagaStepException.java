package com.biou.shopifyhub.newstore;

/**
 * Wraps a step-level failure with the {@link SagaStep} where it occurred,
 * so upstream callers can correlate the exception to the saga state.
 */
public class SagaStepException extends RuntimeException {
    public final SagaStep step;

    public SagaStepException(SagaStep step, Throwable cause) {
        super("saga step " + step + " failed: " + cause.getMessage(), cause);
        this.step = step;
    }
}
