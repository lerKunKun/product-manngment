"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { configureApi } from "@/lib/api/client";

export type AuthUser = {
  userId: number;
  username: string;
  employeeNo?: string;
  userType?: "STAFF" | "TEMP";
  passwordMustChange?: boolean;
};

/**
 * Impersonate 状态。impersonating=true 时 AppShell 顶部展示 banner，提示「以 X 身份登录中」+ 「返回原身份」。
 * original.* 是发起 impersonate 之前的 user/accessToken 备份，用于一键还原。
 * 注意：originalAccessToken 仅放内存（同 accessToken 本身），刷新页面后会失去备份；
 *       此时 banner 仍能根据 user.imp 标记或 sessionStorage 兜底引导用户手动 logout 后重登。
 */
export type ImpersonationState = {
  impersonating: boolean;
  targetUserId?: number;
  targetUsername?: string;
  expiresAt?: number;       // epoch ms，用于前端倒计时
  original?: {
    user: AuthUser | null;
    accessToken: string | null;
  };
};

type AuthState = {
  user: AuthUser | null;
  /** 仅内存：避免 XSS 偷读；刷新页面靠 /auth/refresh 凭 httpOnly cookie 重新拿 */
  accessToken: string | null;
  hydrated: boolean;
  impersonation: ImpersonationState;
  setSession: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string | null) => void;
  setUser: (user: AuthUser | null) => void;
  clear: () => void;
  /** 进入 impersonate：备份当前身份 → 替换 user/token。 */
  beginImpersonation: (target: { userId: number; username: string }, accessToken: string, ttlSeconds: number) => void;
  /** 退出 impersonate：恢复 original.user / original.accessToken。返回是否成功还原。 */
  endImpersonation: () => boolean;
};

const SS_KEY = "shub-impersonation";

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      hydrated: false,
      impersonation: { impersonating: false },
      setSession: (user, accessToken) => set({ user, accessToken }),
      setAccessToken: (token) => set({ accessToken: token }),
      setUser: (user) => set({ user }),
      clear: () =>
        set({
          user: null,
          accessToken: null,
          impersonation: { impersonating: false },
        }),
      beginImpersonation: (target, accessToken, ttlSeconds) => {
        const { user, accessToken: oldToken } = get();
        const expiresAt = Date.now() + ttlSeconds * 1000;
        // sessionStorage 备份原 token，用于「页面刷新后还能返回原身份」的最佳努力恢复。
        // localStorage 上故意不放：避免新开标签页误以为还在 impersonate。
        try {
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(
              SS_KEY,
              JSON.stringify({
                originalAccessToken: oldToken,
                originalUser: user,
                expiresAt,
                target,
              })
            );
          }
        } catch {
          /* ignore */
        }
        set({
          user: {
            userId: target.userId,
            username: target.username,
          },
          accessToken,
          impersonation: {
            impersonating: true,
            targetUserId: target.userId,
            targetUsername: target.username,
            expiresAt,
            original: { user, accessToken: oldToken },
          },
        });
      },
      endImpersonation: () => {
        const { impersonation } = get();
        // 优先用内存里的 original；其次 sessionStorage 兜底（页面刷新后的最佳努力恢复）
        let originalUser: AuthUser | null = impersonation.original?.user ?? null;
        let originalToken: string | null = impersonation.original?.accessToken ?? null;
        if ((!originalToken || !originalUser) && typeof window !== "undefined") {
          try {
            const raw = window.sessionStorage.getItem(SS_KEY);
            if (raw) {
              const obj = JSON.parse(raw) as {
                originalAccessToken: string | null;
                originalUser: AuthUser | null;
              };
              if (!originalToken) originalToken = obj.originalAccessToken;
              if (!originalUser) originalUser = obj.originalUser;
            }
          } catch {
            /* ignore */
          }
        }
        try {
          if (typeof window !== "undefined") window.sessionStorage.removeItem(SS_KEY);
        } catch {
          /* ignore */
        }
        if (!originalToken || !originalUser) {
          // 还原失败：彻底清掉，让前端引导回 /login（用 refresh cookie 重登）。
          set({
            user: null,
            accessToken: null,
            impersonation: { impersonating: false },
          });
          return false;
        }
        set({
          user: originalUser,
          accessToken: originalToken,
          impersonation: { impersonating: false },
        });
        return true;
      },
    }),
    {
      name: "shub-auth",
      storage: createJSONStorage(() => localStorage),
      // 只持久化 user 用于 UI 占位；access token 一律内存
      partialize: (s) => ({ user: s.user }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);

if (typeof window !== "undefined") {
  configureApi({
    getToken: () => useAuthStore.getState().accessToken,
    onUnauthorized: () => {
      useAuthStore.getState().clear();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    },
    refresh: async () => {
      try {
        // 走原生 fetch，不经 api wrapper，避免 401 递归
        const resp = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!resp.ok) return false;
        const body = await resp.json().catch(() => null);
        if (!body || body.code !== 0 || !body.data) return false;
        const d = body.data as {
          userId: number;
          username: string;
          employeeNo?: string;
          userType?: "STAFF" | "TEMP";
          passwordMustChange: boolean;
          accessToken: string;
        };
        useAuthStore.getState().setSession(
          {
            userId: d.userId,
            username: d.username,
            employeeNo: d.employeeNo,
            userType: d.userType,
            passwordMustChange: d.passwordMustChange,
          },
          d.accessToken
        );
        return true;
      } catch {
        return false;
      }
    },
  });
}
