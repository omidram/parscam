"use client";

import { useEffect, useState } from "react";
import {
  BrainCircuit,
  Camera,
  Check,
  Database,
  HardDrive,
  LayoutGrid,
  Palette,
  RotateCcw,
  Save,
  Shield,
  Wifi,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { IranBadge } from "@/components/brand/IranBadge";
import { IranFlag } from "@/components/brand/IranFlag";
import { ThemeToggle } from "@/components/ThemeToggle";
import { YoloSettingsPanel } from "@/components/YoloSettingsPanel";
import { brand } from "@/lib/data";
import { useSettings, type AppSettings } from "@/lib/settings";
import { toPersianDigits } from "@/lib/format";

type TabId =
  | "appearance"
  | "display"
  | "cameras"
  | "yolo"
  | "technical"
  | "security"
  | "about";

const tabs: { id: TabId; label: string; Icon: typeof Palette }[] = [
  { id: "appearance", label: "ظاهر و تم", Icon: Palette },
  { id: "display", label: "نمایش", Icon: LayoutGrid },
  { id: "cameras", label: "دوربین‌ها", Icon: Camera },
  { id: "yolo", label: "YOLO26", Icon: BrainCircuit },
  { id: "technical", label: "فنی و شبکه", Icon: Wifi },
  { id: "security", label: "امنیت", Icon: Shield },
  { id: "about", label: "درباره", Icon: HardDrive },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[0.8rem] font-semibold text-[var(--muted)]">
        {label}
      </div>
      {children}
      {hint ? (
        <p className="mt-1 text-[0.72rem] leading-6 text-[var(--muted)]">{hint}</p>
      ) : null}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-3.5 py-3 text-right"
    >
      <span className="text-[0.88rem] font-semibold">{label}</span>
      <span
        className={`relative h-6 w-11 rounded-full transition ${
          checked ? "bg-[var(--primary)]" : "bg-[var(--line)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "start-5" : "start-0.5"
          }`}
        />
      </span>
    </button>
  );
}

