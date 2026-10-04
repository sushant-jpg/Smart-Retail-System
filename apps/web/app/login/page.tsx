"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, ShieldCheck, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";

const schema = z.object({ email: z.string().email("Enter a valid email address"), password: z.string().min(10, "Password must be at least 10 characters") });
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const router = useRouter();
  const { login } = useAuth();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "manager@smartretail.demo", password: "DemoPass!2026" } });

  async function submit(values: FormValues) {
    setLoading(true); setServerError("");
    try { await login(values.email, values.password); router.push("/dashboard"); }
    catch (error) { setServerError(error instanceof ApiError ? error.message : "Unable to sign in. Check that the API is running."); }
    finally { setLoading(false); }
  }

  return <main className="auth-shell">
    <section className="auth-form-side">
      <div className="auth-brand"><span className="brand-mark !h-9 !w-9"><Zap size={18}/></span>SmartRetail</div>
      <form className="auth-form" method="post" onSubmit={handleSubmit(submit)}>
        <span className="eyebrow text-brand">Operations workspace</span><h1>Welcome back.</h1><p>Sign in to manage today’s sales, inventory, and store performance.</p>
        <label className="auth-label">Work email<input {...register("email")} className="field" autoComplete="email"/>{errors.email&&<span className="mt-1 block text-[10px] text-red-600">{errors.email.message}</span>}</label>
        <label className="auth-label">Password<div className="relative"><input {...register("password")} type={showPassword?"text":"password"} className="field !pr-11" autoComplete="current-password"/><button type="button" className="icon-button absolute right-1 top-1 !h-9 !w-9" onClick={()=>setShowPassword((value)=>!value)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>{errors.password&&<span className="mt-1 block text-[10px] text-red-600">{errors.password.message}</span>}</label>
        <div className="mb-5 flex items-center justify-between text-[10px]"><Link href="/register" className="font-bold text-brand">Create customer account</Link><Link href="/forgot-password" className="font-bold text-brand">Forgot password?</Link></div>
        {serverError&&<div role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">{serverError}</div>}
        <Button className="w-full !h-12" disabled={loading}>{loading?"Opening workspace…":"Sign in securely"}</Button>
        <div className="mt-5 flex items-center justify-center gap-2 text-[9px] text-muted"><ShieldCheck size={13} className="text-brand"/>Protected by rotating session security</div>
        <div className="mt-7 rounded-xl border border-line bg-canvas p-3 text-[10px] text-muted"><strong className="mb-1 block text-ink">Seeded demo account</strong>Run <code>npm run seed</code>, then use the prefilled credentials. This form authenticates against the API; it does not bypass sign-in.</div>
      </form>
      <p className="m-0 text-[9px] text-muted">© 2026 SmartRetail · Privacy · Security</p>
    </section>
    <section className="auth-visual" aria-label="SmartRetail product overview"><div className="auth-showcase"><div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><Sparkles size={23} className="text-[#f6c768]"/></div><h2>One clear view of your entire retail operation.</h2><p>From the shelf to the checkout, SmartRetail turns daily activity into confident decisions.</p><div className="auth-metrics"><div className="auth-metric"><strong>Atomic</strong><span>Inventory updates</span></div><div className="auth-metric"><strong>RBAC</strong><span>Server enforced</span></div><div className="auth-metric"><strong>Live</strong><span>Store events</span></div></div><div className="auth-quote"><p>“The morning overview tells me exactly where the team needs to focus.”</p><span>Aarav · Flagship manager</span></div></div></section>
  </main>;
}
