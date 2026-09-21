import { NextRequest, NextResponse } from "next/server";
import { readAlarms, writeAlarms } from "@/lib/server-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readAlarms());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const camId = Number(body.cam_id);
  const camName = String(body.cam_name || "دوربین");
  const reason = String(body.reason || "آلارم دستی");
  const alarms = readAlarms() as {
    id: number;
    cam_id: number;
    cam_name: string;
    reason: string;
    time: string;
  }[];
  const nextId = Math.max(0, ...alarms.map((a) => a.id || 0)) + 1;
  const item = {
    id: nextId,
    cam_id: camId || 0,
    cam_name: camName,
    reason,
    time: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
  alarms.unshift(item);
  writeAlarms(alarms);
  return NextResponse.json({ success: true, alarm: item });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    writeAlarms([]);
    return NextResponse.json({ success: true });
  }
  const alarms = (readAlarms() as { id: number }[]).filter(
    (a) => String(a.id) !== id,
  );
  writeAlarms(alarms);
  return NextResponse.json({ success: true });
}
