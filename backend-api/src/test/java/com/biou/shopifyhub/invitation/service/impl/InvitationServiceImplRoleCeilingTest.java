package com.biou.shopifyhub.invitation.service.impl;

import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.rbac.UserRolePermissionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.Mockito.when;

/**
 * 单测 InvitationServiceImpl#assertCanGrantRoles —— 邀请创建时的角色上限校验。
 *
 * <p>这层校验是修 B1 权限提升漏洞的关键：之前任何持有 PERM_TEMP_USER:INVITE
 * 的低权 admin 都能在邀请请求里塞入 PLATFORM_SUPER / 其它高级角色，被邀请人
 * 接受后合法获得这些角色。
 */
@ExtendWith(MockitoExtension.class)
class InvitationServiceImplRoleCeilingTest {

    @Mock UserRolePermissionService rbac;

    InvitationServiceImpl service;

    @BeforeEach
    void setUp() {
        // 这套单测只触达 rbac 一条依赖，其它依赖全部传 null —— 走不到。
        service = new InvitationServiceImpl(
            null, null, null, null, null,
            null, null, null, null, null,
            rbac
        );
    }

    @Test
    void rejects_platform_super_even_if_inviter_holds_it() {
        // 即便邀请人自己是平台超管，PLATFORM_SUPER 也不可通过邀请通道传播
        // 黑名单先于"是否在邀请人角色集合内"判断，所以这里不需要 mock loadRoles
        assertThatThrownBy(() ->
            service.assertCanGrantRoles(99L, List.of("PLATFORM_SUPER"))
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo(ResultCode.INVITATION_ROLE_NOT_ALLOWED);
    }

    @Test
    void rejects_role_not_held_by_inviter() {
        // 邀请人只有 OPERATION，却尝试授予 COMPANY_ADMIN — 越权
        when(rbac.loadRoles(7L)).thenReturn(List.of("OPERATION"));

        assertThatThrownBy(() ->
            service.assertCanGrantRoles(7L, List.of("OPERATION", "COMPANY_ADMIN"))
        )
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo(ResultCode.INVITATION_ROLE_NOT_ALLOWED);
    }

    @Test
    void passes_when_requested_roles_are_subset_of_inviter_roles() {
        when(rbac.loadRoles(7L)).thenReturn(List.of("COMPANY_ADMIN", "OPERATION", "EMPLOYEE"));

        assertThatCode(() ->
            service.assertCanGrantRoles(7L, List.of("OPERATION", "EMPLOYEE"))
        ).doesNotThrowAnyException();
    }

    @Test
    void passes_for_invitation_only_role_even_if_inviter_does_not_hold_it() {
        // TEMP_STAFF 是邀请专用标识角色，邀请人本身不会持有 ——
        // 邀请必须能下发，否则邀请流程整个不能用
        when(rbac.loadRoles(7L)).thenReturn(List.of("COMPANY_ADMIN", "OPERATION"));

        assertThatCode(() ->
            service.assertCanGrantRoles(7L, List.of("TEMP_STAFF", "OPERATION"))
        ).doesNotThrowAnyException();
    }

    @Test
    void rejects_empty_role_list() {
        Throwable ex = catchThrowable(() -> service.assertCanGrantRoles(7L, List.of()));
        assertThat(ex).isInstanceOf(BusinessException.class);
        assertThat(((BusinessException) ex).code()).isEqualTo(ResultCode.VALIDATION_FAILED);
    }

    @Test
    void rejects_null_role_list() {
        Throwable ex = catchThrowable(() -> service.assertCanGrantRoles(7L, null));
        assertThat(ex).isInstanceOf(BusinessException.class);
        assertThat(((BusinessException) ex).code()).isEqualTo(ResultCode.VALIDATION_FAILED);
    }
}
