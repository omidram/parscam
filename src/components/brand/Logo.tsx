import Image from "next/image";

type LogoProps = {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
};

const sizes = {
  sm: { box: 40, img: 34 },
  md: { box: 52, img: 44 },
  lg: { box: 88, img: 76 },
};

export function Logo({ size = "md", showText = true, className = "" }: LogoProps) {
  const s = sizes[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="relative shrink-0 overflow-hidden rounded-2xl bg-black shadow-[0_10px_28px_rgba(26,75,139,0.28)] ring-1 ring-[rgba(26,75,139,0.18)]"
        style={{ width: s.box, height: s.box }}
      >
        <Image
          src="/parscam-logo.png"
          alt="لوگوی پارس کم"
          width={s.img}
          height={s.img}
          className="absolute inset-0 m-auto object-cover"
          priority
        />
      </div>
      {showText ? (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[1.15rem] font-extrabold tracking-tight text-[var(--primary-deep)]">
            پارس کم
          </div>
          <div className="truncate text-[0.72rem] font-medium text-[var(--muted)]">
            Pars Cam · نظارت بومی
          </div>
        </div>
      ) : null}
    </div>
  );
}
