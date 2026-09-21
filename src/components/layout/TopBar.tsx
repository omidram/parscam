"use client";

import { Search, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { IranBadge } from "@/components/brand/IranBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { formatJalaliDate } from "@/lib/format";
import { brand } from "@/lib/data";
import { useSearch } from "@/lib/search";

type TopBarProps = {
  title: string;
  subtitle?: string;
};

export function TopBar({ title, subtitle }: TopBarProps) {
  const { query, setQuery } = useSearch();
  const router = useRouter();

  function onSearch(value: string) {
    setQuery(value);
    if (value.trim().length > 1) {
      router.push(`/monitor?q=${encodeURIComponent(value.trim())}`);
    }
  }

  return (
    <header className="animate-rise mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <IranBadge />
          <span className="text-[0.75rem] text-[var(--muted)]">
            {formatJalaliDate()}
          </span>
        </div>
        <h1 className="text-[1.65rem] font-black tracking-tight text-[var(--primary-deep)] md:text-[1.9rem]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-xl text-[0.92rem] text-[var(--muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="glass-panel flex min-w-[240px] flex-1 items-center gap-2 rounded-2xl px-3.5 py-2.5 lg:min-w-[280px]">
          <Search size={18} className="text-[var(--muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="جستجوی دوربین..."
            className="w-full border-0 bg-transparent text-[0.9rem] outline-none placeholder:text-[var(--muted)]"
          />
        </label>
        <ThemeToggle compact />
        <a
          href="/login"
          className="inline-flex items-center gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_22%,transparent)] bg-[var(--surface)] px-3.5 py-2.5 text-[0.85rem] font-semibold text-[var(--danger)] transition hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]"
        >
          <LogOut size={16} />
          خروج
        </a>
      </div>

      <p className="sr-only">
        {brand.claim} — {brand.tagline}
      </p>
    </header>
  );
}
