import { NextRequest, NextResponse } from "next/server";
import { readCameras, writeCameras } from "@/lib/server-paths";
import { normalizeRtspUrl } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cams = readCameras();
  const list = Object.entries(cams).map(([id, cam]) => ({
    id: Number(id),
    name: cam.name,
    rtsp: cam.rtsp,
    location: cam.location || "شبکه محلی",
  }));
  list.sort((a, b) => a.id - b.id);
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const rtsp = normalizeRtspUrl(String(body.rtsp || "").trim());
  const location = String(body.location || "شبکه محلی").trim();
  if (!name || !rtsp.startsWith("rtsp://")) {
    return NextResponse.json({ error: "نام یا آدرس RTSP نامعتبر است" }, { status: 400 });
  }
  const cams = readCameras();
  const ids = Object.keys(cams).map(Number);
  const newId = ids.length ? Math.max(...ids) + 1 : 1;
  cams[String(newId)] = { name, rtsp, location };
  writeCameras(cams);
  return NextResponse.json({ success: true, id: newId });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const name = String(body.name || "").trim();
  const rtsp = normalizeRtspUrl(String(body.rtsp || "").trim());
  const location = String(body.location || "").trim();
  if (!id || !name || !rtsp.startsWith("rtsp://")) {
    return NextResponse.json({ error: "ورودی نامعتبر" }, { status: 400 });
  }
  const cams = readCameras();
  if (!cams[String(id)]) {
    return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  }
  cams[String(id)] = {
    name,
    rtsp,
    location: location || cams[String(id)].location || "شبکه محلی",
  };
  writeCameras(cams);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id لازم است" }, { status: 400 });
  const cams = readCameras();
  if (!cams[id]) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  delete cams[id];
  writeCameras(cams);
  return NextResponse.json({ success: true });
}
