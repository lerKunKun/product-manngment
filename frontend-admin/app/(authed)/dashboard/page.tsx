"use client";

import { useAuthStore } from "@/lib/auth/store";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">欢迎，{user?.username}</h1>
      <div className="rounded-lg border bg-muted/30 p-6 text-sm">
        <div className="mb-2 font-medium">当前阶段：Wave 1 进行中</div>
        <ul className="space-y-1 text-muted-foreground">
          <li>✅ 用户登录 / JWT</li>
          <li>✅ 临时员工邀请（左侧菜单可进入）</li>
          <li>✅ 钉钉扫码登录链路</li>
          <li>🟡 店铺管理（开发中）</li>
          <li>🟡 产品库（开发中）</li>
        </ul>
      </div>
    </div>
  );
}
