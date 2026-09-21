import {
  Camera,
  FileWarning,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { kpis, type Kpi } from "@/lib/data";

const toneStyles: Record<
  Kpi["tone"],
  { icon: string; ring: string; Icon: typeof Camera }
> = {
  success: {
    icon: "bg-[rgba(13,159,79,0.12)] text-[var(--success)]",
    ring: "from-[rgba(13,159,79,0.2)]",
    Icon: Camera,
  },
  info: {
    icon: "bg-[rgba(43,108,176,0.12)] text-[var(--info)]",
    ring: "from-[rgba(43,108,176,0.2)]",
    Icon: FileWarning,
  },
  warning: {
    icon: "bg-[rgba(230,126,0,0.12)] text-[var(--warning)]",
    ring: "from-[rgba(230,126,0,0.2)]",
    Icon: TriangleAlert,
  },
  danger: {
    icon: "bg-[rgba(200,16,46,0.12)] text-[var(--danger)]",
    ring: "from-[rgba(200,16,46,0.2)]",
    Icon: ShieldAlert,
  },
};

export function KpiCards() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi, index) => {
        const tone = toneStyles[kpi.tone];
        const Icon = tone.Icon;
        return (
          <article
            key={kpi.id}
            className={`animate-rise gereh-border glass-panel relative overflow-hidden rounded-[20px] p-4 stagger-${index + 1}`}
          >
            <div
              className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${tone.ring} to-transparent opacity-70`}
            />
            <div className="relative flex items-start justify-between gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone.icon}`}
              >
                <Icon size={20} />
              </div>
              {kpi.trend ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.72rem] font-semibold ${
                    kpi.trend === "down"
                      ? "bg-[rgba(13,159,79,0.12)] text-[var(--success)]"
                      : "bg-[rgba(200,16,46,0.1)] text-[var(--danger)]"
                  }`}
                >
                  {kpi.hint.split(" · ")[0]}
                </span>
              ) : (
                <span className="rounded-full bg-[rgba(13,159,79,0.12)] px-2 py-0.5 text-[0.72rem] font-semibold text-[var(--success)]">
                  ۹۶٪ آپتایم
                </span>
              )}
            </div>
            <div className="relative mt-4">
              <div className="text-[0.82rem] font-semibold text-[var(--muted)]">
                {kpi.label}
              </div>
              <div className="number-display mt-1 text-[2rem] font-black text-[var(--primary-deep)]">
                {kpi.value}
              </div>
              <p className="mt-1 text-[0.78rem] text-[var(--muted)]">{kpi.hint}</p>
            </div>
          </article>
        );
      })}
    </section>
  );
}
