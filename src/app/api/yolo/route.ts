import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { projectRoot } from "@/lib/server-paths";
import {
  isYoloOnline,
  startYoloProcess,
  stopYoloProcess,
  yoloFetch,
} from "@/lib/yolo-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function settingsPath() {
  return path.join(/*turbopackIgnore: true*/ projectRoot(), "yolo_settings.json");
}

function eventsPath() {
  return path.join(/*turbopackIgnore: true*/ projectRoot(), "yolo_events.json");
}

const DEFAULTS = {
  enabled: true,
  model: "yolo26n.pt",
  open_vocab_model: "yoloe-26n-seg.pt",
  use_open_vocab: true,
  confidence: 0.32,
  ov_confidence: 0.12,
  infer_every_n_frames: 5,
  ov_every_n_frames: 6,
  imgsz: 320,
  max_det: 25,
  cooldown_sec: 15,
  filters: {
    human: true,
    fire: true,
    gun: true,
    knife: true,
    animal: false,
    vehicle: false,
  },
  notify: true,
  auto_record_on_detect: true,
  record_duration_sec: 60,
  auto_screenshot_on_detect: true,
  draw_boxes: true,
  live_overlay: true,
};

function readFileSettings() {
  try {
    return {
      ...DEFAULTS,
      ...JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ settingsPath(), "utf-8")),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function readFileEvents() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ eventsPath(), "utf-8"),
    );
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "status";
  const online = await isYoloOnline();

  if (kind === "events") {
    if (online) {
      try {
        return NextResponse.json(await yoloFetch("/api/yolo/events"));
      } catch {
        /* fallback */
      }
    }
    return NextResponse.json(readFileEvents());
  }

  if (kind === "settings") {
    if (online) {
      try {
        return NextResponse.json(await yoloFetch("/api/yolo/settings"));
      } catch {
        /* fallback */
      }
    }
    return NextResponse.json(readFileSettings());
  }

  if (online) {
    try {
      const live = await yoloFetch("/api/yolo/status");
      return NextResponse.json({ ...live, serverOnline: true });
    } catch {
      /* fallback */
    }
  }

  return NextResponse.json({
    running: false,
    model_loaded: false,
    open_vocab_loaded: false,
    serverOnline: false,
    managedByApp: true,
    last_error: "",
    cameras: {},
    detections_total: 0,
    settings: readFileSettings(),
    recent: readFileEvents().slice(0, 20),
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (await isYoloOnline()) {
    try {
      const live = await yoloFetch("/api/yolo/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return NextResponse.json(live);
    } catch {
      /* write file */
    }
  }

  const current = readFileSettings();
  if (body.filters) {
    current.filters = { ...current.filters, ...body.filters };
  }
  for (const [k, v] of Object.entries(body)) {
    if (k !== "filters") (current as Record<string, unknown>)[k] = v;
  }
  if (
    current.filters?.fire ||
    current.filters?.gun ||
    current.filters?.knife
  ) {
    current.use_open_vocab = true;
  }
  fs.writeFileSync(
    /*turbopackIgnore: true*/ settingsPath(),
    JSON.stringify(current, null, 2),
    "utf-8",
  );
  return NextResponse.json({ success: true, settings: current });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "start");

  if (action === "start" || action === "reload") {
    const boot = await startYoloProcess();
    if (!boot.ok) {
      return NextResponse.json({ error: boot.error }, { status: 503 });
    }

    // Already online → call start/reload now
    if (boot.already || (await isYoloOnline())) {
      try {
        if (action === "reload") {
          await yoloFetch("/api/yolo/reload", { method: "POST", body: "{}" });
        } else {
          await yoloFetch("/api/yolo/start", { method: "POST", body: "{}" });
        }
        const status = await yoloFetch("/api/yolo/status");
        return NextResponse.json({
          success: true,
          already: boot.already,
          status: { ...status, serverOnline: true },
        });
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error ? e.message : "موتور اجرا شد ولی آماده نشد",
          },
          { status: 503 },
        );
      }
    }

    // Spawned in background — client should poll status
    return NextResponse.json({
      success: true,
      starting: true,
      message: "موتور YOLO در پس‌زمینه در حال راه‌اندازی است...",
    });
  }

  if (action === "stop") {
    if (await isYoloOnline()) {
      try {
        await yoloFetch("/api/yolo/stop", { method: "POST", body: "{}" });
      } catch {
        /* */
      }
    }
    await stopYoloProcess();
    return NextResponse.json({ success: true, status: { serverOnline: false, running: false } });
  }

  return NextResponse.json({ error: "action نامعتبر" }, { status: 400 });
}
