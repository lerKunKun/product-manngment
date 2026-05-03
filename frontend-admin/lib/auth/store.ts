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

type AuthState = {
  user: AuthUser | null;
  /** 仅内存：避免 XSS 偷读；刷新页面靠 /auth/refresh 凭 httpOnly cookie 重新拿 */
  accessToken: string | null;
  hydrated: boolean;
  setSession: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string | null) => void;
  setUser: (user: AuthUser | null) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      hydrated: false,
      setSession: (user, accessToken) => set({ user, accessToken }),
      setAccessToken: (token) => set({ accessToken: token }),
      setUser: (user) => set({ user }),
      clear: () => set({ user: null, accessToken: null }),
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
