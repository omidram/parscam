import dgram from "dgram";
import net from "net";
import os from "os";
import { randomUUID } from "crypto";

export type DiscoveredDevice = {
  ip: string;
  port: number;
  protocol: "ONVIF" | "SADP" | "RTSP" | "HTTP" | "SSDP";
  manufacturer?: string;
  model?: string;
  name?: string;
  mac?: string;
  serial?: string;
  path?: string;
  rtsp?: string;
  http?: string;
  onvif?: boolean;
  score: number;
  discovery?: string;
};

type LocalIface = { address: string; netmask: string; broadcast: string };

function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() || undefined;
}

function guessVendor(banner: string): string | undefined {
  const t = banner.toLowerCase();
  if (t.includes("hikvision") || t.includes("hik ") || t.includes("ds-"))
    return "Hikvision";
  if (t.includes("dahua") || t.includes("dh-") || t.includes("ipc-"))
    return "Dahua";
  if (t.includes("milesight") || t.includes("mss")) return "Milesight";
  if (t.includes("axis")) return "Axis";
  if (t.includes("uniview") || t.includes("uv-")) return "Uniview";
  if (t.includes("hanwha") || t.includes("samsung")) return "Hanwha";
  if (t.includes("bosch")) return "Bosch";
  if (t.includes("onvif")) return "ONVIF";
  if (t.includes("vivotek")) return "Vivotek";
  if (t.includes("tp-link") || t.includes("tplink")) return "TP-Link";
  return undefined;
}

function rtspPathFor(vendor?: string): string {
  if (vendor === "Hikvision") return "/Streaming/Channels/101";
  if (vendor === "Dahua") return "/cam/realmonitor?channel=1&subtype=0";
  if (vendor === "Milesight") return "/main";
  if (vendor === "Axis") return "/axis-media/media.amp";
  // VMS Pro / generic ONVIF cameras often expose Milesight-style /main
  return "/main";
}

function ipv4Broadcast(address: string, netmask: string): string {
  const a = address.split(".").map(Number);
  const m = netmask.split(".").map(Number);
  return a.map((octet, i) => (octet & m[i]) | (255 ^ m[i])).join(".");
}

export function localInterfaces(): LocalIface[] {
  const nets = os.networkInterfaces();
  const out: LocalIface[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family !== "IPv4" || n.internal || !n.netmask) continue;
      out.push({
        address: n.address,
        netmask: n.netmask,
        broadcast: ipv4Broadcast(n.address, n.netmask),
      });
    }
  }
  return out;
}

/** All local /24 (or smaller) host lists — used silently, never shown as a range picker */
export function allLocalHostIps(maxPerSubnet = 254): string[] {
  const ifaces = localInterfaces();
  const ips = new Set<string>();
  for (const iface of ifaces) {
    const parts = iface.address.split(".").map(Number);
    const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const count = Math.min(254, maxPerSubnet);
    for (let i = 1; i <= count; i++) {
      const ip = `${base}.${i}`;
      if (ip !== iface.address) ips.add(ip);
    }
  }
  return [...ips];
}

function mergeDevice(
  map: Map<string, DiscoveredDevice>,
  device: DiscoveredDevice,
) {
  const prev = map.get(device.ip);
  if (!prev) {
    map.set(device.ip, device);
    return;
  }
  map.set(device.ip, {
    ...prev,
    ...device,
    manufacturer: device.manufacturer || prev.manufacturer,
    model: device.model || prev.model,
    name: device.name || prev.name,
    mac: device.mac || prev.mac,
    serial: device.serial || prev.serial,
    rtsp: device.rtsp || prev.rtsp,
    http: device.http || prev.http,
    path: device.path || prev.path,
    onvif: device.onvif || prev.onvif,
    discovery: [prev.discovery, device.discovery].filter(Boolean).join("+"),
    score: Math.max(prev.score, device.score),
    protocol:
      prev.protocol === "ONVIF" || device.protocol === "ONVIF"
        ? "ONVIF"
        : prev.protocol === "SADP" || device.protocol === "SADP"
          ? "SADP"
          : device.protocol,
  });
}

