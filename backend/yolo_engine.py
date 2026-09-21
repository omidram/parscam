# -*- coding: utf-8 -*-
"""
پارس کم — موتور تشخیص YOLO26
فیلترها: انسان، آتش، اسلحه، چاقو، حیوانات، ماشین
هشدار + نوتیف + ضبط ۶۰ ثانیه‌ای + اسکرین‌شات
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
CAMERAS_FILE = BASE_DIR / "cameras.json"
YOLO_SETTINGS_FILE = BASE_DIR / "yolo_settings.json"
YOLO_EVENTS_FILE = BASE_DIR / "yolo_events.json"
ALARMS_FILE = BASE_DIR / "alarms.json"
SNAPSHOTS_DIR = BASE_DIR / "snapshots"
RECORDINGS_DIR = BASE_DIR / "recordings"
OVERLAY_FILE = BASE_DIR / "yolo_overlays.json"

# همان تنظیمات استریم زنده — بدون این، بعضی دوربین‌ها باز نمی‌شوند
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay",
)

# کلاس‌های COCO برای YOLO26
COCO_FILTER_MAP = {
    "human": {"person"},
    "animal": {
        "bird", "cat", "dog", "horse", "sheep", "cow",
        "elephant", "bear", "zebra", "giraffe",
    },
    "vehicle": {
        "bicycle", "motorcycle", "car", "bus", "truck", "boat",
        "train", "airplane",
    },
}

# پرامپت‌های open-vocab برای YOLOE (آتش / اسلحه / چاقو)
# کوتاه و مشخص — با get_text_pe دقت خیلی بهتر از لیست طولانی است
OPEN_VOCAB_FILTER_MAP = {
    "fire": [
        "fire",
        "flame",
        "lighter flame",
        "burning flame",
        "orange fire",
    ],
    "gun": [
        "handgun",
        "pistol",
        "gun",
        "firearm",
        "rifle",
    ],
    "knife": [
        "knife",
        "kitchen knife",
        "blade",
        "dagger",
    ],
}

FILTER_LABELS_FA = {
    "human": "انسان",
    "fire": "آتش",
    "gun": "اسلحه",
    "knife": "چاقو",
    "animal": "حیوان",
    "vehicle": "ماشین",
}

# ASCII labels for OpenCV putText (Persian renders as ???)
FILTER_LABELS_EN = {
    "human": "Person",
    "fire": "Fire",
    "gun": "Gun",
    "knife": "Knife",
    "animal": "Animal",
    "vehicle": "Vehicle",
}

DEFAULT_YOLO_SETTINGS = {
    "enabled": True,
    "model": "yolo26n.pt",
    "open_vocab_model": "yoloe-26n-seg.pt",
    # وقتی آتش/اسلحه/چاقو روشن باشد، YOLOE خودکار فعال می‌شود
    "use_open_vocab": True,
    "confidence": 0.32,
    "ov_confidence": 0.12,
    "infer_every_n_frames": 5,
    "ov_every_n_frames": 6,
    "imgsz": 320,
    "ov_imgsz": 640,
    "max_det": 25,
    "infer_max_width": 640,
    "ov_infer_max_width": 960,
    "cooldown_sec": 15,
    "filters": {
        "human": True,
        "fire": True,
        "gun": True,
        "knife": True,
        "animal": False,
        "vehicle": False,
    },
    "notify": True,
    "auto_record_on_detect": True,
    "record_duration_sec": 60,
    "auto_screenshot_on_detect": True,
    "draw_boxes": True,
    "live_overlay": True,
}

# شناسه کلاس COCO برای محدود کردن predict (سرعت بالاتر)
COCO_CLASS_IDS = {
    "human": [0],
    "vehicle": [1, 2, 3, 4, 5, 6, 7, 8],
    "animal": [14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
}


class YoloEngine:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.settings = dict(DEFAULT_YOLO_SETTINGS)
        self.events: list[dict[str, Any]] = []
        self.status = {
            "running": False,
            "model_loaded": False,
            "open_vocab_loaded": False,
            "last_error": "",
            "cameras": {},
            "detections_total": 0,
        }
        self._coco_model = None
        self._ov_model = None
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._last_alert: dict[str, float] = defaultdict(float)
        self._recording: dict[int, threading.Thread] = {}
        SNAPSHOTS_DIR.mkdir(exist_ok=True)
        RECORDINGS_DIR.mkdir(exist_ok=True)
        self.load_settings()
        self.load_events()

    # ---------- persistence ----------
    def load_settings(self) -> None:
        if YOLO_SETTINGS_FILE.exists():
            try:
                raw = json.loads(YOLO_SETTINGS_FILE.read_text(encoding="utf-8"))
                merged = dict(DEFAULT_YOLO_SETTINGS)
                merged.update(raw)
                if "filters" in raw:
                    filters = dict(DEFAULT_YOLO_SETTINGS["filters"])
                    filters.update(raw["filters"])
                    merged["filters"] = filters
                self.settings = merged
            except Exception as e:
                self.status["last_error"] = f"settings: {e}"
        self.save_settings()

    def save_settings(self) -> None:
        YOLO_SETTINGS_FILE.write_text(
            json.dumps(self.settings, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def load_events(self) -> None:
        if YOLO_EVENTS_FILE.exists():
            try:
                self.events = json.loads(YOLO_EVENTS_FILE.read_text(encoding="utf-8"))
                if not isinstance(self.events, list):
                    self.events = []
            except Exception:
                self.events = []

    def save_events(self) -> None:
        YOLO_EVENTS_FILE.write_text(
            json.dumps(self.events[:500], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def update_settings(self, patch: dict) -> dict:
        with self.lock:
            for k, v in patch.items():
                if k == "filters" and isinstance(v, dict):
                    self.settings["filters"].update(v)
                elif k in DEFAULT_YOLO_SETTINGS:
                    self.settings[k] = v
            # آتش/اسلحه/چاقو بدون YOLOE کار نمی‌کنند — خودکار روشن کن
            if any(
                self.settings["filters"].get(k)
                for k in ("fire", "gun", "knife")
            ):
                self.settings["use_open_vocab"] = True
            self.save_settings()
            # اگر کلاس‌های OV عوض شد، در ensure_models دوباره set می‌شوند
            self._ov_class_names = None
            return dict(self.settings)

    # ---------- models ----------
    def _desired_ov_names(self) -> list[str]:
        names: list[str] = []
        for key, prompts in OPEN_VOCAB_FILTER_MAP.items():
            if self.settings["filters"].get(key):
                names.extend(prompts)
        # ترتیب پایدار + بدون تکرار
        return list(dict.fromkeys(names))

    def _apply_ov_classes(self, names: list[str]) -> None:
        if not names or self._ov_model is None:
            return
        # YOLOE بدون text prompt embeddings practically کور است
        try:
            pe = self._ov_model.get_text_pe(names)
            self._ov_model.set_classes(names, pe)
        except Exception:
            self._ov_model.set_classes(names)
        self._ov_class_names = list(names)

    def need_open_vocab(self) -> bool:
        return bool(self.settings.get("use_open_vocab", False)) and any(
            self.settings["filters"].get(k) for k in ("fire", "gun", "knife")
        )

    def ensure_models(self) -> None:
        if self._coco_model is None:
            from ultralytics import YOLO

            model_name = self.settings.get("model", "yolo26n.pt")
            path = BASE_DIR / model_name
            self._coco_model = YOLO(str(path if path.exists() else model_name))
            self.status["model_loaded"] = True
            self.status["model_name"] = model_name

        if not self.need_open_vocab():
            self.status["open_vocab_loaded"] = bool(self._ov_model is not None)
            return

        names = self._desired_ov_names()
        if not names:
            self.status["open_vocab_loaded"] = False
            return

        if self._ov_model is None:
            try:
                from ultralytics import YOLO

                ov_name = self.settings.get("open_vocab_model", "yoloe-26n-seg.pt")
                ov_path = BASE_DIR / ov_name
                self._ov_model = YOLO(str(ov_path if ov_path.exists() else ov_name))
                self._apply_ov_classes(names)
                self.status["open_vocab_loaded"] = True
                self.status["last_error"] = ""
            except Exception as e:
                self.status["last_error"] = f"open-vocab: {e}"
                self.status["open_vocab_loaded"] = False
                self._ov_model = None
        elif names != getattr(self, "_ov_class_names", None):
            try:
                self._apply_ov_classes(names)
                self.status["open_vocab_loaded"] = True
            except Exception as e:
                self.status["last_error"] = f"open-vocab refresh: {e}"
                self.status["open_vocab_loaded"] = False
    def active_coco_class_ids(self) -> list[int] | None:
        ids: list[int] = []
        for filt, class_ids in COCO_CLASS_IDS.items():
            if self.settings["filters"].get(filt):
                ids.extend(class_ids)
        return ids or None

    def read_cameras(self) -> dict[int, dict]:
        if not CAMERAS_FILE.exists():
            return {}
        try:
            raw = json.loads(CAMERAS_FILE.read_text(encoding="utf-8"))
            return {int(k): v for k, v in raw.items()}
        except Exception:
            return {}

    # ---------- detect ----------
    def class_to_filter(self, name: str, source: str) -> str | None:
        name = name.lower().strip()
        if source == "coco":
            for filt, classes in COCO_FILTER_MAP.items():
                if not self.settings["filters"].get(filt):
                    continue
                if name in classes:
                    return filt
        else:
            for filt, prompts in OPEN_VOCAB_FILTER_MAP.items():
                if not self.settings["filters"].get(filt):
                    continue
                # exact or substring match against prompt tokens
                if name in prompts:
                    return filt
                for p in prompts:
                    if p in name or name in p:
                        return filt
                # keyword buckets
                if filt == "fire" and any(
                    k in name for k in ("fire", "flame", "blaze", "burn")
                ):
                    return filt
                if filt == "gun" and any(
                    k in name
                    for k in ("gun", "pistol", "rifle", "firearm", "shotgun", "weapon")
                ):
                    return filt
                if filt == "knife" and any(
                    k in name for k in ("knife", "blade", "dagger", "machete")
                ):
                    return filt
        return None

    def publish_overlay(self, cam_id: int, frame, hits: list[dict]) -> None:
        if not self.settings.get("live_overlay", True):
            return
        try:
            h, w = frame.shape[:2]
            data = {}
            if OVERLAY_FILE.exists():
                try:
                    data = json.loads(OVERLAY_FILE.read_text(encoding="utf-8"))
                    if not isinstance(data, dict):
                        data = {}
                except Exception:
                    data = {}
            data[str(cam_id)] = {
                "ts": time.time(),
                "w": w,
                "h": h,
                "hits": [
                    {
                        "filter": h["filter"],
                        "label": h["label"],
                        "label_fa": h["label_fa"],
                        "confidence": h["confidence"],
                        "bbox": h["bbox"],
                    }
                    for h in hits
                ],
            }
            # drop stale cams (>10s)
            now = time.time()
            data = {
                k: v
                for k, v in data.items()
                if isinstance(v, dict) and now - float(v.get("ts", 0)) < 10
            }
            tmp = OVERLAY_FILE.with_suffix(".json.tmp")
            tmp.write_text(
                json.dumps(data, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp.replace(OVERLAY_FILE)
        except Exception as e:
            self.status["last_error"] = f"overlay: {e}"

    def detect_frame(
        self, frame, run_coco: bool = True, run_ov: bool = True
    ) -> list[dict]:
        self.ensure_models()
        conf = float(self.settings.get("confidence", 0.32))
        ov_conf = float(self.settings.get("ov_confidence", 0.12))
        imgsz = int(self.settings.get("imgsz", 320))
        ov_imgsz = int(self.settings.get("ov_imgsz", 640))
        max_det = int(self.settings.get("max_det", 25))
        hits: list[dict] = []

        # کوچک‌کردن فریم برای اینفرنس سریع‌تر (COCO)
        max_w = int(self.settings.get("infer_max_width", 640))
        h0, w0 = frame.shape[:2]
        scale = 1.0
        infer = frame
        if w0 > max_w:
            scale = max_w / float(w0)
            infer = cv2.resize(frame, (max_w, int(h0 * scale)))

        if run_coco and self._coco_model is not None:
            class_ids = self.active_coco_class_ids()
            kwargs = dict(
                conf=conf,
                imgsz=imgsz,
                max_det=max_det,
                verbose=False,
            )
            if class_ids is not None:
                kwargs["classes"] = class_ids
            try:
                kwargs["half"] = True
                results = self._coco_model.predict(infer, **kwargs)
            except Exception:
                kwargs.pop("half", None)
                results = self._coco_model.predict(infer, **kwargs)
            for r in results:
                names = r.names or {}
                if r.boxes is None:
                    continue
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    label = str(names.get(cls_id, cls_id))
                    filt = self.class_to_filter(label, "coco")
                    if not filt:
                        continue
                    xyxy = [float(x) for x in box.xyxy[0].tolist()]
                    if scale != 1.0:
                        xyxy = [v / scale for v in xyxy]
                    hits.append(
                        {
                            "filter": filt,
                            "label": label,
                            "label_fa": FILTER_LABELS_FA.get(filt, filt),
                            "confidence": float(box.conf[0]),
                            "bbox": xyxy,
                        }
                    )

        if (
            run_ov
            and self.need_open_vocab()
            and self._ov_model is not None
        ):
            try:
                # وضوح بالاتر برای اشیای کوچک (چاقو / فندک / اسلحه)
                ov_max_w = int(self.settings.get("ov_infer_max_width", 960))
                ov_scale = 1.0
                ov_infer = frame
                if w0 > ov_max_w:
                    ov_scale = ov_max_w / float(w0)
                    ov_infer = cv2.resize(frame, (ov_max_w, int(h0 * ov_scale)))
                results = self._ov_model.predict(
                    ov_infer,
                    conf=ov_conf,
                    imgsz=ov_imgsz,
                    max_det=max_det,
                    verbose=False,
                )
                for r in results:
                    names = r.names or {}
                    if r.boxes is None:
                        continue
                    for box in r.boxes:
                        cls_id = int(box.cls[0])
                        label = str(names.get(cls_id, cls_id))
                        filt = self.class_to_filter(label, "ov")
                        if not filt:
                            continue
                        xyxy = [float(x) for x in box.xyxy[0].tolist()]
                        if ov_scale != 1.0:
                            xyxy = [v / ov_scale for v in xyxy]
                        # اشیای خیلی کوچک (مثل شعله فندک) را رد نکن
                        bw = abs(xyxy[2] - xyxy[0])
                        bh = abs(xyxy[3] - xyxy[1])
                        if filt != "fire" and (bw < 8 or bh < 8):
                            continue
                        if filt == "fire" and (bw < 4 or bh < 4):
                            continue
                        hits.append(
                            {
                                "filter": filt,
                                "label": label,
                                "label_fa": FILTER_LABELS_FA.get(filt, filt),
                                "confidence": float(box.conf[0]),
                                "bbox": xyxy,
                            }
                        )
            except Exception as e:
                self.status["last_error"] = f"ov predict: {e}"

            # کمکی رنگ‌محور برای شعله کوچک (فندک) وقتی فیلتر آتش روشن است
            if self.settings["filters"].get("fire"):
                try:
                    fire_hits = self.detect_small_flame(frame)
                    hits.extend(fire_hits)
                except Exception as e:
                    self.status["last_error"] = f"flame assist: {e}"

        return hits

    def detect_small_flame(self, frame) -> list[dict]:
        """HSV assist for tiny lighter-like flames — complements YOLOE."""
        h0, w0 = frame.shape[:2]
        # کار روی نسخه کوچک برای سرعت
        scale = 1.0
        small = frame
        if w0 > 640:
            scale = 640 / float(w0)
            small = cv2.resize(frame, (640, int(h0 * scale)))
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        # نارنجی/زرد روشن شعله
        mask1 = cv2.inRange(hsv, (0, 120, 160), (25, 255, 255))
        mask2 = cv2.inRange(hsv, (160, 80, 160), (180, 255, 255))
        mask = cv2.bitwise_or(mask1, mask2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out: list[dict] = []
        area_img = small.shape[0] * small.shape[1]
        for c in cnts:
            area = cv2.contourArea(c)
            # شعله فندک کوچک است؛ آتش بزرگ هم قبول
            if area < 18 or area > area_img * 0.25:
                continue
            x, y, w, h = cv2.boundingRect(c)
            aspect = h / max(w, 1)
            # شعله معمولاً عمودی‌تر از لکه نارنجی تصادفی است
            if aspect < 0.6 and area < 120:
                continue
            # روشنایی داخل باکس
            roi = small[y : y + h, x : x + w]
            if roi.size == 0:
                continue
            mean_v = float(cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)[:, :, 2].mean())
            if mean_v < 150:
                continue
            xyxy = [float(x), float(y), float(x + w), float(y + h)]
            if scale != 1.0:
                xyxy = [v / scale for v in xyxy]
            conf = min(0.55, 0.18 + area / 800.0)
            out.append(
                {
                    "filter": "fire",
                    "label": "lighter flame",
                    "label_fa": FILTER_LABELS_FA["fire"],
                    "confidence": conf,
                    "bbox": xyxy,
                }
            )
        return out[:3]
    def draw_hits(self, frame, hits: list[dict]):
        # live overlay uses green; screenshots keep colored boxes
        colors = {
            "human": (0, 220, 0),
            "fire": (0, 220, 0),
            "gun": (0, 220, 0),
            "knife": (0, 220, 0),
            "animal": (0, 220, 0),
            "vehicle": (0, 220, 0),
        }
        for h in hits:
            x1, y1, x2, y2 = map(int, h["bbox"])
            c = colors.get(h["filter"], (0, 220, 0))
            cv2.rectangle(frame, (x1, y1), (x2, y2), c, 2)
            en = FILTER_LABELS_EN.get(h["filter"]) or str(h.get("label") or "Object")
            en = en.encode("ascii", "ignore").decode("ascii").strip() or "Object"
            tag = f'{en} {h["confidence"]:.0%}'
            cv2.putText(
                frame, tag, (x1, max(20, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, c, 2, cv2.LINE_AA,
            )
        return frame

    # ---------- actions ----------
    def save_screenshot(self, frame, cam_id: int, filt: str) -> str:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"cam{cam_id}_{filt}_{stamp}.jpg"
        path = SNAPSHOTS_DIR / name
        cv2.imwrite(str(path), frame)
        return str(path)

    def start_record_clip(self, cam_id: int, rtsp: str, duration: int) -> None:
        if cam_id in self._recording and self._recording[cam_id].is_alive():
            return

        def _job():
            folder = RECORDINGS_DIR / f"cam{cam_id}"
            folder.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            out = folder / f"cam{cam_id}_yolo_{stamp}.mp4"
            worker = BASE_DIR / "record_worker.py"
            use_url = rtsp
            if "/main" in rtsp and "/sub" not in rtsp:
                use_url = rtsp.replace("/main", "/sub")
            try:
                import subprocess

                subprocess.run(
                    [
                        sys.executable,
                        str(worker),
                        use_url,
                        str(out),
                        str(int(duration)),
                    ],
                    cwd=str(BASE_DIR),
                    timeout=max(30, int(duration) + 30),
                    check=False,
                )
                if not out.exists() or out.stat().st_size < 1000:
                    # fallback to main
                    subprocess.run(
                        [
                            sys.executable,
                            str(worker),
                            rtsp,
                            str(out),
                            str(int(duration)),
                        ],
                        cwd=str(BASE_DIR),
                        timeout=max(30, int(duration) + 30),
                        check=False,
                    )
            except Exception as e:
                self.status["last_error"] = f"record: {e}"
            finally:
                self._recording.pop(cam_id, None)

        t = threading.Thread(target=_job, daemon=True)
        self._recording[cam_id] = t
        t.start()

    def push_alarm(self, cam_id: int, cam_name: str, filt: str, conf: float) -> None:
        try:
            alarms = []
            if ALARMS_FILE.exists():
                alarms = json.loads(ALARMS_FILE.read_text(encoding="utf-8"))
                if not isinstance(alarms, list):
                    alarms = []
            next_id = max((a.get("id", 0) for a in alarms), default=0) + 1
            alarms.insert(
                0,
                {
                    "id": next_id,
                    "cam_id": cam_id,
                    "cam_name": cam_name,
                    "reason": f"YOLO · {FILTER_LABELS_FA.get(filt, filt)} ({conf:.0%})",
                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "filter": filt,
                    "source": "yolo26",
                },
            )
            ALARMS_FILE.write_text(
                json.dumps(alarms[:5000], indent=4, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception as e:
            self.status["last_error"] = f"alarm: {e}"

    def handle_detection(
        self,
        cam_id: int,
        cam_name: str,
        rtsp: str,
        frame,
        hits: list[dict],
    ) -> None:
        if not hits:
            return
        # یک رویداد به ازای هر فیلتر یکتا در فریم
        seen = set()
        for h in hits:
            filt = h["filter"]
            if filt in seen:
                continue
            seen.add(filt)
            key = f"{cam_id}:{filt}"
            now = time.time()
            cooldown = float(self.settings.get("cooldown_sec", 20))
            if now - self._last_alert[key] < cooldown:
                continue
            self._last_alert[key] = now

            annotated = frame.copy()
            if self.settings.get("draw_boxes", True):
                annotated = self.draw_hits(annotated, hits)

            shot = ""
            if self.settings.get("auto_screenshot_on_detect", True):
                shot = self.save_screenshot(annotated, cam_id, filt)

            if self.settings.get("auto_record_on_detect", True):
                dur = int(self.settings.get("record_duration_sec", 60))
                self.start_record_clip(cam_id, rtsp, dur)

            if self.settings.get("notify", True):
                self.push_alarm(cam_id, cam_name, filt, h["confidence"])

            event = {
                "id": str(uuid.uuid4()),
                "cam_id": cam_id,
                "cam_name": cam_name,
                "filter": filt,
                "label": h["label"],
                "label_fa": h["label_fa"],
                "confidence": h["confidence"],
                "time": datetime.now().isoformat(timespec="seconds"),
                "screenshot": shot,
                "notified": bool(self.settings.get("notify", True)),
                "recorded": bool(self.settings.get("auto_record_on_detect", True)),
            }
            with self.lock:
                self.events.insert(0, event)
                self.events = self.events[:500]
                self.status["detections_total"] += 1
                self.save_events()

    # ---------- camera loop ----------
    @staticmethod
    def _prefer_sub(url: str) -> str:
        """Use /sub when possible so live /main viewer keeps the main stream."""
        if "/main" in url and "/sub" not in url:
            return url.replace("/main", "/sub")
        return url

    def camera_loop(self, cam_id: int, cam: dict) -> None:
        primary = cam.get("rtsp", "")
        rtsp = self._prefer_sub(primary)
        name = cam.get("name", f"cam{cam_id}")
        backoff = 1.0
        last_hits: list[dict] = []
        last_hit_ts = 0.0
        while not self._stop.is_set():
            if not self.settings.get("enabled", True):
                time.sleep(1)
                continue
            every = max(2, int(self.settings.get("infer_every_n_frames", 5)))
            use_ov = self.need_open_vocab()
            ov_every = max(3, int(self.settings.get("ov_every_n_frames", 6)))
            # اگر OV لازم است ولی مدل هنوز لود نشده، یک‌بار تلاش کن
            if use_ov and self._ov_model is None:
                try:
                    self.ensure_models()
                except Exception as e:
                    self.status["last_error"] = str(e)
            cap = cv2.VideoCapture(rtsp, cv2.CAP_FFMPEG)
            if not cap.isOpened() and rtsp != primary:
                rtsp = primary
                cap = cv2.VideoCapture(rtsp, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                self.status["cameras"][str(cam_id)] = {
                    "ok": False,
                    "name": name,
                    "error": "باز نشد",
                }
                time.sleep(min(backoff, 15))
                backoff = min(backoff * 2, 15)
                continue
            backoff = 1.0
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass
            self.status["cameras"][str(cam_id)] = {
                "ok": True,
                "name": name,
                "error": "",
                "rtsp": rtsp,
                "model": "yolo26n",
            }
            frame_i = 0
            while not self._stop.is_set() and self.settings.get("enabled", True):
                ok, frame = cap.read()
                if not ok:
                    break
                frame_i += 1
                # دور انداختن فریم‌های بافر برای تأخیر کمتر
                if frame_i % 2 == 0:
                    # grab بدون decode هر از گاهی سنگین است؛ فقط هر چند فریم skip سبک
                    pass
                run_coco = frame_i % every == 0
                run_ov = use_ov and (frame_i % ov_every == 0)
                if not run_coco and not run_ov:
                    # کادر پایدار بین دو اینفرنس
                    if last_hits and (time.time() - last_hit_ts) < 1.2:
                        if frame_i % 2 == 0:
                            self.publish_overlay(cam_id, frame, last_hits)
                    continue
                try:
                    hits = self.detect_frame(
                        frame, run_coco=run_coco, run_ov=run_ov
                    )
                    uniq = []
                    seen = set()
                    for h in hits:
                        key = (
                            h["filter"],
                            int(h["bbox"][0] / 10),
                            int(h["bbox"][1] / 10),
                        )
                        if key in seen:
                            continue
                        seen.add(key)
                        uniq.append(h)
                    hits = uniq
                    if hits:
                        last_hits = hits
                        last_hit_ts = time.time()
                    elif time.time() - last_hit_ts > 1.2:
                        last_hits = []
                    self.publish_overlay(cam_id, frame, last_hits)
                    if hits:
                        self.handle_detection(cam_id, name, primary, frame, hits)
                except Exception as e:
                    self.status["last_error"] = str(e)
                    time.sleep(0.3)
            cap.release()
            time.sleep(0.5)

    def start(self) -> None:
        if self.status["running"]:
            return
        self._stop.clear()
        try:
            self.ensure_models()
        except Exception as e:
            self.status["last_error"] = str(e)
        cams = self.read_cameras()
        for cam_id, cam in cams.items():
            t = threading.Thread(
                target=self.camera_loop,
                args=(cam_id, cam),
                daemon=True,
                name=f"yolo-cam-{cam_id}",
            )
            t.start()
            self._threads.append(t)
        self.status["running"] = True

    def stop(self) -> None:
        self._stop.set()
        self.status["running"] = False

    def snapshot_status(self) -> dict:
        with self.lock:
            return {
                **self.status,
                "settings": self.settings,
                "recent": self.events[:20],
            }


engine = YoloEngine()
