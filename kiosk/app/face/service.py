"""Orchestrates one kiosk face check. The browser sends camera frames to the scanner client and gets
back only a verdict or a hint: the camera frames and the embeddings never leave this process, and
nothing is written to disk. The one exception is a check-in that matches: its chip photo goes back to
the page once, with the verdict, so the check-in can keep it as the person's photo. Nothing logged
here carries a citizen ID, a score or an image."""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import cv2
import numpy as np

from app.face import decision as decisions
from app.face import quality
from app.face.decision import combine_similarities, decide, majority_live
from app.face.engine import MODEL_ID, FaceEngine
from app.face.profiles import ThresholdProfile
from app.face.reference import JPEG_SIGNATURE, decode_photo, reference_embedding
from app.face.session import (
    FLOW_CHECK_IN,
    FLOW_WALK_IN,
    FLOWS,
    REFERENCE_READY,
    REFERENCE_UNAVAILABLE,
    FaceSession,
)

logger = logging.getLogger(__name__)

REFERENCE_WAIT_SEC = 20.0  # how long `verify` waits for the chip photo to be read
SESSION_TTL_SEC = 300.0
STASH_TTL_SEC = 180.0
MAX_FRAMES = 8
MAX_FRAME_BYTES = 600_000

# Outcomes that are not a verdict on the face.
SKIPPED = "skipped"
HINT_REFERENCE_PENDING = "reference_pending"

PhotoReader = Callable[[], Awaitable[Optional[bytes]]]


class FaceStateError(RuntimeError):
    """No face check is in progress (never started, cancelled or expired)."""


