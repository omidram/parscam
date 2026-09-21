"use client";

import { useEffect, useState } from "react";
import {
  BrainCircuit,
  Car,
  Cat,
  Flame,
  LoaderCircle,
  PersonStanding,
  Play,
  ShieldAlert,
  Square,
  Sword,
} from "lucide-react";
import { toPersianDigits } from "@/lib/format";

type Filters = {
  human: boolean;
  fire: boolean;
  gun: boolean;
  knife: boolean;
  animal: boolean;
  vehicle: boolean;
};

type YoloSettings = {
  enabled: boolean;
  confidence: number;
  infer_every_n_frames: number;
  cooldown_sec: number;
  filters: Filters;
  notify: boolean;
  auto_record_on_detect: boolean;
  record_duration_sec: number;
  auto_screenshot_on_detect: boolean;
  draw_boxes: boolean;
  use_open_vocab?: boolean;
  live_overlay?: boolean;
};

type Status = {
  running?: boolean;
  serverOnline?: boolean;
  model_loaded?: boolean;
  open_vocab_loaded?: boolean;
  last_error?: string;
  detections_total?: number;
  settings?: YoloSettings;
  recent?: { id: string; label_fa: string; cam_name: string; time: string }[];
};

const FILTER_META: {
  key: keyof Filters;
  label: string;
  Icon: typeof Flame;
}[] = [
  { key: "human", label: "انسان", Icon: PersonStanding },
  { key: "fire", label: "آتش", Icon: Flame },
  { key: "gun", label: "اسلحه", Icon: ShieldAlert },
  { key: "knife", label: "چاقو", Icon: Sword },
  { key: "animal", label: "حیوانات", Icon: Cat },
  { key: "vehicle", label: "ماشین", Icon: Car },
];

