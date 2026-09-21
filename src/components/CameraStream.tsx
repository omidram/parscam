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
  const everLiveRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    liveRef.current = false;
    // After we have been live once, avoid covering the tile with a loading veil on remount.
    setStatus(everLiveRef.current ? "live" : "loading");
    setErrHint("");

    const timer = window.setTimeout(() => {
      if (!liveRef.current && !everLiveRef.current) {
        setStatus("error");
        setErrHint(
          "اتصال برقرار نشد. VPN را برای شبکه محلی خاموش کنید و مسیر/رمز RTSP را در نظارت بررسی کنید.",
        );
      }
    }, 25000);

    return () => {
      window.clearTimeout(timer);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [camId, active, key]);

  function scheduleReconnect(hint: string) {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    const attempt = retryRef.current;
    retryRef.current = attempt + 1;
    const delay = Math.min(1000 + attempt * 700, 5000);

    if (everLiveRef.current) {
      // Brief drops: stay visually live, silently remount the MJPEG URL.
      setStatus("live");
      setErrHint(attempt > 4 ? hint : "");
    } else {
      setStatus("loading");
      setErrHint(hint);
    }

    retryTimer.current = window.setTimeout(() => {
      setKey((k) => k + 1);
    }, delay);
  }

  if (!active) {
    return (
      <div className={`flex items-center justify-center bg-[#0f1b2d] ${className}`}>
        <VideoOff className="text-white/40" size={28} />
      </div>
    );
  }

  const showBootOverlay = status === "loading" && !everLiveRef.current;
  const showHardError = status === "error" && !everLiveRef.current;

  return (
    <div className={`relative overflow-hidden bg-[#0f1b2d] ${className}`}>
      {showBootOverlay || showHardError ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center text-white/80">
          {showBootOverlay ? (
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
                onClick={() => {
                  retryRef.current = 0;
                  everLiveRef.current = false;
                  setStatus("loading");
                  setKey((k) => k + 1);
                }}
                className="mt-1 rounded-lg bg-white/15 px-3 py-1 text-[0.75rem] font-semibold"
              >
                تلاش مجدد
              </button>
            </>
          )}
        </div>
      ) : null}
      {!showHardError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          src={`/api/stream/${camId}?t=${key}`}
          alt={`استریم دوربین ${camId}`}
          className="h-full w-full object-cover"
          onLoad={() => {
            liveRef.current = true;
            everLiveRef.current = true;
            retryRef.current = 0;
            setStatus("live");
            setErrHint("");
          }}
          onError={() => {
            liveRef.current = false;
            scheduleReconnect("اتصال مجدد استریم...");
          }}
        />
      ) : null}
    </div>
  );
}