class FaceInputError(ValueError):
    """The request carried unusable data."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def decode_frame(raw: bytes) -> Optional[np.ndarray]:
    if not raw or len(raw) > MAX_FRAME_BYTES or not raw.startswith(JPEG_SIGNATURE):
        return None
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)


class FaceService:
    def __init__(
        self,
        models_dir: Path,
        profile: ThresholdProfile,
        *,
        engine: Optional[FaceEngine] = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.profile = profile
        self._models_dir = models_dir
        self._engine = engine
        self._engine_lock = asyncio.Lock()
        self._clock = clock
        self._stash: Optional[tuple[str, bytes | str, float]] = None
        self._session: Optional[FaceSession] = None
        # Wipe timers: the TTLs are also checked on use, but a page that dies mid-check never
        # calls again, and the chip photo / embedding must not sit in RAM until the next person.
        self._stash_timer: Optional[asyncio.TimerHandle] = None
        self._session_timer: Optional[asyncio.TimerHandle] = None

    # -- engine -----------------------------------------------------------------------------

    async def warm_up(self) -> FaceEngine:
        """Load the models off the event loop (first load takes a second or two)."""
        async with self._engine_lock:
            if self._engine is None:
                self._engine = await asyncio.to_thread(FaceEngine, self._models_dir)
            return self._engine

    # -- chip photo hand-off ----------------------------------------------------------------

    def stash_photo(self, citizen_id: str, photo: bytes | str | None) -> None:
        """Walk-in: the full card read already holds the chip photo. Keep it briefly so `start` can
        use it once the person has agreed to the face check. Wiped by `start`, `cancel` or its TTL."""
        if photo:
            self._stash = (citizen_id, photo, self._clock() + STASH_TTL_SEC)
            self._stash_timer = self._reschedule(self._stash_timer, STASH_TTL_SEC, self._clear_stash)

    def _take_stash(self, citizen_id: str) -> Optional[bytes | str]:
        stash = self._stash
        self._clear_stash()
        if stash and stash[0] == citizen_id and self._clock() < stash[2]:
            return stash[1]
        return None

    def _clear_stash(self) -> None:
        self._stash = None
        self._stash_timer = self._reschedule(self._stash_timer, None, None)

    @staticmethod
    def _reschedule(
        handle: Optional[asyncio.TimerHandle],
        delay: Optional[float],
        callback: Optional[Callable[[], None]],
    ) -> Optional[asyncio.TimerHandle]:
        """Cancel `handle`, then (if `delay` is given) start a new timer on the running loop. With no
        running loop the TTL is still enforced when the data is next used."""
        if handle is not None:
            handle.cancel()
        if delay is None or callback is None:
            return None
        try:
            return asyncio.get_running_loop().call_later(delay, callback)
        except RuntimeError:
            return None

    # -- lifecycle --------------------------------------------------------------------------

    def _active(self) -> FaceSession:
        session = self._session
        if session and self._clock() - session.started_at > SESSION_TTL_SEC:
            self.cancel()
            session = None
        if session is None:
            raise FaceStateError("no face check in progress")
        return session

    async def start(
        self, citizen_id: str, flow: str, read_photo: Optional[PhotoReader] = None
    ) -> dict[str, Any]:
        """Begin a check once the person has agreed to it. `read_photo` reads the chip photo from
        the inserted card (check-in); walk-in uses the photo stashed from the full read."""
        if flow not in FLOWS:
            raise FaceInputError("unknown flow")
        engine = await self.warm_up()  # FileNotFoundError here means the models are not installed
        self._drop_session()  # keep the stash: a walk-in's photo was set aside before this call
        session = FaceSession(citizen_id, flow, self._clock(), _utc_now())
        self._session = session
        self._session_timer = self._reschedule(
            self._session_timer, SESSION_TTL_SEC, lambda: self._expire_session(session)
        )

        if flow == FLOW_WALK_IN:
            photo = self._take_stash(citizen_id)
            if photo is None:
                session.set_unavailable("no_chip_photo")
            else:
                session.reference_task = asyncio.create_task(
                    self._prepare_reference(session, engine, photo)
                )
        elif read_photo is None:
            session.set_unavailable("no_chip_photo")
        else:
            session.reference_task = asyncio.create_task(
                self._read_reference(session, engine, read_photo)
            )
        return {
            "ok": True,
            "reference": session.reference_state,
            "max_attempts": self.profile.max_attempts,
        }

    async def _read_reference(
        self, session: FaceSession, engine: FaceEngine, read_photo: PhotoReader
    ) -> None:
        try:
            photo = await read_photo()
        except Exception:
            if session is self._session:
                session.set_unavailable("card_removed")
            return
        if photo is None:
            if session is self._session:
                session.set_unavailable("no_chip_photo")
            return
        await self._prepare_reference(session, engine, photo)
        if (
            session is self._session
            and session.reference_state == REFERENCE_READY
            and isinstance(photo, bytes)
            and photo.startswith(JPEG_SIGNATURE)
        ):
            session.chip_photo = photo  # handed to the page only if the face matches

    async def _prepare_reference(
        self, session: FaceSession, engine: FaceEngine, photo: bytes | str
    ) -> None:
        def build() -> Optional[np.ndarray]:
            image = decode_photo(photo)
            if image is None:
                return None
            built = reference_embedding(engine, image)
            return built[0] if built else None

        embedding = await asyncio.to_thread(build)
        if session is not self._session:
            return  # cancelled while working
        if embedding is None:
            session.set_unavailable("no_chip_photo")
        else:
            session.set_reference(embedding)

    def _drop_session(self) -> None:
        self._session_timer = self._reschedule(self._session_timer, None, None)
        if self._session:
            self._session.clear()
        self._session = None

    def _expire_session(self, session: FaceSession) -> None:
        self._session_timer = None
        if session is self._session:
            logger.info("Face check expired without an end call; wiping it")
            self._drop_session()  # a stash belongs to whoever read a card since: it has its own timer

    def cancel(self) -> None:
        """Wipe everything held for the current person."""
        self._clear_stash()
        self._drop_session()

    # -- preview ----------------------------------------------------------------------------

    async def frame(self, raw: bytes) -> dict[str, Any]:
        """Judge one preview frame so the screen can tell the person how to stand."""
        session = self._active()
        engine = await self.warm_up()

        def judge() -> dict[str, Any]:
            image = decode_frame(raw)
            if image is None:
                raise FaceInputError("not a usable JPEG frame")
            hint, face = quality.assess(image, engine.detect(image), self.profile)
            return {"face": face is not None, "hint": hint, "ready": hint == quality.OK}

        reply = await asyncio.to_thread(judge)
        # Lets a check-in screen say when the card can be taken out (the chip photo is read).
        reply["reference"] = session.reference_state
        return reply

    # -- verification -----------------------------------------------------------------------

    async def verify(self, frames: list[bytes]) -> dict[str, Any]:
        session = self._active()
        if not 1 <= len(frames) <= MAX_FRAMES:
            raise FaceInputError("expected between 1 and %d frames" % MAX_FRAMES)
        if session.outcome is not None:  # a repeated call answers the same
            return self._reply(session, session.outcome)

        if session.reference_task and not session.reference_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(session.reference_task), REFERENCE_WAIT_SEC)
            except asyncio.TimeoutError:
                return {"result": decisions.RETRY, "hint": HINT_REFERENCE_PENDING,
                        "attempt": session.attempts}
        if session is not self._session:
            raise FaceStateError("face check was cancelled")

        if session.reference_state == REFERENCE_UNAVAILABLE:
            return self._finish(session, SKIPPED, session.reference_reason, None)
        if session.reference is None or session.reference_state != REFERENCE_READY:
            return {"result": decisions.RETRY, "hint": HINT_REFERENCE_PENDING,
                    "attempt": session.attempts}

        engine = await self.warm_up()
        measured = await asyncio.to_thread(self._measure, engine, session.reference, frames)
        similarities, live_flags, hints = measured
        if session is not self._session:
            raise FaceStateError("face check was cancelled")
        hint = hints.most_common(1)[0][0] if hints else quality.OK

        # Only a burst that could be compared is an attempt: one spoilt by moving or bad light
        # costs nothing. The page's own positioning timeout keeps this from looping forever.
        if len(similarities) < self.profile.required_frames:
            return {"result": decisions.RETRY, "hint": hint, "attempt": session.attempts}
        session.attempts += 1
        similarity = combine_similarities(similarities, self.profile.top_k)
        live = majority_live(live_flags)

        verdict = decide(similarity, live, session.attempts, self.profile)
        if not verdict.final:
            # Only the generic quality hint: never why a burst looked fake.
            return {"result": decisions.RETRY, "hint": hint, "attempt": session.attempts}
        return self._finish(session, verdict.result, verdict.reason, live)

    def _measure(
        self, engine: FaceEngine, reference: np.ndarray, frames: list[bytes]
    ) -> tuple[list[float], list[bool], Counter]:
        similarities: list[float] = []
        live_flags: list[bool] = []
        hints: Counter = Counter()
        for raw in frames:
            image = decode_frame(raw)
            if image is None:
                hints[quality.NO_FACE] += 1
                continue
            hint, face = quality.assess(image, engine.detect(image), self.profile)
            if hint != quality.OK or face is None:
                hints[hint] += 1
                continue
            similarities.append(engine.similarity(reference, engine.embed(image, face)))
            live_flags.append(engine.liveness(image, face).is_real)
        return similarities, live_flags, hints

    def _finish(
        self, session: FaceSession, result: str, reason: Optional[str], live: Optional[bool]
    ) -> dict[str, Any]:
        session.outcome = {
            "result": result,
            "reason": reason,
            "liveness": "not_checked" if live is None else ("pass" if live else "fail"),
        }
        session.reference = None  # the embedding has done its job
        chip_photo, session.chip_photo = session.chip_photo, None  # sent at most once, then gone
        logger.info(
            "Face check finished: flow=%s result=%s reason=%s attempts=%d",
            session.flow, result, reason, session.attempts,
        )
        reply = self._reply(session, session.outcome)
        if result == decisions.MATCH and session.flow == FLOW_CHECK_IN and chip_photo:
            reply["chip_photo"] = base64.b64encode(chip_photo).decode("ascii")
        return reply

    @staticmethod
    def _reply(session: FaceSession, outcome: dict) -> dict[str, Any]:
        reply: dict[str, Any] = {"result": outcome["result"], "attempt": session.attempts}
        if outcome["reason"]:
            reply["reason"] = outcome["reason"]
        return reply

    # -- result for the server (Phase 3 attaches this to /register and /check-in) ------------

    def identity_check(self, *, mode: str, device_id: str) -> Optional[dict[str, Any]]:
        """The record for `identity_check` (plan §8), or None while there is no final outcome. The
        server does not accept it yet, so nothing sends it."""
        session = self._session
        if session is None or session.outcome is None:
            return None
        check: dict[str, Any] = {
            "method": "face_1to1_chip",
            "flow": session.flow,
            "result": session.outcome["result"],
            "liveness": session.outcome["liveness"],
            "attempts": session.attempts,
            "model_id": MODEL_ID,
            "threshold_profile": self.profile.name,
            "mode": mode,
            "biometric_consented_at": session.consented_at,
            "checked_at": _utc_now(),
            "device_id": device_id,
        }
        if session.outcome["reason"]:
            check["reason"] = session.outcome["reason"]
        return check
