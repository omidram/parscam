# -*- coding: utf-8 -*-
"""
پارس کم - سیستم نظارت تصویری
نسخه ارتقاءیافته: طراحی مدرن + امنیت استاندارد جهانی
"""
import cv2
import os
import sys
import json
import time
import hmac
import html
import hashlib
import logging
import secrets
import socket
import threading
import webbrowser
import ipaddress
import mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import wraps
from datetime import datetime, timedelta
from collections import defaultdict
from urllib.parse import quote

from flask import (
    Flask, Response, request, jsonify, send_from_directory,
    abort, session, redirect, url_for, render_template_string, g
)
from werkzeug.utils import secure_filename
from werkzeug.serving import make_server

# ====================================================================
#                          تنظیمات اصلی
# ====================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "cameras.json")
ALARM_FILE = os.path.join(BASE_DIR, "alarms.json")
AUTH_FILE = os.path.join(BASE_DIR, "auth.json")
SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")
LOG_FILE = os.path.join(BASE_DIR, "parscam.log")

_default_recordings = os.environ.get(
    "PARSCAM_RECORDINGS",
    os.path.join(BASE_DIR, "recordings"),
)
try:
    os.makedirs(_default_recordings, exist_ok=True)
    RECORDINGS_PATH = os.path.realpath(_default_recordings)
except OSError:
    RECORDINGS_PATH = os.path.realpath(os.path.join(BASE_DIR, "recordings"))
    os.makedirs(RECORDINGS_PATH, exist_ok=True)

MAIN_PORT = int(os.environ.get("PARSCAM_PORT", 9000))
START_PORT = int(os.environ.get("PARSCAM_START_PORT", 9100))

FRAME_WIDTH = 640
FRAME_HEIGHT = 360
JPEG_QUALITY = 75
FPS_LIMIT = 15
RTSP_TRANSPORT = "tcp"
RTSP_TIMEOUT_SEC = 5
AUTO_RECONNECT = True
LOW_LATENCY = True
SNAPSHOT_ON_ALARM = True
RETENTION_DAYS = 30

DEFAULT_SETTINGS = {
    "frame_width": 640,
    "frame_height": 360,
    "jpeg_quality": 75,
    "fps_limit": 15,
    "rtsp_transport": "tcp",
    "rtsp_timeout_sec": 5,
    "auto_reconnect": True,
    "low_latency": True,
    "snapshot_on_alarm": True,
    "retention_days": 30,
}

# امنیت
SESSION_LIFETIME = timedelta(hours=8)
SESSION_IDLE_TIMEOUT = timedelta(hours=2)
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 300
ALLOWED_RECORDING_EXT = {".mp4"}
MAX_SCAN_RANGE = 1024
API_RATE_LIMIT = 120            # درخواست در دقیقه برای هر IP
API_RATE_WINDOW = 60
DEFAULT_USER = "admin"
DEFAULT_PASS = "admin"

# FFMPEG
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
)

# ====================================================================
#                            لاگ‌گیری
# ====================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("parscam")

# ====================================================================
#                    قفل و وضعیت جهانی
# ====================================================================
state_lock = threading.RLock()
cameras = {}
alarms = []
recording_threads = {}
recording_active = {}
recording_writers = {}
camera_servers = {}
login_attempts = {}
api_rate = defaultdict(list)     # ip -> [timestamps]
csrf_tokens = {}                 # session_id -> token

# ====================================================================
#                       توابع رمز عبور
# ====================================================================
def hash_password(password: str, salt: str = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    iterations = 200_000
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"),
        salt.encode("utf-8"), iterations,
    )
    return f"pbkdf2_sha256${iterations}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) != 4:
            return False
        algo, iters, salt, hashval = parts
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"),
            salt.encode("utf-8"), int(iters),
        )
        return hmac.compare_digest(dk.hex(), hashval)
    except Exception as e:
        log.error(f"خطا در بررسی رمز: {e}")
        return False


def load_or_create_auth():
    if os.path.exists(AUTH_FILE):
        try:
            with open(AUTH_FILE, "r", encoding="utf-8") as f:
                auth = json.load(f)
            if not all(k in auth for k in ("username", "password_hash")):
                raise ValueError("ساختار نامعتبر")
            log.info(f"auth.json بارگذاری شد - کاربر: {auth['username']}")
            return auth
        except Exception as e:
            log.error(f"auth.json خراب: {e}")
            try:
                os.remove(AUTH_FILE)
            except OSError:
                pass

    username = os.environ.get("PARSCAM_USER", DEFAULT_USER).strip() or DEFAULT_USER
    password = os.environ.get("PARSCAM_PASS", DEFAULT_PASS)

    auth = {
        "username": username,
        "password_hash": hash_password(password),
        "must_change": True,
    }
    if not verify_password(password, auth["password_hash"]):
        log.error("خطای داخلی: هش نامعتبر")
        sys.exit(1)

    tmp = AUTH_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(auth, f, indent=4, ensure_ascii=False)
    os.replace(tmp, AUTH_FILE)
    try:
        os.chmod(AUTH_FILE, 0o600)
    except OSError:
        pass

    print("=" * 70)
    print(f"🔐 کاربر پیش‌فرض: {username}")
    print(f"🔐 رمز پیش‌فرض: {password}")
    print("   ⚠️  پس از ورود، رمز را تغییر دهید.")
    print("=" * 70)
    return auth


AUTH = load_or_create_auth()

# ====================================================================
#                     CSRF
# ====================================================================
def get_csrf_token() -> str:
    sid = session.get("sid")
    if not sid:
        sid = secrets.token_hex(32)
        session["sid"] = sid
    with state_lock:
        if sid not in csrf_tokens:
            csrf_tokens[sid] = secrets.token_hex(32)
        return csrf_tokens[sid]


def verify_csrf() -> bool:
    sid = session.get("sid")
    if not sid:
        return False
    with state_lock:
        expected = csrf_tokens.get(sid)
    if not expected:
        return False
    provided = (request.headers.get("X-CSRF-Token")
                or request.form.get("csrf_token", ""))
    return hmac.compare_digest(expected, provided)


