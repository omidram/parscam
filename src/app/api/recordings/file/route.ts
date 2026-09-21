import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { recordingsRoot } from "@/lib/server-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cam = req.nextUrl.searchParams.get("cam") || "";
  const file = req.nextUrl.searchParams.get("file") || "";
  if (!cam || !file) {
    return NextResponse.json({ error: "پارامتر نامعتبر" }, { status: 400 });
  }
  if (
    cam.includes("..") ||
    file.includes("..") ||
    file.includes("/") ||
    file.includes("\\")
  ) {
    return NextResponse.json({ error: "مسیر نامعتبر" }, { status: 400 });
  }
  if (!file.toLowerCase().endsWith(".mp4")) {
    return NextResponse.json({ error: "فرمت نامعتبر" }, { status: 400 });
  }

  const target = path.join(/*turbopackIgnore: true*/ recordingsRoot(), cam, file);
  const rootResolved = path.resolve(/*turbopackIgnore: true*/ recordingsRoot());
  const targetResolved = path.resolve(/*turbopackIgnore: true*/ target);
  if (!targetResolved.startsWith(rootResolved)) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  }
  if (!fs.existsSync(/*turbopackIgnore: true*/ targetResolved)) {
    return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  }

  const stat = fs.statSync(/*turbopackIgnore: true*/ targetResolved);
  const download = req.nextUrl.searchParams.get("download") === "1";
  const nodeStream = fs.createReadStream(/*turbopackIgnore: true*/ targetResolved);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
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
