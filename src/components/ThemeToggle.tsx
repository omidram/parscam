"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSettings, type ThemeMode } from "@/lib/settings";

const modes: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "روشن", Icon: Sun },
  { id: "dark", label: "تاریک", Icon: Moon },
  { id: "system", label: "سیستم", Icon: Monitor },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { settings, setTheme } = useSettings();

  if (compact) {
    const next: ThemeMode =
      settings.theme === "light"
        ? "dark"
        : settings.theme === "dark"
          ? "system"
          : "light";
    const current = modes.find((m) => m.id === settings.theme) ?? modes[0];
    const Icon = current.Icon;
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-[var(--primary)] transition hover:bg-[var(--primary-soft)]"
        title={`تم: ${current.label}`}
        aria-label="تغییر تم"
      >
        <Icon size={18} />
      </button>
    );
  }

  return (
    <div className="inline-flex rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-1">
      {modes.map(({ id, label, Icon }) => {
        const active = settings.theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[0.78rem] font-semibold transition ${
              active
                ? "bg-[var(--primary)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
