package com.biou.shopifyhub.approval;

import com.biou.shopifyhub.approval.entity.ApprovalFlow;

/**
 * 按 type 分发的 post-APPROVE 钩子；ApprovalEngine.approve 提交事务前调用。
 * 实现类按 supports(type) 返回 true 时被选中；同一 type 只命中一个 hook。
 */
public interface ApprovalTypeHook {
    boolean supports(String type);

    void onApproved(ApprovalFlow flow);
}
