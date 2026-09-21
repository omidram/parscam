import { NextResponse } from "next/server";
import os from "os";
import { execSync } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adapterHint(): {
  wifi?: string;
  ethernet?: string;
  tun?: boolean;
  warning?: string;
} {
  const nets = os.networkInterfaces();
  let wifi: string | undefined;
  let ethernet: string | undefined;
  let tun = false;
  for (const [name, list] of Object.entries(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family !== "IPv4" || n.internal) continue;
      const low = name.toLowerCase();
      if (low.includes("wi-fi") || low.includes("wlan") || low.includes("wifi")) {
        wifi = n.address;
      } else if (low.includes("ethernet") && !low.includes("bluetooth")) {
        ethernet = n.address;
      } else if (low.includes("tun") || low.includes("sing") || low.includes("vpn")) {
        tun = true;
      }
    }
  }

  let ethStatus = "";
  if (process.platform === "win32") {
    try {
      ethStatus = execSync(
        'powershell -NoProfile -Command "(Get-NetAdapter -Name Ethernet -ErrorAction SilentlyContinue).Status"',
        { encoding: "utf8", windowsHide: true, timeout: 4000 },
      ).trim();
    } catch {
      ethStatus = "";
    }
  }

  let warning: string | undefined;
  if (/disconnected|not present/i.test(ethStatus)) {
    warning =
      "کابل شبکه Ethernet قطع است. دوربین‌های ۱۹۲.۱۶۸.۱.x فقط وقتی Ethernet وصل باشد پخش می‌شوند. کابل را به همان سوییچ دوربین‌ها بزنید.";
  } else if (tun) {
    warning =
      "VPN/TUN فعال است (مثل v2rayN). در تنظیمات VPN گزینه Bypass LAN / دور زدن شبکه محلی را روشن کنید، وگرنه RTSP خراب می‌شود.";
  }

  return { wifi, ethernet, tun, warning };
}

export async function GET() {
  return NextResponse.json(adapterHint());
}
