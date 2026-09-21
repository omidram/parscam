import { Suspense } from "react";
import MonitorClient from "./MonitorClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="py-12 text-center text-[var(--muted)]">در حال بارگذاری...</p>
      }
    >
      <MonitorClient />
    </Suspense>
  );
}
