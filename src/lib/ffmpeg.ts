import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { recordingsRoot, projectRoot } from "@/lib/server-paths";

const recordingProcs = new Map<number, ChildProcess>();

export function isRecording(camId: number): boolean {
  const p = recordingProcs.get(camId);
  return Boolean(p && !p.killed && p.exitCode === null);
}

export function recordingStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, proc] of recordingProcs) {
    out[String(id)] = Boolean(proc && !proc.killed && proc.exitCode === null);
  }
  return out;
}

/** Encode user/pass so passwords containing @ : / work in RTSP URLs */
export function normalizeRtspUrl(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(rtsps?):\/\/(.+)@([^@/?#]+)(.*)$/i);
  if (!m) return trimmed;
  const scheme = m[1];
  const userinfo = m[2];
  const hostport = m[3];
  const path = m[4] || "";
  const colon = userinfo.indexOf(":");
  if (colon < 0) {
    return `${scheme}://${encodeURIComponent(decodeURIComponentSafe(userinfo))}@${hostport}${path}`;
  }
  const user = decodeURIComponentSafe(userinfo.slice(0, colon));
  const pass = decodeURIComponentSafe(userinfo.slice(colon + 1));
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostport}${path}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function buildRtspUrl(opts: {
  host: string;
  port?: number;
  path?: string;
  username?: string;
  password?: string;
}): string {
  const port = opts.port ?? 554;
  const p = opts.path?.startsWith("/") ? opts.path : `/${opts.path || "main"}`;
  const user = opts.username || "";
  const pass = opts.password || "";
  const auth =
    user || pass
      ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
      : "";
  return `rtsp://${auth}${opts.host}:${port}${p}`;
}

export function startFfmpegRecording(
  camId: number,
  camName: string,
  rtsp: string,
): { ok: boolean; error?: string; path?: string } {
  if (isRecording(camId)) {
    return { ok: false, error: "قبلاً در حال ضبط است" };
  }

  const folder = path.join(
    /*turbopackIgnore: true*/ recordingsRoot(),
    `cam${camId}`,
  );
  fs.mkdirSync(/*turbopackIgnore: true*/ folder, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 15);
  const filename = `cam${camId}_${stamp}.mp4`;
  const outPath = path.join(folder, filename);
  const url = normalizeRtspUrl(rtsp);

  try {
    const proc = spawn(
      "ffmpeg",
      [
        "-y",
        "-rtsp_transport",
        "tcp",
        "-i",
        url,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    recordingProcs.set(camId, proc);
    proc.on("exit", () => {
      recordingProcs.delete(camId);
    });
    return { ok: true, path: outPath };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "اجرای ffmpeg ناموفق",
    };
  }
}

export function stopFfmpegRecording(
  camId: number,
): { ok: boolean; error?: string } {
  const proc = recordingProcs.get(camId);
  if (!proc) return { ok: false, error: "در حال ضبط نیست" };
  try {
    proc.kill("SIGINT");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 2000);
    recordingProcs.delete(camId);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "توقف ناموفق",
    };
  }
}

function pythonCandidates(): [string, string[]][] {
  const script = path.join(
    /*turbopackIgnore: true*/ projectRoot(),
    "stream_worker.py",
  );
  if (process.platform === "win32") {
    return [
      ["py", ["-3", script]],
      ["python", [script]],
    ];
  }
  return [
    ["python3", [script]],
    ["python", [script]],
  ];
}

/** OpenCV MJPEG worker (same as Flask parscam) — most reliable for IP cams */
export function spawnOpenCvMjpeg(rtsp: string): ChildProcess {
  const url = normalizeRtspUrl(rtsp);
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    PARSCAM_RTSP_TRANSPORT: "tcp",
  };
  let lastErr: Error | null = null;
  for (const [cmd, baseArgs] of pythonCandidates()) {
    try {
      const proc = spawn(cmd, [...baseArgs, url], {
        cwd: /*turbopackIgnore: true*/ projectRoot(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      return proc;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("Python پیدا نشد");
}

/** Fallback ffmpeg MJPEG — boundary must be `ffmpeg` */
export function spawnMjpegStream(rtsp: string): ChildProcess {
  const url = normalizeRtspUrl(rtsp);
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-rtsp_transport",
      "tcp",
      "-i",
      url,
      "-an",
      "-vf",
      "scale=960:-2",
      "-q:v",
      "6",
      "-r",
      "10",
      "-f",
      "mpjpeg",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
}
