package com.biou.shopifyhub.asset;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class AssetProgressControllerTest {

    @Test
    void progress_rejects_when_internal_token_missing() {
        AssetProgressService service = mock(AssetProgressService.class);
        AssetProgressController controller = controllerWithToken(service, "");

        ResponseEntity<Void> resp = controller.progress("secret", Map.of("snapshotId", 1));

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        verifyNoInteractions(service);
    }

    @Test
    void progress_rejects_wrong_internal_token() {
        AssetProgressService service = mock(AssetProgressService.class);
        AssetProgressController controller = controllerWithToken(service, "secret");

        ResponseEntity<Void> resp = controller.progress("wrong", Map.of("snapshotId", 1));

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        verifyNoInteractions(service);
    }

    @Test
    void progress_publishes_when_internal_token_matches() {
        AssetProgressService service = mock(AssetProgressService.class);
        AssetProgressController controller = controllerWithToken(service, "secret");
        Map<String, Object> payload = Map.of("snapshotId", 1, "event", "file");

        ResponseEntity<Void> resp = controller.progress("secret", payload);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(service).publish(1L, payload);
    }

    private AssetProgressController controllerWithToken(AssetProgressService service, String token) {
        AssetProgressController controller = new AssetProgressController(service);
        ReflectionTestUtils.setField(controller, "internalToken", token);
        return controller;
    }
}
