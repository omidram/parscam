"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BellRing,
  Pencil,
  Plus,
  Radio,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { CameraStream } from "@/components/CameraStream";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { useSearch } from "@/lib/search";

type Cam = {
  id: number;
  name: string;
  rtsp: string;
  location: string;
  recording: boolean;
};

export default function MonitorClient() {
  const { settings } = useSettings();
  const { query } = useSearch();
  const params = useSearchParams();
  const urlQ = params.get("q") || "";
  const filter = (query || urlQ).trim();

  const [cams, setCams] = useState<Cam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [netWarn, setNetWarn] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [form, setForm] = useState({ name: "", rtsp: "", location: "" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const gridClass =
    settings.gridColumns === 4
      ? "md:grid-cols-2 xl:grid-cols-4"
      : settings.gridColumns === 3
        ? "md:grid-cols-2 xl:grid-cols-3"
        : "md:grid-cols-2";

  const load = useCallback(async () => {
    try {
      const [camRes, recRes] = await Promise.all([
        fetch("/api/cameras", { cache: "no-store" }),
        fetch("/api/record", { cache: "no-store" }),
      ]);
      const list = (await camRes.json()) as Omit<Cam, "recording">[];
      const rec = (await recRes.json()) as Record<string, boolean>;
      setCams(
        list.map((c) => ({
          ...c,
          recording: Boolean(rec[String(c.id)]),
        })),
      );
      setError("");
    } catch {
      setError("بارگذاری دوربین‌ها ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/network", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setNetWarn(String(d.warning || "")))
      .catch(() => setNetWarn(""));
  }, []);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function toggleRecord(cam: Cam) {
    setBusyId(cam.id);
    try {
      const res = await fetch("/api/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: cam.recording ? "stop" : "start",
          cam_id: cam.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا");
      setCams((prev) =>
        prev.map((c) =>
          c.id === cam.id ? { ...c, recording: !cam.recording } : c,
        ),
      );
      flash(cam.recording ? "ضبط متوقف شد" : "ضبط شروع شد");
    } catch (e) {
      flash(e instanceof Error ? e.message : "خطای ضبط");
    } finally {
      setBusyId(null);
    }
  }

  async function removeCam(id: number) {
    if (!window.confirm("این دوربین حذف شود؟")) return;
    const res = await fetch(`/api/cameras?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setCams((prev) => prev.filter((c) => c.id !== id));
      flash("دوربین حذف شد");
    } else flash("حذف ناموفق بود");
  }

  async function saveCam(e: React.FormEvent) {
    e.preventDefault();
    const editing = modal === "edit" && selected;
    const res = await fetch("/api/cameras", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selected,
        name: form.name,
        rtsp: form.rtsp,
        location: form.location,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      flash(data.error || "ذخیره ناموفق");
      return;
    }
    setModal(null);
    flash(editing ? "دوربین ویرایش شد" : "دوربین اضافه شد");
    await load();
  }

  async function raiseAlarm(cam: Cam) {
    const res = await fetch("/api/alarms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cam_id: cam.id,
        cam_name: cam.name,
        reason: "آلارم دستی از مانیتور",
      }),
    });
    flash(res.ok ? "هشدار ثبت شد" : "ثبت هشدار ناموفق بود");
  }

  const visible = useMemo(() => {
    if (!filter) return cams;
    const q = filter.toLowerCase();
    return cams.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.location || "").toLowerCase().includes(q),
    );
  }, [cams, filter]);

  const online = visible.length;

  return (
    <>
      <TopBar
        title="نظارت و ضبط"
        subtitle="مشاهده زنده از RTSP، ضبط با ffmpeg و مدیریت دوربین‌ها"
      />

      {toast ? (
        <div className="mb-3 rounded-2xl bg-[var(--primary-soft)] px-3 py-2 text-[0.85rem] font-semibold text-[var(--primary)]">
          {toast}
        </div>
      ) : null}
      {netWarn ? (
        <div className="mb-3 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--accent-soft)] px-3 py-2 text-[0.85rem] font-semibold text-[var(--accent)]">
          {netWarn}
        </div>
      ) : null}
      {error ? (
        <div className="mb-3 rounded-2xl bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-[0.85rem] text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="glass-panel rounded-full px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--success)]">
          آنلاین: {toPersianDigits(online)} از {toPersianDigits(cams.length)}
        </span>
        <Link
          href="/alarms"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--primary)]"
        >
          <BellRing size={14} />
          هشدارها
        </Link>
        <button
          type="button"
          onClick={() => {
            setForm({
              name: "",
              rtsp: "rtsp://admin:123456@enster.oicp.net/stream0",
              location: "",
            });
            setSelected(null);
            setModal("add");
          }}
          className="ms-auto inline-flex items-center gap-1.5 rounded-2xl bg-[var(--primary)] px-3.5 py-2 text-[0.85rem] font-bold text-white"
        >
          <Plus size={16} />
          افزودن دوربین
        </button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-[var(--muted)]">در حال بارگذاری...</p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-[var(--muted)]">دوربینی یافت نشد.</p>
      ) : (
        <div className={`grid gap-3 ${gridClass}`}>
          {visible.map((cam) => (
            <article
              key={cam.id}
              className={`glass-panel overflow-hidden rounded-[20px] ${
                selected === cam.id ? "ring-2 ring-[var(--accent)]" : ""
              }`}
              onClick={() => setSelected(cam.id)}
            >
              <div className="relative aspect-video">
                <CameraStream
                  camId={cam.id}
                  className="absolute inset-0 h-full w-full"
                />
                {settings.showLiveBadge ? (
                  <div className="pointer-events-none absolute start-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[0.72rem] text-white">
                    <span className="live-dot" />
                    {cam.recording ? "ضبط" : "زنده"}
                  </div>
                ) : null}
                {settings.showCameraOverlay ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent p-3">
                    <h3 className="text-[0.92rem] font-bold text-white">
                      {cam.name}
                    </h3>
                    <p className="text-[0.72rem] text-white/70">
                      {formatJalaliDateTime()} · {cam.location}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  disabled={busyId === cam.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRecord(cam);
                  }}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[0.8rem] font-bold disabled:opacity-60 ${
                    cam.recording
                      ? "bg-[rgba(200,16,46,0.1)] text-[var(--danger)]"
                      : "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]"
                  }`}
                >
                  {cam.recording ? (
                    <>
                      <Square size={14} /> توقف ضبط
                    </>
                  ) : (
                    <>
                      <Radio size={14} /> شروع ضبط
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    raiseAlarm(cam);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
                  title="ثبت هشدار"
                >
                  <BellRing size={15} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(cam.id);
                    setForm({
                      name: cam.name,
                      rtsp: cam.rtsp,
                      location: cam.location,
                    });
                    setModal("edit");
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-soft)] text-[var(--primary)]"
                  title="ویرایش"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCam(cam.id);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(200,16,46,0.08)] text-[var(--danger)]"
                  aria-label="حذف دوربین"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={saveCam}
            className="glass-panel w-full max-w-md rounded-[22px] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-extrabold text-[var(--primary-deep)]">
                {modal === "add" ? "افزودن دوربین" : "ویرایش دوربین"}
              </h2>
              <button
                type="button"
                onClick={() => setModal(null)}
                aria-label="بستن"
              >
                <X size={18} />
              </button>
            </div>
            <label className="mb-3 block text-[0.8rem] font-semibold text-[var(--muted)]">
              نام
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2.5"
              />
            </label>
            <label className="mb-3 block text-[0.8rem] font-semibold text-[var(--muted)]">
              آدرس RTSP
              <input
                required
                dir="ltr"
                value={form.rtsp}
                onChange={(e) => setForm({ ...form, rtsp: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2.5"
              />
            </label>
            <label className="mb-4 block text-[0.8rem] font-semibold text-[var(--muted)]">
              محل
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2.5"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-2xl bg-[var(--primary)] py-2.5 font-bold text-white"
            >
              ذخیره
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
