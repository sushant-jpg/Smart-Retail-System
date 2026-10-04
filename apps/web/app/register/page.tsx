"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MailCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui";
import { ApiError, apiRequest } from "@/lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      await apiRequest("/auth/register", { method: "POST", body: form, retryAuth: false });
      setSubmittedEmail(form.email);
      setMessage("Check your email for a verification link before signing in.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Registration could not be completed.");
    } finally { setLoading(false); }
  }

  async function resend() {
    setLoading(true); setError("");
    try {
      await apiRequest("/auth/resend-verification", { method: "POST", body: { email: submittedEmail }, retryAuth: false });
      setMessage("If the address is awaiting verification, a new message has been sent.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The verification message could not be sent.");
    } finally { setLoading(false); }
  }

  return <main className="auth-shell"><section className="auth-form-side !max-w-none"><div className="auth-brand"><span className="brand-mark !h-9 !w-9"><Zap size={18}/></span>SmartRetail</div>
    <div className="auth-form"><span className="eyebrow text-brand">Customer account</span><h1>Create your account.</h1><p>Register to shop, earn loyalty points, and retrieve your receipts.</p>
      {submittedEmail ? <div className="rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><MailCheck className="mb-3"/><p>{message}</p><Button className="mt-4" variant="secondary" onClick={resend} disabled={loading}>{loading ? "Sending…" : "Resend verification"}</Button></div>
        : <form method="post" onSubmit={submit}><div className="grid gap-3 sm:grid-cols-2"><label className="auth-label">First name<input className="field" required maxLength={60} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })}/></label><label className="auth-label">Last name<input className="field" required maxLength={60} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })}/></label></div><label className="auth-label">Email address<input className="field" required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label><label className="auth-label">Password<input className="field" required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label><Button className="w-full !h-12" disabled={loading}>{loading ? "Creating account…" : "Create account"}</Button></form>}
      {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}<Link href="/login" className="mt-5 block text-center text-xs font-bold text-brand">Back to sign in</Link>
    </div></section></main>;
}
