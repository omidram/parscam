import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { projectRoot } from "@/lib/server-paths";

const YOLO_PORT = 9010;
const YOLO_BASE = `http://127.0.0.1:${YOLO_PORT}`;

let yoloProc: ChildProcess | null = null;
let starting: Promise<{ ok: boolean; error?: string }> | null = null;

export async function isYoloOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${YOLO_BASE}/api/yolo/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function yoloFetch(pathname: string, init?: RequestInit) {
  const res = await fetch(`${YOLO_BASE}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`yolo ${res.status}`);
  return res.json();
}

async function waitUntilOnline(ms = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await isYoloOnline()) return true;
    // Spawn failed / crashed — stop waiting so the UI is not stuck on loading.
    if (yoloProc && yoloProc.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

function logPath() {
  return path.join(/*turbopackIgnore: true*/ projectRoot(), "yolo_server.log");
}

function readRecentLogTail(maxChars = 1200): string {
  try {
    const raw = fs.readFileSync(logPath(), "utf-8");
    return raw.slice(-maxChars).trim();
  } catch {
    return "";
  }
}

function spawnYoloOnce(): { ok: boolean; error?: string } {
  if (yoloProc && !yoloProc.killed && yoloProc.exitCode === null) {
    return { ok: true };
  }

  const root = /*turbopackIgnore: true*/ projectRoot();
  const script = path.join(/*turbopackIgnore: true*/ root, "yolo_server.py");
  if (!fs.existsSync(script)) {
    return { ok: false, error: `یافت نشد: ${script}` };
  }

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    OPENCV_FFMPEG_CAPTURE_OPTIONS:
      "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay",
  };

  const log = logPath();
  let logFd: number | undefined;
  try {
    logFd = fs.openSync(log, "a");
  } catch {
    logFd = undefined;
  }

  const stdio: ["ignore", "pipe" | number, "pipe" | number] = logFd
    ? ["ignore", logFd, logFd]
    : ["ignore", "pipe", "pipe"];

  const candidates: [string, string[]][] =
    process.platform === "win32"
      ? [
          ["py", ["-3", script]],
          ["python", [script]],
        ]
      : [
          ["python3", [script]],
          ["python", [script]],
        ];

  let lastErr = "";
  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, args, {
        cwd: root,
        windowsHide: true,
        detached: true,
        stdio,
        env,
      });
      child.unref();
      child.on("error", (err) => {
        lastErr = err.message;
        if (yoloProc === child) yoloProc = null;
      });
      child.on("exit", (code) => {
        if (yoloProc === child) yoloProc = null;
        try {
          fs.appendFileSync(
            log,
            `\n[exit code=${code} at ${new Date().toISOString()}]\n`,
          );
        } catch {
          /* */
        }
      });
      yoloProc = child;
      return { ok: true };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      yoloProc = null;
    }
  }
  return {
    ok: false,
    error: lastErr || "Python پیدا نشد. Python 3 را نصب کنید.",
  };
}

/** Fire-and-forget start — returns immediately so browser fetch never times out. */
export async function startYoloProcess(): Promise<{
  ok: boolean;
  error?: string;
  already?: boolean;
  starting?: boolean;
}> {
  if (await isYoloOnline()) {
    return { ok: true, already: true };
  }
  if (starting) {
    return { ok: true, starting: true };
  }

  const boot = spawnYoloOnce();
  if (!boot.ok) return boot;

  starting = (async () => {
    try {
      // Give the child a moment to crash on import/encoding errors.
      await new Promise((r) => setTimeout(r, 1500));
      if (yoloProc && yoloProc.exitCode !== null) {
        const tail = readRecentLogTail();
        return {
          ok: false,
          error:
            "موتور YOLO بلافاصله متوقف شد." +
            (tail ? `\n${tail.slice(-400)}` : " لاگ yolo_server.log را ببینید."),
        };
      }
      const up = await waitUntilOnline(180000);
      if (up) return { ok: true };
      const tail = readRecentLogTail();
      return {
        ok: false,
        error:
          "راه‌اندازی YOLO طولانی شد." +
          (tail ? `\n${tail.slice(-400)}` : " لاگ yolo_server.log را ببینید."),
      };
    } finally {
      starting = null;
    }
  })();

  return { ok: true, starting: true };
}

export async function stopYoloProcess(): Promise<{ ok: boolean }> {
  try {
    if (await isYoloOnline()) {
      await fetch(`${YOLO_BASE}/api/yolo/stop`, {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);
    }
  } catch {
    /* */
  }

  if (yoloProc && !yoloProc.killed) {
    try {
      yoloProc.kill();
    } catch {
      /* */
    }
  }
  yoloProc = null;

  if (process.platform === "win32") {
    try {
      spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-NetTCPConnection -LocalPort ${YOLO_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    } catch {
      /* */
    }
  }

  return { ok: true };
}

export { YOLO_BASE, YOLO_PORT };