function listenUdp(
  port: number | 0,
  onMessage: (msg: Buffer, rinfo: dgram.RemoteInfo) => void,
  setup?: (socket: dgram.Socket) => void,
): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", reject);
    socket.on("message", onMessage);
    socket.bind(port, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* */
      }
      try {
        setup?.(socket);
      } catch {
        /* */
      }
      resolve(socket);
    });
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Hikvision SADP — same idea as SADP / AdjDev Tool (UDP 37020 multicast + broadcast) */
export async function sadpDiscover(
  timeoutMs = 4500,
): Promise<DiscoveredDevice[]> {
  const found = new Map<string, DiscoveredDevice>();
  const uuid = randomUUID().toUpperCase();
  const probe = Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`,
    "utf8",
  );

  const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
    const xml = msg.toString("utf8");
    if (!/IPv4Address|DeviceDescription|MAC/i.test(xml)) return;
    const ip = xmlTag(xml, "IPv4Address") || rinfo.address;
    if (!ip || ip === "0.0.0.0") return;
    const desc = xmlTag(xml, "DeviceDescription") || "";
    const dtype = xmlTag(xml, "DeviceType") || "";
    const mac = xmlTag(xml, "MAC");
    const serial = xmlTag(xml, "SerialNumber") || xmlTag(xml, "SerialNo");
    const httpPort = Number(
      xmlTag(xml, "HttpPort") || xmlTag(xml, "CommandPort") || 80,
    );
    const vendor = guessVendor(`${desc} ${dtype}`) || "Hikvision";
    const path = rtspPathFor(vendor);
    mergeDevice(found, {
      ip,
      port: httpPort || 80,
      protocol: "SADP",
      manufacturer: vendor,
      model: desc || dtype || undefined,
      name: desc || dtype || undefined,
      mac,
      serial,
      path,
      http: `http://${ip}:${httpPort || 80}/`,
      rtsp: `rtsp://${ip}:554${path}`,
      score: 95,
      discovery: "SADP",
    });
  };

  let socket: dgram.Socket;
  try {
    // Prefer bind 37020 like official tools; fall back to ephemeral
    try {
      socket = await listenUdp(37020, onMessage);
    } catch {
      socket = await listenUdp(0, onMessage);
    }
  } catch {
    return [];
  }

  try {
    socket.setMulticastTTL(4);
    socket.addMembership("239.255.255.250");
  } catch {
    /* */
  }

  const ifaces = localInterfaces();
  const targets: { host: string; port: number }[] = [
    { host: "239.255.255.250", port: 37020 },
    { host: "255.255.255.255", port: 37020 },
  ];
  for (const iface of ifaces) {
    targets.push({ host: iface.broadcast, port: 37020 });
  }

  for (const t of targets) {
    try {
      socket.send(probe, t.port, t.host);
    } catch {
      /* */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  for (const t of targets) {
    try {
      socket.send(probe, t.port, t.host);
    } catch {
      /* */
    }
  }

  await new Promise((r) => setTimeout(r, timeoutMs));
  try {
    socket.close();
  } catch {
    /* */
  }
  return [...found.values()];
}

/** ONVIF WS-Discovery — VMS Pro Device Search */
export async function onvifWsDiscover(
  timeoutMs = 4500,
): Promise<DiscoveredDevice[]> {
  const found = new Map<string, DiscoveredDevice>();
  const uuid = `uuid:${randomUUID()}`;
  const probe = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
 xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>${uuid}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`,
    "utf8",
  );

  // also probe Device type (some brands)
  const probeDevice = Buffer.from(
    probe
      .toString("utf8")
      .replace(
        "dn:NetworkVideoTransmitter",
        "tds:Device dn:NetworkVideoTransmitter",
      ),
    "utf8",
  );

  let socket: dgram.Socket;
  try {
    socket = await listenUdp(0, (msg, rinfo) => {
      const xml = msg.toString("utf8");
      if (!/ProbeMatch|XAddrs|Scopes/i.test(xml)) return;
      const xaddrs =
        xml.match(/<[^>]*XAddrs[^>]*>([^<]+)<\/[^>]*XAddrs>/i)?.[1] || "";
      const scopes =
        xml.match(/<[^>]*Scopes[^>]*>([^<]+)<\/[^>]*Scopes>/i)?.[1] || "";
      const urlMatch = xaddrs.match(/https?:\/\/([^/:]+)(?::(\d+))?/i);
      const host = urlMatch?.[1] || rinfo.address;
      const port = Number(urlMatch?.[2] || 80);
      const name = scopes
        .match(/onvif:\/\/www\.onvif\.org\/name\/([^\s]+)/i)?.[1]
        ?.replace(/%20/g, " ");
      const hardware = scopes
        .match(/onvif:\/\/www\.onvif\.org\/hardware\/([^\s]+)/i)?.[1]
        ?.replace(/%20/g, " ");
      const vendor = guessVendor(`${scopes} ${xaddrs}`) || "ONVIF";
      const path = rtspPathFor(vendor);
      mergeDevice(found, {
        ip: host,
        port,
        protocol: "ONVIF",
        manufacturer: vendor,
        model: hardware,
        name: name || hardware,
        onvif: true,
        http: `http://${host}:${port}/`,
        path,
        rtsp: `rtsp://${host}:554${path}`,
        score: 92,
        discovery: "ONVIF",
      });
    });
  } catch {
    return [];
  }

  try {
    socket.setMulticastTTL(4);
  } catch {
    /* */
  }

  const destinations = [
    { host: "239.255.255.250", port: 3702 },
    { host: "255.255.255.255", port: 3702 },
  ];
  for (const iface of localInterfaces()) {
    destinations.push({ host: iface.broadcast, port: 3702 });
  }

  for (const d of destinations) {
    try {
      socket.send(probe, d.port, d.host);
      socket.send(probeDevice, d.port, d.host);
    } catch {
      /* */
    }
  }
  await new Promise((r) => setTimeout(r, 350));
  for (const d of destinations) {
    try {
      socket.send(probe, d.port, d.host);
    } catch {
      /* */
    }
  }

  await new Promise((r) => setTimeout(r, timeoutMs));
  try {
    socket.close();
  } catch {
    /* */
  }
  return [...found.values()];
}

