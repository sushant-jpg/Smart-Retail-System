"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Mail, Zap } from "lucide-react";
import { Button } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { await apiRequest("/auth/forgot-password", { method: "POST", body: { email }, retryAuth: false }); setSent(true); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Reset instructions could not be requested."); }
    finally { setLoading(false); }
  }
  return <main className="auth-shell"><section className="auth-form-side !max-w-none"><div className="auth-brand"><span className="brand-mark !h-9 !w-9"><Zap size={18}/></span>SmartRetail</div><form className="auth-form" method="post" onSubmit={submit}><span className="eyebrow text-brand">Account recovery</span><h1>Reset your password.</h1><p>Enter your account email. The response is intentionally identical whether an account exists or not.</p>{sent?<div className="rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Mail className="mb-3"/>If the address is registered, reset instructions have been sent.</div>:<><label className="auth-label">Email address<input required type="email" value={email} onChange={(event)=>setEmail(event.target.value)} className="field" autoComplete="email"/></label><Button className="w-full !h-12" disabled={loading}>{loading?"Submitting…":"Send reset instructions"}</Button></>}{error&&<div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}<Link href="/login" className="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-brand"><ArrowLeft size={14}/>Back to sign in</Link></form></section></main>;
}
