"""YuNet (detect + 5 landmarks) and SFace (128-d embedding) through OpenCV."""

from __future__ import annotations

import threading
from pathlib import Path

import cv2
import numpy as np

from app.face.liveness import LivenessModel, LivenessResult

YUNET_FILE = "face_detection_yunet_2023mar.onnx"
SFACE_FILE = "face_recognition_sface_2021dec.onnx"
LIVENESS_FILES = ("MiniFASNetV2.onnx", "MiniFASNetV1SE.onnx")
REQUIRED_FILES = (YUNET_FILE, SFACE_FILE, *LIVENESS_FILES)
MODEL_ID = "yunet-2023mar+sface-2021dec+minifasnet-v2-v1se"

# Detect with a loose score so a small, soft chip photo is still found; the quality gate applies
# the stricter limit to live frames.
DETECT_SCORE_FLOOR = 0.6
ALIGNED_SIZE = 112


def missing_models(models_dir: Path) -> list[str]:
    return [name for name in REQUIRED_FILES if not (models_dir / name).is_file()]


class FaceEngine:
    def __init__(self, models_dir: Path):
        missing = missing_models(models_dir)
        if missing:
            raise FileNotFoundError(
                "Face models missing (run models/download_models.sh): " + ", ".join(missing)
            )
        self._detector = cv2.FaceDetectorYN.create(
            str(models_dir / YUNET_FILE), "", (320, 320), DETECT_SCORE_FLOOR, 0.3, 5
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(models_dir / SFACE_FILE), "")
        self._liveness = LivenessModel(models_dir)
        self._lock = threading.Lock()  # the detector's input size and the nets are shared state

    def detect(self, image: np.ndarray) -> list[np.ndarray]:
        """Faces found in a BGR image, best score first."""
        with self._lock:
            self._detector.setInputSize((image.shape[1], image.shape[0]))
            _, faces = self._detector.detect(image)
        if faces is None:
            return []
        return sorted(faces, key=lambda row: float(row[14]), reverse=True)

    def embed(self, image: np.ndarray, face: np.ndarray) -> np.ndarray:
        """Embedding of a face aligned on its five landmarks."""
        with self._lock:
            return self._recognizer.feature(self._recognizer.alignCrop(image, face))

    def embed_unaligned(self, image: np.ndarray) -> np.ndarray:
        """Embedding of a whole image squeezed to 112x112 - the fallback when the chip photo yields
        no landmarks. Less reliable, so it errs towards 'not confirmed'."""
        with self._lock:
            return self._recognizer.feature(cv2.resize(image, (ALIGNED_SIZE, ALIGNED_SIZE)))

    def similarity(self, first: np.ndarray, second: np.ndarray) -> float:
        with self._lock:
            return float(self._recognizer.match(first, second, cv2.FaceRecognizerSF_FR_COSINE))

    def liveness(self, image: np.ndarray, face: np.ndarray) -> LivenessResult:
        return self._liveness.predict(image, face)
