"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Signal, Video } from "lucide-react";
import { formatJalaliDateTime } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { CameraStream } from "@/components/CameraStream";

type Cam = { id: number; name: string; location: string };

export function LiveCameras() {
  const { settings } = useSettings();
  const [cameras, setCameras] = useState<Cam[]>([]);
  const now = new Date();

  useEffect(() => {
    fetch("/api/cameras", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Cam[]) => setCameras(data))
      .catch(() => setCameras([]));
  }, []);

  return (
    <section className="animate-rise stagger-2 glass-panel rounded-[22px] p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {settings.showLiveBadge ? <span className="live-dot" /> : null}
          <h2 className="text-[1.05rem] font-extrabold text-[var(--primary-deep)]">
            نظارت زنده دوربین‌ها
          </h2>
        </div>
        <Link
          href="/monitor"
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--primary)] transition hover:border-[var(--primary)]"
        >
          مشاهده همه دوربین‌ها
        </Link>
      </div>

      {cameras.length === 0 ? (
        <p className="py-10 text-center text-[var(--muted)]">
          دوربینی ثبت نشده است. از صفحه نظارت یکی اضافه کنید.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {cameras.slice(0, 4).map((cam) => (
            <article
              key={cam.id}
              className="group relative aspect-[16/10] overflow-hidden rounded-[18px] bg-[#0f1b2d]"
            >
              <CameraStream camId={cam.id} className="absolute inset-0 h-full w-full" />

              {settings.showLiveBadge ? (
                <div className="pointer-events-none absolute start-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[0.72rem] text-white backdrop-blur-sm">
                  <Video size={12} />
                  زنده
                </div>
              ) : null}

              {settings.showCameraOverlay ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/45 to-transparent p-3 pt-10">
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="live-dot" />
                        <h3 className="text-[0.9rem] font-bold text-white">{cam.name}</h3>
                      </div>
                      <p className="text-[0.72rem] text-white/75">
                        {formatJalaliDateTime(now)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 text-[0.72rem] font-semibold text-emerald-300">
                      <Signal size={13} />
                      RTSP
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
