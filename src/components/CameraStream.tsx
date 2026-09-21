"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, VideoOff } from "lucide-react";

type Props = {
  camId: number;
  className?: string;
  active?: boolean;
};

export function CameraStream({ camId, className = "", active = true }: Props) {
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [key, setKey] = useState(0);
  const [errHint, setErrHint] = useState("");
  const liveRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    liveRef.current = false;
    setStatus("loading");
    setErrHint("");
    // MJPEG may take a while on first connect (OpenCV + RTSP handshake)
    const timer = window.setTimeout(() => {
      if (!liveRef.current) {
        setStatus("error");
        setErrHint(
          "اتصال برقرار نشد. VPN را برای شبکه محلی خاموش کنید و مسیر/رمز RTSP را در نظارت بررسی کنید.",
        );
      }
    }, 25000);
    return () => window.clearTimeout(timer);
  }, [camId, active, key]);

  if (!active) {
    return (
      <div className={`flex items-center justify-center bg-[#0f1b2d] ${className}`}>
        <VideoOff className="text-white/40" size={28} />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-[#0f1b2d] ${className}`}>
      {status !== "live" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center text-white/80">
          {status === "loading" ? (
            <>
              <LoaderCircle className="animate-spin" size={28} />
              <span className="text-[0.78rem]">در حال اتصال به استریم...</span>
            </>
          ) : (
            <>
              <VideoOff size={28} />
              <span className="text-[0.78rem]">استریم در دسترس نیست</span>
              {errHint ? (
                <span className="max-w-[90%] text-[0.7rem] text-white/55">{errHint}</span>
              ) : null}
              <button
                type="button"
                onClick={() => setKey((k) => k + 1)}
                className="mt-1 rounded-lg bg-white/15 px-3 py-1 text-[0.75rem] font-semibold"
              >
                تلاش مجدد
              </button>
            </>
          )}
        </div>
      ) : null}
      {status !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          src={`/api/stream/${camId}?t=${key}`}
          alt={`استریم دوربین ${camId}`}
          className="h-full w-full object-cover"
          onLoad={() => {
            liveRef.current = true;
            setStatus("live");
          }}
          onError={() => {
            liveRef.current = false;
            setStatus("error");
            setErrHint("پاسخ استریم قطع شد.");
          }}
        />
      ) : null}
    </div>
  );
}