/** SSDP M-SEARCH — some NVRs / cameras answer */
export async function ssdpDiscover(
  timeoutMs = 3000,
): Promise<DiscoveredDevice[]> {
  const found = new Map<string, DiscoveredDevice>();
  const probe = Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: ssdp:all",
      "",
      "",
    ].join("\r\n"),
    "utf8",
  );

  let socket: dgram.Socket;
  try {
    socket = await listenUdp(0, (msg, rinfo) => {
      const text = msg.toString("utf8");
      if (!/LOCATION:|SERVER:/i.test(text)) return;
      const loc = text.match(/LOCATION:\s*(\S+)/i)?.[1] || "";
      const server = text.match(/SERVER:\s*(.+)/i)?.[1] || "";
      const url = loc.match(/https?:\/\/([^/:]+)(?::(\d+))?/i);
      const ip = url?.[1] || rinfo.address;
      const port = Number(url?.[2] || 80);
      const vendor = guessVendor(`${server} ${loc}`);
      if (!vendor && !/camera|nvr|dvr|onvif|ipc/i.test(`${server} ${loc}`)) {
        return;
      }
      const path = rtspPathFor(vendor);
      mergeDevice(found, {
        ip,
        port,
        protocol: "SSDP",
        manufacturer: vendor || "SSDP",
        name: server?.slice(0, 60),
        http: loc.startsWith("http") ? loc : `http://${ip}:${port}/`,
        path,
        rtsp: `rtsp://${ip}:554${path}`,
        score: 70,
        discovery: "SSDP",
      });
    });
  } catch {
    return [];
  }

  try {
    socket.send(probe, 1900, "239.255.255.250");
    socket.send(probe, 1900, "255.255.255.255");
  } catch {
    /* */
  }

  await new Promise((r) => setTimeout(r, timeoutMs));
  try {
    socket.close();
  } catch {
    /* */
  }
  return [...found.values()];
}

