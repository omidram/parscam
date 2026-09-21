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

# OpenCV putText cannot render Persian — always use ASCII labels on the live box.
FILTER_LABELS_EN = {
    "human": "Person",
    "fire": "Fire",
    "gun": "Gun",
    "knife": "Knife",
    "animal": "Animal",
    "vehicle": "Vehicle",
}


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


def overlay_tag(hit: dict) -> str:
    filt = str(hit.get("filter") or "")
    label = FILTER_LABELS_EN.get(filt) or str(hit.get("label") or "Object")
    # Strip non-ASCII so ????? never appears on the frame
    label = label.encode("ascii", "ignore").decode("ascii").strip() or "Object"
    conf = hit.get("confidence")
    if isinstance(conf, (int, float)):
        return f"{label} {conf:.0%}"
    return label


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
        tag = overlay_tag(h)
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
    overlay_check_every = 3
    frame_i = 0
    cached_overlay = None
    last_jpeg: bytes | None = None
    last_emit = 0.0

    def emit_jpeg(jpeg: bytes) -> None:
        nonlocal last_jpeg, last_emit
        last_jpeg = jpeg
        last_emit = time.time()
        chunk = (
            b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
        )
        out.write(chunk)
        out.flush()

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
                        # Keep MJPEG alive so the browser <img> does not error out.
                        if last_jpeg is not None and time.time() - last_emit > 0.4:
                            try:
                                emit_jpeg(last_jpeg)
                            except BrokenPipeError:
                                break
                        time.sleep(backoff)
                        backoff = min(backoff * 1.8, 4.0)
                        continue
                    try:
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass
                    backoff = 0.5
                    empty_reads = 0

                ok, frame = cap.read()
                if not ok or frame is None:
                    empty_reads += 1
                    # Hold last frame so the HTTP multipart stream never stalls.
                    if last_jpeg is not None and time.time() - last_emit > 0.35:
                        try:
                            emit_jpeg(last_jpeg)
                        except BrokenPipeError:
                            break
                    if empty_reads > 80:
                        try:
                            cap.release()
                        except Exception:
                            pass
                        cap = None
                        empty_reads = 0
                    else:
                        time.sleep(0.03)
                    continue

                empty_reads = 0
                frame_i += 1
                h, w = frame.shape[:2]
                if w != FRAME_WIDTH or h != FRAME_HEIGHT:
                    frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))

                # Overlay must never tear down the RTSP session.
                try:
                    if frame_i % overlay_check_every == 0:
                        cached_overlay = load_overlay(cam_id)
                    if cached_overlay:
                        frame = draw_overlay(frame, cached_overlay)
                except Exception:
                    cached_overlay = None

                ok, buf = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
                )
                if not ok:
                    continue

                emit_jpeg(buf.tobytes())
            except BrokenPipeError:
                break
            except Exception as e:
                sys.stderr.write(f"stream_worker: {e}\n")
                # Prefer holding the pipe with last frame over full reconnect storms.
                if last_jpeg is not None:
                    try:
                        emit_jpeg(last_jpeg)
                    except BrokenPipeError:
                        break
                    except Exception:
                        pass
                if empty_reads > 40 or cap is None:
                    if cap is not None:
                        try:
                            cap.release()
                        except Exception:
                            pass
                    cap = None
                time.sleep(min(backoff, 1.5))
                backoff = min(backoff * 1.5, 4.0)
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
