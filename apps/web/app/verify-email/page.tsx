"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MailCheck, Zap } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState("Verifying your email…");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      queueMicrotask(() => { setFailed(true); setStatus("The verification link is missing its token."); });
      return;
    }
    apiRequest("/auth/verify-email", { method: "POST", body: { token }, retryAuth: false })
      .then(() => setStatus("Your email is verified. You can now sign in."))
      .catch((cause) => { setFailed(true); setStatus(cause instanceof ApiError ? cause.message : "The verification link could not be used."); });
  }, []);
  return <main className="auth-shell"><section className="auth-form-side !max-w-none"><div className="auth-brand"><span className="brand-mark !h-9 !w-9"><Zap size={18}/></span>SmartRetail</div><div className="auth-form text-center"><MailCheck className={`mx-auto mb-4 ${failed ? "text-red-600" : "text-brand"}`} size={38}/><h1>Email verification</h1><p role="status">{status}</p><Link href="/login" className="mt-5 block text-xs font-bold text-brand">Continue to sign in</Link></div></section></main>;
}
