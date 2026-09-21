import fs from "fs";
import path from "path";

/** مسیر ریشه پروژه پارس‌کم (پوشه والد web) */
export function projectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function recordingsRoot(): string {
  const fromEnv = process.env.PARSCAM_RECORDINGS;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const local = path.join(projectRoot(), "recordings");
  if (fs.existsSync(local)) return local;
  return local;
}

export function camerasFile(): string {
  return path.join(projectRoot(), "cameras.json");
}

export function alarmsFile(): string {
  return path.join(projectRoot(), "alarms.json");
}

export type StoredCamera = {
  name: string;
  rtsp: string;
  location?: string;
};

export type CamerasMap = Record<string, StoredCamera>;

export function readCameras(): CamerasMap {
  const file = camerasFile();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CamerasMap;
  } catch {
    return {};
  }
}

export function writeCameras(data: CamerasMap) {
  fs.writeFileSync(camerasFile(), JSON.stringify(data, null, 4), "utf-8");
}

export function readAlarms(): unknown[] {
  const file = alarmsFile();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeAlarms(data: unknown[]) {
  fs.writeFileSync(alarmsFile(), JSON.stringify(data, null, 4), "utf-8");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