function portOpen(ip: string, port: number, timeout = 280): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port, timeout }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      worker(),
    ),
  );
}

/** Silent LAN sweep of all local subnets — no user range */
async function lanPortSweep(
  byIp: Map<string, DiscoveredDevice>,
): Promise<void> {
  const ips = allLocalHostIps(254);
  const ports = [554, 80, 8000, 8080];
  await mapPool(ips, 64, async (ip) => {
    const open: number[] = [];
    await Promise.all(
      ports.map(async (p) => {
        if (await portOpen(ip, p)) open.push(p);
      }),
    );
    if (!open.length) return;
    const hasRtsp = open.includes(554);
    if (!hasRtsp && !byIp.has(ip) && !open.includes(8000)) return;

    const existing = byIp.get(ip);
    const vendor = existing?.manufacturer;
    const path = rtspPathFor(vendor);
    mergeDevice(byIp, {
      ip,
      port: hasRtsp ? 554 : open[0],
      protocol: existing?.onvif
        ? "ONVIF"
        : existing?.protocol === "SADP"
          ? "SADP"
          : hasRtsp
            ? "RTSP"
            : "HTTP",
      manufacturer: vendor,
      model: existing?.model,
      name: existing?.name,
      mac: existing?.mac,
      serial: existing?.serial,
      onvif: existing?.onvif,
      path,
      rtsp: hasRtsp ? `rtsp://${ip}:554${path}` : existing?.rtsp,
      http: open.includes(80)
        ? `http://${ip}/`
        : open.includes(8080)
          ? `http://${ip}:8080/`
          : existing?.http,
      score: (hasRtsp ? 65 : 40) + (existing ? 20 : 0),
      discovery: existing?.discovery
        ? `${existing.discovery}+LAN`
        : "LAN",
    });
  });
}

function applyAuth(devices: DiscoveredDevice[], auth: string) {
  if (!auth) return devices;
  return devices.map((d) => {
    if (!d.rtsp || d.rtsp.includes("@")) return d;
    return { ...d, rtsp: d.rtsp.replace("rtsp://", `rtsp://${auth}`) };
  });
}

/**
 * Full automatic discovery — like VMS Pro / SADP / AdjDev Tool.
 * No IP range from the user; multicast + broadcast + all local LANs.
 */
export async function discoverAllCameras(opts?: {
  username?: string;
  password?: string;
}): Promise<DiscoveredDevice[]> {
  const user = opts?.username ?? "admin";
  const pass = opts?.password ?? "";
  const auth =
    user || pass
      ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
      : "";

  const byIp = new Map<string, DiscoveredDevice>();

  const [sadp, onvif, ssdp] = await Promise.all([
    sadpDiscover(5000).catch(() => [] as DiscoveredDevice[]),
    onvifWsDiscover(5000).catch(() => [] as DiscoveredDevice[]),
    ssdpDiscover(3500).catch(() => [] as DiscoveredDevice[]),
  ]);

  for (const d of [...sadp, ...onvif, ...ssdp]) mergeDevice(byIp, d);

  // Also sweep every local subnet silently (covers non-ONVIF/SADP devices)
  try {
    await withTimeout(lanPortSweep(byIp), 25000);
  } catch {
    /* sweep timed out — keep multicast results */
  }

  return applyAuth(
    [...byIp.values()].sort(
      (a, b) => b.score - a.score || a.ip.localeCompare(b.ip),
    ),
    auth,
  );
}

/** @deprecated keep helpers for API metadata */
export function localSubnets(): string[] {
  return localInterfaces().map((i) => {
    const p = i.address.split(".");
    return `${p[0]}.${p[1]}.${p[2]}.1-254`;
  });
}
