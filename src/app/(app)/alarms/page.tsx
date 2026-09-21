"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";

type Alarm = {
  id: number;
  cam_name?: string;
  title?: string;
  location?: string;
  reason?: string;
  time?: string;
};

export default function AlarmsPage() {
  const [items, setItems] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alarms", { cache: "no-store" });
      const data = (await res.json()) as Alarm[];
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id?: number) {
    const url = id ? `/api/alarms?id=${id}` : "/api/alarms";
    await fetch(url, { method: "DELETE" });
    await load();
  }

  return (
    <>
      <TopBar
        title="مرکز هشدارها"
        subtitle="رویدادهای ثبت‌شده در alarms.json — حذف تکی یا پاک‌کردن همه"
      />

      <div className="glass-panel overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h2 className="font-extrabold text-[var(--primary-deep)]">فهرست هشدارها</h2>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("همه هشدارها پاک شوند؟")) remove();
            }}
            className="text-[0.8rem] font-semibold text-[var(--danger)]"
          >
            پاک کردن همه
          </button>
        </div>

        {loading ? (
          <div className="px-4 py-16 text-center text-[var(--muted)]">در حال بارگذاری...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-16 text-center text-[var(--muted)]">
            هشدار فعالی وجود ندارد.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-[var(--surface-soft)]"
              >
                <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--danger)]" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{a.reason || a.title || "هشدار"}</div>
                  <div className="text-[0.8rem] text-[var(--muted)]">
                    {a.cam_name || a.location || "—"} · {a.time || ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  className="rounded-xl p-2 text-[var(--muted)] hover:bg-[rgba(200,16,46,0.08)] hover:text-[var(--danger)]"
                  aria-label="حذف"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
