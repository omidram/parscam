"""
MJPEG multipart streamer with optional live YOLO green boxes.
Usage: python stream_worker.py <rtsp_url> [cam_id]
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import cv2

FRAME_WIDTH = 960
FRAME_HEIGHT = 540
JPEG_QUALITY = 68
BASE_DIR = Path(__file__).resolve().parent
OVERLAY_FILE = BASE_DIR / "yolo_overlays.json"


def load_overlay(cam_id: str | None):
    if not cam_id or not OVERLAY_FILE.exists():
        return None
    try:
        raw = json.loads(OVERLAY_FILE.read_text(encoding="utf-8"))
        entry = raw.get(str(cam_id))
        if not entry:
            return None
        # نگه داشتن کادر تا ۱.۸ ثانیه برای نرمی بیشتر
        if time.time() - float(entry.get("ts", 0)) > 1.8:
            return None
        return entry
    except Exception:
        return None


def draw_overlay(frame, entry):
    hits = entry.get("hits") or []
    src_w = float(entry.get("w") or frame.shape[1])
    src_h = float(entry.get("h") or frame.shape[0])
    fh, fw = frame.shape[:2]
    sx = fw / max(src_w, 1.0)
    sy = fh / max(src_h, 1.0)
    green = (0, 220, 0)
    for h in hits:
        bbox = h.get("bbox") or []
        if len(bbox) != 4:
            continue
        x1, y1, x2, y2 = bbox
        x1 = int(x1 * sx)
        y1 = int(y1 * sy)
        x2 = int(x2 * sx)
        y2 = int(y2 * sy)
        cv2.rectangle(frame, (x1, y1), (x2, y2), green, 2)
        label = str(h.get("label_fa") or h.get("label") or "")
        conf = h.get("confidence")
        tag = label
        if isinstance(conf, (int, float)):
            tag = f"{label} {conf:.0%}".strip()
        if tag:
            cv2.putText(
                frame,
                tag,
                (x1, max(18, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                green,
                2,
                cv2.LINE_AA,
            )
    return frame


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: stream_worker.py <rtsp_url> [cam_id]\n")
        return 2

    rtsp = sys.argv[1]
    cam_id = sys.argv[2] if len(sys.argv) > 2 else None
    transport = os.environ.get("PARSCAM_RTSP_TRANSPORT", "tcp")
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        f"rtsp_transport;{transport}|fflags;nobuffer|flags;low_delay"
    )

    try:
        sys.stdout.reconfigure(encoding=None)  # type: ignore[attr-defined]
    except Exception:
        pass
    out = sys.stdout.buffer

    cap = None
    backoff = 0.5
    empty_reads = 0
    overlay_check_every = 2
    frame_i = 0
    cached_overlay = None

    try:
        while True:
            try:
                if cap is None or not cap.isOpened():
                    if cap is not None:
                        try:
                            cap.release()
                        except Exception:
                            pass
                    cap = cv2.VideoCapture(rtsp, cv2.CAP_FFMPEG)
                    if not cap.isOpened():
                        time.sleep(backoff)
                        backoff = min(backoff * 1.8, 6.0)
                        continue
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    backoff = 0.5
                    empty_reads = 0

                ok, frame = cap.read()
                if not ok or frame is None:
                    empty_reads += 1
                    if empty_reads > 30:
                        try:
                            cap.release()
                        except Exception:
                            pass
                        cap = None
                        empty_reads = 0
                    time.sleep(0.05)
                    continue

                empty_reads = 0
                frame_i += 1
                h, w = frame.shape[:2]
                if w != FRAME_WIDTH or h != FRAME_HEIGHT:
                    frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))

                if frame_i % overlay_check_every == 0:
                    cached_overlay = load_overlay(cam_id)
                if cached_overlay:
                    frame = draw_overlay(frame, cached_overlay)

                ok, buf = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
                )
                if not ok:
                    continue

                chunk = (
                    b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                    + buf.tobytes()
                    + b"\r\n"
                )
                out.write(chunk)
                out.flush()
            except BrokenPipeError:
                break
            except Exception as e:
                sys.stderr.write(f"stream_worker: {e}\n")
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                cap = None
                time.sleep(backoff)
                backoff = min(backoff * 1.8, 6.0)
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
