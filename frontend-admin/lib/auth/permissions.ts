"use client";

/**
 * RBAC 权限检查 hook（前端 UX 层）。
 *
 * 重要：这里只决定**菜单是否显示 / 按钮是否禁用**等 UX 表现。真正的权限拦截
 * 在后端（JwtAuthFilter + SecurityConfig + @PreAuthorize）。绝不能用前端
 * hasPerm 替代后端鉴权——任何人都能本地改 zustand 绕过前端检查。
 */

import { useAuthStore } from "./store";

/** Spring Security 默认 hasRole 自动加 ROLE_ 前缀；前端这里直接比对 code，不带前缀。 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];

  return {
    user,
    roles,
    permissions,
    /** 任一角色匹配。常用：hasRole("PLATFORM_SUPER") */
    hasRole: (code: string) => roles.includes(code),
    /** 任一角色在列表内 */
    hasAnyRole: (...codes: string[]) => codes.some((c) => roles.includes(c)),
    /** 单权限码命中。注意 PLATFORM_SUPER 走的是角色绑定的全权限，所以 hasPerm 也会命中。 */
    hasPerm: (code: string) => permissions.includes(code),
    /** 任一权限码命中（适合 nav 项目这种「能看到任意一个 sub-page 就显示」的场景） */
    hasAnyPerm: (...codes: string[]) => codes.some((c) => permissions.includes(c)),
    /** 所有权限码都命中（敏感按钮 gate 用） */
    hasAllPerms: (...codes: string[]) => codes.every((c) => permissions.includes(c)),
    /** 平台超管捷径——通常 admin-only 页面用 */
    isPlatformSuper: () => roles.includes("PLATFORM_SUPER"),
    /** 是否任意 admin 类角色（PLATFORM_SUPER / COMPANY_ADMIN / DEPT_LEAD） */
    isAdminLike: () =>
      roles.includes("PLATFORM_SUPER") ||
      roles.includes("COMPANY_ADMIN") ||
      roles.includes("DEPT_LEAD"),
  };
}
