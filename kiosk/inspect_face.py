#!/usr/bin/env python3
"""Try the kiosk face check from a terminal, without the browser or the server.

  ./inspect_face.py --card                     # chip photo from the inserted card (reader per CARD_READER in .env), live camera
  ./inspect_face.py --chip photo.jpg           # chip photo from a file
  ./inspect_face.py --card --image a.jpg b.jpg # compare against still images instead of the camera
  ./inspect_face.py --card --show-scores       # also print similarity / liveness numbers

For the team's own functional tests (plan §11, Phase 0.4 / 0.6): hold your own card, then try
holding the card, a printed copy or a phone screen up to the camera. Nothing is saved, and the
numbers are printed only with --show-scores, to your terminal. Use only your own face and card.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

import cv2

from app.face import quality
from app.face.decision import combine_similarities, decide, majority_live
from app.face.engine import FaceEngine, missing_models
from app.face.profiles import DEFAULT_PROFILE, get_profile
from app.face.reference import decode_photo, reference_embedding

DEFAULT_MODELS = Path(__file__).resolve().parent / "models"


def load_reference(args) -> bytes:
    if args.chip:
        return Path(args.chip).read_bytes()
    from app.config import DEFAULT_CARD_READER_USB_ID, load_config
    from app.scard import ThaiSmartCardReader

    config = load_config()  # the same CARD_READER choice as the kiosk (.env)
    reader = None
    try:
        if str(config.get("CARD_READER") or "pcsc").strip().lower() == "rfpro":
            from app.rfpro import RfproThaiCardReader

            reader = RfproThaiCardReader(
                str(config.get("CARD_READER_USB_ID") or "").strip() or DEFAULT_CARD_READER_USB_ID
            )
        else:
            reader = ThaiSmartCardReader()
        started = time.monotonic()
        photo = reader.read_photo()
    except Exception as error:
        sys.exit(f"Could not read the card: {error}")
    finally:
        close = getattr(reader, "close", None)
        if callable(close):
            close()
    print(f"chip photo read in {time.monotonic() - started:.1f}s ({len(photo or b'')} bytes)")
    if not photo:
        sys.exit("The card gave no photo.")
    return photo


def probe_frames(args) -> list:
    if args.image:
        frames = [cv2.imread(path) for path in args.image]
        if any(frame is None for frame in frames):
            sys.exit("Could not read one of the --image files.")
        return frames
    capture = cv2.VideoCapture(int(args.camera) if args.camera.isdigit() else args.camera)
    if not capture.isOpened():
        sys.exit(f"Could not open the camera {args.camera!r}.")
    print(f"Look at the camera... capturing {args.frames} frames")
    time.sleep(1.0)
    frames = []
    for _ in range(args.frames):
        ok, frame = capture.read()
        if ok:
            frames.append(frame)
        time.sleep(0.25)
    capture.release()
    return frames


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--card", action="store_true", help="read the chip photo from the inserted card")
    source.add_argument("--chip", metavar="JPG", help="use this chip photo file")
    parser.add_argument("--image", nargs="+", metavar="JPG", help="compare against these images, not the camera")
    parser.add_argument("--camera", default="0", help="camera index or device path (default 0)")
    parser.add_argument("--frames", type=int, default=6)
    parser.add_argument("--models", default=str(DEFAULT_MODELS))
    parser.add_argument("--profile", default=DEFAULT_PROFILE.name)
    parser.add_argument("--show-scores", action="store_true")
    args = parser.parse_args()

    models = Path(args.models)
    if missing_models(models):
        sys.exit("Models missing: run ./models/download_models.sh")
    profile = get_profile(args.profile)
    engine = FaceEngine(models)

    image = decode_photo(load_reference(args))
    if image is None:
        sys.exit("The chip photo could not be decoded.")
    built = reference_embedding(engine, image)
    reference, aligned = built
    print(f"chip photo {image.shape[1]}x{image.shape[0]}px,",
          "face found" if aligned else "NO face found (whole photo used - expect weaker results)")

    similarities, live_flags, hints = [], [], Counter()
    for index, frame in enumerate(probe_frames(args), start=1):
        hint, face = quality.assess(frame, engine.detect(frame), profile)
        line = f"frame {index}: {hint}"
        if hint == quality.OK and face is not None:
            similarity = engine.similarity(reference, engine.embed(frame, face))
            result = engine.liveness(frame, face)
            similarities.append(similarity)
            live_flags.append(result.is_real)
            line += f"  live={'yes' if result.is_real else 'NO'}"
            if args.show_scores:
                line += f"  similarity={similarity:.3f}  p_real={result.p_real:.2f}"
        else:
            hints[hint] += 1
        print(line)

    if len(similarities) >= profile.required_frames:
        similarity = combine_similarities(similarities, profile.top_k)
        verdict = decide(similarity, majority_live(live_flags), 1, profile)
        if args.show_scores:
            print(f"combined similarity {similarity:.3f} (match >= {profile.match}, "
                  f"card-held-up >= {profile.too_similar})")
    else:
        verdict = decide(None, None, 1, profile)
        print(f"only {len(similarities)} usable frame(s), need {profile.required_frames}")
    print("verdict:", verdict.result, verdict.reason or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
