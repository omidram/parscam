import { NextRequest, NextResponse } from "next/server";
import { discoverAllCameras, localInterfaces } from "@/lib/camera-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({
    mode: "auto",
    description:
      "جست‌وجوی خودکار مثل VMS Pro / SADP / AdjDev — بدون نیاز به بازه IP",
    interfaces: localInterfaces().map((i) => ({
      address: i.address,
      broadcast: i.broadcast,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? "admin");
  const password = String(body.password ?? "");

  try {
    const devices = await discoverAllCameras({ username, password });
    return NextResponse.json({
      count: devices.length,
      mode: "auto",
      devices,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "اسکن ناموفق" },
      { status: 500 },
    );
  }
}
