"""Passive liveness with Minivision's MiniFASNet (Silent-Face-Anti-Spoofing, Apache-2.0).

Two small networks look at the face with different amounts of surrounding context (2.7x and 4.0x
the face box, resized to 80x80). Their softmax outputs are summed and the face counts as real when
class 1 wins - the same rule as the reference `test.py`. The ONNX files come from
yakhyo/face-anti-spoofing (see models/MODELS.md). Input is BGR, raw 0-255, NCHW.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

# (file, crop scale)
MODEL_SPECS = (("MiniFASNetV2.onnx", 2.7), ("MiniFASNetV1SE.onnx", 4.0))
INPUT_SIZE = 80
REAL_CLASS = 1


@dataclass(frozen=True)
class LivenessResult:
    is_real: bool
    p_real: float


def crop_for_liveness(image: np.ndarray, box_xywh: tuple[float, float, float, float], scale: float) -> np.ndarray:
    """Crop `scale` x the face box around its centre (clamped to the image) and resize to 80x80."""
    src_h, src_w = image.shape[:2]
    x, y, box_w, box_h = box_xywh
    box_w = max(box_w, 1.0)
    box_h = max(box_h, 1.0)
    scale = min((src_h - 1) / box_h, (src_w - 1) / box_w, scale)
    new_w, new_h = box_w * scale, box_h * scale
    center_x, center_y = x + box_w / 2, y + box_h / 2
    x1 = max(0, int(center_x - new_w / 2))
    y1 = max(0, int(center_y - new_h / 2))
    x2 = min(src_w - 1, int(center_x + new_w / 2))
    y2 = min(src_h - 1, int(center_y + new_h / 2))
    return cv2.resize(image[y1 : y2 + 1, x1 : x2 + 1], (INPUT_SIZE, INPUT_SIZE))


def _softmax(logits: np.ndarray) -> np.ndarray:
    exp = np.exp(logits - np.max(logits, axis=1, keepdims=True))
    return exp / exp.sum(axis=1, keepdims=True)


class LivenessModel:
    def __init__(self, models_dir: Path):
        self._nets = [
            (cv2.dnn.readNetFromONNX(str(models_dir / name)), scale) for name, scale in MODEL_SPECS
        ]
        self._lock = threading.Lock()  # cv2.dnn nets are not thread safe

    def predict(self, image: np.ndarray, face: np.ndarray) -> LivenessResult:
        box = tuple(float(v) for v in face[:4])
        total = np.zeros((1, 3), dtype=np.float64)
        with self._lock:
            for net, scale in self._nets:
                patch = crop_for_liveness(image, box, scale)  # type: ignore[arg-type]
                tensor = np.transpose(patch.astype(np.float32), (2, 0, 1))[np.newaxis]
                net.setInput(tensor)
                total += _softmax(net.forward())
        return LivenessResult(
            is_real=int(np.argmax(total)) == REAL_CLASS,
            p_real=float(total[0, REAL_CLASS] / len(self._nets)),
        )
