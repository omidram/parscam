"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Play, X } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { toPersianDigits } from "@/lib/format";
import { useSearch } from "@/lib/search";

type Rec = {
  id: string;
  camera: string;
  filename: string;
  date: string;
  size: string;
  cam: string;
};

export default function RecordingsPage() {
  const { query } = useSearch();
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<Rec | null>(null);
  const [camFilter, setCamFilter] = useState("all");

  useEffect(() => {
    fetch("/api/recordings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Rec[]) => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const folders = useMemo(
    () => ["all", ...Array.from(new Set(items.map((i) => i.cam)))],
    [items],
  );

  const visible = useMemo(() => {
    return items.filter((r) => {
      if (camFilter !== "all" && r.cam !== camFilter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        r.camera.toLowerCase().includes(q) ||
        r.filename.toLowerCase().includes(q) ||
        r.date.includes(q)
      );
    });
  }, [items, camFilter, query]);

  function fileUrl(r: Rec, download = false, play = false) {
    const u = `/api/recordings/file?cam=${encodeURIComponent(r.cam)}&file=${encodeURIComponent(r.filename)}`;
    if (download) return `${u}&download=1`;
    if (play) return `${u}&play=1`;
    return u;
  }

  return (
    <>
      <TopBar
        title="آرشیو ضبط"
        subtitle="فایل‌های واقعی پوشه recordings — پخش و دانلود محلی"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.82rem] text-[var(--muted)]">
          {toPersianDigits(visible.length)} فایل
        </span>
        <select
          value={camFilter}
          onChange={(e) => setCamFilter(e.target.value)}
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[0.82rem]"
          aria-label="فیلتر دوربین"
        >
          {folders.map((f) => (
            <option key={f} value={f}>
              {f === "all" ? "همه دوربین‌ها" : f}
            </option>
          ))}
        </select>
      </div>

      <div className="glass-panel overflow-x-auto rounded-[22px]">
        {loading ? (
          <p className="py-12 text-center text-[var(--muted)]">در حال خواندن آرشیو...</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-[var(--muted)]">ضبطی یافت نشد.</p>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-right text-[0.9rem]">
            <thead className="bg-[var(--surface-soft)] text-[0.78rem] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">دوربین</th>
                <th className="px-4 py-3 font-semibold">فایل</th>
                <th className="px-4 py-3 font-semibold">تاریخ</th>
                <th className="px-4 py-3 font-semibold">حجم</th>
                <th className="px-4 py-3 font-semibold">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--line)] transition hover:bg-[var(--surface-soft)]"
                >
                  <td className="px-4 py-3.5 font-bold text-[var(--primary-deep)]">
                    {r.camera}
                  </td>
                  <td className="px-4 py-3.5 text-[0.8rem]" dir="ltr">
                    {r.filename}
                  </td>
                  <td className="px-4 py-3.5 number-display">{r.date}</td>
                  <td className="px-4 py-3.5 number-display">{r.size}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPlaying(r)}
                        className="inline-flex items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-2.5 py-1.5 text-[0.78rem] font-semibold text-[var(--primary)]"
                      >
                        <Play size={14} /> پخش
                      </button>
                      <a
                        href={fileUrl(r, true)}
                        download={r.filename}
                        className="inline-flex items-center gap-1 rounded-xl bg-[var(--accent-soft)] px-2.5 py-1.5 text-[0.78rem] font-semibold text-[var(--accent)]"
                      >
                        <Download size={14} /> دانلود
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {playing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-[22px] bg-[var(--surface)] shadow-[var(--shadow)]">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-extrabold text-[var(--primary-deep)]">
                  {playing.camera}
                </div>
                <div className="text-[0.78rem] text-[var(--muted)]" dir="ltr">
                  {playing.filename}
                </div>
              </div>
              <button type="button" onClick={() => setPlaying(null)} aria-label="بستن">
                <X size={18} />
              </button>
            </div>
            <video
              key={playing.id}
              controls
              autoPlay
              playsInline
              preload="auto"
              className="aspect-video w-full bg-black"
              src={fileUrl(playing, false, true)}
            >
              مرورگر شما پخش ویدیو را پشتیبانی نمی‌کند.
            </video>
          </div>
        </div>
      ) : null}
    </>
  );
}
