"""Per-frame quality gate. Says *why* a frame is unusable so the kiosk can tell the person."""

from __future__ import annotations

import math

import cv2
import numpy as np

from app.face.profiles import ThresholdProfile

OK = "ok"
NO_FACE = "no_face"
MULTIPLE_FACES = "multiple_faces"
TOO_FAR = "too_far"
TOO_CLOSE = "too_close"
TURN_STRAIGHT = "turn_straight"
TOO_DARK = "too_dark"
TOO_BRIGHT = "too_bright"
BLURRY = "blurry"

# YuNet row: x, y, w, h, then (x, y) of right eye, left eye, nose, right and left mouth corner
# ("right" = the subject's right, which is on the left of the image), then the score.
_SHARPNESS_SIZE = 112


def _points(face: np.ndarray) -> tuple[np.ndarray, ...]:
    pts = face[4:14].reshape(5, 2)
    return pts[0], pts[1], pts[2], pts[3], pts[4]


def pose_ratios(face: np.ndarray) -> tuple[float, float, float]:
    """(yaw ratio, pitch ratio, roll degrees) estimated from the five landmarks."""
    right_eye, left_eye, nose, right_mouth, left_mouth = _points(face)
    eye_mid = (right_eye + left_eye) / 2
    mouth_mid = (right_mouth + left_mouth) / 2
    eye_vec = left_eye - right_eye
    eye_dist = float(np.hypot(*eye_vec)) or 1e-6
    yaw = abs(float(nose[0] - eye_mid[0])) / eye_dist
    span = float(mouth_mid[1] - eye_mid[1]) or 1e-6
    pitch = float(nose[1] - eye_mid[1]) / span
    roll = abs(math.degrees(math.atan2(float(eye_vec[1]), float(eye_vec[0]))))
    return yaw, pitch, roll


def assess(
    image: np.ndarray, faces: list[np.ndarray], profile: ThresholdProfile
) -> tuple[str, np.ndarray | None]:
    """Return (hint, face). `hint` is OK or the first problem found; `face` is the single detected
    row (also returned for a failed gate so the caller can still draw on it), or None."""
    if not faces:
        return NO_FACE, None
    if len(faces) > 1:
        return MULTIPLE_FACES, None
    face = faces[0]
    height, width = image.shape[:2]

    if float(face[14]) < profile.min_detect_score:
        return NO_FACE, face

    right_eye, left_eye, *_ = _points(face)
    eye_dist = float(np.hypot(*(left_eye - right_eye)))
    if eye_dist < profile.min_eye_distance_ratio * width:
        return TOO_FAR, face
    if float(face[2]) > profile.max_face_width_ratio * width:
        return TOO_CLOSE, face

    x, y, w, h = (int(round(float(v))) for v in face[:4])
    x0, y0 = max(0, x), max(0, y)
    crop = image[y0 : min(height, y + h), x0 : min(width, x + w)]
    if crop.size == 0:
        return NO_FACE, face
    gray = cv2.cvtColor(cv2.resize(crop, (_SHARPNESS_SIZE, _SHARPNESS_SIZE)), cv2.COLOR_BGR2GRAY)

    brightness = float(gray.mean())
    if brightness < profile.brightness_range[0]:
        return TOO_DARK, face
    if brightness > profile.brightness_range[1]:
        return TOO_BRIGHT, face

    yaw, pitch, roll = pose_ratios(face)
    low, high = profile.pitch_range
    if yaw > profile.max_yaw_ratio or roll > profile.max_roll_deg or not low <= pitch <= high:
        return TURN_STRAIGHT, face

    if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < profile.min_sharpness:
        return BLURRY, face
    return OK, face