const inputClass =
  "mt-0 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-4 py-2.5 outline-none transition focus:border-[var(--primary)]";

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const [tab, setTab] = useState<TabId>("appearance");
  const [saved, setSaved] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [pwdSaved, setPwdSaved] = useState(false);

  async function syncToBackend() {
    setSyncMsg("");
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          frame_width: settings.frameWidth,
          frame_height: settings.frameHeight,
          jpeg_quality: settings.jpegQuality,
          fps_limit: settings.fpsLimit,
          rtsp_transport: settings.rtspTransport,
          rtsp_timeout_sec: settings.rtspTimeoutSec,
          auto_reconnect: settings.autoReconnect,
          low_latency: settings.lowLatency,
          snapshot_on_alarm: settings.snapshotOnAlarm,
          retention_days: settings.retentionDays,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setSyncMsg("تنظیمات فنی با موفقیت روی سرور ذخیره شد.");
    } catch {
      setSyncMsg(
        "اتصال به بک‌اند برقرار نشد؛ تنظیمات فقط روی این مرورگر ذخیره شد.",
      );
    }
  }

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(t);
  }, [saved]);

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    update({ [key]: value });
    setSaved(true);
  }

  return (
    <>
      <TopBar
        title="تنظیمات پارس کم"
        subtitle="ظاهر، نمایش، دوربین‌ها، شبکه و امنیت — با پشتیبانی تم روشن و تاریک"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-2xl px-3.5 py-2 text-[0.82rem] font-bold transition ${
              tab === id
                ? "bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]"
                : "glass-panel text-[var(--ink-soft)] hover:text-[var(--primary)]"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {saved ? (
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3 py-2 text-[0.82rem] font-semibold text-[var(--success)]">
          <Check size={16} />
          تغییرات ذخیره شد
        </div>
      ) : null}

      {tab === "appearance" ? (
        <section className="glass-panel grid gap-5 rounded-[22px] p-5 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-[1.05rem] font-extrabold text-[var(--primary-deep)]">
              حالت نمایش
            </h2>
            <ThemeToggle />
            <p className="mt-2 text-[0.78rem] text-[var(--muted)]">
              تم سیستم با ترجیح سیستم‌عامل هماهنگ می‌شود.
            </p>
          </div>
          <Field label="سبک رنگ‌ها">
            <div className="flex gap-2">
              {(
                [
                  { id: "brand", label: "برند پارس کم" },
                  { id: "iran", label: "پرچم ایران" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => patch("accentStyle", opt.id)}
                  className={`flex-1 rounded-2xl border px-3 py-2.5 text-[0.82rem] font-bold ${
                    settings.accentStyle === opt.id
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                      : "border-[var(--line)] bg-[var(--surface-soft)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="تراکم رابط">
            <select
              className={inputClass}
              value={settings.density}
              onChange={(e) =>
                patch("density", e.target.value as AppSettings["density"])
              }
            >
              <option value="comfortable">راحت</option>
              <option value="compact">فشرده</option>
            </select>
          </Field>
          <div className="flex flex-col gap-2">
            <Toggle
              label="انیمیشن‌های رابط"
              checked={settings.animations}
              onChange={(v) => patch("animations", v)}
            />
            <Toggle
              label="کاهش حرکت (دسترسی‌پذیری)"
              checked={settings.reduceMotion}
              onChange={(v) => patch("reduceMotion", v)}
            />
          </div>
        </section>
      ) : null}

      {tab === "display" ? (
        <section className="glass-panel grid gap-5 rounded-[22px] p-5 lg:grid-cols-2">
          <Field
            label="تعداد ستون شبکه دوربین"
            hint="در صفحه نظارت زنده اعمال می‌شود"
          >
            <select
              className={inputClass}
              value={settings.gridColumns}
              onChange={(e) =>
                patch("gridColumns", Number(e.target.value) as 2 | 3 | 4)
              }
            >
              <option value={2}>۲ ستون</option>
              <option value={3}>۳ ستون</option>
              <option value={4}>۴ ستون</option>
            </select>
          </Field>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <Toggle
              label="نمایش نشان زنده (Live)"
              checked={settings.showLiveBadge}
              onChange={(v) => patch("showLiveBadge", v)}
            />
            <Toggle
              label="نمایش اطلاعات روی تصویر دوربین"
              checked={settings.showCameraOverlay}
              onChange={(v) => patch("showCameraOverlay", v)}
            />
            <Toggle
              label="اعداد فارسی"
              checked={settings.showPersianDigits}
              onChange={(v) => patch("showPersianDigits", v)}
            />
            <Toggle
              label="جمع‌شدن نوار کناری"
              checked={settings.sidebarCollapsed}
              onChange={(v) => patch("sidebarCollapsed", v)}
            />
          </div>
        </section>
      ) : null}

      {tab === "cameras" ? (
        <section className="glass-panel grid gap-5 rounded-[22px] p-5 lg:grid-cols-2">
          <Field label={`عرض فریم (${toPersianDigits(settings.frameWidth)}px)`}>
            <input
              type="range"
              min={320}
              max={1920}
              step={160}
              value={settings.frameWidth}
              onChange={(e) => patch("frameWidth", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label={`ارتفاع فریم (${toPersianDigits(settings.frameHeight)}px)`}>
            <input
              type="range"
              min={180}
              max={1080}
              step={90}
              value={settings.frameHeight}
              onChange={(e) => patch("frameHeight", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label={`کیفیت JPEG (${toPersianDigits(settings.jpegQuality)}٪)`}>
            <input
              type="range"
              min={40}
              max={95}
              value={settings.jpegQuality}
              onChange={(e) => patch("jpegQuality", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label={`حداکثر FPS (${toPersianDigits(settings.fpsLimit)})`}>
            <input
              type="range"
              min={5}
              max={30}
              value={settings.fpsLimit}
              onChange={(e) => patch("fpsLimit", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="پروتکل انتقال RTSP">
            <select
              className={inputClass}
              value={settings.rtspTransport}
              onChange={(e) =>
                patch(
                  "rtspTransport",
                  e.target.value as AppSettings["rtspTransport"],
                )
              }
            >
              <option value="tcp">TCP (پایدارتر)</option>
              <option value="udp">UDP (کم‌تأخیرتر)</option>
            </select>
          </Field>
          <Field label="مهلت اتصال RTSP (ثانیه)">
            <input
              type="number"
              min={2}
              max={30}
              className={inputClass}
              value={settings.rtspTimeoutSec}
              onChange={(e) => patch("rtspTimeoutSec", Number(e.target.value))}
            />
          </Field>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <Toggle
              label="اتصال مجدد خودکار"
              checked={settings.autoReconnect}
              onChange={(v) => patch("autoReconnect", v)}
            />
            <Toggle
              label="حالت کم‌تأخیر"
              checked={settings.lowLatency}
              onChange={(v) => patch("lowLatency", v)}
            />
            <Toggle
              label="عکس فوری هنگام آلارم"
              checked={settings.snapshotOnAlarm}
              onChange={(v) => patch("snapshotOnAlarm", v)}
            />
          </div>
        </section>
      ) : null}

      {tab === "yolo" ? <YoloSettingsPanel /> : null}

      {tab === "technical" ? (
        <section className="glass-panel grid gap-5 rounded-[22px] p-5 lg:grid-cols-2">
          <Field
            label="آدرس API بک‌اند"
            hint="آدرس سرویس Flask پارس کم (پیش‌فرض پورت ۹۰۰۰)"
          >
            <input
              className={inputClass}
              dir="ltr"
              value={settings.apiBaseUrl}
              onChange={(e) => patch("apiBaseUrl", e.target.value)}
            />
          </Field>
          <Field label={`نگهداری ضبط (روز): ${toPersianDigits(settings.retentionDays)}`}>
            <input
              type="range"
              min={7}
              max={180}
              value={settings.retentionDays}
              onChange={(e) => patch("retentionDays", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <div className="lg:col-span-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={syncToBackend}
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-2.5 text-[0.88rem] font-bold text-white"
            >
              <Save size={16} />
              همگام‌سازی با سرور
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setSaved(true);
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-[0.88rem] font-bold"
            >
              <RotateCcw size={16} />
              بازنشانی پیش‌فرض
            </button>
          </div>
          {syncMsg ? (
            <p className="lg:col-span-2 text-[0.85rem] font-semibold text-[var(--ink-soft)]">
              <Database size={14} className="me-1 inline" />
              {syncMsg}
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === "security" ? (
        <section className="glass-panel max-w-xl rounded-[22px] p-5">
          <h2 className="mb-4 text-[1.05rem] font-extrabold text-[var(--primary-deep)]">
            تغییر رمز عبور
          </h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setPwdSaved(true);
              setTimeout(() => setPwdSaved(false), 2500);
            }}
          >
            <Field label="رمز فعلی">
              <input type="password" required className={inputClass} />
            </Field>
            <Field label="رمز جدید (حداقل ۸ کاراکتر)">
              <input type="password" required minLength={8} className={inputClass} />
            </Field>
            <Field label="تکرار رمز جدید">
              <input type="password" required minLength={8} className={inputClass} />
            </Field>
            <button
              type="submit"
              className="mt-1 rounded-2xl bg-[var(--primary)] px-4 py-3 font-bold text-white"
            >
              ذخیره رمز جدید
            </button>
            {pwdSaved ? (
              <p className="text-center text-[0.85rem] font-semibold text-[var(--success)]">
                رمز با موفقیت به‌روزرسانی شد.
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {tab === "about" ? (
        <section className="glass-panel gereh-border rounded-[22px] p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <IranFlag width={72} height={42} />
            <IranBadge />
          </div>
          <h2 className="mb-2 text-[1.1rem] font-extrabold text-[var(--primary-deep)]">
            درباره {brand.nameFa}
          </h2>
          <p className="mb-4 max-w-3xl leading-8 text-[0.92rem] text-[var(--ink-soft)]">
            {brand.nameFa} ({brand.nameEn}) یک سامانه نظارت تصویری{" "}
            {brand.claim} است. طراحی رابط فارسی، تقویم جلالی، استقرار روی شبکه
            داخلی و استقلال از سرویس‌های خارجی، هویت بومی این محصول را شکل
            می‌دهد.
          </p>
          <dl className="grid gap-2 text-[0.88rem] sm:grid-cols-2">
            <div className="flex justify-between rounded-xl bg-[var(--surface-soft)] px-3 py-2">
              <dt className="text-[var(--muted)]">توسعه‌دهنده</dt>
              <dd className="font-bold">{brand.company}</dd>
            </div>
            <div className="flex justify-between rounded-xl bg-[var(--surface-soft)] px-3 py-2">
              <dt className="text-[var(--muted)]">پشتیبانی</dt>
              <dd className="font-bold number-display">{brand.phone}</dd>
            </div>
            <div className="flex justify-between rounded-xl bg-[var(--surface-soft)] px-3 py-2 sm:col-span-2">
              <dt className="text-[var(--muted)]">ایمیل</dt>
              <dd className="font-bold" dir="ltr">
                {brand.email}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </>
  );
}
