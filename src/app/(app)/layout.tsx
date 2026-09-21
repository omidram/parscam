import { AppShell } from "@/components/layout/AppShell";
import { SearchProvider } from "@/lib/search";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SearchProvider>
      <AppShell>{children}</AppShell>
    </SearchProvider>
  );
}
