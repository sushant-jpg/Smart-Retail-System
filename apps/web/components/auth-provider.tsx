"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest, setAccessToken } from "@/lib/api";

export type AuthUser = { id: string; email: string; firstName: string; lastName: string; role: string; storeIds: string[] };
type AuthContextValue = { user: AuthUser | null; loading: boolean; login: (email: string, password: string) => Promise<AuthUser>; logout: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

let sessionRestorePromise: Promise<{ user: AuthUser; accessToken: string }> | null = null;

function restoreSession() {
  if (!sessionRestorePromise) {
    sessionRestorePromise = apiRequest<{ user: AuthUser; accessToken: string }>("/auth/refresh", { method: "POST", retryAuth: false })
      .finally(() => { sessionRestorePromise = null; });
  }
  return sessionRestorePromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestVersion = useRef(0);

  useEffect(() => {
    const version = authRequestVersion.current;
    restoreSession()
      .then((result) => {
        if (version !== authRequestVersion.current) return;
        setAccessToken(result.accessToken);
        setUser(result.user);
      })
      .catch(() => {
        if (version !== authRequestVersion.current) return;
        setAccessToken(null);
        setUser(null);
      })
      .finally(() => {
        if (version === authRequestVersion.current) setLoading(false);
      });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, loading,
    login: async (email, password) => {
      const version = ++authRequestVersion.current;
      try {
        const result = await apiRequest<{ user: AuthUser; accessToken: string }>("/auth/login", { method: "POST", body: { email, password }, retryAuth: false });
        if (version !== authRequestVersion.current) throw new Error("Sign-in was superseded by a newer authentication action");
        setAccessToken(result.accessToken);
        setUser(result.user);
        return result.user;
      } finally {
        if (version === authRequestVersion.current) setLoading(false);
      }
    },
    logout: async () => {
      const version = ++authRequestVersion.current;
      try { await apiRequest("/auth/logout", { method: "POST", retryAuth: false }); }
      finally {
        if (version === authRequestVersion.current) {
          setAccessToken(null);
          setUser(null);
          setLoading(false);
        }
      }
    },
  }), [loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
