"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { KeyRound, Zap } from "lucide-react";
import { Button } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setError("The reset link is missing its token."); setLoading(false); return; }
    try {
      await apiRequest("/auth/reset-password", { method: "POST", body: { token, password }, retryAuth: false });
      setMessage("Your password has been reset. Existing sessions were signed out.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The password could not be reset.");
    } finally { setLoading(false); }
  }
  return <main className="auth-shell"><section className="auth-form-side !max-w-none"><div className="auth-brand"><span className="brand-mark !h-9 !w-9"><Zap size={18}/></span>SmartRetail</div><form className="auth-form" method="post" onSubmit={submit}><KeyRound className="text-brand"/><h1>Choose a new password.</h1><p>Use at least 10 characters. Resetting signs out every existing session.</p>{message ? <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{message}</div> : <><label className="auth-label">New password<input className="field" required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><Button className="w-full !h-12" disabled={loading}>{loading ? "Resetting…" : "Reset password"}</Button></>}{error && <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}<Link href="/login" className="mt-4 text-center text-xs font-bold text-brand">Back to sign in</Link></form></section></main>;
}