def csrf_protect(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if request.method in ("POST", "PUT", "DELETE", "PATCH"):
            if not verify_csrf():
                return jsonify({"error": "csrf_invalid"}), 403
        return f(*args, **kwargs)
    return wrapper

# ====================================================================
#                     Rate Limiting
# ====================================================================
def rate_limited(limit=API_RATE_LIMIT, window=API_RATE_WINDOW):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            ip = client_ip()
            now = time.time()
            with state_lock:
                timestamps = api_rate[ip]
                # پاکسازی قدیمی‌ها
                api_rate[ip] = [t for t in timestamps if now - t < window]
                if len(api_rate[ip]) >= limit:
                    return jsonify({"error": "rate_limit_exceeded"}), 429
                api_rate[ip].append(now)
            return f(*args, **kwargs)
        return wrapper
    return decorator

# ====================================================================
#                     توابع کمکی امنیتی
# ====================================================================
def client_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def is_locked_out(ip: str) -> bool:
    with state_lock:
        if ip not in login_attempts:
            return False
        count, last = login_attempts[ip]
        if count < MAX_LOGIN_ATTEMPTS:
            return False
        if (time.time() - last) > LOGIN_LOCKOUT_SECONDS:
            del login_attempts[ip]
            return False
        return True


def record_failed_login(ip: str):
    with state_lock:
        count, _ = login_attempts.get(ip, (0, 0))
        login_attempts[ip] = (count + 1, time.time())


def clear_login_attempts(ip: str):
    with state_lock:
        login_attempts.pop(ip, None)


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("authenticated"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login_page"))

        now = time.time()
        last = session.get("last_seen", 0)
        login_time = session.get("login_time", now)

        # انقضای مطلق
        if (now - login_time) > SESSION_LIFETIME.total_seconds():
            session.clear()
            return redirect(url_for("login_page"))
        # انقضای بی‌کاری
        if (now - last) > SESSION_IDLE_TIMEOUT.total_seconds():
            session.clear()
            return redirect(url_for("login_page"))
        session["last_seen"] = now

        # اجبار به تغییر رمز
        if AUTH.get("must_change"):
            allowed = {"/change_password", "/logout"}
            if request.path not in allowed and not request.path.startswith("/static"):
                if request.path.startswith("/api/"):
                    return jsonify({"error": "must_change_password"}), 403
                return redirect(url_for("change_password_page"))

        return f(*args, **kwargs)
    return wrapper


def safe_join(base: str, *parts: str) -> str:
    base_real = os.path.realpath(base)
    target = os.path.realpath(os.path.join(base_real, *parts))
    if target != base_real and not target.startswith(base_real + os.sep):
        raise ValueError("path traversal detected")
    return target


def valid_rtsp(url: str) -> bool:
    if not isinstance(url, str) or not (5 <= len(url) <= 500):
        return False
    return url.startswith(("rtsp://", "rtsps://", "http://", "https://"))


def valid_name(name: str) -> bool:
    return isinstance(name, str) and 1 <= len(name.strip()) <= 100


def esc(v) -> str:
    """HTML escape امن"""
    return html.escape(str(v), quote=True)


# ====================================================================
#                     ذخیره/بارگذاری فایل‌ها
# ====================================================================
def _atomic_write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    os.replace(tmp, path)


def load_cameras():
    global cameras
    with state_lock:
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                cameras = {int(k): v for k, v in raw.items()}
                log.info(f"{len(cameras)} دوربین بارگذاری شد")
                return
            except Exception as e:
                log.error(f"خطا در بارگذاری دوربین‌ها: {e}")
        cameras = {}
        save_cameras_locked()


def save_cameras_locked():
    _atomic_write_json(CONFIG_FILE, {str(k): v for k, v in cameras.items()})
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass


def load_alarms():
    global alarms
    with state_lock:
        if os.path.exists(ALARM_FILE):
            try:
                with open(ALARM_FILE, "r", encoding="utf-8") as f:
                    alarms = json.load(f)
            except Exception as e:
                log.error(f"خطا در بارگذاری هشدارها: {e}")
                alarms = []


def save_alarms_locked():
    _atomic_write_json(ALARM_FILE, alarms)


def apply_settings(data: dict):
    """اعمال تنظیمات فنی روی متغیرهای سراسری"""
    global FRAME_WIDTH, FRAME_HEIGHT, JPEG_QUALITY, FPS_LIMIT
    global RTSP_TRANSPORT, RTSP_TIMEOUT_SEC, AUTO_RECONNECT, LOW_LATENCY
    global SNAPSHOT_ON_ALARM, RETENTION_DAYS

    fw = int(data.get("frame_width", FRAME_WIDTH))
    fh = int(data.get("frame_height", FRAME_HEIGHT))
    jq = int(data.get("jpeg_quality", JPEG_QUALITY))
    fps = int(data.get("fps_limit", FPS_LIMIT))
    transport = str(data.get("rtsp_transport", RTSP_TRANSPORT)).lower()
    timeout = int(data.get("rtsp_timeout_sec", RTSP_TIMEOUT_SEC))
    retention = int(data.get("retention_days", RETENTION_DAYS))

    if fw < 320 or fw > 1920:
        raise ValueError("frame_width نامعتبر")
    if fh < 180 or fh > 1080:
        raise ValueError("frame_height نامعتبر")
    if jq < 40 or jq > 95:
        raise ValueError("jpeg_quality نامعتبر")
    if fps < 5 or fps > 30:
        raise ValueError("fps_limit نامعتبر")
    if transport not in ("tcp", "udp"):
        raise ValueError("rtsp_transport نامعتبر")
    if timeout < 2 or timeout > 30:
        raise ValueError("rtsp_timeout_sec نامعتبر")
    if retention < 7 or retention > 365:
        raise ValueError("retention_days نامعتبر")

    FRAME_WIDTH = fw
    FRAME_HEIGHT = fh
    JPEG_QUALITY = jq
    FPS_LIMIT = fps
    RTSP_TRANSPORT = transport
    RTSP_TIMEOUT_SEC = timeout
    AUTO_RECONNECT = bool(data.get("auto_reconnect", AUTO_RECONNECT))
    LOW_LATENCY = bool(data.get("low_latency", LOW_LATENCY))
    SNAPSHOT_ON_ALARM = bool(data.get("snapshot_on_alarm", SNAPSHOT_ON_ALARM))
    RETENTION_DAYS = retention

    # به‌روزرسانی گزینه‌های FFMPEG
    opts = [f"rtsp_transport;{RTSP_TRANSPORT}"]
    if LOW_LATENCY:
        opts.extend(["fflags;nobuffer", "flags;low_delay"])
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "|".join(opts)


def get_settings_dict() -> dict:
    return {
        "frame_width": FRAME_WIDTH,
        "frame_height": FRAME_HEIGHT,
        "jpeg_quality": JPEG_QUALITY,
        "fps_limit": FPS_LIMIT,
        "rtsp_transport": RTSP_TRANSPORT,
        "rtsp_timeout_sec": RTSP_TIMEOUT_SEC,
        "auto_reconnect": AUTO_RECONNECT,
        "low_latency": LOW_LATENCY,
        "snapshot_on_alarm": SNAPSHOT_ON_ALARM,
        "retention_days": RETENTION_DAYS,
        "recordings_path": RECORDINGS_PATH,
        "main_port": MAIN_PORT,
        "start_port": START_PORT,
    }


def load_settings():
    merged = dict(DEFAULT_SETTINGS)
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                merged.update(raw)
            log.info("settings.json بارگذاری شد")
        except Exception as e:
            log.error(f"خطا در بارگذاری settings.json: {e}")
    try:
        apply_settings(merged)
        _atomic_write_json(SETTINGS_FILE, get_settings_dict())
    except Exception as e:
        log.error(f"اعمال تنظیمات ناموفق: {e}")
        apply_settings(DEFAULT_SETTINGS)


def save_settings_locked():
    _atomic_write_json(SETTINGS_FILE, get_settings_dict())
    try:
        os.chmod(SETTINGS_FILE, 0o600)
    except OSError:
        pass


# ====================================================================
#                          هشدارها
# ====================================================================
def add_alarm(cam_id, cam_name, reason="Manual alarm"):
    with state_lock:
        next_id = max((a.get("id", 0) for a in alarms), default=0) + 1
        alarms.insert(0, {
            "id": next_id,
            "cam_id": cam_id,
            "cam_name": cam_name,
            "reason": reason,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        if len(alarms) > 5000:
            del alarms[5000:]
        save_alarms_locked()


# ====================================================================
#                          ضبط ویدیو
# ====================================================================
def safe_cam_folder(cam_name: str) -> str:
    safe = secure_filename(cam_name)
    if not safe:
        safe = f"cam_{int(time.time())}"
    return safe[:80]


def build_recording_path(cam_id: int, cam_name: str) -> str:
    cam_dir = os.path.join(RECORDINGS_PATH, safe_cam_folder(cam_name))
    os.makedirs(cam_dir, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    time_str = datetime.now().strftime("%H-%M-%S")
    filename = f"{date_str}_{time_str}_{cam_id}.mp4"
    return os.path.join(cam_dir, filename)


def record_camera(cam_id, rtsp_url, cam_name):
    log.info(f"▶️ شروع ضبط دوربین {cam_id} ({cam_name})")
    cap = None
    out = None
    out_path = None
    try:
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            log.error(f"❌ باز کردن RTSP دوربین {cam_id} ناموفق")
            with state_lock:
                recording_active[cam_id] = False
            return

        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

        fps = FPS_LIMIT if FPS_LIMIT > 0 else 15
        out_path = build_recording_path(cam_id, cam_name)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(out_path, fourcc, fps, (FRAME_WIDTH, FRAME_HEIGHT))
        if not out.isOpened():
            log.error(f"❌ VideoWriter ناموفق: {out_path}")
            with state_lock:
                recording_active[cam_id] = False
            return

        with state_lock:
            recording_writers[cam_id] = out

        frame_time = 1.0 / fps
        last_time = time.time()

        while True:
            with state_lock:
                if not recording_active.get(cam_id, False):
                    break
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue
            if frame.shape[1] != FRAME_WIDTH or frame.shape[0] != FRAME_HEIGHT:
                frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))
            out.write(frame)
            now = time.time()
            elapsed = now - last_time
            if elapsed < frame_time:
                time.sleep(frame_time - elapsed)
            last_time = now
    except Exception as e:
        log.exception(f"خطای ضبط دوربین {cam_id}: {e}")
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        if out is not None:
            try:
                out.release()
            except Exception:
                pass
        with state_lock:
            recording_writers.pop(cam_id, None)
            recording_active[cam_id] = False
        log.info(f"⏹ ضبط دوربین {cam_id} متوقف شد -> {out_path}")


def start_recording(cam_id):
    with state_lock:
        if cam_id not in cameras:
            return False, "دوربین یافت نشد"
        if recording_active.get(cam_id, False):
            return False, "قبلاً در حال ضبط است"
        recording_active[cam_id] = True
        cam = cameras[cam_id]

    t = threading.Thread(
        target=record_camera,
        args=(cam_id, cam["rtsp"], cam["name"]),
        daemon=True,
    )
    t.start()
    with state_lock:
        recording_threads[cam_id] = t
    return True, None


def stop_recording(cam_id):
    with state_lock:
        if not recording_active.get(cam_id, False):
            return False, "در حال ضبط نیست"
        recording_active[cam_id] = False
        t = recording_threads.pop(cam_id, None)
    if t:
        t.join(timeout=3)
    return True, None


# ====================================================================
#                        استریم دوربین
# ====================================================================
def generate_frames(rtsp_url):
    cap = None
    backoff = 1.0
    try:
        while True:
            try:
                if cap is None or not cap.isOpened():
                    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
                    if cap.isOpened():
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
                        backoff = 1.0
                    else:
                        if cap:
                            cap.release()
                        cap = None
                        time.sleep(backoff)
                        backoff = min(backoff * 2, 10.0)
                        continue

                ret, frame = cap.read()
                if not ret:
                    if cap:
                        cap.release()
                    cap = None
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 10.0)
                    continue

                if frame.shape[1] != FRAME_WIDTH or frame.shape[0] != FRAME_HEIGHT:
                    frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))

                ok, buf = cv2.imencode(
                    ".jpg", frame,
                    [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                )
                if not ok:
                    continue
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                       + buf.tobytes() + b"\r\n")
            except GeneratorExit:
                break
            except Exception as e:
                log.warning(f"خطای استریم: {e}")
                if cap:
                    try:
                        cap.release()
                    except Exception:
                        pass
                cap = None
                time.sleep(backoff)
                backoff = min(backoff * 2, 10.0)
    finally:
        if cap:
            try:
                cap.release()
            except Exception:
                pass


def make_camera_app(cam_id, cam_name, rtsp_url, port):
    cam_app = Flask(f"camera_{cam_id}")
    cam_app.config["SECRET_KEY"] = secrets.token_hex(32)

    @cam_app.route("/")
    def stream():
        return Response(
            generate_frames(rtsp_url),
            mimetype="multipart/x-mixed-replace; boundary=frame",
        )

    @cam_app.route("/status")
    def status():
        return jsonify({"status": "online", "cam_id": cam_id, "port": port})

    return cam_app


def run_camera_server(cam_id, cam_name, rtsp_url, port):
    try:
        app = make_camera_app(cam_id, cam_name, rtsp_url, port)
        server = make_server("0.0.0.0", port, app, threaded=True)
        with state_lock:
            camera_servers[cam_id] = server
        log.info(f"🎥 دوربین {cam_id} روی پورت {port}")
        server.serve_forever()
    except OSError as e:
        log.error(f"❌ پورت {port} در دسترس نیست (دوربین {cam_id}): {e}")
    except Exception as e:
        log.exception(f"خطای سرور دوربین {cam_id}: {e}")
    finally:
        with state_lock:
            camera_servers.pop(cam_id, None)


def stop_camera_server(cam_id):
    with state_lock:
        server = camera_servers.pop(cam_id, None)
    if server:
        try:
            server.shutdown()
            time.sleep(0.2)
        except Exception as e:
            log.warning(f"خطا در توقف سرور دوربین {cam_id}: {e}")


# ====================================================================
#                    قالب پایه (CSS مشترک)
# ====================================================================
BASE_CSS = """
:root{
    --bg-1:#070b14;
    --bg-2:#0d1424;
    --card:rgba(20,30,50,.65);
    --card-solid:#141e32;
    --border:rgba(255,170,68,.18);
    --border-hover:rgba(255,170,68,.55);
    --accent:#ffaa44;
    --accent-2:#ff8800;
    --text:#e8eef7;
    --text-dim:#8fa0bb;
    --success:#22c55e;
    --danger:#ef4444;
    --warning:#f59e0b;
    --info:#3b82f6;
    --radius:14px;
    --shadow:0 8px 32px rgba(0,0,0,.45);
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{
    font-family:'Vazirmatn',Tahoma,system-ui,sans-serif;
    background:
        radial-gradient(ellipse at top left, rgba(255,170,68,.06), transparent 50%),
        radial-gradient(ellipse at bottom right, rgba(59,130,246,.06), transparent 50%),
        linear-gradient(135deg, var(--bg-1), var(--bg-2));
    background-attachment:fixed;
    color:var(--text);
    min-height:100vh;
    line-height:1.6;
    -webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none;transition:.2s}
a:hover{color:#ffcc77}
button{font-family:inherit;cursor:pointer;transition:.2s;border:none}
input,select{font-family:inherit}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,170,68,.3);border-radius:10px}
::-webkit-scrollbar-thumb:hover{background:rgba(255,170,68,.55)}

.glass{
    background:var(--card);
    backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);
    border:1px solid var(--border);
    border-radius:var(--radius);
}

.btn{
    display:inline-flex;align-items:center;gap:.4rem;
    padding:.55rem 1rem;border-radius:10px;
    font-weight:600;font-size:.85rem;
    background:linear-gradient(105deg,var(--accent),var(--accent-2));
    color:#0a0f1e;
    box-shadow:0 4px 14px rgba(255,170,68,.25);
}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(255,170,68,.4)}
.btn:active{transform:translateY(0)}
.btn-ghost{background:rgba(255,255,255,.06);color:var(--text);border:1px solid var(--border);box-shadow:none}
.btn-ghost:hover{background:rgba(255,255,255,.1);border-color:var(--border-hover)}
.btn-danger{background:linear-gradient(105deg,#ef4444,#dc2626);color:#fff;box-shadow:0 4px 14px rgba(239,68,68,.3)}
.btn-success{background:linear-gradient(105deg,#22c55e,#16a34a);color:#fff;box-shadow:0 4px 14px rgba(34,197,94,.3)}
.btn-info{background:linear-gradient(105deg,#3b82f6,#2563eb);color:#fff;box-shadow:0 4px 14px rgba(59,130,246,.3)}
.btn-warning{background:linear-gradient(105deg,#f59e0b,#d97706);color:#0a0f1e;box-shadow:0 4px 14px rgba(245,158,11,.3)}
.btn-icon{padding:.45rem;min-width:2rem;justify-content:center}

.badge{display:inline-block;padding:.15rem .55rem;border-radius:999px;font-size:.7rem;font-weight:600}
.badge-success{background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3)}
.badge-danger{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3)}
.badge-warning{background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.3)}

.toast{
    position:fixed;bottom:1.5rem;left:1.5rem;z-index:9999;
    display:flex;align-items:center;gap:.6rem;
    padding:.9rem 1.2rem;border-radius:12px;
    background:var(--card-solid);
    border:1px solid var(--border);
    box-shadow:var(--shadow);
    min-width:280px;max-width:400px;
    animation:slideIn .3s ease;
    font-size:.85rem;
}
.toast.success{border-color:rgba(34,197,94,.5)}
.toast.error{border-color:rgba(239,68,68,.5)}
.toast.info{border-color:rgba(59,130,246,.5)}
@keyframes slideIn{from{transform:translateX(-120%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes slideOut{to{transform:translateX(-120%);opacity:0}}

.spinner{
    width:18px;height:18px;border-radius:50%;
    border:2.5px solid rgba(255,170,68,.2);
    border-top-color:var(--accent);
    animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

.fade-in{animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
"""

