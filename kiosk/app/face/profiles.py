"""Versioned thresholds for the kiosk face check.

The numbers are *not* calibrated on Thai ID-chip photos. `match` is the cosine SFace's authors
recommend from LFW; the quality limits are conservative first guesses to be adjusted by the team's
own functional tests. Because the check never rejects anyone (a miss goes to staff), a profile that
is too strict only sends more people to the desk. Tune by adding a new profile, never by editing a
released one, so a stored `threshold_profile` always says which numbers produced a result.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ThresholdProfile:
    name: str
    # Similarity (SFace cosine, higher = more alike).
    match: float  # at/above: same person
    too_similar: float  # at/above: suspiciously close to the chip photo (card held to the camera)
    # Attempts: one attempt = one capture burst sent to `verify`.
    max_attempts: int
    required_frames: int  # frames that pass the quality gate that one attempt needs
    top_k: int  # best frames that are averaged (median) into the attempt's similarity
    # Quality gate, per frame.
    min_detect_score: float
    min_eye_distance_ratio: float  # eye distance / image width
    max_face_width_ratio: float  # face width / image width
    max_yaw_ratio: float  # |nose offset from the eyes' midpoint| / eye distance
    max_roll_deg: float
    pitch_range: tuple[float, float]  # nose position between eyes (0) and mouth (1)
    min_sharpness: float  # variance of the Laplacian of the 112x112 gray face
    brightness_range: tuple[float, float]  # mean gray of the face, 0-255


DEFAULT_PROFILE = ThresholdProfile(
    name="sface-opencv-default-v1",
    match=0.363,
    too_similar=0.85,
    max_attempts=3,
    required_frames=3,
    top_k=3,
    min_detect_score=0.85,
    min_eye_distance_ratio=0.09,
    max_face_width_ratio=0.7,
    max_yaw_ratio=0.25,
    max_roll_deg=20.0,
    pitch_range=(0.35, 0.8),
    min_sharpness=25.0,
    brightness_range=(55.0, 215.0),
)

PROFILES = {profile.name: profile for profile in (DEFAULT_PROFILE,)}


def get_profile(name: str | None) -> ThresholdProfile:
    """Look a profile up by name; an empty name means the default."""
    if not name:
        return DEFAULT_PROFILE
    try:
        return PROFILES[name]
    except KeyError:
        raise ValueError(f"Unknown face threshold profile: {name}") from None