export function YoloSettingsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<YoloSettings | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/yolo?kind=status", { cache: "no-store" });
    const data = (await res.json()) as Status;
    setStatus(data);
    if (data.settings) setSettings(data.settings as YoloSettings);
  }

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  async function save(
    patch: Partial<Omit<YoloSettings, "filters">> & {
      filters?: Partial<Filters>;
    },
  ) {
    setBusy(true);
    setMsg("");
    try {
      const body: YoloSettings = {
        ...settings!,
        ...patch,
        filters: {
          ...settings!.filters,
          ...(patch.filters || {}),
        },
      };
      const res = await fetch("/api/yolo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
      setMsg("تنظیمات YOLO ذخیره شد.");
      await refresh();
    } catch {
      setMsg("ذخیره ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function control(action: "start" | "stop" | "reload") {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/yolo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "خطا");
        return;
      }
      if (action === "stop") {
        setMsg("موتور متوقف شد.");
      } else if (data.starting) {
        setMsg("موتور در حال راه‌اندازی است... چند لحظه صبر کنید.");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await fetch("/api/yolo?kind=status", { cache: "no-store" });
          const body = await st.json();
          if (body.serverOnline) {
            await fetch("/api/yolo", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "start" }),
            });
            setMsg("موتور YOLO از داخل پارس کم راه‌اندازی شد.");
            break;
          }
          if (body.last_error) {
            setMsg(String(body.last_error));
            break;
          }
          if (i === 39) {
            setMsg(
              "راه‌اندازی طولانی شد. اگر سرور آفلاین ماند، next dev را یک‌بار ری‌استارت کنید.",
            );
          }
        }
      } else if (action === "start") {
        setMsg(
          data.already
            ? "موتور YOLO از قبل فعال بود."
            : "موتور YOLO از داخل پارس کم راه‌اندازی شد.",
        );
      } else {
        setMsg("مدل‌ها دوباره بارگذاری شدند.");
      }
      await refresh();
    } catch {
      setMsg("اجرای موتور YOLO ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="glass-panel flex items-center justify-center gap-2 rounded-[22px] p-10 text-[var(--muted)]">
        <LoaderCircle className="animate-spin" size={18} />
        بارگذاری تنظیمات YOLO...
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="glass-panel gereh-border rounded-[22px] p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
              <BrainCircuit size={22} />
            </div>
            <div>
              <h2 className="text-[1.05rem] font-extrabold text-[var(--primary-deep)]">
                YOLO26n · حالت سبک
              </h2>
              <p className="text-[0.8rem] text-[var(--muted)]">
                مدل nano با کادر سبز زنده دور سوژه — بهینه برای اجرای روان
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => control("start")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--success)] px-3 py-2 text-[0.8rem] font-bold text-white disabled:opacity-70"
            >
              {busy && !status?.serverOnline ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <Play size={14} />
              )}
              {status?.serverOnline ? "شروع تشخیص" : "اجرای موتور از پارس کم"}
            </button>
            <button
              type="button"
              disabled={busy || !status?.serverOnline}
              onClick={() => control("stop")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--danger)] px-3 py-2 text-[0.8rem] font-bold text-white disabled:opacity-50"
            >
              <Square size={14} /> توقف
            </button>
          </div>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-[var(--surface-soft)] px-3 py-2 text-[0.8rem]">
            سرور:{" "}
            <b className={status?.serverOnline ? "text-[var(--success)]" : "text-[var(--danger)]"}>
              {status?.serverOnline ? "آنلاین" : "آفلاین"}
            </b>
          </div>
          <div className="rounded-2xl bg-[var(--surface-soft)] px-3 py-2 text-[0.8rem]">
            مدل:{" "}
            <b>
              {status?.model_loaded
                ? status?.open_vocab_loaded
                  ? "YOLO26n + YOLOE"
                  : "YOLO26n"
                : "—"}
            </b>
          </div>
          <div className="rounded-2xl bg-[var(--surface-soft)] px-3 py-2 text-[0.8rem]">
            تشخیص‌ها:{" "}
            <b className="number-display">
              {toPersianDigits(status?.detections_total || 0)}
            </b>
          </div>
        </div>

        {!status?.serverOnline ? (
          <p className="mb-4 rounded-2xl bg-[var(--primary-soft)] px-3 py-2 text-[0.8rem] text-[var(--primary)]">
            موتور را با دکمه «اجرای موتور از پارس کم» از همین صفحه روشن کنید؛ نیازی به ترمینال جدا نیست.
          </p>
        ) : null}

        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FILTER_META.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                const next = !settings.filters[key];
                const patch: Partial<YoloSettings> & {
                  filters: Partial<Filters>;
                } = {
                  filters: { [key]: next },
                };
                // آتش/اسلحه/چاقو نیاز به YOLOE دارند
                if (next && (key === "fire" || key === "gun" || key === "knife")) {
                  patch.use_open_vocab = true;
                }
                save(patch);
              }}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-right transition ${
                settings.filters[key]
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                  : "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]"
              }`}
            >
              <Icon size={18} />
              <span className="flex-1 font-bold">{label}</span>
              <span className="text-[0.72rem]">
                {settings.filters[key] ? "فعال" : "خاموش"}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block text-[0.8rem] font-semibold text-[var(--muted)]">
            آستانه اطمینان ({toPersianDigits(Math.round(settings.confidence * 100))}٪)
            <input
              type="range"
              min={25}
              max={85}
              value={Math.round(settings.confidence * 100)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  confidence: Number(e.target.value) / 100,
                })
              }
              onMouseUp={() => save({ confidence: settings.confidence })}
              onTouchEnd={() => save({ confidence: settings.confidence })}
              className="mt-2 w-full"
            />
          </label>
          <label className="block text-[0.8rem] font-semibold text-[var(--muted)]">
            مدت ضبط خودکار (ثانیه)
            <input
              type="number"
              min={15}
              max={300}
              value={settings.record_duration_sec}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  record_duration_sec: Number(e.target.value),
                })
              }
              onBlur={() =>
                save({ record_duration_sec: settings.record_duration_sec })
              }
              className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-2">
          {(
            [
              ["enabled", "فعال بودن موتور YOLO26n"],
              ["live_overlay", "کادر سبز زنده دور سوژه در استریم"],
              ["use_open_vocab", "تشخیص آتش / اسلحه / چاقو (YOLOE)"],
              ["notify", "هشدار و نوتیفیکیشن هنگام تشخیص"],
              [
                "auto_record_on_detect",
                "ضبط خودکار یک‌دقیقه‌ای پس از تشخیص",
              ],
              [
                "auto_screenshot_on_detect",
                "گرفتن اسکرین‌شات هنگام تشخیص",
              ],
              ["draw_boxes", "رسم کادر روی تصویر ذخیره‌شده"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                save({ [key]: !(settings as Record<string, unknown>)[key] })
              }
              className="flex w-full items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-3.5 py-3 text-right"
            >
              <span className="text-[0.88rem] font-semibold">{label}</span>
              <span
                className={`relative h-6 w-11 rounded-full transition ${
                  (settings as Record<string, unknown>)[key]
                    ? "bg-[var(--primary)]"
                    : "bg-[var(--line)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                    (settings as Record<string, unknown>)[key]
                      ? "start-5"
                      : "start-0.5"
                  }`}
                />
              </span>
            </button>
          ))}
        </div>

        {msg ? (
          <p className="mt-3 text-[0.85rem] font-semibold text-[var(--ink-soft)]">
            {msg}
          </p>
        ) : null}
        {status?.last_error ? (
          <p className="mt-2 text-[0.75rem] text-[var(--danger)]">
            {status.last_error}
          </p>
        ) : null}
      </section>

      <section className="glass-panel rounded-[22px] p-4">
        <h3 className="mb-3 font-extrabold text-[var(--primary-deep)]">
          آخرین تشخیص‌ها
        </h3>
        {!status?.recent?.length ? (
          <p className="py-6 text-center text-[var(--muted)]">هنوز تشخیصی ثبت نشده.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {status.recent.slice(0, 8).map((e) => (
              <li key={e.id} className="flex justify-between gap-2 py-2.5 text-[0.85rem]">
                <span className="font-bold">
                  {e.label_fa} · {e.cam_name}
                </span>
                <span className="text-[var(--muted)]" dir="ltr">
                  {e.time}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
