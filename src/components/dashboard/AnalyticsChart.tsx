import { weeklyIncidents } from "@/lib/data";
import { toPersianDigits } from "@/lib/format";

export function AnalyticsChart() {
  const max = Math.max(...weeklyIncidents.map((d) => d.value));
  const width = 280;
  const height = 150;
  const pad = 16;
  const points = weeklyIncidents.map((d, i) => {
    const x =
      pad + (i * (width - pad * 2)) / Math.max(weeklyIncidents.length - 1, 1);
    const y = height - pad - (d.value / max) * (height - pad * 2);
    return { ...d, x, y };
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const area = `${path} L ${points[points.length - 1].x} ${height - pad} L ${points[0].x} ${height - pad} Z`;
  const highlight = points[3];

  return (
    <section className="animate-fade-slide stagger-2 glass-panel rounded-[22px] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[1rem] font-extrabold text-[var(--primary-deep)]">
          تحلیل رویدادها
        </h2>
        <select
          className="rounded-xl border border-[var(--line)] bg-white px-2.5 py-1.5 text-[0.78rem] text-[var(--ink-soft)] outline-none"
          defaultValue="7"
          aria-label="بازه زمانی"
        >
          <option value="7">۷ روز اخیر</option>
          <option value="30">۳۰ روز اخیر</option>
        </select>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full chart-grid">
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={pad}
              x2={width - pad}
              y1={pad + i * ((height - pad * 2) / 3)}
              y2={pad + i * ((height - pad * 2) / 3)}
            />
          ))}
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a4b8b" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#1a4b8b" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#areaFill)" />
          <path
            d={path}
            fill="none"
            stroke="#1a4b8b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p) => (
            <circle
              key={p.day}
              cx={p.x}
              cy={p.y}
              r={p === highlight ? 4.5 : 3}
              fill={p === highlight ? "#f39200" : "#1a4b8b"}
            />
          ))}
        </svg>

        <div
          className="absolute rounded-xl border border-[var(--line)] bg-white px-2.5 py-1.5 text-[0.72rem] shadow-[var(--shadow-sm)]"
          style={{
            left: `${(highlight.x / width) * 100}%`,
            top: `${(highlight.y / height) * 100 - 18}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="font-bold text-[var(--primary-deep)]">{highlight.day}</div>
          <div className="text-[var(--muted)]">
            {toPersianDigits(highlight.value)} رویداد · ۱۰٪ نسبت به قبل
          </div>
        </div>
      </div>

      <div className="mt-2 flex justify-between text-[0.7rem] text-[var(--muted)]">
        {weeklyIncidents.map((d) => (
          <span key={d.day}>{d.day}</span>
        ))}
      </div>
    </section>
  );
}
