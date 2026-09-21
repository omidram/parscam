import { Sidebar } from "@/components/layout/Sidebar";
import { YoloNotifier } from "@/components/YoloNotifier";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="persian-pattern pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[1600px] gap-4 p-4 md:p-5">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-6">{children}</main>
      </div>
      <YoloNotifier />
    </div>
  );
}
