import { IranFlag } from "@/components/brand/IranFlag";

export function IranBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-full border border-[color-mix(in_srgb,var(--iran-green)_28%,transparent)] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--iran-green)_14%,transparent),color-mix(in_srgb,var(--surface)_90%,transparent),color-mix(in_srgb,var(--iran-red)_10%,transparent))] px-3.5 py-2 text-[0.8rem] font-semibold text-[var(--ink-soft)] shadow-[var(--shadow-sm)] ${className}`}
    >
      <IranFlag width={52} height={30} className="shrink-0" />
      <span>محصول کاملاً ایرانی و بومی</span>
    </div>
  );
}
