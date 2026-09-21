import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { readCameras } from "@/lib/server-paths";
import { normalizeRtspUrl } from "@/lib/ffmpeg";
import net from "net";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localIpv4s(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    if (!list) continue;
    for (const n of list) {
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function sameSubnet(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  if (pa.length !== 4 || pb.length !== 4) return false;
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

function tcpReachable(host: string, port: number, ms = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: ms }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function parseRtspHost(rtsp: string): { host: string; port: number } | null {
  const m = rtsp.match(/^rtsps?:\/\/(?:[^@/]+@)?([^:/]+)(?::(\d+))?/i);
  if (!m) return null;
  return { host: m[1], port: Number(m[2] || 554) };
}

function probeWithFfmpeg(rtsp: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const url = normalizeRtspUrl(rtsp);
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-rtsp_transport",
        "tcp",
        "-show_entries",
        "stream=codec_type,codec_name",
        "-of",
        "csv=p=0",
        url,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    let out = "";
    const t = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* */
      }
      resolve({ ok: false, detail: "زمان‌سنج ffprobe به پایان رسید" });
    }, 12000);
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
    });
    proc.on("exit", (code) => {
      clearTimeout(t);
      if (code === 0 && /video/i.test(out + err)) {
        resolve({ ok: true, detail: out.trim() || "ok" });
      } else {
        resolve({
          ok: false,
          detail: (err || out || `exit ${code}`).trim().slice(0, 400),
        });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, detail: e.message });
    });
  });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const cams = readCameras();
  if (!id || !cams[id]) {
    return NextResponse.json({ error: "دوربین یافت نشد" }, { status: 404 });
  }
  const cam = cams[id];
  const rtsp = normalizeRtspUrl(cam.rtsp);
  const parsed = parseRtspHost(rtsp);
  const locals = localIpv4s();
  const onLan = parsed
    ? locals.some((ip) => sameSubnet(ip, parsed.host))
    : false;
  const portOpen = parsed
    ? await tcpReachable(parsed.host, parsed.port)
    : false;
  const probe = await probeWithFfmpeg(rtsp);

  const hints: string[] = [];
  if (!portOpen) {
    hints.push(
      "پورت RTSP در دسترس نیست — VPN/فایروال را برای شبکه محلی (LAN Bypass) بررسی کنید.",
    );
  }
  if (onLan && !probe.ok) {
    hints.push(
      "دوربین روی subnet محلی است ولی RTSP پاسخ معتبر نمی‌دهد. مسیر استریم را مثل VMS Pro روی /main یا ONVIF تنظیم کنید.",
    );
  }
  if (!probe.ok && /Invalid data|401|403|Unauthorized/i.test(probe.detail)) {
    hints.push("نام کاربری یا رمز عبور RTSP اشتباه است یا مسیر استریم نادرست است.");
  }

  return NextResponse.json({
    id,
    name: cam.name,
    rtsp,
    host: parsed?.host,
    port: parsed?.port,
    localAddresses: locals,
    onLan,
    portOpen,
    streamOk: probe.ok,
    detail: probe.detail,
    hints,
  });
}
