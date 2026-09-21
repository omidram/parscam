import { TopBar } from "@/components/layout/TopBar";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { LiveCameras } from "@/components/dashboard/LiveCameras";
import { ActiveAlerts } from "@/components/dashboard/ActiveAlerts";
import { AnalyticsChart } from "@/components/dashboard/AnalyticsChart";
import { brand } from "@/lib/data";

export const metadata = {
  title: "داشبورد",
};

export default function DashboardPage() {
  return (
    <>
      <TopBar
        title={`داشبورد ${brand.nameFa}`}
        subtitle="مرکز فرماندهی نظارت تصویری — طراحی‌شده و توسعه‌یافته در ایران برای زیرساخت‌های بومی"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <KpiCards />
          <LiveCameras />

          <section className="animate-rise stagger-4 glass-panel gereh-border rounded-[22px] p-4 md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-[1.05rem] font-extrabold text-[var(--primary-deep)]">
                  هویت بومی پارس کم
                </h2>
                <p className="mt-1 max-w-2xl text-[0.88rem] leading-7 text-[var(--muted)]">
                  پارس کم یک سامانه نظارت تصویری کاملاً ایرانی است؛ از رابط کاربری
                  فارسی و تقویم جلالی تا معماری قابل استقرار روی شبکه داخلی، بدون
                  وابستگی به سرویس‌های خارجی.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <span className="rounded-full bg-[rgba(0,150,57,0.12)] px-3 py-1.5 text-[0.75rem] font-bold text-[var(--iran-green)]">
                  ساخت ایران
                </span>
                <span className="rounded-full bg-[rgba(26,75,139,0.1)] px-3 py-1.5 text-[0.75rem] font-bold text-[var(--primary)]">
                  پشتیبانی فارسی
                </span>
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[0.75rem] font-bold text-[var(--accent)]">
                  شبکه داخلی
                </span>
              </div>
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <ActiveAlerts />
          <AnalyticsChart />
        </aside>
      </div>
    </>
  );
}
