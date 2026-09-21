import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Readable } from "stream";
import { recordingsRoot } from "@/lib/server-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveSafe(cam: string, file: string) {
  if (
    !cam ||
    !file ||
    cam.includes("..") ||
    file.includes("..") ||
    file.includes("/") ||
    file.includes("\\")
  ) {
    return null;
  }
  if (!file.toLowerCase().endsWith(".mp4") && !file.toLowerCase().endsWith(".avi")) {
    return null;
  }
  const target = path.join(/*turbopackIgnore: true*/ recordingsRoot(), cam, file);
  const rootResolved = path.resolve(/*turbopackIgnore: true*/ recordingsRoot());
  const targetResolved = path.resolve(/*turbopackIgnore: true*/ target);
  if (!targetResolved.startsWith(rootResolved)) return null;
  if (!fs.existsSync(/*turbopackIgnore: true*/ targetResolved)) return null;
  return targetResolved;
}

/** Stream H.264 fMP4 via ffmpeg so Chrome can play mp4v/XVID recordings too */
function chromePlayStream(filePath: string, req: NextRequest) {
  const proc = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  const cleanup = () => {
    try {
      if (!proc.killed) proc.kill("SIGKILL");
    } catch {
      /* */
    }
  };
  proc.stderr?.on("data", () => {});
  req.signal.addEventListener("abort", cleanup);
  proc.on("exit", () => {});

  const nodeStream = proc.stdout;
  if (!nodeStream) {
    cleanup();
    return NextResponse.json({ error: "پخش ناموفق" }, { status: 500 });
  }
  return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "Content-Disposition": "inline",
    },
  });
}

export async function GET(req: NextRequest) {
  const cam = req.nextUrl.searchParams.get("cam") || "";
  const file = req.nextUrl.searchParams.get("file") || "";
  const play = req.nextUrl.searchParams.get("play") === "1";
  const download = req.nextUrl.searchParams.get("download") === "1";

  const targetResolved = resolveSafe(cam, file);
  if (!targetResolved) {
    return NextResponse.json({ error: "یافت نشد یا مسیر نامعتبر" }, { status: 404 });
  }

  // Browser playback: always remux/transcode to H.264 for Chrome compatibility
  if (play && !download) {
    return chromePlayStream(targetResolved, req);
  }

  const stat = fs.statSync(/*turbopackIgnore: true*/ targetResolved);
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : Math.min(start + 1024 * 1024 - 1, stat.size - 1);
      const chunk = end - start + 1;
      const nodeStream = fs.createReadStream(/*turbopackIgnore: true*/ targetResolved, {
        start,
        end,
      });
      return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunk),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=60",
        },
      });
    }
  }

  const nodeStream = fs.createReadStream(/*turbopackIgnore: true*/ targetResolved);
  return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file)}"`,
    },
  });
}
