"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./auth-provider";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, router, user]);
  if (loading || !user) return <main className="grid min-h-screen place-items-center bg-canvas"><div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand" /><p className="mt-3 text-xs text-muted">Securing your workspace…</p></div></main>;
  return children;
}
