"""
ضبط RTSP با خروجی H.264 سازگار با Chrome.
فریم‌ها از OpenCV خوانده و با ffmpeg/libx264 نوشته می‌شوند.
Usage:
  python record_worker.py <rtsp_url> <output_mp4> [max_seconds]
Stop: create <output_mp4>.stop
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2

os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay",
)


def find_ffmpeg() -> str:
    return shutil.which("ffmpeg") or "ffmpeg"


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("usage: record_worker.py <rtsp> <out.mp4> [max_sec]\n")
        return 2

    rtsp = sys.argv[1]
    out = Path(sys.argv[2])
    max_sec = float(sys.argv[3]) if len(sys.argv) > 3 else 0
    stop_file = Path(str(out) + ".stop")
    out.parent.mkdir(parents=True, exist_ok=True)
    if stop_file.exists():
        try:
            stop_file.unlink()
        except OSError:
            pass

    transport = os.environ.get("PARSCAM_RTSP_TRANSPORT", "tcp")
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        f"rtsp_transport;{transport}|fflags;nobuffer|flags;low_delay"
    )

    cap = cv2.VideoCapture(rtsp, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        sys.stderr.write(f"cannot open rtsp: {rtsp}\n")
        return 1

    ok, frame = cap.read()
    if not ok or frame is None:
        sys.stderr.write("no first frame\n")
        cap.release()
        return 1

    h, w = frame.shape[:2]
    # even dimensions for yuv420p
    if w % 2:
        w -= 1
    if h % 2:
        h -= 1
    if frame.shape[1] != w or frame.shape[0] != h:
        frame = cv2.resize(frame, (w, h))

    ffmpeg = find_ffmpeg()
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-s",
        f"{w}x{h}",
        "-r",
        "12",
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(out),
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except Exception as e:
        sys.stderr.write(f"ffmpeg spawn failed: {e}\n")
        cap.release()
        return 1

    assert proc.stdin is not None
    sys.stderr.write(f"recording h264 -> {out} {w}x{h}\n")
    t0 = time.time()
    frames = 0

    try:
        while True:
            if stop_file.exists():
                break
            if max_sec > 0 and (time.time() - t0) >= max_sec:
                break
            if frames == 0:
                cur = frame
            else:
                ok, cur = cap.read()
                if not ok or cur is None:
                    time.sleep(0.05)
                    continue
                if cur.shape[1] != w or cur.shape[0] != h:
                    cur = cv2.resize(cur, (w, h))
            try:
                proc.stdin.write(cur.tobytes())
            except BrokenPipeError:
                break
            frames += 1
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        cap.release()
        if stop_file.exists():
            try:
                stop_file.unlink()
            except OSError:
                pass
        size = out.stat().st_size if out.exists() else 0
        err = ""
        try:
            if proc.stderr:
                err = proc.stderr.read().decode("utf-8", "replace")[-500:]
        except Exception:
            pass
        sys.stderr.write(f"done frames={frames} bytes={size} {err}\n")
        if size < 2000:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
