package com.biou.shopifyhub.invitation.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.invitation.entity.UserInvitation;
import com.biou.shopifyhub.invitation.mapper.UserInvitationMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * 单测 InvitationServiceImpl#assertUsernameAvailable + #claimInvitation。
 *
 * <p>这两个 helper 是修 B2 邀请重放漏洞的两道闸：
 * <ol>
 *   <li>{@code assertUsernameAvailable}：邮箱已是某 sys_user.username 时直接拒，
 *       避免后续 insert 唯一索引冲突回滚事务把 invitation 重置回 PENDING。</li>
 *   <li>{@code claimInvitation}：用条件 UPDATE 抢占 PENDING→ACCEPTED，
 *       并发场景下只有一个请求能进入用户创建流程。</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class InvitationServiceImplReplayGuardTest {

    @Mock UserInvitationMapper invitationMapper;
    @Mock SysUserMapper userMapper;

    InvitationServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new InvitationServiceImpl(
            invitationMapper, userMapper,
            null, null, null, null, null, null, null, null,
            null /* UserRolePermissionService — 这套单测不走 create()，不需要 mock */
        );
    }

    @Test
    void rejects_accept_when_email_already_a_system_username() {
        when(userMapper.selectCount(ArgumentMatchers.<QueryWrapper<SysUser>>any())).thenReturn(1L);

        Throwable ex = catchThrowable(() -> service.assertUsernameAvailable("dup@example.com"));

        assertThat(ex).isInstanceOf(BusinessException.class);
        assertThat(((BusinessException) ex).code()).isEqualTo(ResultCode.INVITATION_USERNAME_TAKEN);
    }

    @Test
    void passes_when_email_not_yet_registered() {
        when(userMapper.selectCount(ArgumentMatchers.<QueryWrapper<SysUser>>any())).thenReturn(0L);

        assertThatCode(() -> service.assertUsernameAvailable("fresh@example.com"))
            .doesNotThrowAnyException();
    }

    @Test
    void claim_succeeds_on_first_attempt() {
        when(invitationMapper.update(eq(null), any(UpdateWrapper.class))).thenReturn(1);

        boolean ok = service.claimInvitation(42L, LocalDateTime.now());

        assertThat(ok).isTrue();
    }

    @Test
    void claim_fails_when_another_request_already_accepted_it() {
        // DB 端 UPDATE ... WHERE status='PENDING' 影响行数=0 → 抢占失败
        when(invitationMapper.update(eq(null), any(UpdateWrapper.class))).thenReturn(0);

        boolean ok = service.claimInvitation(42L, LocalDateTime.now());

        assertThat(ok).isFalse();
    }
}
