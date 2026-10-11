"""Turn the JPEG from the card chip into an embedding.

The chip photo is tiny (about 5 KB) and cropped tight around the face, which YuNet dislikes, so it is
enlarged and given a border first. Only the embedding is kept; the image is dropped at once.
"""

from __future__ import annotations

import base64
import binascii
from typing import Optional

import cv2
import numpy as np

from app.face.engine import FaceEngine

JPEG_SIGNATURE = b"\xff\xd8\xff"
MIN_SIDE_PX = 24  # anything smaller is not a photo
TARGET_SIDE_PX = 400  # small photos are enlarged to about this before detection
PAD_RATIO = 0.3
MAX_PHOTO_BYTES = 1_500_000


def decode_photo(data: bytes | str | None) -> Optional[np.ndarray]:
    """Decode chip photo bytes (or the reader's `data:image/jpeg;base64,...` string) to BGR."""
    if not data:
        return None
    if isinstance(data, str):
        payload = data.split(",", 1)[1] if data.startswith("data:") else data
        try:
            data = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError):
            return None
    if len(data) > MAX_PHOTO_BYTES or not data.startswith(JPEG_SIGNATURE):
        return None
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None or min(image.shape[:2]) < MIN_SIDE_PX:
        return None
    return image


def reference_embedding(engine: FaceEngine, image: np.ndarray) -> Optional[tuple[np.ndarray, bool]]:
    """(embedding, aligned). `aligned` is False when no face was found and the fallback was used."""
    side = max(image.shape[:2])
    if side < TARGET_SIDE_PX:
        factor = TARGET_SIDE_PX / side
        image = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
    pad = int(max(image.shape[:2]) * PAD_RATIO)
    padded = cv2.copyMakeBorder(image, pad, pad, pad, pad, cv2.BORDER_REPLICATE)

    faces = engine.detect(padded)
    if faces:
        largest = max(faces, key=lambda row: float(row[2]) * float(row[3]))
        return engine.embed(padded, largest), True

    height, width = image.shape[:2]
    side = min(height, width)
    top, left = (height - side) // 2, (width - side) // 2
    return engine.embed_unaligned(image[top : top + side, left : left + side]), False
