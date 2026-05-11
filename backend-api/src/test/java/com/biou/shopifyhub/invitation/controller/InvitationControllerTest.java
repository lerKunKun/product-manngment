package com.biou.shopifyhub.invitation.controller;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.security.CookieUtil;
import com.biou.shopifyhub.invitation.dto.InvitationAcceptRequest;
import com.biou.shopifyhub.invitation.service.InvitationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InvitationControllerTest {

    @Mock InvitationService service;

    @Test
    void accept_writes_clear_cookie_header_so_prior_admin_session_cannot_resume() {
        CookieUtil cookieUtil = new CookieUtil(new MockEnvironment(), Duration.ofDays(7));
        InvitationController controller = new InvitationController(service, cookieUtil);

        InvitationAcceptRequest req = new InvitationAcceptRequest();
        req.setToken("tok");
        req.setTempPassword("pw");
        when(service.accept(any(InvitationAcceptRequest.class))).thenReturn(42L);

        MockHttpServletResponse resp = new MockHttpServletResponse();
        Result<Map<String, Long>> result = controller.accept(req, resp);

        assertThat(result.code()).isEqualTo(0);
        assertThat(result.data()).containsEntry("userId", 42L);

        String setCookie = resp.getHeader("Set-Cookie");
        assertThat(setCookie).as("accept 必须下发清除 refresh cookie 的 Set-Cookie").isNotNull();
        assertThat(setCookie).contains("shub_refresh=");
        assertThat(setCookie).contains("Max-Age=0");
        assertThat(setCookie).contains("Path=/api/auth");
        assertThat(setCookie).contains("HttpOnly");
    }
}
