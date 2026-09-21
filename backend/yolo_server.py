# -*- coding: utf-8 -*-
"""
سرور HTTP تشخیص YOLO26 برای پارس کم — پورت ۹۰۱۰
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# Windows consoles (cp1252) crash on Persian prints — force UTF-8 I/O early.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from yolo_engine import engine

HOST = "127.0.0.1"
PORT = 9010


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/api/yolo/status", "/status"):
            return self._json(200, engine.snapshot_status())
        if path in ("/api/yolo/events", "/events"):
            return self._json(200, engine.events[:100])
        if path in ("/api/yolo/settings", "/settings"):
            return self._json(200, engine.settings)
        return self._json(404, {"error": "not found"})

    def do_PUT(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "json invalid"})
        if path in ("/api/yolo/settings", "/settings"):
            return self._json(200, {"success": True, "settings": engine.update_settings(data)})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path in ("/api/yolo/start", "/start"):
            engine.start()
            return self._json(200, {"success": True, "status": engine.snapshot_status()})
        if path in ("/api/yolo/stop", "/stop"):
            engine.stop()
            return self._json(200, {"success": True, "status": engine.snapshot_status()})
        if path in ("/api/yolo/reload", "/reload"):
            engine.stop()
            engine._threads = []
            engine.start()
            return self._json(200, {"success": True, "status": engine.snapshot_status()})
        return self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(f"[yolo-server] {args[0]}")


def main():
    print("=" * 60)
    print("Pars Cam | YOLO26 Detection Server")
    print(f"http://{HOST}:{PORT}/api/yolo/status")
    print("=" * 60)
    # Bind HTTP first so /status comes online even while the model loads.
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    threading.Thread(target=engine.start, daemon=True, name="yolo-engine-start").start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        engine.stop()
        print("stopped")


if __name__ == "__main__":
    main()
