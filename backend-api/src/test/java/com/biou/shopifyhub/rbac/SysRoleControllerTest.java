package com.biou.shopifyhub.rbac;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.Rollback;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@ActiveProfiles("test")
@Transactional
@Rollback
class SysRoleControllerTest {

    @Autowired MockMvc mvc;
    @Autowired SysRoleMapper roleMapper;

    @BeforeEach
    void setUpUser() {
        TenantContext.set(1L, "platform", 1L, "tester");
    }

    @AfterEach
    void clearUser() {
        TenantContext.clear();
    }

    @Test
    void list_returns_all_roles() throws Exception {
        mvc.perform(get("/admin/role"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isArray())
            .andExpect(jsonPath("$.data[0].code").exists());
    }

    @Test
    void get_role_detail() throws Exception {
        SysRole any = roleMapper.selectList(new LambdaQueryWrapper<SysRole>().orderByAsc(SysRole::getId)).get(0);
        mvc.perform(get("/admin/role/" + any.getId()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.role.id").value(any.getId()))
            .andExpect(jsonPath("$.data.permissionCodes").isArray())
            .andExpect(jsonPath("$.data.userCount").exists());
    }

    @Test
    void create_custom_role() throws Exception {
        String body = """
            {"code":"TEST_ROLE_%d","name":"测试角色","description":"e2e test"}
            """.formatted(System.currentTimeMillis());
        mvc.perform(post("/admin/role").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data").exists());
    }

    @Test
    void update_permissions_blocked_for_builtin() throws Exception {
        SysRole builtin = roleMapper.selectList(
            new LambdaQueryWrapper<SysRole>().eq(SysRole::getBuiltin, true).orderByAsc(SysRole::getId)
        ).get(0);
        String body = """
            {"permissionCodes":["PRODUCT:READ"]}
            """;
        mvc.perform(put("/admin/role/" + builtin.getId() + "/permissions")
                .contentType("application/json").content(body))
            .andExpect(status().is4xxClientError());
    }
}
