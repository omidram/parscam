import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { formatBytes, recordingsRoot } from "@/lib/server-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const root = recordingsRoot();
  const results: {
    id: string;
    camera: string;
    filename: string;
    date: string;
    size: string;
    sizeBytes: number;
    mtime: number;
    cam: string;
  }[] = [];

  if (!fs.existsSync(root)) {
    return NextResponse.json([]);
  }

  for (const camFolder of fs.readdirSync(root)) {
    const camPath = path.join(root, camFolder);
    if (!fs.statSync(camPath).isDirectory()) continue;
    for (const fname of fs.readdirSync(camPath)) {
      if (!fname.toLowerCase().endsWith(".mp4")) continue;
      const full = path.join(camPath, fname);
      try {
        const st = fs.statSync(full);
        const base = path.parse(fname).name;
        const dateMatch = base.match(/(\d{8})_(\d{6})/);
        let dateLabel = base.replace(/_/g, " · ");
        if (dateMatch) {
          const d = dateMatch[1];
          const t = dateMatch[2];
          dateLabel = `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)} - ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
        }
        results.push({
          id: `${camFolder}/${fname}`,
          camera: camFolder,
          filename: fname,
          date: dateLabel,
          size: formatBytes(st.size),
          sizeBytes: st.size,
          mtime: st.mtimeMs,
          cam: camFolder,
        });
      } catch {
        /* skip */
      }
    }
  }

  results.sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json(results);
}
