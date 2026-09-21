"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Flame, X } from "lucide-react";

type YoloEvent = {
  id: string;
  cam_name: string;
  label_fa: string;
  filter: string;
  confidence: number;
  time: string;
};

export function YoloNotifier() {
  const [toasts, setToasts] = useState<YoloEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/yolo?kind=events", { cache: "no-store" });
        const data = (await res.json()) as YoloEvent[];
        if (!alive || !Array.isArray(data) || !data.length) return;
        const newest = data[0];
        if (!newest?.id || seenRef.current.has(newest.id)) return;
        // seed seen on first load without toast spam
        if (seenRef.current.size === 0 && data.length > 0) {
          data.slice(0, 20).forEach((e) => seenRef.current.add(e.id));
          return;
        }
        seenRef.current.add(newest.id);
        setToasts((prev) => [newest, ...prev].slice(0, 4));
        if (typeof window !== "undefined" && "Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification("پارس کم · تشخیص YOLO26", {
              body: `${newest.label_fa} در ${newest.cam_name}`,
            });
          } else if (Notification.permission === "default") {
            Notification.requestPermission();
          }
        }
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== newest.id));
        }, 8000);
      } catch {
        /* ignore */
      }
    }
    poll();
    const id = window.setInterval(poll, 3500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 start-4 z-[80] flex w-[min(100%,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto animate-rise flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(200,16,46,0.12)] text-[var(--danger)]">
            {t.filter === "fire" ? <Flame size={18} /> : <Bell size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[0.88rem] font-extrabold text-[var(--primary-deep)]">
              تشخیص {t.label_fa}
            </div>
            <div className="text-[0.75rem] text-[var(--muted)]">
              {t.cam_name} · {Math.round((t.confidence || 0) * 100)}٪ · YOLO26
            </div>
          </div>
          <button
            type="button"
            className="text-[var(--muted)]"
            onClick={() => dismiss(t.id)}
            aria-label="بستن"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
