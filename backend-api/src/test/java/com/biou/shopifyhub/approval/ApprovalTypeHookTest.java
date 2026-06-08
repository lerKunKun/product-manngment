package com.biou.shopifyhub.approval;

import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.core.entity.SysDataScope;
import com.biou.shopifyhub.core.mapper.SysDataScopeMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ApprovalTypeHookTest {

    @Test
    void product_access_sets_required_data_scope_fields() {
        SysDataScopeMapper mapper = mock(SysDataScopeMapper.class);
        ProductAccessApprovalService service = new ProductAccessApprovalService(mapper);
        ApprovalFlow flow = approvedFlow("PRODUCT_ACCESS", Map.of("productId", 1001L));

        service.onApproved(flow);

        SysDataScope ds = insertedScope(mapper);
        assertThat(ds.getGrantedBy()).isEqualTo(9L);
        assertThat(ds.getExpiresAt()).isNotNull();
        assertThat(ds.getScopeType()).isEqualTo("PRODUCT");
        assertThat(ds.getScopeId()).isEqualTo(1001L);
        assertThat(ds.getSource()).isEqualTo("APPROVAL");
    }

    @Test
    void cross_company_sets_required_data_scope_fields() {
        SysDataScopeMapper mapper = mock(SysDataScopeMapper.class);
        CrossCompanyApprovalService service = new CrossCompanyApprovalService(mapper);
        ApprovalFlow flow = approvedFlow("CROSS_COMPANY_AUTH", Map.of(
            "scopeType", "COMPANY",
            "scopeId", 2001L
        ));

        service.onApproved(flow);

        SysDataScope ds = insertedScope(mapper);
        assertThat(ds.getGrantedBy()).isEqualTo(9L);
        assertThat(ds.getExpiresAt()).isNotNull();
        assertThat(ds.getCrossCompany()).isTrue();
        assertThat(ds.getScopeType()).isEqualTo("COMPANY");
        assertThat(ds.getScopeId()).isEqualTo(2001L);
    }

    private static ApprovalFlow approvedFlow(String type, Map<String, Object> payload) {
        ApprovalFlow flow = new ApprovalFlow();
        flow.setId(101L);
        flow.setType(type);
        flow.setApplicantId(1L);
        flow.setTargetUserId(2L);
        flow.setDecidedBy(9L);
        flow.setPayload(payload);
        return flow;
    }

    private static SysDataScope insertedScope(SysDataScopeMapper mapper) {
        ArgumentCaptor<SysDataScope> captor = ArgumentCaptor.forClass(SysDataScope.class);
        verify(mapper).insert(captor.capture());
        return captor.getValue();
    }
}
