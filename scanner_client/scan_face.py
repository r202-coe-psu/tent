#!/usr/bin/env python3
"""Scan a face with the camera and say what the kiosk face check would see. No card, no server.

  ./scan_face.py --list                  # which camera index is which (colour = RGB, grey = IR)
  ./scan_face.py                         # camera 0, 15 seconds, one line per half second
  ./scan_face.py --camera 2 --seconds 30 --show-scores
  ./scan_face.py --image a.jpg b.jpg     # still images instead of the camera

For setting up a kiosk (plan §11, Phase 0): is the camera open, is a face found, is the framing good
enough (distance, angle, light, sharpness) and does the liveness model call it a real face. It never
compares against a card. Nothing is saved: frames are looked at and thrown away, and only numbers
and hints are printed. Use only your own face, or a person who agreed.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# OpenCV warns once per camera index it cannot open; that is noise here. Must be set before the import.
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from app.face import quality  # noqa: E402
from app.face.engine import FaceEngine, missing_models
from app.face.profiles import DEFAULT_PROFILE, ThresholdProfile, get_profile  # noqa: E402

DEFAULT_MODELS = Path(__file__).resolve().parent / "models"
MAX_CAMERA_INDEX = 10
WARM_UP_SEC = 1.0
# A webcam's first frames are often a flat grey placeholder until auto exposure settles.
WARM_UP_FRAMES = 8
# The desktop's media service (pipewire) sometimes holds a camera for a moment; try again before giving up.
OPEN_ATTEMPTS = 4
OPEN_RETRY_SEC = 0.5
LINE_EVERY_SEC = 0.5

# What to tell the person at the camera, per hint (same meaning as the kiosk screen).
HINT_ADVICE = {
    quality.OK: "พร้อม — ใช้ตรวจได้",
    quality.NO_FACE: "ไม่เห็นหน้า",
    quality.MULTIPLE_FACES: "มีหลายหน้าในภาพ",
    quality.TOO_FAR: "ไกลเกินไป",
    quality.TOO_CLOSE: "ใกล้เกินไป",
    quality.TURN_STRAIGHT: "หน้าไม่ตรงกล้อง (เอียง/ก้ม/หัน)",
    quality.TOO_DARK: "แสงน้อยเกินไป",
    quality.TOO_BRIGHT: "แสงจ้าเกินไป",
    quality.BLURRY: "ภาพไม่ชัด",
}


@dataclass(frozen=True)
class FrameReport:
    hint: str
    face_found: bool
    eye_px: Optional[float] = None
    eye_ratio: Optional[float] = None
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    live: Optional[bool] = None
    p_real: Optional[float] = None


def analyse_frame(engine, frame: np.ndarray, profile: ThresholdProfile) -> FrameReport:
    """What the face check makes of one camera frame."""
    hint, face = quality.assess(frame, engine.detect(frame), profile)
    if face is None:
        return FrameReport(hint=hint, face_found=False)
    right_eye, left_eye = face[4:6], face[6:8]
    eye_px = float(np.hypot(*(left_eye - right_eye)))
    yaw, pitch, roll = quality.pose_ratios(face)
    result = engine.liveness(frame, face)
    return FrameReport(
        hint=hint,
        face_found=True,
        eye_px=eye_px,
        eye_ratio=eye_px / frame.shape[1],
        yaw=yaw,
        pitch=pitch,
        roll=roll,
        live=result.is_real,
        p_real=result.p_real,
    )


def format_report(report: FrameReport, *, show_scores: bool) -> str:
    text = f"{HINT_ADVICE.get(report.hint, report.hint)} ({report.hint})"
    if not report.face_found:
        return text
    text += f" · eye={report.eye_px:.0f}px ({report.eye_ratio:.0%})"
    text += f" · live={'yes' if report.live else 'NO'}"
    if show_scores:
        text += (f" p_real={report.p_real:.2f} · yaw={report.yaw:.2f} pitch={report.pitch:.2f}"
                 f" roll={report.roll:.0f}°")
    return text


def summarise(reports: list[FrameReport], profile: ThresholdProfile) -> list[str]:
    """The lines to print once the scan is over."""
    total = len(reports)
    if total == 0:
        return ["ไม่ได้ภาพจากกล้องเลย — ตรวจสาย/สิทธิ์/ดัชนีกล้อง (ลอง --list)"]
    with_face = [r for r in reports if r.face_found]
    good = [r for r in reports if r.hint == quality.OK]
    lines = [
        f"เฟรมทั้งหมด {total} · เห็นหน้า {len(with_face)} · ผ่านเกณฑ์ภาพ {len(good)}",
    ]
    if with_face:
        live = sum(1 for r in with_face if r.live)
        lines.append(f"ตัวตรวจคนจริงว่าจริง {live}/{len(with_face)} เฟรมที่เห็นหน้า")
    problems = Counter(r.hint for r in reports if r.hint != quality.OK)
    if problems:
        common = ", ".join(f"{HINT_ADVICE.get(hint, hint)} ×{n}" for hint, n in problems.most_common(3))
        lines.append(f"ปัญหาที่พบบ่อย: {common}")
    if len(good) >= profile.required_frames:
        lines.append(f"✅ กล้องและการตั้งท่าใช้ตรวจใบหน้าได้ (ต้องมีเฟรมดี ≥ {profile.required_frames} เฟรม)")
    else:
        lines.append(f"⚠️ เฟรมดีไม่พอ ({len(good)}/{profile.required_frames}) — แก้ตามปัญหาด้านบนแล้วลองใหม่")
    return lines


def camera_indexes() -> list[int]:
    """Camera numbers worth trying: the /dev/video* nodes that exist, else 0..9."""
    found = sorted(
        int(match.group(1))
        for path in glob.glob("/dev/video*")
        if (match := re.fullmatch(r"/dev/video(\d+)", path))
    )
    return found or list(range(MAX_CAMERA_INDEX))


def open_camera(source, capture_factory=cv2.VideoCapture, sleep=time.sleep):
    """A capture for `source`, opened - retried a few times because a camera that is busy for a
    moment opens fine a moment later. Returns the last attempt even if it never opened."""
    capture = capture_factory(source)
    for _ in range(OPEN_ATTEMPTS - 1):
        if capture.isOpened():
            break
        capture.release()
        sleep(OPEN_RETRY_SEC)
        capture = capture_factory(source)
    return capture


def list_cameras(
    capture_factory=cv2.VideoCapture, indexes: Optional[list[int]] = None, sleep=time.sleep
) -> list[str]:
    """One line per camera that gives a picture: size, brightness and colour or grey."""
    lines = []
    for index in indexes if indexes is not None else camera_indexes():
        capture = open_camera(index, capture_factory, sleep)
        try:
            if not capture.isOpened():
                lines.append(f"  {index}: เปิดไม่ได้ (ถูกโปรแกรมอื่นใช้อยู่ หรือเป็น node ที่ไม่ใช่ภาพ)")
                continue
            ok, frame = False, None
            for _ in range(WARM_UP_FRAMES):
                ok, frame = capture.read()
            if not ok or frame is None:
                lines.append(f"  {index}: เปิดได้แต่ไม่ได้ภาพ")
                continue
            grey_like = float(np.abs(frame[..., 0].astype(int) - frame[..., 1].astype(int)).mean()) < 2.0
            lines.append(
                f"  {index}: {frame.shape[1]}x{frame.shape[0]} · สว่างเฉลี่ย {frame.mean():.0f}"
                f" · {'ขาวดำ (น่าจะเป็น IR)' if grey_like else 'สี (น่าจะเป็น RGB)'}"
            )
        finally:
            capture.release()
    if not any("x" in line and "สว่าง" in line for line in lines):
        lines.append("  ไม่มีกล้องที่ให้ภาพเลย — ปิดโปรแกรมที่ใช้กล้องอยู่ (เบราว์เซอร์/Zoom/Cheese) แล้วลองใหม่")
        lines.append("  ดูว่าใครถือกล้อง:  fuser -v /dev/video0   ·   ตรวจสิทธิ์:  ls -l /dev/video*  (ต้องอยู่ใน group video)")
    return lines


def scan_camera(engine, profile: ThresholdProfile, args) -> list[FrameReport]:
    capture = open_camera(int(args.camera) if args.camera.isdigit() else args.camera)
    if not capture.isOpened():
        sys.exit(f"เปิดกล้อง {args.camera!r} ไม่ได้ (ลอง ./scan_face.py --list)")
    print(f"กำลังสแกน {args.seconds:.0f} วินาที — มองตรงที่กล้อง ...")
    reports: list[FrameReport] = []
    started = time.monotonic()
    last_line = 0.0
    try:
        while (now := time.monotonic() - started) < args.seconds:
            ok, frame = capture.read()
            if not ok:
                continue
            if now < WARM_UP_SEC:
                continue  # auto exposure still settling
            report = analyse_frame(engine, frame, profile)
            reports.append(report)
            if now - last_line >= LINE_EVERY_SEC:
                last_line = now
                print(f"{now:5.1f}s  {format_report(report, show_scores=args.show_scores)}")
    finally:
        capture.release()
    return reports


def scan_images(engine, profile: ThresholdProfile, args) -> list[FrameReport]:
    reports = []
    for path in args.image:
        frame = cv2.imread(path)
        if frame is None:
            sys.exit(f"อ่านไฟล์ภาพไม่ได้: {path}")
        report = analyse_frame(engine, frame, profile)
        reports.append(report)
        print(f"{Path(path).name}: {format_report(report, show_scores=args.show_scores)}")
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--list", action="store_true", help="list the cameras that give a picture and exit")
    parser.add_argument("--camera", default="0", help="camera index or device path (default 0)")
    parser.add_argument("--seconds", type=float, default=15.0)
    parser.add_argument("--image", nargs="+", metavar="JPG", help="scan these images, not the camera")
    parser.add_argument("--models", default=str(DEFAULT_MODELS))
    parser.add_argument("--profile", default=DEFAULT_PROFILE.name)
    parser.add_argument("--show-scores", action="store_true")
    args = parser.parse_args()

    if args.list:
        print("กล้องที่เปิดได้:")
        print("\n".join(list_cameras()))
        return 0

    models = Path(args.models)
    if missing_models(models):
        sys.exit("ยังไม่มี model — รัน ./models/download_models.sh ก่อน")
    profile = get_profile(args.profile)
    engine = FaceEngine(models)

    reports = scan_images(engine, profile, args) if args.image else scan_camera(engine, profile, args)
    print()
    print("\n".join(summarise(reports, profile)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
