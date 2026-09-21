"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { IranBadge } from "@/components/brand/IranBadge";
import { IranFlag } from "@/components/brand/IranFlag";
import { ThemeToggle } from "@/components/ThemeToggle";
import { brand } from "@/lib/data";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(e.currentTarget);
    const user = String(data.get("username") || "");
    const pass = String(data.get("password") || "");

    window.setTimeout(() => {
      if (user === "admin" && pass.length > 0) {
        router.push("/dashboard");
        return;
      }
      setError("نام کاربری یا رمز عبور اشتباه است.");
      setLoading(false);
    }, 500);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="persian-pattern pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -start-20 top-10 h-72 w-72 rounded-full bg-[rgba(0,150,57,0.12)] blur-3xl" />
      <div className="pointer-events-none absolute -end-16 bottom-8 h-80 w-80 rounded-full bg-[rgba(243,146,0,0.16)] blur-3xl" />

      <div className="relative w-full max-w-[440px] animate-rise">
        <div className="mb-4 flex justify-end">
          <ThemeToggle compact />
        </div>
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size="lg" showText={false} />
          </div>
          <div className="mb-3 flex justify-center">
            <IranFlag width={64} height={38} />
          </div>
          <h1 className="text-[2rem] font-black tracking-tight text-[var(--primary-deep)]">
            {brand.nameFa}
          </h1>
          <p className="mt-1 text-[0.95rem] text-[var(--muted)]">
            {brand.tagline}
          </p>
          <div className="mt-3 flex justify-center">
            <IranBadge />
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="glass-panel gereh-border rounded-[24px] p-6 shadow-[var(--shadow)] md:p-7"
        >
          <h2 className="mb-5 text-center text-[1.1rem] font-extrabold text-[var(--primary-deep)]">
            ورود به سامانه
          </h2>

          <label className="mb-3 block text-[0.8rem] font-semibold text-[var(--muted)]">
            نام کاربری
            <input
              name="username"
              defaultValue="admin"
              required
              autoFocus
              autoComplete="username"
              className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[0.95rem] outline-none transition focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(243,146,0,0.15)]"
              placeholder="admin"
            />
          </label>

          <label className="mb-4 block text-[0.8rem] font-semibold text-[var(--muted)]">
            رمز عبور
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[0.95rem] outline-none transition focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(243,146,0,0.15)]"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-[linear-gradient(135deg,#1a4b8b,#123663)] px-4 py-3.5 text-[0.95rem] font-bold text-white shadow-[0_14px_30px_rgba(26,75,139,0.35)] transition hover:brightness-110 disabled:opacity-70"
          >
            {loading ? "در حال ورود..." : "ورود به پارس کم"}
          </button>

          {error ? (
            <div className="mt-3 rounded-2xl border border-[rgba(200,16,46,0.25)] bg-[rgba(200,16,46,0.08)] px-3 py-2.5 text-center text-[0.83rem] text-[var(--danger)]">
              {error}
            </div>
          ) : null}
        </form>

        <footer className="mt-8 text-center text-[0.75rem] leading-7 text-[var(--muted)]">
          <div>
            📞 {brand.phone} · ✉️ {brand.email}
          </div>
          <div>
            © ۱۴۰۴ {brand.company} — تمامی حقوق محفوظ است · {brand.claim}
          </div>
        </footer>
      </div>
    </div>
  );
}