FONT_LINK = """
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
"""

# ====================================================================
#                       HTML LOGIN
# ====================================================================
HTML_LOGIN = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ورود — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
body{display:flex;align-items:center;justify-content:center;padding:1.5rem}
.login-wrap{width:100%;max-width:420px;animation:fadeIn .5s ease}
.brand{text-align:center;margin-bottom:2rem}
.brand-icon{
    width:72px;height:72px;margin:0 auto 1rem;
    border-radius:20px;
    background:linear-gradient(135deg,var(--accent),var(--accent-2));
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 10px 40px rgba(255,170,68,.35);
}
.brand-icon svg{width:40px;height:40px}
.brand h1{
    font-size:1.4rem;font-weight:800;letter-spacing:-.02em;
    background:linear-gradient(135deg,#ffcc77,#ffaa44);
    -webkit-background-clip:text;background-clip:text;color:transparent;
}
.brand p{color:var(--text-dim);font-size:.85rem;margin-top:.3rem}
.login-box{padding:2rem;box-shadow:var(--shadow)}
.field{margin-bottom:1rem;position:relative}
.field label{
    display:block;font-size:.78rem;color:var(--text-dim);
    margin-bottom:.35rem;font-weight:600
}
.field input{
    width:100%;padding:.85rem 1rem;
    background:rgba(10,15,30,.7);
    border:1.5px solid var(--border);
    border-radius:10px;color:var(--text);
    font-size:.95rem;transition:.2s;
}
.field input:focus{
    outline:none;border-color:var(--accent);
    background:rgba(10,15,30,.95);
    box-shadow:0 0 0 3px rgba(255,170,68,.12);
}
.field input::placeholder{color:rgba(143,160,187,.5)}
.login-btn{width:100%;justify-content:center;margin-top:.6rem;padding:.85rem}
.error-msg{
    margin-top:1rem;padding:.75rem;
    background:rgba(239,68,68,.1);
    border:1px solid rgba(239,68,68,.3);
    border-radius:10px;
    color:#fca5a5;font-size:.83rem;text-align:center;
}
.footer-info{text-align:center;margin-top:2rem;color:var(--text-dim);font-size:.72rem;line-height:1.8}
</style></head><body>
<div class="login-wrap">
    <div class="brand">
        <div class="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0a0f1e" stroke-width="2.5" stroke-linecap="round">
                <path d="M23 7l-7 5 7 5V7z"/>
                <rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
        </div>
        <h1>سیستم نظارت پارس کم</h1>
        <p>لطفاً وارد حساب کاربری خود شوید</p>
    </div>
    <form class="login-box glass" method="POST" action="/login">
        <div class="field">
            <label>نام کاربری</label>
            <input type="text" name="username" placeholder="admin"
                   required autofocus autocomplete="username"
                   value="admin">
        </div>
        <div class="field">
            <label>رمز عبور</label>
            <input type="password" name="password" placeholder="••••••••"
                   required autocomplete="current-password">
        </div>
        <button type="submit" class="btn login-btn">ورود به سیستم</button>
        {% if error %}<div class="error-msg">{{ error }}</div>{% endif %}
    </form>
    <div class="footer-info">
        <div>📞 09372104444 &nbsp;|&nbsp; ✉️ info@iotcityhub.ir</div>
        <div>© 2025 نسل فردا — تمامی حقوق محفوظ است</div>
    </div>
</div></body></html>"""

# ====================================================================
#                       HTML CHANGE PASSWORD
# ====================================================================
HTML_CHANGE_PASSWORD = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تغییر رمز — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
body{display:flex;align-items:center;justify-content:center;padding:1.5rem}
.wrap{width:100%;max-width:440px}
.card{padding:2rem;box-shadow:var(--shadow)}
.card h2{
    font-size:1.2rem;font-weight:800;margin-bottom:1.5rem;text-align:center;
    background:linear-gradient(135deg,#ffcc77,#ffaa44);
    -webkit-background-clip:text;background-clip:text;color:transparent;
}
.warn-box{
    padding:.85rem 1rem;border-radius:10px;
    background:linear-gradient(105deg,rgba(245,158,11,.15),rgba(245,158,11,.05));
    border:1px solid rgba(245,158,11,.35);
    color:#fbbf24;font-size:.82rem;margin-bottom:1.2rem;text-align:center;
}
.field{margin-bottom:1rem}
.field label{display:block;font-size:.78rem;color:var(--text-dim);margin-bottom:.35rem;font-weight:600}
.field input{
    width:100%;padding:.85rem 1rem;
    background:rgba(10,15,30,.7);
    border:1.5px solid var(--border);
    border-radius:10px;color:var(--text);font-size:.95rem;
}
.field input:focus{
    outline:none;border-color:var(--accent);
    box-shadow:0 0 0 3px rgba(255,170,68,.12);
}
.error-msg{
    margin-top:1rem;padding:.75rem;border-radius:10px;
    background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);
    color:#fca5a5;font-size:.83rem;text-align:center;
}
.strength{height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:.4rem;overflow:hidden}
.strength-bar{height:100%;width:0;transition:.3s;background:var(--danger)}
.strength-text{font-size:.72rem;color:var(--text-dim);margin-top:.3rem}
</style></head><body>
<div class="wrap">
    <div class="card glass fade-in">
        <h2>🔑 تغییر رمز عبور</h2>
        {% if must_change %}
        <div class="warn-box">
            ⚠️ رمز فعلی شما پیش‌فرض (admin) است.<br>
            برای استفاده از سیستم، رمز جدید تعیین کنید.
        </div>
        {% endif %}
        <form method="POST" action="/change_password">
            <div class="field">
                <label>رمز فعلی</label>
                <input type="password" name="current" placeholder="••••••••" required autofocus>
            </div>
            <div class="field">
                <label>رمز جدید (حداقل 8 کاراکتر)</label>
                <input type="password" name="new1" id="new1" placeholder="••••••••"
                       required minlength="8" oninput="checkStrength(this.value)">
                <div class="strength"><div class="strength-bar" id="sBar"></div></div>
                <div class="strength-text" id="sText">قدرت رمز</div>
            </div>
            <div class="field">
                <label>تکرار رمز جدید</label>
                <input type="password" name="new2" placeholder="••••••••" required minlength="8">
            </div>
            <button type="submit" class="btn" style="width:100%;justify-content:center;padding:.85rem">
                ذخیره رمز جدید
            </button>
        </form>
        {% if error %}<div class="error-msg">{{ error }}</div>{% endif %}
    </div>
</div>
<script>
function checkStrength(v){
    const bar = document.getElementById('sBar');
    const txt = document.getElementById('sText');
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[A-Z]/.test(v)) score++;
    if (/[0-9]/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;
    const colors = ['#ef4444','#ef4444','#f59e0b','#eab308','#22c55e','#22c55e'];
    const labels = ['خیلی ضعیف','ضعیف','متوسط','خوب','قوی','عالی'];
    bar.style.width = (score*20)+'%';
    bar.style.background = colors[score];
    txt.innerText = labels[score];
}
</script></body></html>"""

# ====================================================================
#                       HTML DASHBOARD
# ====================================================================
HTML_MAIN = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>داشبورد — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
.container{max-width:1200px;margin:0 auto;padding:1.5rem}
.topbar{
    display:flex;justify-content:space-between;align-items:center;
    padding:1rem 1.5rem;margin-bottom:2rem;
    flex-wrap:wrap;gap:1rem;
}
.logo-area{display:flex;align-items:center;gap:.8rem}
.logo-icon{
    width:44px;height:44px;border-radius:12px;
    background:linear-gradient(135deg,var(--accent),var(--accent-2));
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 16px rgba(255,170,68,.3);
}
.logo-icon svg{width:24px;height:24px}
.logo-text h1{font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.logo-text p{font-size:.72rem;color:var(--text-dim)}
.top-actions{display:flex;gap:.5rem;align-items:center}
.hero{text-align:center;margin-bottom:2.5rem}
.hero h2{
    font-size:2rem;font-weight:900;letter-spacing:-.03em;margin-bottom:.5rem;
    background:linear-gradient(135deg,#fff,#ffcc77 60%,#ffaa44);
    -webkit-background-clip:text;background-clip:text;color:transparent;
}
.hero p{color:var(--text-dim);font-size:.95rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.2rem}
.nav-card{
    position:relative;overflow:hidden;
    padding:2rem 1.5rem;border-radius:var(--radius);
    background:var(--card);backdrop-filter:blur(16px);
    border:1px solid var(--border);
    text-decoration:none;color:var(--text);
    transition:.35s cubic-bezier(.4,0,.2,1);
    cursor:pointer;
}
.nav-card::before{
    content:'';position:absolute;inset:0;
    background:linear-gradient(135deg,rgba(255,170,68,.1),transparent);
    opacity:0;transition:.35s;
}
.nav-card:hover{transform:translateY(-6px);border-color:var(--border-hover);box-shadow:0 20px 50px rgba(255,170,68,.15)}
.nav-card:hover::before{opacity:1}
.nav-card .icon{
    position:relative;
    width:64px;height:64px;border-radius:16px;
    background:linear-gradient(135deg,rgba(255,170,68,.15),rgba(255,170,68,.05));
    border:1px solid var(--border);
    display:flex;align-items:center;justify-content:center;
    margin-bottom:1.2rem;
}
.nav-card .icon svg{width:32px;height:32px;stroke:var(--accent)}
.nav-card h3{position:relative;font-size:1.15rem;font-weight:800;margin-bottom:.4rem}
.nav-card p{position:relative;color:var(--text-dim);font-size:.85rem}
.footer{
    margin-top:3rem;padding:1.5rem;text-align:center;
    color:var(--text-dim);font-size:.75rem;line-height:1.9;
}
</style></head><body>
<div class="container">
    <div class="topbar glass">
        <div class="logo-area">
            <div class="logo-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#0a0f1e" stroke-width="2.5" stroke-linecap="round">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
            </div>
            <div class="logo-text">
                <h1>پارس کم</h1>
                <p>سیستم نظارت تصویری</p>
            </div>
        </div>
        <div class="top-actions">
            <a href="/change_password" class="btn btn-ghost">🔑 تغییر رمز</a>
            <a href="/logout" class="btn btn-danger">خروج</a>
        </div>
    </div>

    <div class="hero">
        <h2>داشبورد مدیریت</h2>
        <p>سرویس مورد نظر خود را انتخاب کنید</p>
    </div>

    <div class="cards">
        <a href="/monitor" class="nav-card">
            <div class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
            </div>
            <h3>نظارت و ضبط</h3>
            <p>مشاهده زنده، ضبط ویدیو، مدیریت دوربین‌ها و آلارم‌ها</p>
        </a>
        <a href="/scanner" class="nav-card">
            <div class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                </svg>
            </div>
            <h3>اسکنر RTSP</h3>
            <p>کشف خودکار دوربین‌های IP در شبکه</p>
        </a>
    </div>

    <div class="footer">
        <div>📞 09372104444 &nbsp;|&nbsp; ✉️ info@iotcityhub.ir</div>
        <div>© 2025 نسل فردا — تمامی حقوق محفوظ است</div>
    </div>
</div></body></html>"""

# ====================================================================
#                       HTML MONITOR
# ====================================================================
HTML_MONITOR = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>نظارت — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
.container{max-width:1600px;margin:0 auto;padding:1rem}
.topbar{
    display:flex;justify-content:space-between;align-items:center;
    padding:.85rem 1.2rem;margin-bottom:1.2rem;
    flex-wrap:wrap;gap:.7rem;position:sticky;top:1rem;z-index:100;
}
.topbar h1{font-size:1rem;font-weight:800;display:flex;align-items:center;gap:.5rem}
.topbar h1 svg{width:20px;height:20px;stroke:var(--accent)}
.top-actions{display:flex;gap:.4rem;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:1rem}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
.cam-card{
    background:var(--card);backdrop-filter:blur(16px);
    border:1px solid var(--border);
    border-radius:var(--radius);
    overflow:hidden;transition:.3s;
}
.cam-card:hover{border-color:var(--border-hover);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.cam-header{
    padding:.7rem 1rem;
    background:rgba(10,15,30,.6);
    display:flex;justify-content:space-between;align-items:center;
    border-bottom:1px solid var(--border);
}
.cam-title{font-size:.9rem;font-weight:700;display:flex;align-items:center;gap:.5rem}
.status-dot{
    width:8px;height:8px;border-radius:50%;
    background:var(--success);
    box-shadow:0 0 8px rgba(34,197,94,.7);
    animation:pulse 2s infinite;
}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.cam-controls{display:flex;gap:.3rem}
.cam-controls button{
    width:32px;height:32px;border-radius:8px;
    display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,.06);color:var(--text);
    border:1px solid transparent;
}
.cam-controls button:hover{background:rgba(255,255,255,.12);border-color:var(--border-hover)}
.cam-controls button.danger:hover{background:rgba(239,68,68,.15);color:#f87171}
.cam-stream-wrap{position:relative;background:#000;aspect-ratio:16/9;overflow:hidden}
.cam-stream{width:100%;height:100%;object-fit:contain;display:block}
.cam-offline{
    position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:.5rem;
    background:linear-gradient(135deg,#1a0a0a,#0a0a1a);color:#666;
}
.cam-offline svg{width:48px;height:48px;stroke:#444}
.cam-offline span{font-size:.8rem;color:#888}
.cam-footer{padding:.7rem;display:flex;gap:.5rem}
.cam-footer button{
    flex:1;padding:.5rem;border-radius:9px;
    font-size:.78rem;font-weight:700;
    display:flex;align-items:center;justify-content:center;gap:.4rem;
    border:none;
}
.rec-btn{background:linear-gradient(105deg,#ef4444,#dc2626);color:#fff;box-shadow:0 3px 12px rgba(239,68,68,.3)}
.rec-btn.recording{background:linear-gradient(105deg,#f59e0b,#d97706);color:#0a0f1e;animation:pulseBtn 1.5s infinite}
@keyframes pulseBtn{0%,100%{box-shadow:0 3px 12px rgba(245,158,11,.4)}50%{box-shadow:0 3px 20px rgba(245,158,11,.8)}}
.alarm-btn{background:linear-gradient(105deg,#f59e0b,#d97706);color:#0a0f1e;box-shadow:0 3px 12px rgba(245,158,11,.3)}
.snapshot-btn{background:rgba(59,130,246,.2);color:#60a5fa;border:1px solid rgba(59,130,246,.3)!important;flex:0 0 auto;min-width:44px}
.modal{
    display:none;position:fixed;inset:0;z-index:1000;
    background:rgba(0,0,0,.75);backdrop-filter:blur(6px);
    align-items:center;justify-content:center;padding:1rem;
    animation:fadeIn .2s ease;
}
.modal.open{display:flex}
.modal-content{
    background:var(--card-solid);
    border:1px solid var(--border);
    border-radius:var(--radius);
    padding:1.5rem;width:100%;max-width:440px;
    box-shadow:var(--shadow);
    animation:pop .25s ease;
}
@keyframes pop{from{transform:scale(.95);opacity:0}to{transform:scale(1);opacity:1}}
.modal-content h3{font-size:1.05rem;font-weight:800;margin-bottom:1rem;color:var(--accent)}
.modal-content .field{margin-bottom:.9rem}
.modal-content label{display:block;font-size:.78rem;color:var(--text-dim);margin-bottom:.3rem;font-weight:600}
.modal-content input{
    width:100%;padding:.7rem .9rem;border-radius:9px;
    background:rgba(10,15,30,.8);border:1.5px solid var(--border);
    color:var(--text);font-size:.9rem;
}
.modal-content input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(255,170,68,.12)}
.modal-actions{display:flex;gap:.5rem;margin-top:1.2rem}
.modal-actions button{flex:1;justify-content:center}
.empty{
    text-align:center;padding:4rem 1rem;color:var(--text-dim);
    grid-column:1/-1;
}
.empty svg{width:80px;height:80px;stroke:#2a3a55;margin-bottom:1rem}
.empty h3{font-size:1.1rem;color:var(--text);margin-bottom:.5rem}
</style></head><body>
<div class="container">
    <div class="topbar glass">
        <h1>
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round">
                <path d="M23 7l-7 5 7 5V7z"/>
                <rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            نظارت زنده
        </h1>
        <div class="top-actions">
            <a href="/recordings" class="btn btn-ghost">📀 ضبط‌ها</a>
            <a href="/alarms" class="btn btn-ghost">🚨 هشدارها</a>
            <a href="/" class="btn btn-ghost">🏠</a>
            <button class="btn btn-success" onclick="openAddModal()">➕ افزودن</button>
        </div>
    </div>
    <div class="grid" id="grid"></div>
</div>

<div id="modal" class="modal">
    <div class="modal-content">
        <h3 id="modalTitle">افزودن دوربین جدید</h3>
        <div class="field">
            <label>نام دوربین</label>
            <input type="text" id="camName" placeholder="مثال: دوربین ورودی اصلی" maxlength="100">
        </div>
        <div class="field">
            <label>آدرس RTSP</label>
            <input type="text" id="camRtsp" placeholder="rtsp://..." dir="ltr" maxlength="500">
        </div>
        <input type="hidden" id="editId">
        <div class="modal-actions">
            <button class="btn btn-ghost" onclick="closeModal()">انصراف</button>
            <button class="btn" onclick="saveCamera()">💾 ذخیره</button>
        </div>
    </div>
</div>

<script>
const START_PORT = {{ start_port }};
const CSRF = "{{ csrf }}";
let camerasData = {};
let recordingState = {};

function h(v){
    return String(v??'').replace(/[&<>"']/g, c => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
}
function toast(msg, type='info'){
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span>${type==='success'?'✅':type==='error'?'❌':'ℹ️'}</span><span>${h(msg)}</span>`;
    document.body.appendChild(el);
    setTimeout(()=>{
        el.style.animation = 'slideOut .3s ease forwards';
        setTimeout(()=>el.remove(), 300);
    }, 3500);
}
async function apiFetch(url, opts={}){
    opts.headers = opts.headers || {};
    opts.headers['X-CSRF-Token'] = CSRF;
    if (opts.body && typeof opts.body === 'object'){
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, opts);
    if (r.status === 401){ location.href = '/login'; throw new Error('unauth'); }
    if (r.status === 403){
        const j = await r.json().catch(()=>({}));
        if (j.error === 'must_change_password') location.href = '/change_password';
        throw new Error(j.error || 'forbidden');
    }
    return r;
}
async function loadStatus(){
    try{
        const r = await fetch('/api/record/status');
        if (r.ok) recordingState = await r.json();
    }catch(e){}
}
async function loadCameras(){
    await loadStatus();
    const r = await apiFetch('/api/cameras');
    camerasData = await r.json();
    const grid = document.getElementById('grid');
    const ids = Object.keys(camerasData);
    if (!ids.length){
        grid.innerHTML = `
            <div class="empty">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
                <h3>هیچ دوربینی تعریف نشده</h3>
                <p>برای شروع، دکمه افزودن را بزنید</p>
            </div>`;
        return;
    }
    grid.innerHTML = '';
    for (const id of ids){
        const cam = camerasData[id];
        const port = START_PORT + parseInt(id) - 1;
        const isRec = !!recordingState[String(id)];
        const card = document.createElement('div');
        card.className = 'cam-card fade-in';
        card.innerHTML = `
            <div class="cam-header">
                <div class="cam-title">
                    <span class="status-dot"></span>
                    ${h(cam.name)}
                </div>
                <div class="cam-controls">
                    <button title="ویرایش" onclick="editCamera(${id})">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>
                        </svg>
                    </button>
                    <button class="danger" title="حذف" onclick="deleteCamera(${id})">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="cam-stream-wrap">
                <img src="http://${location.hostname}:${port}/" class="cam-stream"
                     alt="live" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                     onload="this.style.display='block';this.nextElementSibling.style.display='none'">
                <div class="cam-offline" style="display:none">
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round">
                        <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
                        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
                        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
                        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                        <line x1="12" y1="20" x2="12.01" y2="20"/>
                    </svg>
                    <span>قطع ارتباط با دوربین</span>
                </div>
            </div>
            <div class="cam-footer">
                <button class="rec-btn ${isRec?'recording':''}" onclick="toggleRecording(${id})">
                    ${isRec?'⏹ توقف ضبط':'● شروع ضبط'}
                </button>
                <button class="snapshot-btn" title="اسنپ‌شات" onclick="snapshot(${id},${port})">📷</button>
                <button class="alarm-btn" onclick="triggerAlarm(${id})">🚨 آلارم</button>
            </div>`;
        grid.appendChild(card);
    }
}
async function toggleRecording(camId){
    const isActive = !!recordingState[String(camId)];
    const url = isActive ? '/api/record/stop' : '/api/record/start';
    try{
        const r = await apiFetch(url, {method:'POST', body:{cam_id: camId}});
        if (r.ok){
            toast(isActive?'ضبط متوقف شد':'ضبط شروع شد', 'success');
            await loadCameras();
        } else {
            const j = await r.json().catch(()=>({}));
            toast(j.error || 'خطا', 'error');
        }
    }catch(e){ toast('خطا: '+e.message, 'error'); }
}
async function triggerAlarm(camId){
    const cam = camerasData[camId];
    if (!cam) return;
    try{
        const r = await apiFetch('/api/alarm', {method:'POST', body:{cam_id: camId, cam_name: cam.name}});
        toast(r.ok ? 'آلارم ثبت شد' : 'خطا در ثبت', r.ok?'success':'error');
    }catch(e){ toast('خطا: '+e.message, 'error'); }
}
function snapshot(camId, port){
    const img = document.querySelectorAll('.cam-stream')[Object.keys(camerasData).indexOf(String(camId))];
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    canvas.toBlob(b => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snapshot_cam${camId}_${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        toast('اسنپ‌شات ذخیره شد', 'success');
    }, 'image/jpeg', 0.9);
}
function openAddModal(){
    document.getElementById('modalTitle').innerText = 'افزودن دوربین جدید';
    document.getElementById('editId').value = '';
    document.getElementById('camName').value = '';
    document.getElementById('camRtsp').value = '';
    document.getElementById('modal').classList.add('open');
}
function editCamera(id){
    const cam = camerasData[id];
    if (!cam) return;
    document.getElementById('modalTitle').innerText = 'ویرایش دوربین';
    document.getElementById('editId').value = id;
    document.getElementById('camName').value = cam.name;
    document.getElementById('camRtsp').value = cam.rtsp;
    document.getElementById('modal').classList.add('open');
}
function closeModal(){ document.getElementById('modal').classList.remove('open'); }
async function saveCamera(){
    const id = document.getElementById('editId').value;
    const data = {
        name: document.getElementById('camName').value.trim(),
        rtsp: document.getElementById('camRtsp').value.trim()
    };
    if (!data.name || !data.rtsp){ toast('همه فیلدها لازم است', 'error'); return; }
    let url = '/api/cameras', method = 'POST';
    if (id){ data.id = parseInt(id); method = 'PUT'; }
    try{
        const r = await apiFetch(url, {method, body:data});
        if (r.ok){ closeModal(); toast('ذخیره شد', 'success'); loadCameras(); }
        else { const j = await r.json().catch(()=>({})); toast(j.error||'خطا', 'error'); }
    }catch(e){ toast('خطا: '+e.message, 'error'); }
}
async function deleteCamera(id){
    if (!confirm('آیا از حذف این دوربین اطمینان دارید؟')) return;
    try{
        const r = await apiFetch(`/api/cameras?id=${id}`, {method:'DELETE'});
        if (r.ok){ toast('حذف شد', 'success'); loadCameras(); }
    }catch(e){ toast('خطا: '+e.message, 'error'); }
}
document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
loadCameras();
setInterval(loadStatus, 5000);
</script></body></html>"""

# ====================================================================
#                       HTML RECORDINGS
# ====================================================================
HTML_RECORDINGS = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ضبط‌ها — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
.container{max-width:1400px;margin:0 auto;padding:1rem}
.topbar{
    display:flex;justify-content:space-between;align-items:center;
    padding:.85rem 1.2rem;margin-bottom:1.2rem;
    flex-wrap:wrap;gap:.7rem;
}
.topbar h2{font-size:1rem;font-weight:800;display:flex;align-items:center;gap:.5rem}
.toolbar{
    display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;
    padding:1rem;margin-bottom:1rem;
}
.search-box{position:relative;flex:1;min-width:220px}
.search-box input{
    width:100%;padding:.7rem 2.5rem .7rem 1rem;
    background:rgba(10,15,30,.7);
    border:1.5px solid var(--border);border-radius:10px;
    color:var(--text);font-size:.88rem;
}
.search-box input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(255,170,68,.12)}
.search-box svg{
    position:absolute;right:.9rem;top:50%;transform:translateY(-50%);
    width:18px;height:18px;stroke:var(--text-dim);
}
.filter-select{
    padding:.7rem 1rem;background:rgba(10,15,30,.7);
    border:1.5px solid var(--border);border-radius:10px;
    color:var(--text);font-size:.85rem;font-weight:600;
}
.view-toggle{display:flex;background:rgba(10,15,30,.7);border:1.5px solid var(--border);border-radius:10px;overflow:hidden}
.view-toggle button{
    padding:.6rem .9rem;background:transparent;color:var(--text-dim);
    display:flex;align-items:center;justify-content:center;
}
.view-toggle button.active{background:linear-gradient(105deg,var(--accent),var(--accent-2));color:#0a0f1e}
.view-toggle svg{width:16px;height:16px}

.grid-view{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:1rem}
.video-card{
    background:var(--card);backdrop-filter:blur(16px);
    border:1px solid var(--border);border-radius:var(--radius);
    overflow:hidden;transition:.3s;cursor:pointer;
}
.video-card:hover{transform:translateY(-4px);border-color:var(--border-hover);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.thumb{
    position:relative;background:#000;aspect-ratio:16/9;
    display:flex;align-items:center;justify-content:center;overflow:hidden;
}
.thumb video{width:100%;height:100%;object-fit:cover}
.thumb-overlay{
    position:absolute;inset:0;
    background:linear-gradient(to top,rgba(0,0,0,.85),transparent 60%);
    display:flex;align-items:flex-end;padding:.8rem;
    opacity:0;transition:.3s;
}
.video-card:hover .thumb-overlay{opacity:1}
.play-icon{
    position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(.7);
    width:56px;height:56px;border-radius:50%;
    background:rgba(255,170,68,.95);
    display:flex;align-items:center;justify-content:center;
    opacity:0;transition:.3s;box-shadow:0 8px 24px rgba(0,0,0,.5);
}
.video-card:hover .play-icon{opacity:1;transform:translate(-50%,-50%) scale(1)}
.play-icon svg{width:22px;height:22px;fill:#0a0f1e;margin-right:-2px}
.video-info{padding:.85rem}
.video-info h4{font-size:.85rem;font-weight:700;margin-bottom:.35rem;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.video-meta{display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-dim)}
.video-meta span{display:flex;align-items:center;gap:.25rem}

.list-view{display:flex;flex-direction:column;gap:.5rem}
.list-row{
    display:flex;align-items:center;gap:1rem;padding:.9rem 1.1rem;
    background:var(--card);backdrop-filter:blur(16px);
    border:1px solid var(--border);border-radius:10px;
    transition:.2s;cursor:pointer;
}
.list-row:hover{border-color:var(--border-hover);background:rgba(20,30,50,.9)}
.list-row .thumb-sm{
    width:100px;height:60px;border-radius:8px;background:#000;
    display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;
}
.list-row .thumb-sm svg{width:28px;height:28px;fill:var(--accent)}
.list-info{flex:1;min-width:0}
.list-info h4{font-size:.88rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list-info .meta{font-size:.75rem;color:var(--text-dim);margin-top:.25rem}
.list-actions{display:flex;gap:.4rem}

.player-modal{
    display:none;position:fixed;inset:0;z-index:2000;
    background:rgba(0,0,0,.92);backdrop-filter:blur(10px);
    align-items:center;justify-content:center;padding:1rem;
    animation:fadeIn .25s ease;
}
.player-modal.open{display:flex}
.player-content{
    width:100%;max-width:1100px;
    background:var(--card-solid);border:1px solid var(--border);
    border-radius:var(--radius);overflow:hidden;
    box-shadow:0 20px 60px rgba(0,0,0,.6);
}
.player-header{
    display:flex;justify-content:space-between;align-items:center;
    padding:1rem 1.2rem;border-bottom:1px solid var(--border);
}
.player-header h3{font-size:.95rem;font-weight:800}
.player-close{
    width:36px;height:36px;border-radius:9px;
    background:rgba(255,255,255,.06);color:var(--text);
    display:flex;align-items:center;justify-content:center;font-size:1.3rem;
}
.player-close:hover{background:rgba(239,68,68,.15);color:#f87171}
.player-content video{width:100%;max-height:75vh;background:#000;display:block}
.player-info{padding:1rem 1.2rem;display:flex;justify-content:space-between;font-size:.82rem;color:var(--text-dim)}

.empty{
    text-align:center;padding:5rem 1rem;color:var(--text-dim);
}
.empty svg{width:96px;height:96px;stroke:#2a3a55;margin-bottom:1rem}
.empty h3{font-size:1.1rem;color:var(--text);margin-bottom:.5rem}
.stat-bar{
    display:flex;gap:1rem;flex-wrap:wrap;
    padding:1rem;margin-bottom:1rem;font-size:.85rem;
}
.stat-item{display:flex;align-items:center;gap:.5rem}
.stat-item strong{color:var(--accent);font-weight:800}
</style></head><body>
<div class="container">
    <div class="topbar glass">
        <h2>📀 آرشیو ضبط‌ها</h2>
        <a href="/monitor" class="btn btn-ghost">← بازگشت به نظارت</a>
    </div>

    <div class="toolbar glass">
        <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" id="searchInput" placeholder="جستجو در نام دوربین یا تاریخ...">
        </div>
        <select class="filter-select" id="camFilter">
            <option value="">همه دوربین‌ها</option>
        </select>
        <select class="filter-select" id="sortFilter">
            <option value="date-desc">جدیدترین</option>
            <option value="date-asc">قدیمی‌ترین</option>
            <option value="size-desc">بزرگ‌ترین</option>
            <option value="size-asc">کوچک‌ترین</option>
        </select>
        <div class="view-toggle">
            <button class="active" onclick="setView('grid', this)" title="گرید">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
            </button>
            <button onclick="setView('list', this)" title="لیست">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                    <line x1="8" y1="18" x2="21" y2="18"/>
                    <circle cx="3.5" cy="6" r="1.5" fill="currentColor"/>
                    <circle cx="3.5" cy="12" r="1.5" fill="currentColor"/>
                    <circle cx="3.5" cy="18" r="1.5" fill="currentColor"/>
                </svg>
            </button>
        </div>
    </div>

    <div class="stat-bar glass">
        <div class="stat-item">🎬 <span>تعداد:</span> <strong id="statCount">0</strong></div>
        <div class="stat-item">💾 <span>حجم کل:</span> <strong id="statSize">0 MB</strong></div>
    </div>

    <div id="content"></div>
</div>

<div id="playerModal" class="player-modal">
    <div class="player-content">
        <div class="player-header">
            <h3 id="playerTitle">پخش ویدیو</h3>
            <button class="player-close" onclick="closePlayer()">✕</button>
        </div>
        <video id="playerVideo" controls preload="metadata"></video>
        <div class="player-info">
            <span id="playerCam"></span>
            <span id="playerSize"></span>
        </div>
    </div>
</div>

<script>
let allData = [];
let currentView = 'grid';

function h(v){
    return String(v??'').replace(/[&<>"']/g, c => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
}
function fmtSize(b){
    if (b > 1073741824) return (b/1073741824).toFixed(2)+' GB';
    if (b > 1048576) return (b/1048576).toFixed(2)+' MB';
    return (b/1024).toFixed(1)+' KB';
}
async function load(){
    const r = await fetch('/api/recordings/list');
    allData = await r.json();
    const camFilter = document.getElementById('camFilter');
    const cams = [...new Set(allData.map(d => d.cam_name))];
    camFilter.innerHTML = '<option value="">همه دوربین‌ها</option>' +
        cams.map(c => `<option value="${h(c)}">${h(c)}</option>`).join('');
    applyFilters();
}
function applyFilters(){
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    const cam = document.getElementById('camFilter').value;
    const sort = document.getElementById('sortFilter').value;

    let filtered = allData.filter(d => {
        if (cam && d.cam_name !== cam) return false;
        if (q && !(`${d.cam_name} ${d.date}`.toLowerCase().includes(q))) return false;
        return true;
    });

    filtered.sort((a,b) => {
        if (sort === 'date-desc') return b.date.localeCompare(a.date);
        if (sort === 'date-asc')  return a.date.localeCompare(b.date);
        if (sort === 'size-desc') return b.size - a.size;
        if (sort === 'size-asc')  return a.size - b.size;
        return 0;
    });

    const totalSize = filtered.reduce((s,d) => s + d.size, 0);
    document.getElementById('statCount').innerText = filtered.length;
    document.getElementById('statSize').innerText = fmtSize(totalSize);

    render(filtered);
}
function render(data){
    const c = document.getElementById('content');
    if (!data.length){
        c.innerHTML = `
            <div class="empty">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
                <h3>هیچ ضبطی یافت نشد</h3>
                <p>پس از شروع ضبط، فایل‌ها اینجا نمایش داده می‌شوند</p>
            </div>`;
        return;
    }
    if (currentView === 'grid'){
        c.innerHTML = '<div class="grid-view">' + data.map(item => {
            const url = `/recordings/file?cam=${encodeURIComponent(item.cam_name)}&file=${encodeURIComponent(item.filename)}`;
            return `
                <div class="video-card fade-in" onclick="playVideo('${h(item.cam_name).replace(/'/g,"\\'")}','${h(item.filename).replace(/'/g,"\\'")}','${url}',${item.size})">
                    <div class="thumb">
                        <video preload="metadata" muted>
                            <source src="${url}#t=1" type="video/mp4">
                        </video>
                        <div class="thumb-overlay"></div>
                        <div class="play-icon">
                            <svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>
                        </div>
                    </div>
                    <div class="video-info">
                        <h4>${h(item.cam_name)}</h4>
                        <div class="video-meta">
                            <span>🕒 ${h(item.date)}</span>
                            <span>💾 ${fmtSize(item.size)}</span>
                        </div>
                    </div>
                </div>`;
        }).join('') + '</div>';
    } else {
        c.innerHTML = '<div class="list-view">' + data.map(item => {
            const url = `/recordings/file?cam=${encodeURIComponent(item.cam_name)}&file=${encodeURIComponent(item.filename)}`;
            return `
                <div class="list-row fade-in" onclick="playVideo('${h(item.cam_name).replace(/'/g,"\\'")}','${h(item.filename).replace(/'/g,"\\'")}','${url}',${item.size})">
                    <div class="thumb-sm">
                        <svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>
                    </div>
                    <div class="list-info">
                        <h4>${h(item.cam_name)}</h4>
                        <div class="meta">🕒 ${h(item.date)} &nbsp;•&nbsp; 💾 ${fmtSize(item.size)}</div>
                    </div>
                </div>`;
        }).join('') + '</div>';
    }
}
function playVideo(cam, file, url, size){
    document.getElementById('playerTitle').innerText = file;
    document.getElementById('playerCam').innerText = '📹 ' + cam;
    document.getElementById('playerSize').innerText = '💾 ' + fmtSize(size);
    const v = document.getElementById('playerVideo');
    v.src = url;
    v.play().catch(()=>{});
    document.getElementById('playerModal').classList.add('open');
}
function closePlayer(){
    const v = document.getElementById('playerVideo');
    v.pause(); v.src = '';
    document.getElementById('playerModal').classList.remove('open');
}
function setView(v, btn){
    currentView = v;
    document.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
}
document.getElementById('searchInput').addEventListener('input', applyFilters);
document.getElementById('camFilter').addEventListener('change', applyFilters);
document.getElementById('sortFilter').addEventListener('change', applyFilters);
document.getElementById('playerModal').addEventListener('click', e => {
    if (e.target.id === 'playerModal') closePlayer();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayer(); });
load();
</script></body></html>"""

# ====================================================================
#                       HTML ALARMS
# ====================================================================
HTML_ALARMS = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>هشدارها — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
.container{max-width:1000px;margin:0 auto;padding:1rem}
.topbar{
    display:flex;justify-content:space-between;align-items:center;
    padding:.85rem 1.2rem;margin-bottom:1.2rem;
    flex-wrap:wrap;gap:.7rem;
}
.topbar h2{font-size:1rem;font-weight:800;display:flex;align-items:center;gap:.5rem}
.toolbar{
    padding:1rem;margin-bottom:1rem;display:flex;gap:.6rem;
    flex-wrap:wrap;align-items:center;
}
.search-box{position:relative;flex:1;min-width:220px}
.search-box input{
    width:100%;padding:.7rem 2.5rem .7rem 1rem;
    background:rgba(10,15,30,.7);
    border:1.5px solid var(--border);border-radius:10px;
    color:var(--text);font-size:.88rem;
}
.search-box input:focus{outline:none;border-color:var(--accent)}
.search-box svg{
    position:absolute;right:.9rem;top:50%;transform:translateY(-50%);
    width:18px;height:18px;stroke:var(--text-dim);
}
.alarm-list{display:flex;flex-direction:column;gap:.7rem}
.alarm-item{
    display:flex;align-items:flex-start;gap:1rem;
    padding:1rem 1.2rem;border-radius:12px;
    background:var(--card);backdrop-filter:blur(16px);
    border:1px solid var(--border);
    transition:.2s;animation:fadeIn .3s ease;
}
.alarm-item:hover{border-color:var(--border-hover)}
.alarm-icon{
    width:44px;height:44px;flex-shrink:0;border-radius:11px;
    background:linear-gradient(135deg,rgba(239,68,68,.2),rgba(239,68,68,.05));
    border:1px solid rgba(239,68,68,.35);
    display:flex;align-items:center;justify-content:center;
}
.alarm-icon svg{width:22px;height:22px;stroke:#f87171;fill:none;stroke-width:2}
.alarm-body{flex:1;min-width:0}
.alarm-title{font-weight:700;font-size:.92rem;margin-bottom:.25rem}
.alarm-meta{display:flex;gap:1rem;font-size:.76rem;color:var(--text-dim);flex-wrap:wrap}
.alarm-meta span{display:flex;align-items:center;gap:.3rem}
.alarm-reason{
    display:inline-block;margin-top:.5rem;padding:.2rem .6rem;
    background:rgba(245,158,11,.1);color:#fbbf24;
    border-radius:6px;font-size:.72rem;border:1px solid rgba(245,158,11,.25);
}
.empty{
    text-align:center;padding:5rem 1rem;color:var(--text-dim);
}
.empty svg{width:96px;height:96px;stroke:#2a3a55;margin-bottom:1rem}
.empty h3{font-size:1.1rem;color:var(--text);margin-bottom:.5rem}
</style></head><body>
<div class="container">
    <div class="topbar glass">
        <h2>🚨 لاگ هشدارها</h2>
        <div style="display:flex;gap:.5rem">
            <button class="btn btn-danger" onclick="clearAll()">🗑 پاک کردن همه</button>
            <a href="/monitor" class="btn btn-ghost">← بازگشت</a>
        </div>
    </div>
    <div class="toolbar glass">
        <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" id="searchInput" placeholder="جستجو در هشدارها...">
        </div>
    </div>
    <div id="content"></div>
</div>
<script>
const CSRF = "{{ csrf }}";
let allData = [];
function h(v){
    return String(v??'').replace(/[&<>"']/g, c => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
}
async function load(){
    const r = await fetch('/api/alarms');
    allData = await r.json();
    render();
}
function render(){
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    const data = allData.filter(a => !q ||
        `${a.cam_name} ${a.reason} ${a.time}`.toLowerCase().includes(q));
    const c = document.getElementById('content');
    if (!data.length){
        c.innerHTML = `
            <div class="empty">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <h3>هیچ هشداری ثبت نشده</h3>
                <p>هنگام فعال شدن آلارم، اینجا نمایش داده می‌شود</p>
            </div>`;
        return;
    }
    c.innerHTML = '<div class="alarm-list">' + data.map(a => `
        <div class="alarm-item">
            <div class="alarm-icon">
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
            </div>
            <div class="alarm-body">
                <div class="alarm-title">${h(a.cam_name)}</div>
                <div class="alarm-meta">
                    <span>🕒 ${h(a.time)}</span>
                    <span>#${h(a.id)}</span>
                </div>
                <div class="alarm-reason">${h(a.reason)}</div>
            </div>
        </div>
    `).join('') + '</div>';
}
async function clearAll(){
    if (!confirm('همه هشدارها حذف شوند؟')) return;
    const r = await fetch('/api/alarms/clear', {
        method:'DELETE', headers:{'X-CSRF-Token': CSRF}
    });
    if (r.ok) load();
}
document.getElementById('searchInput').addEventListener('input', render);
load();
</script></body></html>"""

# ====================================================================
#                       HTML SCANNER
# ====================================================================
HTML_SCANNER = """<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>اسکنر RTSP — پارس کم</title>
""" + FONT_LINK + """
<style>""" + BASE_CSS + """
.container{max-width:1000px;margin:0 auto;padding:1rem}
.topbar{
    display:flex;justify-content:space-between;align-items:center;
    padding:.85rem 1.2rem;margin-bottom:1.2rem;
    flex-wrap:wrap;gap:.7rem;
}
.topbar h2{font-size:1rem;font-weight:800;display:flex;align-items:center;gap:.5rem}
.card{padding:1.5rem;margin-bottom:1rem}
.card h3{font-size:.95rem;font-weight:800;margin-bottom:1rem;color:var(--accent)}
.form-row{display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem}
.field{flex:1;min-width:150px}
.field label{display:block;font-size:.78rem;color:var(--text-dim);margin-bottom:.3rem;font-weight:600}
.field input{
    width:100%;padding:.7rem .9rem;border-radius:10px;
    background:rgba(10,15,30,.7);
    border:1.5px solid var(--border);color:var(--text);font-size:.88rem;
}
.field input:focus{outline:none;border-color:var(--accent)}
.progress-box{
    display:none;align-items:center;gap:.7rem;padding:1rem;
    background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);
    border-radius:10px;margin-top:1rem;font-size:.85rem;color:#60a5fa;
}
.progress-box.active{display:flex}
.result-item{
    padding:1rem;margin-bottom:.6rem;
    background:rgba(10,15,30,.5);
    border:1px solid var(--border);border-radius:10px;
    display:flex;justify-content:space-between;align-items:center;
    gap:1rem;flex-wrap:wrap;animation:fadeIn .3s ease;
}
.result-item:hover{border-color:var(--border-hover)}
.result-info{flex:1;min-width:0}
.result-info strong{display:block;font-size:.9rem;margin-bottom:.3rem}
.result-info code{
    display:block;font-size:.72rem;color:var(--text-dim);
    font-family:monospace;direction:ltr;text-align:left;
    word-break:break-all;
}
.result-empty{
    text-align:center;padding:3rem 1rem;color:var(--text-dim);
}
</style></head><body>
<div class="container">
    <div class="topbar glass">
        <h2>🔍 اسکنر شبکه RTSP</h2>
        <a href="/" class="btn btn-ghost">← بازگشت</a>
    </div>

    <div class="card glass">
        <h3>تنظیمات اسکن</h3>
        <div class="form-row">
            <div class="field">
                <label>از IP</label>
                <input type="text" id="startIp" value="192.168.1.1" dir="ltr">
            </div>
            <div class="field">
                <label>تا IP</label>
                <input type="text" id="endIp" value="192.168.1.50" dir="ltr">
            </div>
            <div class="field">
                <label>پورت</label>
                <input type="text" id="port" value="554" dir="ltr">
            </div>
        </div>
        <div class="field" style="margin-bottom:1rem">
            <label>مسیرهای RTSP (با کاما جدا کنید)</label>
            <input type="text" id="paths" dir="ltr"
                   value="/streaming/channels/1,/unicast/c1/s0/live,/live/ch0">
        </div>
        <button class="btn" onclick="startScan()" id="scanBtn">🚀 شروع اسکن</button>
        <div id="progressBox" class="progress-box">
            <div class="spinner"></div>
            <span>در حال اسکن شبکه... لطفاً صبر کنید</span>
        </div>
    </div>

    <div class="card glass">
        <h3>نتایج (<span id="resultCount">0</span>)</h3>
        <div id="results">
            <div class="result-empty">هنوز اسکنی انجام نشده است</div>
        </div>
    </div>
</div>
<script>
const CSRF = "{{ csrf }}";
function h(v){
    return String(v??'').replace(/[&<>"']/g, c => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
}
async function startScan(){
    const startIp = document.getElementById('startIp').value.trim();
    const endIp = document.getElementById('endIp').value.trim();
    const port = parseInt(document.getElementById('port').value) || 554;
    const paths = document.getElementById('paths').value.split(',')
                  .map(p => p.trim()).filter(Boolean);

    document.getElementById('progressBox').classList.add('active');
    document.getElementById('scanBtn').disabled = true;
    document.getElementById('results').innerHTML = '';

    try{
        const r = await fetch('/api/scan', {
            method:'POST',
            headers:{'Content-Type':'application/json','X-CSRF-Token':CSRF},
            body: JSON.stringify({start_ip:startIp, end_ip:endIp, port, paths})
        });
        const data = await r.json();
        if (data.error){
            document.getElementById('results').innerHTML =
                `<div class="result-empty">❌ ${h(data.error)}</div>`;
            return;
        }
        document.getElementById('resultCount').innerText = data.length;
        if (!data.length){
            document.getElementById('results').innerHTML =
                '<div class="result-empty">هیچ دوربینی یافت نشد</div>';
            return;
        }
        document.getElementById('results').innerHTML = data.map((cam,i) => `
            <div class="result-item">
                <div class="result-info">
                    <strong>${h(cam.name)}</strong>
                    <code>${h(cam.rtsp)}</code>
                </div>
                <button class="btn btn-success"
                    onclick="addCam('${h(cam.name).replace(/'/g,"\\'")}','${h(cam.rtsp).replace(/'/g,"\\'")}',this)">
                    ➕ افزودن
                </button>
            </div>
        `).join('');
    }catch(e){
        document.getElementById('results').innerHTML =
            `<div class="result-empty">❌ خطا: ${h(e.message)}</div>`;
    }finally{
        document.getElementById('progressBox').classList.remove('active');
        document.getElementById('scanBtn').disabled = false;
    }
}
async function addCam(name, rtsp, btn){
    btn.disabled = true;
    btn.innerText = '...';
    try{
        const r = await fetch('/api/cameras', {
            method:'POST',
            headers:{'Content-Type':'application/json','X-CSRF-Token':CSRF},
            body: JSON.stringify({name, rtsp})
        });
        if (r.ok){
            btn.classList.remove('btn-success');
            btn.classList.add('btn-ghost');
            btn.innerText = '✓ اضافه شد';
        } else {
            btn.innerText = 'خطا';
            btn.disabled = false;
        }
    }catch(e){
        btn.innerText = 'خطا';
        btn.disabled = false;
    }
}
</script></body></html>"""


# ====================================================================
#                       اپلیکیشن اصلی
# ====================================================================
main_app = Flask(__name__)
main_app.config.update(
    SECRET_KEY=secrets.token_hex(64),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=False,        # برای HTTPS روی True بگذارید
    PERMANENT_SESSION_LIFETIME=SESSION_LIFETIME,
    MAX_CONTENT_LENGTH=1 * 1024 * 1024,
    JSON_SORT_KEYS=False,
)


@main_app.after_request
def security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = (
        "geolocation=(), microphone=(), camera=(), payment=()"
    )
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["X-XSS-Protection"] = "1; mode=block"
    resp.headers["Server"] = "parscam"
    resp.headers.pop("X-Powered-By", None)

    # CORS برای رابط Next.js روی پورت ۳۰۰۰
    origin = request.headers.get("Origin", "")
    if origin in (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, X-CSRF-Token, Authorization"
        )
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"

    # CSP
    csp = (
        "default-src 'self'; "
        "img-src 'self' http: https: data: blob:; "
        "media-src 'self' http: https: blob:; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "font-src 'self' https://cdn.jsdelivr.net data:; "
        "connect-src 'self' http://localhost:3000 http://127.0.0.1:3000; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    resp.headers["Content-Security-Policy"] = csp
    return resp


@main_app.route("/api/settings", methods=["GET", "PUT", "OPTIONS"])
@rate_limited()
def api_settings():
    """خواندن/نوشتن تنظیمات فنی استریم و ضبط"""
    if request.method == "OPTIONS":
        return ("", 204)

    if request.method == "GET":
        return jsonify(get_settings_dict())

    # PUT — فقط از localhost یا نشست احرازشده
    ip = client_ip()
    local = ip in ("127.0.0.1", "::1", "localhost")
    authed = bool(session.get("authenticated"))
    if not (local or authed):
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    try:
        with state_lock:
            apply_settings({**get_settings_dict(), **data})
            save_settings_locked()
        log.info(f"تنظیمات به‌روز شد - {ip}")
        return jsonify({"success": True, "settings": get_settings_dict()})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log.exception(f"خطای ذخیره تنظیمات: {e}")
        return jsonify({"error": "ذخیره ناموفق"}), 500


# ---------------- صفحات احراز هویت ----------------
@main_app.route("/login", methods=["GET", "POST"])
@rate_limited(limit=20, window=60)
def login_page():
    error = None
    if request.method == "POST":
        ip = client_ip()
        if is_locked_out(ip):
            return render_template_string(
                HTML_LOGIN,
                error="تلاش‌های ناموفق زیاد. لطفاً چند دقیقه بعد امتحان کنید."
            ), 429

        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        # timing-safe
        user_ok = hmac.compare_digest(
            username.encode("utf-8"),
            AUTH.get("username", "").encode("utf-8"),
        )
        pass_ok = verify_password(password, AUTH.get("password_hash", ""))

        if user_ok and pass_ok:
            clear_login_attempts(ip)
            # session regeneration (جلوگیری از fixation)
            session.clear()
            session.permanent = True
            session["authenticated"] = True
            session["login_time"] = time.time()
            session["last_seen"] = time.time()
            session["sid"] = secrets.token_hex(32)
            # csrf token جدید
            get_csrf_token()
            log.info(f"✅ ورود موفق - {ip} - {request.headers.get('User-Agent','?')[:80]}")
            if AUTH.get("must_change"):
                return redirect(url_for("change_password_page"))
            return redirect(url_for("dashboard"))

        record_failed_login(ip)
        log.warning(f"❌ ورود ناموفق - {ip} - کاربر: {username}")
        error = "نام کاربری یا رمز عبور اشتباه است."
    return render_template_string(HTML_LOGIN, error=error)


@main_app.route("/logout")
def logout():
    ip = client_ip()
    log.info(f"خروج - {ip}")
    session.clear()
    return redirect(url_for("login_page"))


@main_app.route("/change_password", methods=["GET", "POST"])
@login_required
def change_password_page():
    error = None
    if request.method == "POST":
        cur = request.form.get("current") or ""
        new1 = request.form.get("new1") or ""
        new2 = request.form.get("new2") or ""

        if not verify_password(cur, AUTH.get("password_hash", "")):
            error = "رمز فعلی اشتباه است."
        elif new1 != new2:
            error = "رمزهای جدید یکسان نیستند."
        elif len(new1) < 8:
            error = "رمز جدید باید حداقل 8 کاراکتر باشد."
        elif new1.lower() == "admin":
            error = "رمز جدید نمی‌تواند 'admin' باشد."
        else:
            AUTH["password_hash"] = hash_password(new1)
            AUTH["must_change"] = False
            _atomic_write_json(AUTH_FILE, AUTH)
            try:
                os.chmod(AUTH_FILE, 0o600)
            except OSError:
                pass
            log.info(f"🔑 تغییر رمز - {client_ip()}")
            return redirect(url_for("dashboard"))
    return render_template_string(
        HTML_CHANGE_PASSWORD,
        error=error,
        must_change=AUTH.get("must_change", False),
    )


# ---------------- صفحات اصلی ----------------
@main_app.route("/")
@login_required
def dashboard():
    return render_template_string(HTML_MAIN)


@main_app.route("/monitor")
@login_required
def monitor():
    html = HTML_MONITOR.replace("{{ start_port }}", str(START_PORT))
    html = html.replace("{{ csrf }}", get_csrf_token())
    return render_template_string(html)


@main_app.route("/recordings")
@login_required
def recordings_page():
    return render_template_string(HTML_RECORDINGS)


@main_app.route("/alarms")
@login_required
def alarms_page():
    html = HTML_ALARMS.replace("{{ csrf }}", get_csrf_token())
    return render_template_string(html)


@main_app.route("/scanner")
@login_required
def scanner_page():
    html = HTML_SCANNER.replace("{{ csrf }}", get_csrf_token())
    return render_template_string(html)


# ---------------- API دوربین‌ها ----------------
@main_app.route("/api/cameras", methods=["GET", "POST", "PUT", "DELETE"])
@login_required
@csrf_protect
@rate_limited()
def api_cameras():
    global cameras

    if request.method == "GET":
        with state_lock:
            return jsonify(cameras)

    data = request.get_json(silent=True) or {}

    if request.method == "POST":
        name = (data.get("name") or "").strip()
        rtsp = (data.get("rtsp") or "").strip()
        if not valid_name(name) or not valid_rtsp(rtsp):
            return jsonify({"error": "ورودی نامعتبر"}), 400
        with state_lock:
            new_id = (max(cameras.keys()) + 1) if cameras else 1
            port = START_PORT + new_id - 1
            cameras[new_id] = {"name": name, "rtsp": rtsp}
            save_cameras_locked()
        threading.Thread(
            target=run_camera_server,
            args=(new_id, name, rtsp, port),
            daemon=True,
        ).start()
        log.info(f"دوربین جدید: {new_id} - {name}")
        return jsonify({"success": True, "id": new_id})

    if request.method == "PUT":
        cam_id = data.get("id")
        name = (data.get("name") or "").strip()
        rtsp = (data.get("rtsp") or "").strip()
        if not isinstance(cam_id, int) or not valid_name(name) or not valid_rtsp(rtsp):
            return jsonify({"error": "ورودی نامعتبر"}), 400
        with state_lock:
            if cam_id not in cameras:
                return jsonify({"error": "یافت نشد"}), 404
            cameras[cam_id] = {"name": name, "rtsp": rtsp}
            save_cameras_locked()
        stop_recording(cam_id)
        stop_camera_server(cam_id)
        port = START_PORT + cam_id - 1
        time.sleep(0.3)
        threading.Thread(
            target=run_camera_server,
            args=(cam_id, name, rtsp, port),
            daemon=True,
        ).start()
        log.info(f"ویرایش دوربین: {cam_id}")
        return jsonify({"success": True})

    if request.method == "DELETE":
        try:
            cam_id = int(request.args.get("id"))
        except (TypeError, ValueError):
            return jsonify({"error": "id نامعتبر"}), 400
        stop_recording(cam_id)
        stop_camera_server(cam_id)
        with state_lock:
            cameras.pop(cam_id, None)
            save_cameras_locked()
        log.info(f"حذف دوربین: {cam_id}")
        return jsonify({"success": True})


# ---------------- API ضبط ----------------
@main_app.route("/api/record/start", methods=["POST"])
@login_required
@csrf_protect
@rate_limited()
def api_record_start():
    data = request.get_json(silent=True) or {}
    cam_id = data.get("cam_id")
    if not isinstance(cam_id, int):
        return jsonify({"error": "cam_id نامعتبر"}), 400
    ok, err = start_recording(cam_id)
    if ok:
        return jsonify({"success": True})
    return jsonify({"success": False, "error": err}), 400


@main_app.route("/api/record/stop", methods=["POST"])
@login_required
@csrf_protect
@rate_limited()
def api_record_stop():
    data = request.get_json(silent=True) or {}
    cam_id = data.get("cam_id")
    if not isinstance(cam_id, int):
        return jsonify({"error": "cam_id نامعتبر"}), 400
    ok, err = stop_recording(cam_id)
    if ok:
        return jsonify({"success": True})
    return jsonify({"success": False, "error": err}), 400


@main_app.route("/api/record/status", methods=["GET"])
@login_required
@rate_limited(limit=200)
def api_record_status():
    with state_lock:
        return jsonify({str(k): bool(v) for k, v in recording_active.items()})


# ---------------- API هشدارها ----------------
@main_app.route("/api/alarm", methods=["POST"])
@login_required
@csrf_protect
@rate_limited()
def api_alarm():
    data = request.get_json(silent=True) or {}
    cam_id = data.get("cam_id")
    cam_name = (data.get("cam_name") or "").strip()
    if not isinstance(cam_id, int) or not valid_name(cam_name):
        return jsonify({"error": "ورودی نامعتبر"}), 400
    add_alarm(cam_id, cam_name, "Manual alarm")
    log.info(f"آلارم دستی - دوربین {cam_id} - {client_ip()}")
    return jsonify({"success": True})


@main_app.route("/api/alarms", methods=["GET"])
@login_required
@rate_limited()
def api_alarms():
    with state_lock:
        return jsonify(list(alarms))


@main_app.route("/api/alarms/clear", methods=["DELETE"])
@login_required
@csrf_protect
@rate_limited()
def api_alarms_clear():
    global alarms
    with state_lock:
        alarms = []
        save_alarms_locked()
    log.info(f"پاک کردن هشدارها - {client_ip()}")
    return jsonify({"success": True})


# ---------------- API ضبط‌ها ----------------
@main_app.route("/api/recordings/list", methods=["GET"])
@login_required
@rate_limited()
def api_recordings_list():
    results = []
    if not os.path.isdir(RECORDINGS_PATH):
        return jsonify([])
    try:
        for cam_folder in os.listdir(RECORDINGS_PATH):
            cam_path = os.path.join(RECORDINGS_PATH, cam_folder)
            if not os.path.isdir(cam_path):
                continue
            for fname in os.listdir(cam_path):
                ext = os.path.splitext(fname)[1].lower()
                if ext not in ALLOWED_RECORDING_EXT:
                    continue
                full = os.path.join(cam_path, fname)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                # تاریخ مرتب‌سازی
                base = os.path.splitext(fname)[0]
                results.append({
                    "cam_name": cam_folder,
                    "filename": fname,
                    "date": base.replace("_", " - "),
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                })
    except OSError as e:
        log.error(f"خطا در لیست ضبط‌ها: {e}")
    results.sort(key=lambda x: x["mtime"], reverse=True)
    return jsonify(results)


@main_app.route("/recordings/file", methods=["GET"])
@login_required
@rate_limited()
def serve_recording():
    cam = request.args.get("cam", "")
    fname = request.args.get("file", "")
    if not cam or not fname:
        abort(400)
    try:
        cam_safe = secure_filename(cam)
        fname_safe = secure_filename(fname)
        if not cam_safe or not fname_safe:
            abort(400)
        if not fname_safe.lower().endswith(".mp4"):
            abort(400)
        target = safe_join(RECORDINGS_PATH, cam_safe, fname_safe)
        if not os.path.isfile(target):
            abort(404)
        # بررسی MIME
        mime, _ = mimetypes.guess_type(target)
        if mime not in ("video/mp4", "video/x-m4v", "application/octet-stream"):
            abort(400)
        return send_from_directory(
            os.path.dirname(target),
            os.path.basename(target),
            mimetype="video/mp4",
            conditional=True,
        )
    except ValueError:
        abort(403)
    except Exception as e:
        log.warning(f"خطا در سرو فایل ضبط: {e}")
        abort(404)


# ---------------- API اسکنر ----------------
def _port_open(ip, port, timeout=0.5):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except Exception:
        return False


def _test_rtsp(rtsp_url, timeout_seconds=3):
    cap = None
    try:
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            return False
        start = time.time()
        while time.time() - start < timeout_seconds:
            ret, _ = cap.read()
            if ret:
                return True
        return False
    except Exception:
        return False
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass


@main_app.route("/api/scan", methods=["POST"])
@login_required
@csrf_protect
@rate_limited(limit=5, window=60)
def api_scan():
    data = request.get_json(silent=True) or {}
    start_ip = data.get("start_ip", "")
    end_ip = data.get("end_ip", "")
    try:
        port = int(data.get("port", 554))
    except (TypeError, ValueError):
        return jsonify({"error": "پورت نامعتبر"}), 400
    paths = data.get("paths", [])

    if not isinstance(paths, list) or len(paths) > 10:
        return jsonify({"error": "مسیرها نامعتبر"}), 400
    paths = [str(p) for p in paths if str(p).startswith("/")][:10]
    if not (1 <= port <= 65535):
        return jsonify({"error": "پورت نامعتبر"}), 400
    if not paths:
        return jsonify({"error": "حداقل یک مسیر لازم است"}), 400

    try:
        start = ipaddress.ip_address(start_ip)
        end = ipaddress.ip_address(end_ip)
        if start.version != 4 or end.version != 4:
            return jsonify({"error": "فقط IPv4"}), 400
        start_int, end_int = int(start), int(end)
        if start_int > end_int:
            start_int, end_int = end_int, start_int
        if (end_int - start_int + 1) > MAX_SCAN_RANGE:
            return jsonify({"error": f"حداکثر {MAX_SCAN_RANGE} آدرس"}), 400

        ips = [str(ipaddress.ip_address(i))
               for i in range(start_int, end_int + 1)]

        open_ips = []
        with ThreadPoolExecutor(max_workers=64) as pool:
            futures = {pool.submit(_port_open, ip, port, 0.5): ip for ip in ips}
            for fut in as_completed(futures):
                try:
                    if fut.result():
                        open_ips.append(futures[fut])
                except Exception:
                    pass

        log.info(f"اسکن: {len(open_ips)}/{len(ips)} IP پورت {port} باز")

        results = []
        seen = set()
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {}
            for ip in open_ips:
                for path in paths:
                    url = f"rtsp://{ip}:{port}{path}"
                    futures[pool.submit(_test_rtsp, url, 3)] = (ip, url)
            for fut in as_completed(futures):
                ip, url = futures[fut]
                try:
                    if fut.result() and ip not in seen:
                        seen.add(ip)
                        results.append({"name": f"Camera at {ip}", "rtsp": url})
                except Exception:
                    pass
        return jsonify(results)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log.exception(f"خطای اسکن: {e}")
        return jsonify({"error": "اسکن ناموفق"}), 500


# ---------------- Error Handlers ----------------
@main_app.errorhandler(404)
def err_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "not found"}), 404
    return redirect(url_for("dashboard"))


@main_app.errorhandler(500)
def err_500(e):
    log.exception("Internal server error")
    if request.path.startswith("/api/"):
        return jsonify({"error": "internal error"}), 500
    return "خطای داخلی سرور", 500


# ====================================================================
#                          اجرای اصلی
# ====================================================================
def open_browser():
    time.sleep(2)
    try:
        webbrowser.open_new_tab(f"http://localhost:{MAIN_PORT}")
    except Exception:
        pass


def main():
    load_settings()
    load_cameras()
    load_alarms()

    print("=" * 70)
    print("✅ سیستم نظارت پارس کم - نسخه ارتقاءیافته")
    print(f"🌐 داشبورد: http://localhost:{MAIN_PORT}")
    print(f"💾 مسیر ضبط: {RECORDINGS_PATH}")
    print(f"🔐 کاربر: {AUTH['username']}")
    print(f"📹 راه‌اندازی {len(cameras)} سرور دوربین...")
    print("=" * 70)

    with state_lock:
        cam_items = list(cameras.items())

    for cam_id, cam in cam_items:
        port = START_PORT + cam_id - 1
        threading.Thread(
            target=run_camera_server,
            args=(cam_id, cam["name"], cam["rtsp"], port),
            daemon=True,
        ).start()
        time.sleep(0.2)

    print("=" * 70)
    print(f"✅ {len(cam_items)} سرور دوربین راه‌اندازی شد")
    print(f"📡 محدوده پورت‌ها: {START_PORT} - {START_PORT + len(cam_items) - 1}")
    print("=" * 70)

    threading.Thread(target=open_browser, daemon=True).start()
    main_app.run(host="0.0.0.0", port=MAIN_PORT, threaded=True, debug=False)


if __name__ == "__main__":
    main()