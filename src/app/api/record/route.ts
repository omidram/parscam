import { NextRequest, NextResponse } from "next/server";
import { readCameras } from "@/lib/server-paths";
import {
  isRecording,
  recordingStatus,
  startFfmpegRecording,
  stopFfmpegRecording,
} from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(recordingStatus());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "start");
  const camId = Number(body.cam_id ?? body.id);
  if (!camId) {
    return NextResponse.json({ error: "cam_id لازم است" }, { status: 400 });
  }

  const cams = readCameras();
  const cam = cams[String(camId)];
  if (!cam) {
    return NextResponse.json({ error: "دوربین یافت نشد" }, { status: 404 });
  }

  if (action === "stop") {
    const r = stopFfmpegRecording(camId);
    return r.ok
      ? NextResponse.json({ success: true, recording: false })
      : NextResponse.json({ error: r.error }, { status: 400 });
  }

  if (isRecording(camId)) {
    return NextResponse.json({ error: "قبلاً در حال ضبط است" }, { status: 400 });
  }

  const r = startFfmpegRecording(camId, cam.name, cam.rtsp);
  return r.ok
    ? NextResponse.json({ success: true, recording: true, path: r.path })
    : NextResponse.json({ error: r.error }, { status: 500 });
}
