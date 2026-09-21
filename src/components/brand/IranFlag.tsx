import Image from "next/image";

type IranFlagProps = {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
};

/** پرچم ایران از فایل واقعی (webp) — بدون تبدیل به SVG */
export function IranFlag({
  className = "",
  width = 48,
  height = 28,
  priority = false,
}: IranFlagProps) {
  return (
    <Image
      src="/iran-flag.webp"
      alt="پرچم جمهوری اسلامی ایران"
      width={width}
      height={height}
      className={`rounded-[3px] object-cover shadow-sm ring-1 ring-black/10 ${className}`}
      priority={priority}
      unoptimized
    />
  );
}
