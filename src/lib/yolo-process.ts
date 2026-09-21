import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { projectRoot } from "@/lib/server-paths";

const YOLO_PORT = 9010;
const YOLO_BASE = `http://127.0.0.1:${YOLO_PORT}`;

let yoloProc: ChildProcess | null = null;
let starting: Promise<{ ok: boolean; error?: string }> | null = null;

export async function isYoloOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${YOLO_BASE}/api/yolo/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function yoloFetch(pathname: string, init?: RequestInit) {
  const res = await fetch(`${YOLO_BASE}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`yolo ${res.status}`);
  return res.json();
}

async function waitUntilOnline(ms = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await isYoloOnline()) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

function spawnYoloOnce(): { ok: boolean; error?: string } {
  if (yoloProc && !yoloProc.killed) return { ok: true };

  const root = /*turbopackIgnore: true*/ projectRoot();
  const script = path.join(/*turbopackIgnore: true*/ root, "yolo_server.py");
  const env = { ...process.env, PYTHONUNBUFFERED: "1" };
  const spawnOpts = {
    cwd: root,
    windowsHide: true,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"] as ["ignore", "ignore", "ignore"],
    env,
  };

  const candidates: [string, string[]][] =
    process.platform === "win32"
      ? [
          ["py", ["-3", script]],
          ["python", [script]],
          ["python3", [script]],
        ]
      : [
          ["python3", [script]],
          ["python", [script]],
        ];

  let lastErr = "";
  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, args, spawnOpts);
      child.unref();
      child.on("exit", () => {
        if (yoloProc === child) yoloProc = null;
      });
      yoloProc = child;
      return { ok: true };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      yoloProc = null;
    }
  }
  return { ok: false, error: lastErr || "Python پیدا نشد. Python 3 را نصب کنید." };
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
      const up = await waitUntilOnline(120000);
      return up
        ? { ok: true }
        : {
            ok: false,
            error:
              "راه‌اندازی YOLO طولانی شد. ultralytics را در همان Python بررسی کنید.",
          };
    } finally {
      starting = null;
    }
  })();

  // don't await — client polls /api/yolo?kind=status
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

  // Windows: try kill by port if still up
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
