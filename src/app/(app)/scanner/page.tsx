"use client";

import { useState } from "react";
import {
  LoaderCircle,
  Plus,
  Radar,
  Search,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { toPersianDigits } from "@/lib/format";

type Device = {
  ip: string;
  port: number;
  protocol: string;
  manufacturer?: string;
  model?: string;
  name?: string;
  mac?: string;
  serial?: string;
  path?: string;
  rtsp?: string;
  http?: string;
  onvif?: boolean;
  discovery?: string;
  score: number;
};

export default function ScannerPage() {
  const [scanning, setScanning] = useState(false);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  async function startScan() {
    setScanning(true);
    setFound([]);
    setSelected({});
    setMessage(
      "در حال جست‌وجوی خودکار شبکه (SADP / ONVIF / SSDP / LAN) — مثل VMS Pro و AdjDev...",
    );
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "اسکن ناموفق");
      const devices = (data.devices || []) as Device[];
      setFound(devices);
      setMessage(
        devices.length
          ? `${toPersianDigits(devices.length)} دستگاه پیدا شد.`
          : "دستگاهی پیدا نشد. مطمئن شوید روی همان شبکه محلی دوربین‌ها هستید.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "خطا");
    } finally {
      setScanning(false);
    }
  }

  async function addCam(cam: Device) {
    const rtsp =
      cam.rtsp ||
      `rtsp://${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@${cam.ip}:554${cam.path || "/main"}`;
    const res = await fetch("/api/cameras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: cam.name || cam.model || cam.manufacturer || `دوربین ${cam.ip}`,
        rtsp,
        location: cam.manufacturer
          ? `کشف خودکار · ${cam.manufacturer}${cam.discovery ? ` · ${cam.discovery}` : ""}`
          : "کشف خودکار",
      }),
    });
    setMessage(res.ok ? `${cam.ip} به پارس کم اضافه شد.` : "افزودن ناموفق بود.");
    return res.ok;
  }

  async function addSelected() {
    const list = found.filter((d) => selected[d.ip]);
    if (!list.length) {
      setMessage("حداقل یک دستگاه را انتخاب کنید.");
      return;
    }
    let ok = 0;
    for (const cam of list) {
      if (await addCam(cam)) ok += 1;
    }
    setMessage(`${toPersianDigits(ok)} دوربین به پارس کم اضافه شد.`);
  }

  return (
    <>
      <TopBar
        title="جست‌وجوی دستگاه"
        subtitle="کشف خودکار کل شبکه محلی — بدون بازه IP، مثل VMS Pro و AdjDev Tool"
      />

      <section className="glass-panel gereh-border mb-4 rounded-[22px] p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(26,75,139,0.1)] text-[var(--primary)]">
            <Radar size={20} />
          </div>
          <div>
            <h2 className="font-extrabold text-[var(--primary-deep)]">
              جست‌وجوی خودکار
            </h2>
            <p className="text-[0.8rem] text-[var(--muted)]">
              فقط جست‌وجو را بزنید؛ همه دوربین‌های قابل کشف در شبکه پیدا می‌شوند.
            </p>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[0.78rem] font-semibold text-[var(--muted)]">
            نام کاربری (برای ساخت لینک RTSP)
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2.5 outline-none focus:border-[var(--primary)]"
              dir="ltr"
            />
          </label>
          <label className="block text-[0.78rem] font-semibold text-[var(--muted)]">
            رمز عبور
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2.5 outline-none focus:border-[var(--primary)]"
              dir="ltr"
              placeholder="اختیاری"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startScan}
            disabled={scanning}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 font-bold text-white shadow-[0_12px_28px_rgba(243,146,0,0.35)] transition hover:brightness-105 disabled:opacity-70"
          >
            {scanning ? (
              <>
                <LoaderCircle className="animate-spin" size={18} />
                در حال جست‌وجو در کل شبکه...
              </>
            ) : (
              <>
                <Search size={18} />
                جست‌وجوی دستگاه‌ها
              </>
            )}
          </button>
          <button
            type="button"
            onClick={addSelected}
            disabled={scanning || !Object.values(selected).some(Boolean)}
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            <Plus size={18} />
            افزودن دسته‌ای
          </button>
        </div>

        {message ? (
          <p className="mt-3 text-[0.82rem] font-semibold text-[var(--ink-soft)]">
            {message}
          </p>
        ) : null}
      </section>

      <section className="glass-panel overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 className="font-extrabold text-[var(--primary-deep)]">
            فهرست دستگاه‌ها ({toPersianDigits(found.length)})
          </h3>
          <span className="inline-flex items-center gap-1 text-[0.75rem] text-[var(--muted)]">
            <ShieldCheck size={14} />
            SADP · ONVIF · SSDP · LAN
          </span>
        </div>

        {found.length === 0 ? (
          <p className="py-12 text-center text-[var(--muted)]">
            هنوز نتیجه‌ای ثبت نشده است.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-[0.85rem]">
              <thead className="bg-[var(--surface-soft)] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">انتخاب</th>
                  <th className="px-3 py-2.5 font-semibold">IP</th>
                  <th className="px-3 py-2.5 font-semibold">کشف</th>
                  <th className="px-3 py-2.5 font-semibold">سازنده</th>
                  <th className="px-3 py-2.5 font-semibold">نام / مدل</th>
                  <th className="px-3 py-2.5 font-semibold">MAC</th>
                  <th className="px-3 py-2.5 font-semibold">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {found.map((cam) => (
                  <tr
                    key={`${cam.ip}:${cam.port}:${cam.discovery || cam.protocol}`}
                    className="border-t border-[var(--line)]"
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={!!selected[cam.ip]}
                        onChange={(e) =>
                          setSelected((s) => ({
                            ...s,
                            [cam.ip]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-3 font-bold" dir="ltr">
                      {cam.ip}
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-lg bg-[var(--primary-soft)] px-2 py-0.5 text-[0.72rem] font-bold text-[var(--primary)]">
                        {cam.discovery || cam.protocol}
                      </span>
                    </td>
                    <td className="px-3 py-3">{cam.manufacturer || "—"}</td>
                    <td className="px-3 py-3">
                      {cam.name || cam.model || "—"}
                    </td>
                    <td className="px-3 py-3 text-[0.75rem] text-[var(--muted)]" dir="ltr">
                      {cam.mac || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => addCam(cam)}
                        className="inline-flex items-center gap-1 rounded-xl bg-[var(--primary)] px-3 py-1.5 text-[0.78rem] font-bold text-white"
                      >
                        <Wifi size={14} />
                        افزودن
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
