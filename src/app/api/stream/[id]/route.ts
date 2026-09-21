import { NextRequest, NextResponse } from "next/server";
import { readCameras } from "@/lib/server-paths";
import { spawnOpenCvMjpeg, spawnMjpegStream, normalizeRtspUrl } from "@/lib/ffmpeg";
import { Readable } from "stream";
import type { ChildProcess } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function attachStream(
  proc: ChildProcess,
  req: NextRequest,
  boundary: string,
): NextResponse {
  const cleanup = () => {
    try {
      if (!proc.killed) proc.kill("SIGKILL");
    } catch {
      /* */
    }
  };

  let gotData = false;
  const bootTimer = setTimeout(() => {
    if (!gotData) cleanup();
  }, 20000);

  proc.stderr?.on("data", (chunk: Buffer) => {
    // keep pipe draining; optional debug
    const t = chunk.toString();
    if (/error|fail|invalid|401|403/i.test(t)) {
      // leave process; client will see stream end
    }
  });

  const nodeStream = proc.stdout;
  if (!nodeStream) {
    clearTimeout(bootTimer);
    cleanup();
    return NextResponse.json({ error: "استریم در دسترس نیست" }, { status: 500 });
  }

  nodeStream.once("data", () => {
    gotData = true;
    clearTimeout(bootTimer);
  });
  nodeStream.on("end", () => clearTimeout(bootTimer));
  proc.on("exit", () => clearTimeout(bootTimer));
  req.signal.addEventListener("abort", () => {
    clearTimeout(bootTimer);
    cleanup();
  });

  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Connection: "close",
    },
  });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cams = readCameras();
  const cam = cams[id];
  if (!cam?.rtsp) {
    return NextResponse.json({ error: "دوربین یافت نشد" }, { status: 404 });
  }

  const rtsp = normalizeRtspUrl(cam.rtsp);
  const engine = (req.nextUrl.searchParams.get("engine") || "opencv").toLowerCase();

  try {
    if (engine === "ffmpeg") {
      const proc = spawnMjpegStream(rtsp);
      return attachStream(proc, req, "ffmpeg");
    }
    const proc = spawnOpenCvMjpeg(rtsp, id);
    // if python spawn fails immediately, fall back
    const failed = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 500);
      proc.once("error", () => {
        clearTimeout(t);
        resolve(true);
      });
      proc.once("exit", (code) => {
        if (code && code !== 0 && !proc.stdout?.readableLength) {
          clearTimeout(t);
          resolve(true);
        }
      });
    });
    if (failed) {
      try {
        proc.kill();
      } catch {
        /* */
      }
      const fb = spawnMjpegStream(rtsp);
      return attachStream(fb, req, "ffmpeg");
    }
    return attachStream(proc, req, "frame");
  } catch {
    const fb = spawnMjpegStream(rtsp);
    return attachStream(fb, req, "ffmpeg");
  }
}
