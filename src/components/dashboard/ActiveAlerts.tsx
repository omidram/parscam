"use client";

import { useEffect, useState } from "react";
import { Package, ShieldBan, UserRoundSearch } from "lucide-react";
import Link from "next/link";

type Alarm = {
  id: number;
  cam_name?: string;
  reason?: string;
  time?: string;
};

export function ActiveAlerts() {
  const [items, setItems] = useState<Alarm[]>([]);

  useEffect(() => {
    fetch("/api/alarms", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d.slice(0, 6) : []))
      .catch(() => setItems([]));
  }, []);

  return (
    <section className="animate-fade-slide glass-panel rounded-[22px] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[1rem] font-extrabold text-[var(--primary-deep)]">
          هشدارهای فعال
        </h2>
        <Link
          href="/alarms"
          className="rounded-full bg-[rgba(200,16,46,0.1)] px-2 py-0.5 text-[0.72rem] font-bold text-[var(--danger)]"
        >
          {items.length} · همه
        </Link>
      </div>

      <div className="flex max-h-[360px] flex-col gap-2.5 overflow-auto pe-1">
        {items.length === 0 ? (
          <p className="py-8 text-center text-[0.85rem] text-[var(--muted)]">
            هشداری نیست
          </p>
        ) : (
          items.map((alert, i) => {
            const Icon = i === 0 ? ShieldBan : i === 1 ? UserRoundSearch : Package;
            return (
              <article
                key={alert.id}
                className="rounded-2xl border-e-4 border-[var(--danger)] bg-[var(--surface-soft)] p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(200,16,46,0.1)] text-[var(--danger)]">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[0.88rem] font-bold">
                      {alert.reason || "هشدار"}
                    </h3>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[var(--muted)]">
                      {alert.cam_name || "—"} · {alert.time || ""}
                    </p>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
