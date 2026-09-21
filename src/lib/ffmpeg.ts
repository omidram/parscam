import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { recordingsRoot, projectRoot } from "@/lib/server-paths";

type RecEntry = {
  proc: ChildProcess;
  outPath: string;
  stopFile: string;
};

const recordingProcs = new Map<number, RecEntry>();

export function isRecording(camId: number): boolean {
  const e = recordingProcs.get(camId);
  return Boolean(e && e.proc && !e.proc.killed && e.proc.exitCode === null);
}

export function recordingStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id] of recordingProcs) {
    out[String(id)] = isRecording(id);
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
  const rest = m[4] || "";
  const colon = userinfo.indexOf(":");
  if (colon < 0) {
    return `${scheme}://${encodeURIComponent(decodeURIComponentSafe(userinfo))}@${hostport}${rest}`;
  }
  const user = decodeURIComponentSafe(userinfo.slice(0, colon));
  const pass = decodeURIComponentSafe(userinfo.slice(colon + 1));
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostport}${rest}`;
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
  _camName: string,
  rtsp: string,
  maxSeconds = 0,
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
  const stopFile = `${outPath}.stop`;
  const urlRaw = normalizeRtspUrl(rtsp);
  // Prefer /sub so live /main stream is not dropped
  const url =
    urlRaw.includes("/main") && !urlRaw.includes("/sub")
      ? urlRaw.replace("/main", "/sub")
      : urlRaw;

  try {
    if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  } catch {
    /* */
  }

  try {
    const args = maxSeconds > 0 ? [url, outPath, String(maxSeconds)] : [url, outPath];
    const root = /*turbopackIgnore: true*/ projectRoot();
    const script = path.join(/*turbopackIgnore: true*/ root, "record_worker.py");
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PARSCAM_RTSP_TRANSPORT: "tcp",
      OPENCV_FFMPEG_CAPTURE_OPTIONS:
        "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay",
    };

    const spawnRecorder = (rtspUrl: string) => {
      const a =
        maxSeconds > 0
          ? [rtspUrl, outPath, String(maxSeconds)]
          : [rtspUrl, outPath];
      try {
        return spawn(
          process.platform === "win32" ? "py" : "python3",
          process.platform === "win32" ? ["-3", script, ...a] : [script, ...a],
          {
            cwd: root,
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"],
            env,
          },
        );
      } catch {
        return spawn("python", [script, ...a], {
          cwd: root,
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
          env,
        });
      }
    };

    let proc = spawnRecorder(url);
    const logChunks: string[] = [];
    const attachLog = (p: ChildProcess) => {
      p.stderr?.on("data", (c: Buffer) => {
        logChunks.push(c.toString());
        if (logChunks.length > 40) logChunks.shift();
      });
    };
    attachLog(proc);

    // If /sub dies immediately, retry once on original /main
    proc.once("exit", (code) => {
      const current = recordingProcs.get(camId);
      if (!current || current.proc !== proc) return;
      const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
      if (
        code &&
        code !== 0 &&
        size < 1000 &&
        url !== urlRaw &&
        recordingProcs.has(camId)
      ) {
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        } catch {
          /* */
        }
        proc = spawnRecorder(urlRaw);
        attachLog(proc);
        recordingProcs.set(camId, { proc, outPath, stopFile });
        proc.on("exit", onFinalExit);
        return;
      }
      onFinalExit(code);
    });

    function onFinalExit(code: number | null) {
      recordingProcs.delete(camId);
      try {
        if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
      } catch {
        /* */
      }
      try {
        if (code && code !== 0) {
          fs.writeFileSync(`${outPath}.log`, logChunks.join(""), "utf-8");
        }
      } catch {
        /* */
      }
    }

    recordingProcs.set(camId, { proc, outPath, stopFile });
    return { ok: true, path: outPath };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "اجرای ضبط ناموفق",
    };
  }
}

export function stopFfmpegRecording(
  camId: number,
): { ok: boolean; error?: string } {
  const entry = recordingProcs.get(camId);
  if (!entry) return { ok: false, error: "در حال ضبط نیست" };
  try {
    // Graceful stop for OpenCV worker
    fs.writeFileSync(entry.stopFile, "1", "utf-8");
    const { proc } = entry;
    const deadline = Date.now() + 8000;
    const wait = () => {
      if (proc.exitCode !== null || Date.now() > deadline) {
        try {
          if (!proc.killed && proc.exitCode === null) proc.kill();
        } catch {
          /* */
        }
        recordingProcs.delete(camId);
        return;
      }
      setTimeout(wait, 200);
    };
    wait();
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
export function spawnOpenCvMjpeg(
  rtsp: string,
  camId?: string | number,
): ChildProcess {
  const url = normalizeRtspUrl(rtsp);
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    PARSCAM_RTSP_TRANSPORT: "tcp",
    OPENCV_FFMPEG_CAPTURE_OPTIONS:
      "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay",
  };
  const extra =
    camId !== undefined && camId !== null && String(camId) !== ""
      ? [String(camId)]
      : [];
  let lastErr: Error | null = null;
  for (const [cmd, baseArgs] of pythonCandidates()) {
    try {
      const proc = spawn(cmd, [...baseArgs, url, ...extra], {
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
