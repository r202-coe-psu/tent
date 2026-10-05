"""Turn one attempt's measurements into an outcome. Pure: no I/O, no OpenCV."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Optional, Sequence

from app.face.profiles import ThresholdProfile

MATCH = "match"
NOT_CONFIRMED = "not_confirmed"
RETRY = "retry"

REASON_CARD_PRESENTATION = "possible_card_presentation"
REASON_LIVENESS_FAILED = "liveness_failed"
REASON_RETRY_EXHAUSTED = "retry_exhausted"


@dataclass(frozen=True)
class Decision:
    result: str
    reason: Optional[str] = None

    @property
    def final(self) -> bool:
        return self.result != RETRY


def combine_similarities(scores: Sequence[float], top_k: int) -> float:
    """Median of the `top_k` best frames. The median (not the max) so that one lucky frame cannot
    carry an attempt."""
    if not scores:
        raise ValueError("no similarity scores")
    best = sorted(scores, reverse=True)[:top_k]
    return float(median(best))


def majority_live(flags: Sequence[bool]) -> bool:
    """A face counts as live when at least half of its frames were judged real."""
    return bool(flags) and sum(flags) * 2 >= len(flags)


def decide(
    similarity: Optional[float],
    live: Optional[bool],
    attempt: int,
    profile: ThresholdProfile,
) -> Decision:
    """`similarity` is None when too few frames passed the quality gate; `live` is None when
    liveness could not be assessed (no usable frame)."""
    if similarity is not None:
        if similarity >= profile.too_similar:
            return Decision(NOT_CONFIRMED, REASON_CARD_PRESENTATION)
        if live is False:
            return Decision(NOT_CONFIRMED, REASON_LIVENESS_FAILED)
        if similarity >= profile.match:
            return Decision(MATCH)
    if attempt >= profile.max_attempts:
        return Decision(NOT_CONFIRMED, REASON_RETRY_EXHAUSTED)
    return Decision(RETRY)
