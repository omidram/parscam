"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Bell,
  Home,
  MonitorPlay,
  Radar,
  Settings,
} from "lucide-react";
import { navItems } from "@/lib/data";
import { Logo } from "@/components/brand/Logo";
import { useSettings } from "@/lib/settings";

const icons = {
  home: Home,
  monitor: MonitorPlay,
  bell: Bell,
  archive: Archive,
  scan: Radar,
  settings: Settings,
};

export function Sidebar() {
  const pathname = usePathname();
  const { settings } = useSettings();
  const collapsed = settings.sidebarCollapsed;

  return (
    <aside
      className={`glass-panel sticky top-4 z-30 flex h-[calc(100vh-2rem)] shrink-0 flex-col rounded-[24px] py-4 transition-all ${
        collapsed
          ? "w-[72px] items-center px-1.5"
          : "w-[84px] items-center px-2"
      }`}
    >
      <Link href="/dashboard" className="mb-6" aria-label="پارس کم">
        <Logo size="sm" showText={false} />
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-2">
        {navItems.map((item) => {
          const Icon = icons[item.icon];
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              title={item.label}
              className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-300 ${
                active
                  ? "bg-[var(--primary)] text-white shadow-[0_10px_24px_rgba(26,75,139,0.35)]"
                  : "text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] hover:text-[var(--primary)]"
              }`}
            >
              <Icon size={collapsed ? 18 : 20} strokeWidth={active ? 2.4 : 2} />
              <span className="pointer-events-none absolute end-full me-3 whitespace-nowrap rounded-lg bg-[var(--ink)] px-2.5 py-1 text-[0.72rem] text-[var(--surface)] opacity-0 shadow-lg transition group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-2 pt-3">
        <div className="h-8 w-8 overflow-hidden rounded-full bg-[linear-gradient(135deg,#1a4b8b,#f39200)] p-[2px]">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--surface)] text-[0.7rem] font-bold text-[var(--primary)]">
            اد
          </div>
        </div>
      </div>
    </aside>
  );
}
