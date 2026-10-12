#!/usr/bin/env python3
"""Read a Thai ID card from the USB card reader and test the face scan, in an OpenCV window.

  ./card_face_demo.py                       # reader per CARD_READER in .env (default pcsc), camera 0
  ./card_face_demo.py --reader pcsc --camera 0
  ./card_face_demo.py --show-data           # also print the card fields in the terminal
  ./card_face_demo.py --show-scores         # numbers on the picture (same as pressing S)

The window shows the live camera on the left and the photo read from the card chip on the right.
Insert the card, look at the camera, and the bar at the bottom says whether the face matches, using
exactly the same pipeline and thresholds as the kiosk (app/face). Keys: Q or Esc quit - R read the
card again - S show/hide the numbers.

Needs an OpenCV with a window system. The scanner client's `opencv-python-headless` has none, so use
a separate venv for this tool:
  python3 -m venv .venv-gui && .venv-gui/bin/pip install opencv-python numpy pillow pyscard python-dotenv
  .venv-gui/bin/python card_face_demo.py

Nothing is saved or sent anywhere: the camera frames and the chip photo stay in memory, and the
terminal shows only the last 4 digits of the ID number unless you ask for --show-data. Use only your
own card and face, or those of a person who agreed.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

# OpenCV warns about every camera index it cannot open; that is noise here. Set before the import.
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from app.face import decision, quality  # noqa: E402
from app.face.engine import FaceEngine, missing_models  # noqa: E402
from app.face.profiles import DEFAULT_PROFILE, ThresholdProfile, get_profile  # noqa: E402
from app.face.reference import decode_photo, reference_embedding  # noqa: E402
from scan_face import HINT_ADVICE, open_camera  # noqa: E402

DEFAULT_MODELS = Path(__file__).resolve().parent / "models"
WINDOW = "Card + Face test"
CAMERA_W, CAMERA_H = 640, 480
PANEL_W = 360
BAR_H = 120
CANVAS_W, CANVAS_H = CAMERA_W + PANEL_W, CAMERA_H + BAR_H
CHIP_BOX = (240, 240)  # the chip photo is shown inside this box
HEAVY_EVERY = 3  # match + liveness on every Nth frame; detection runs on all of them
WINDOW_SEC = 3.0  # frames older than this no longer count towards the verdict
WINDOW_FRAMES = 6
READER_POLL_SEC = 0.5
READER_RETRY_SEC = 2.0

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
    "/usr/share/fonts/truetype/tlwg/Loma.ttf",
    "/usr/share/fonts/truetype/tlwg/Garuda.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansThai-Regular.otf",
    "/usr/share/fonts/truetype/tlwg/TlwgTypo.ttf",
)

LATIN_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
)

# BGR
GREEN, AMBER, RED, GREY, NAVY, WHITE = (60, 160, 60), (0, 170, 240), (50, 50, 200), (130, 130, 130), (71, 38, 10), (255, 255, 255)

# -- small helpers ------------------------------------------------------------------------------


def mask_citizen_id(citizen_id: str) -> str:
    """The last 4 digits only: enough to tell cards apart, not enough to identify the person."""
    digits = re.sub(r"\D", "", citizen_id or "")
    return "*********" + digits[-4:] if len(digits) >= 4 else "(ไม่ทราบ)"


def find_thai_font(candidates=FONT_CANDIDATES) -> Optional[str]:
    """A font that can draw Thai, or None (the window then falls back to English)."""
    for path in candidates:
        if os.path.isfile(path):
            return path
    try:
        found = subprocess.run(
            ["fc-match", "-f", "%{file}", "Noto Sans Thai"], capture_output=True, text=True, timeout=3
        ).stdout.strip()
        if found and os.path.isfile(found) and "thai" in found.lower():
            return found
    except (OSError, subprocess.SubprocessError):
        pass
    return None


@dataclass(frozen=True)
class Fonts:
    """A Thai font plus one for digits and Latin letters (Noto Sans Thai has no Latin glyphs, so
    without the second font every number would show as an empty box)."""

    thai: str
    latin: str


def find_fonts() -> Optional[Fonts]:
    thai = find_thai_font()
    if thai is None:
        return None
    latin = next((path for path in LATIN_FONT_CANDIDATES if os.path.isfile(path)), thai)
    return Fonts(thai, latin)


def gui_available(build_info: Optional[str] = None) -> bool:
    """False for OpenCV builds without a window system (opencv-python-headless)."""
    info = cv2.getBuildInformation() if build_info is None else build_info
    for line in info.splitlines():
        if line.strip().startswith("GUI:"):
            return line.split(":", 1)[1].strip().upper() not in ("", "NONE")
    return False


def make_reader(kind: str, usb_id: str):
    if kind == "rfpro":
        from app.rfpro import RfproThaiCardReader

        return RfproThaiCardReader(usb_id)
    from app.scard import ThaiSmartCardReader

    return ThaiSmartCardReader()


# -- the card, read in the background so the window never freezes ---------------------------------


class CardWatcher(threading.Thread):
    """Waits for a card, reads it and builds the face reference from its photo.

    `state`: waiting (no card) -> reading -> ready, or error (with `message`). A new card, or `reset()`,
    starts over. The chip photo and the embedding live only in this object.
    """

    def __init__(
        self,
        reader_factory: Callable[[], Any],
        build_reference: Callable[[bytes], Optional[tuple[np.ndarray, bool, np.ndarray]]],
        poll_sec: float = READER_POLL_SEC,
        retry_sec: float = READER_RETRY_SEC,
    ):
        super().__init__(daemon=True)
        self._factory = reader_factory
        self._build_reference = build_reference
        self._poll = poll_sec
        self._retry = retry_sec
        self._stop_event = threading.Event()
        self._reset_event = threading.Event()
        self._lock = threading.Lock()
        self._state = "waiting"
        self._message = ""
        self._data: dict = {}
        self._photo_image: Optional[np.ndarray] = None
        self._reference: Optional[np.ndarray] = None
        self._aligned = True
        self._read_sec = 0.0

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "state": self._state,
                "message": self._message,
                "data": dict(self._data),
                "photo": self._photo_image,
                "reference": self._reference,
                "aligned": self._aligned,
                "read_sec": self._read_sec,
            }

    def reset(self) -> None:
        self._reset_event.set()

    def stop(self) -> None:
        self._stop_event.set()

    def _set(self, state: str, message: str = "", **fields: Any) -> None:
        with self._lock:
            self._state, self._message = state, message
            for key, value in fields.items():
                setattr(self, key, value)

    def run(self) -> None:
        reader = None
        card_was_removed = True  # the first card counts as new
        read_done = False
        while not self._stop_event.is_set():
            if reader is None:
                try:
                    reader = self._factory()
                except Exception as error:
                    self._set("error", f"ไม่พบตัวอ่านบัตร: {error}")
                    self._stop_event.wait(self._retry)
                    continue
                self._set("waiting", "")
            if self._reset_event.is_set():
                self._reset_event.clear()
                read_done, card_was_removed = False, True
                self._set("waiting", "", _data={}, _photo_image=None, _reference=None)
            try:
                inserted = bool(reader.is_card_inserted())
            except Exception as error:
                self._set("error", f"ตัวอ่านบัตรมีปัญหา: {error}")
                reader = None
                self._stop_event.wait(self._retry)
                continue
            if not inserted:
                card_was_removed = True
                if not read_done:
                    self._set("waiting", "")
            elif card_was_removed:  # a card has just gone in (or R asked for a fresh read)
                card_was_removed = False
                read_done = self._read_card(reader)
            self._stop_event.wait(self._poll)

    def _read_card(self, reader) -> bool:
        self._set("reading", "", _data={}, _photo_image=None, _reference=None)
        started = time.monotonic()
        try:
            data = reader.read_all_data()
        except Exception as error:
            self._set("error", f"อ่านบัตรไม่สำเร็จ ลองเสียบใหม่ ({type(error).__name__})")
            return False
        elapsed = time.monotonic() - started
        photo_base64 = data.pop("photo_base64", None)
        image = decode_photo(photo_base64)
        if image is None:
            self._set("error", "บัตรนี้ไม่มีรูปถ่ายที่อ่านได้", _data=data, _read_sec=elapsed)
            return True
        built = self._build_reference(photo_base64)
        if built is None:
            self._set("error", "หาใบหน้าในรูปบัตรไม่เจอ", _data=data, _photo_image=image, _read_sec=elapsed)
            return True
        embedding, aligned, _ = built
        self._set(
            "ready", "", _data=data, _photo_image=image, _reference=embedding, _aligned=aligned,
            _read_sec=elapsed,
        )
        return True


# -- looking at the camera ----------------------------------------------------------------------


@dataclass
class LiveReading:
    hint: str
    face: Optional[np.ndarray] = None
    similarity: Optional[float] = None
    live: Optional[bool] = None
    p_real: Optional[float] = None


def analyse_live(
    engine, frame: np.ndarray, profile: ThresholdProfile, reference: Optional[np.ndarray], heavy: bool
) -> LiveReading:
    hint, face = quality.assess(frame, engine.detect(frame), profile)
    reading = LiveReading(hint=hint, face=face)
    if face is not None and hint == quality.OK and heavy:
        result = engine.liveness(frame, face)
        reading.live, reading.p_real = result.is_real, result.p_real
        if reference is not None:
            reading.similarity = engine.similarity(reference, engine.embed(frame, face))
    return reading


@dataclass
class Verdict:
    kind: str  # waiting | collecting | match | no_match | card | fake
    text: str
    similarity: Optional[float] = None


class Recent:
    """The last few good frames (similarity, live), forgetting the old ones."""

    def __init__(self, now: Callable[[], float] = time.monotonic):
        self._now = now
        self._items: deque[tuple[float, float, bool]] = deque(maxlen=WINDOW_FRAMES)

    def add(self, similarity: float, live: bool) -> None:
        self._items.append((self._now(), similarity, live))

    def clear(self) -> None:
        self._items.clear()

    def values(self) -> tuple[list[float], list[bool]]:
        cutoff = self._now() - WINDOW_SEC
        kept = [(s, lv) for t, s, lv in self._items if t >= cutoff]
        return [s for s, _ in kept], [lv for _, lv in kept]


def verdict_for(recent: Recent, profile: ThresholdProfile, reference_ready: bool) -> Verdict:
    """What the kiosk would conclude from the recent frames (same rules as app/face/decision.py)."""
    if not reference_ready:
        return Verdict("waiting", "เสียบบัตรเพื่อเริ่มตรวจ")
    sims, lives = recent.values()
    if len(sims) < profile.required_frames:
        return Verdict("collecting", "กำลังตรวจ… มองตรงที่กล้อง")
    similarity = decision.combine_similarities(sims, profile.top_k)
    outcome = decision.decide(similarity, decision.majority_live(lives), profile.max_attempts, profile)
    if outcome.result == decision.MATCH:
        return Verdict("match", "ตรงกับรูปในบัตร", similarity)
    if outcome.reason == decision.REASON_CARD_PRESENTATION:
        return Verdict("card", "เหมือนรูปบัตรเกินไป (ส่องบัตรหรือเปล่า?)", similarity)
    if outcome.reason == decision.REASON_LIVENESS_FAILED:
        return Verdict("fake", "ดูไม่ใช่ใบหน้าจริง", similarity)
    return Verdict("no_match", "ยังไม่ตรงกับรูปในบัตร", similarity)


# -- drawing --------------------------------------------------------------------------------------

_FONTS: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

TextItem = tuple[str, tuple[int, int], int, tuple[int, int, int]]  # text, xy, size, RGB


def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, size)
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(path, size)
    return _FONTS[key]


def split_runs(text: str) -> list[tuple[bool, str]]:
    """Cut `text` into (is_thai, run). Spaces stay with the run before them."""
    runs: list[tuple[bool, str]] = []
    for char in text:
        thai = "\u0e00" <= char <= "\u0e7f" if char != " " else (runs[-1][0] if runs else False)
        if runs and runs[-1][0] == thai:
            runs[-1] = (thai, runs[-1][1] + char)
        else:
            runs.append((thai, char))
    return runs


def draw_texts(canvas: np.ndarray, items: list[TextItem], fonts: Optional[Fonts]) -> np.ndarray:
    """Write text with PIL (cv2.putText cannot draw Thai). Thai and Latin runs use their own fonts.
    Without fonts, items must already be English (PIL's built-in font)."""
    if not items:
        return canvas
    image = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(image)
    for text, (x, y), size, rgb in items:
        if fonts is None:
            draw.text((x, y), text, fill=rgb)
            continue
        for thai, run in split_runs(text):
            font = _font(fonts.thai if thai else fonts.latin, size)
            draw.text((x, y), run, font=font, fill=rgb)
            x += int(font.getlength(run))
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def _fit(image: np.ndarray, box: tuple[int, int]) -> np.ndarray:
    scale = min(box[0] / image.shape[1], box[1] / image.shape[0])
    return cv2.resize(image, (max(1, int(image.shape[1] * scale)), max(1, int(image.shape[0] * scale))))


_VERDICT_COLOR = {"match": GREEN, "no_match": AMBER, "card": RED, "fake": RED, "collecting": GREY, "waiting": GREY}
_VERDICT_EN = {
    "match": "MATCH - same person as the card photo",
    "no_match": "NOT YET - does not match the card photo",
    "card": "TOO SIMILAR - is the card held up to the camera?",
    "fake": "LOOKS NOT REAL - not a live face?",
    "collecting": "Checking... look straight at the camera",
    "waiting": "Insert the ID card to start",
}


@dataclass
class View:
    camera: Optional[np.ndarray]  # already mirrored, CAMERA_W x CAMERA_H
    face_box: Optional[tuple[int, int, int, int]] = None  # on the mirrored picture
    landmarks: list[tuple[int, int]] = field(default_factory=list)
    hint: str = quality.OK
    card: dict = field(default_factory=dict)  # snapshot() of the CardWatcher
    verdict: Verdict = field(default_factory=lambda: Verdict("waiting", ""))
    reading: Optional[LiveReading] = None
    show_scores: bool = False
    show_name: bool = False


def compose(view: View, fonts: Optional[Fonts]) -> np.ndarray:
    """The whole window as one picture. Pure: no camera, no reader, no window."""
    thai = fonts is not None
    pick = (lambda th, en: th) if thai else (lambda th, en: en)
    canvas = np.full((CANVAS_H, CANVAS_W, 3), 245, np.uint8)
    texts: list[TextItem] = []

    # camera
    if view.camera is not None:
        canvas[:CAMERA_H, :CAMERA_W] = view.camera
    else:
        canvas[:CAMERA_H, :CAMERA_W] = 40
        texts.append((pick("ไม่ได้ภาพจากกล้อง", "No picture from the camera"), (30, 220), 26, (255, 255, 255)))
    if view.face_box:
        x, y, w, h = view.face_box
        color = GREEN if view.hint == quality.OK else AMBER
        cv2.rectangle(canvas, (x, y), (x + w, y + h), color, 2)
        for point in view.landmarks:
            cv2.circle(canvas, point, 3, color, -1)
    if view.hint != quality.OK:
        advice = HINT_ADVICE.get(view.hint, view.hint)
        label = advice if thai else view.hint
        cv2.rectangle(canvas, (0, 0), (CAMERA_W, 40), AMBER, -1)
        texts.append((label, (12, 6), 24, (0, 0, 0)))

    # right panel: the chip photo
    state = view.card.get("state", "waiting")
    left = CAMERA_W + 15
    texts.append((pick("รูปจากชิปบัตร", "Photo from the card chip"), (left, 12), 22, (10, 38, 71)))
    photo = view.card.get("photo")
    if photo is not None:
        shown = _fit(photo, CHIP_BOX)
        canvas[48 : 48 + shown.shape[0], left : left + shown.shape[1]] = shown
    else:
        cv2.rectangle(canvas, (left, 48), (left + CHIP_BOX[0], 48 + CHIP_BOX[1]), (200, 200, 200), 2)
    info_y = 48 + CHIP_BOX[1] + 14
    if state == "reading":
        texts.append((pick("กำลังอ่านบัตร… อย่าดึงบัตรออก", "Reading the card... keep it in"), (left, info_y), 20, (180, 110, 0)))
    elif state == "error":
        texts.append((view.card.get("message") or "error", (left, info_y), 18, (200, 50, 50)))
    elif state == "waiting":
        texts.append((pick("เสียบบัตรประชาชน", "Insert the ID card"), (left, info_y), 22, (100, 100, 100)))
    data = view.card.get("data") or {}
    if data:
        texts.append((pick("เลขบัตร ", "ID ") + mask_citizen_id(data.get("citizen_id", "")), (left, info_y), 20, (30, 30, 30)))
        if view.show_name and thai:
            texts.append((str(data.get("full_name_th") or ""), (left, info_y + 28), 20, (30, 30, 30)))
        timing = f"{view.card.get('read_sec', 0.0):.1f}s"
        face_note = "" if view.card.get("aligned", True) else pick(" · หาใบหน้าในรูปไม่เจอ", " - no face found in photo")
        texts.append((pick("อ่านบัตรใช้เวลา ", "Card read in ") + timing + face_note, (left, info_y + 56), 18, (90, 90, 90)))
    if view.show_scores and view.reading is not None:
        r = view.reading
        lines = []
        if view.verdict.similarity is not None:
            lines.append(f"combined similarity {view.verdict.similarity:.3f}")
        if r.similarity is not None:
            lines.append(f"frame similarity {r.similarity:.3f}")
        if r.p_real is not None:
            lines.append(f"p_real {r.p_real:.2f}")
        for i, line in enumerate(lines):
            texts.append((line, (left, info_y + 90 + i * 22), 18, (60, 60, 160)))

    # bottom bar: the verdict
    bar = view.verdict
    cv2.rectangle(canvas, (0, CAMERA_H), (CANVAS_W, CANVAS_H), _VERDICT_COLOR.get(bar.kind, GREY), -1)
    headline = bar.text if thai else _VERDICT_EN.get(bar.kind, bar.kind)
    texts.append((headline, (20, CAMERA_H + 22), 34, (255, 255, 255)))
    texts.append((pick("Q ออก · R อ่านบัตรใหม่ · S แสดงตัวเลข", "Q quit - R read card again - S numbers"), (20, CAMERA_H + 82), 20, (255, 255, 255)))
    return draw_texts(canvas, texts, fonts)


def mirrored_view(frame: np.ndarray, reading: LiveReading) -> tuple[np.ndarray, Optional[tuple[int, int, int, int]], list[tuple[int, int]]]:
    """The picture as a mirror shows it, with the face box and landmarks moved to match."""
    height, width = frame.shape[:2]
    shown = cv2.flip(cv2.resize(frame, (CAMERA_W, CAMERA_H)), 1)
    if reading.face is None:
        return shown, None, []
    sx, sy = CAMERA_W / width, CAMERA_H / height
    x, y, w, h = (float(v) for v in reading.face[:4])
    box = (int(CAMERA_W - (x + w) * sx), int(y * sy), int(w * sx), int(h * sy))
    points = [(int(CAMERA_W - float(px) * sx), int(float(py) * sy)) for px, py in reading.face[4:14].reshape(5, 2)]
    return shown, box, points


# -- the loop -------------------------------------------------------------------------------------


def run_demo(
    engine,
    profile: ThresholdProfile,
    capture,
    watcher: CardWatcher,
    *,
    show: Callable[[np.ndarray], None],
    wait_key: Callable[[], int],
    window_open: Callable[[], bool] = lambda: True,
    fonts: Optional[Fonts] = None,
    show_scores: bool = False,
    show_name: bool = False,
    recent: Optional[Recent] = None,
    max_frames: Optional[int] = None,
) -> None:
    recent = recent or Recent()
    frame_no = 0
    last_ref_id: Optional[int] = None
    last_reading: Optional[LiveReading] = None
    while window_open() and (max_frames is None or frame_no < max_frames):
        ok, frame = capture.read()
        card = watcher.snapshot()
        reference = card["reference"] if card["state"] == "ready" else None
        if id(reference) != last_ref_id:  # a new card: start the verdict afresh
            last_ref_id = id(reference)
            recent.clear()
        if ok and frame is not None:
            reading = analyse_live(engine, frame, profile, reference, heavy=frame_no % HEAVY_EVERY == 0)
            if reading.similarity is not None and reading.live is not None:
                recent.add(reading.similarity, reading.live)
            last_reading = reading
            camera, box, points = mirrored_view(frame, reading)
            view = View(camera, box, points, reading.hint, card, show_scores=show_scores, show_name=show_name)
        else:
            reading = last_reading
            view = View(None, hint=quality.OK, card=card, show_scores=show_scores, show_name=show_name)
        view.reading = reading
        view.verdict = verdict_for(recent, profile, reference is not None)
        show(compose(view, fonts))
        frame_no += 1
        key = wait_key()
        if key in (ord("q"), ord("Q"), 27):
            return
        if key in (ord("r"), ord("R")):
            watcher.reset()
            recent.clear()
        if key in (ord("s"), ord("S")):
            show_scores = not show_scores


def print_card(data: dict, show_data: bool) -> None:
    if show_data:
        for key, value in data.items():
            print(f"  {key}: {value}")
    else:
        print(f"  เลขบัตร {mask_citizen_id(data.get('citizen_id', ''))} (ใช้ --show-data เพื่อดูข้อมูลทั้งหมด)")


GUI_HELP = """OpenCV ตัวนี้ไม่มีหน้าต่าง (opencv-python-headless) เปิด popup ไม่ได้
ใช้ venv แยกที่ลง opencv-python แบบมี GUI (ไม่ไปแตะ venv ของ scanner_client):

  python3 -m venv .venv-gui
  .venv-gui/bin/pip install opencv-python numpy pillow pyscard python-dotenv
  .venv-gui/bin/python card_face_demo.py
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--reader", choices=("pcsc", "rfpro"), help="default: CARD_READER in .env, else pcsc")
    parser.add_argument("--camera", default="0", help="camera index or device path (default 0)")
    parser.add_argument("--models", default=str(DEFAULT_MODELS))
    parser.add_argument("--profile", default=DEFAULT_PROFILE.name)
    parser.add_argument("--show-scores", action="store_true")
    parser.add_argument("--show-data", action="store_true", help="print every card field in the terminal")
    args = parser.parse_args()

    if not gui_available():
        sys.stderr.write(GUI_HELP)
        return 2
    models = Path(args.models)
    if missing_models(models):
        sys.exit("ยังไม่มี model — รัน ./models/download_models.sh ก่อน")

    from app.config import DEFAULT_CARD_READER_USB_ID, load_config

    config = load_config()
    kind = args.reader or str(config.get("CARD_READER") or "pcsc").strip().lower()
    usb_id = str(config.get("CARD_READER_USB_ID") or "").strip() or DEFAULT_CARD_READER_USB_ID
    profile = get_profile(args.profile)
    engine = FaceEngine(models)

    def build_reference(photo_base64: str):
        image = decode_photo(photo_base64)
        built = reference_embedding(engine, image) if image is not None else None
        return (built[0], built[1], image) if built else None

    capture = open_camera(int(args.camera) if args.camera.isdigit() else args.camera)
    if not capture.isOpened():
        sys.exit(f"เปิดกล้อง {args.camera!r} ไม่ได้ (ลอง ./scan_face.py --list)")
    fonts = find_fonts()
    if fonts is None:
        print("(ไม่พบฟอนต์ไทย — หน้าต่างจะใช้ภาษาอังกฤษ)")

    watcher = CardWatcher(lambda: make_reader(kind, usb_id), build_reference)
    watcher.start()
    printed_for: Optional[int] = None

    def show(picture: np.ndarray) -> None:
        nonlocal printed_for
        cv2.imshow(WINDOW, picture)
        card = watcher.snapshot()
        if card["state"] == "ready" and id(card["reference"]) != printed_for:
            printed_for = id(card["reference"])
            print(f"อ่านบัตรสำเร็จ ใช้เวลา {card['read_sec']:.1f}s")
            print_card(card["data"], args.show_data)

    cv2.namedWindow(WINDOW, cv2.WINDOW_AUTOSIZE)
    print(f"เปิดหน้าต่างแล้ว · ตัวอ่าน: {kind} · เสียบบัตรได้เลย (Q ออก, R อ่านบัตรใหม่, S ตัวเลข)")
    try:
        run_demo(
            engine, profile, capture, watcher,
            show=show,
            wait_key=lambda: cv2.waitKey(1) & 0xFF,
            window_open=lambda: cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) >= 1,
            fonts=fonts,
            show_scores=args.show_scores,
            show_name=args.show_data,
        )
    finally:
        watcher.stop()
        capture.release()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
