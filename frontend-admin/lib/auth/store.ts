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
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (
    user: AuthUser,
    accessToken: string,
    refreshToken: string
  ) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: "shub-auth",
      storage: createJSONStorage(() => localStorage),
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
  });
}
