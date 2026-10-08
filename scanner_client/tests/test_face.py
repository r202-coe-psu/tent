import asyncio
import base64
import unittest
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

from app.face import decision, quality
from app.face.decision import Decision, combine_similarities, decide, majority_live
from app.face.liveness import INPUT_SIZE, LivenessResult, crop_for_liveness
from app.face.profiles import DEFAULT_PROFILE, get_profile
from app.face.reference import decode_photo, reference_embedding
from app.face import service as face_service
from app.face.service import FaceInputError, FaceService, FaceStateError

PROFILE = DEFAULT_PROFILE
CID = "1234567890123"


def textured(width=640, height=480, level=128, seed=0):
    """A synthetic image sharp and bright enough to pass the gate. Never a real face."""
    noise = np.random.default_rng(seed).integers(-40, 40, (height, width, 3))
    return np.clip(level + noise, 0, 255).astype(np.uint8)


def jpeg(image=None, quality_=90):
    image = textured() if image is None else image
    return cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality_])[1].tobytes()


def face_row(x=220, y=140, w=200, h=240, score=0.95, yaw_shift=0.0, tilt=0.0):
    """A YuNet row for a frontal face. Eyes 80 px apart, nose centred, mouth below."""
    cx = x + w / 2
    eye_y = y + h * 0.38
    right_eye = (cx - 40, eye_y - tilt / 2)
    left_eye = (cx + 40, eye_y + tilt / 2)
    nose = (cx + yaw_shift * 80, eye_y + h * 0.17)
    mouth_y = y + h * 0.72
    return np.array(
        [x, y, w, h, *right_eye, *left_eye, *nose, cx - 28, mouth_y, cx + 28, mouth_y, score],
        dtype=np.float32,
    )


class DecisionTests(unittest.TestCase):
    def test_similarity_is_the_median_of_the_best_frames(self):
        self.assertAlmostEqual(combine_similarities([0.1, 0.5, 0.6, 0.4, 0.9], 3), 0.6)
        self.assertAlmostEqual(combine_similarities([0.5], 3), 0.5)
        with self.assertRaises(ValueError):
            combine_similarities([], 3)

    def test_live_needs_at_least_half_the_frames(self):
        self.assertTrue(majority_live([True, True, False, False]))
        self.assertFalse(majority_live([True, False, False]))
        self.assertFalse(majority_live([]))

    def test_a_similar_enough_live_face_matches(self):
        self.assertEqual(decide(0.5, True, 1, PROFILE), Decision(decision.MATCH))
        self.assertEqual(decide(PROFILE.match, True, 1, PROFILE), Decision(decision.MATCH))

    def test_below_the_threshold_retries_until_the_last_attempt(self):
        self.assertEqual(decide(0.2, True, 1, PROFILE), Decision(decision.RETRY))
        self.assertEqual(decide(0.2, True, PROFILE.max_attempts - 1, PROFILE), Decision(decision.RETRY))
        self.assertEqual(
            decide(0.2, True, PROFILE.max_attempts, PROFILE),
            Decision(decision.NOT_CONFIRMED, decision.REASON_RETRY_EXHAUSTED),
        )

    def test_too_few_good_frames_is_a_retry_then_exhausted(self):
        self.assertEqual(decide(None, None, 1, PROFILE), Decision(decision.RETRY))
        self.assertEqual(
            decide(None, None, PROFILE.max_attempts, PROFILE).reason, decision.REASON_RETRY_EXHAUSTED
        )

    def test_a_face_too_close_to_the_chip_photo_retries_then_looks_like_the_card_held_up(self):
        self.assertEqual(decide(PROFILE.too_similar, True, 1, PROFILE), Decision(decision.RETRY))
        verdict = decide(PROFILE.too_similar, True, PROFILE.max_attempts, PROFILE)
        self.assertEqual(verdict, Decision(decision.NOT_CONFIRMED, decision.REASON_CARD_PRESENTATION))
        self.assertTrue(verdict.final)

    def test_a_face_judged_fake_is_never_a_match_but_gets_every_attempt(self):
        for attempt in range(1, PROFILE.max_attempts):
            self.assertEqual(decide(0.7, False, attempt, PROFILE), Decision(decision.RETRY))
        self.assertEqual(
            decide(0.7, False, PROFILE.max_attempts, PROFILE),
            Decision(decision.NOT_CONFIRMED, decision.REASON_LIVENESS_FAILED),
        )

    def test_the_final_reason_is_the_last_attempts(self):
        last = PROFILE.max_attempts
        self.assertEqual(decide(0.1, True, last, PROFILE).reason, decision.REASON_RETRY_EXHAUSTED)
        self.assertEqual(decide(0.7, False, last, PROFILE).reason, decision.REASON_LIVENESS_FAILED)
        self.assertEqual(decide(0.95, True, last, PROFILE).reason, decision.REASON_CARD_PRESENTATION)

    def test_the_default_profile_is_the_named_one_and_unknown_names_fail(self):
        self.assertIs(get_profile(None), DEFAULT_PROFILE)
        self.assertIs(get_profile("sface-opencv-default-v1"), DEFAULT_PROFILE)
        with self.assertRaises(ValueError):
            get_profile("nope")


class QualityTests(unittest.TestCase):
    def hint(self, image=None, faces=None):
        image = textured() if image is None else image
        faces = [face_row()] if faces is None else faces
        return quality.assess(image, faces, PROFILE)[0]

    def test_a_good_frame_passes(self):
        self.assertEqual(self.hint(), quality.OK)

    def test_no_face_and_several_faces(self):
        self.assertEqual(self.hint(faces=[]), quality.NO_FACE)
        self.assertEqual(self.hint(faces=[face_row(), face_row(x=10)]), quality.MULTIPLE_FACES)
        self.assertEqual(self.hint(faces=[face_row(score=0.5)]), quality.NO_FACE)

    def test_distance(self):
        small = face_row(w=60, h=70)
        small[4:14:2] = small[4:14:2] * 0.0 + np.array([300, 340, 320, 310, 330], dtype=np.float32)
        small[5:14:2] = np.array([200, 200, 215, 235, 235], dtype=np.float32)
        self.assertEqual(self.hint(faces=[small]), quality.TOO_FAR)
        self.assertEqual(self.hint(faces=[face_row(x=10, w=520)]), quality.TOO_CLOSE)

    def test_light(self):
        self.assertEqual(self.hint(textured(level=20)), quality.TOO_DARK)
        self.assertEqual(self.hint(textured(level=250)), quality.TOO_BRIGHT)

    def test_a_turned_or_tilted_head_is_asked_to_face_the_camera(self):
        self.assertEqual(self.hint(faces=[face_row(yaw_shift=0.5)]), quality.TURN_STRAIGHT)
        self.assertEqual(self.hint(faces=[face_row(tilt=60)]), quality.TURN_STRAIGHT)

    def test_a_flat_image_is_blurry(self):
        self.assertEqual(self.hint(np.full((480, 640, 3), 128, np.uint8)), quality.BLURRY)

    def test_pose_ratios_of_a_frontal_face_are_small(self):
        yaw, pitch, roll = quality.pose_ratios(face_row())
        self.assertLess(yaw, 0.05)
        self.assertLess(roll, 1.0)
        self.assertTrue(0.35 <= pitch <= 0.8)


class LivenessCropTests(unittest.TestCase):
    def test_crop_is_always_80_by_80(self):
        image = textured()
        for scale in (2.7, 4.0):
            crop = crop_for_liveness(image, (220, 140, 200, 240), scale)
            self.assertEqual(crop.shape, (INPUT_SIZE, INPUT_SIZE, 3))

    def test_a_face_at_the_image_edge_is_clamped_not_an_error(self):
        crop = crop_for_liveness(textured(), (0, 0, 200, 240), 4.0)
        self.assertEqual(crop.shape, (INPUT_SIZE, INPUT_SIZE, 3))
        crop = crop_for_liveness(textured(), (500, 300, 400, 400), 2.7)
        self.assertEqual(crop.shape, (INPUT_SIZE, INPUT_SIZE, 3))


class FakeEngine:
    """Stands in for FaceEngine: scripted detections and similarities, no models. `live` is a bool
    or a list of per-call verdicts (the last one repeats)."""

    def __init__(self, similarities=(0.6,), live=True, faces=None):
        self.similarities = list(similarities)
        self.live = list(live) if isinstance(live, (list, tuple)) else [live]
        self.faces = [face_row()] if faces is None else faces
        self.detect_sizes = []
        self.unaligned_calls = 0
        self.embedded = 0

    def detect(self, image):
        self.detect_sizes.append(image.shape[:2])
        return list(self.faces)

    def embed(self, image, face):
        self.embedded += 1
        return np.ones((1, 128), dtype=np.float32)

    def embed_unaligned(self, image):
        self.unaligned_calls += 1
        return np.ones((1, 128), dtype=np.float32)

    def similarity(self, first, second):
        return self.similarities.pop(0) if len(self.similarities) > 1 else self.similarities[0]

    def liveness(self, image, face):
        live = self.live.pop(0) if len(self.live) > 1 else self.live[0]
        return LivenessResult(is_real=live, p_real=0.9 if live else 0.1)


class ReferenceTests(unittest.TestCase):
    def test_decode_accepts_jpeg_bytes_and_data_urls(self):
        data = jpeg(textured(120, 150))
        self.assertEqual(decode_photo(data).shape[:2], (150, 120))
        url = "data:image/jpeg;base64," + base64.b64encode(data).decode()
        self.assertEqual(decode_photo(url).shape[:2], (150, 120))

    def test_decode_rejects_what_is_not_a_usable_photo(self):
        self.assertIsNone(decode_photo(None))
        self.assertIsNone(decode_photo(b""))
        self.assertIsNone(decode_photo(b"\x89PNG\r\n\x1a\n" + b"0" * 50))
        self.assertIsNone(decode_photo("data:image/jpeg;base64,@@@"))
        self.assertIsNone(decode_photo(jpeg(textured(10, 10))))  # too small to be a photo
        self.assertIsNone(decode_photo(b"\xff\xd8\xff" + b"0" * 2_000_000))

    def test_a_small_chip_photo_is_enlarged_and_padded_before_detection(self):
        engine = FakeEngine()
        built = reference_embedding(engine, textured(100, 120))
        self.assertTrue(built[1])
        height, width = engine.detect_sizes[0]
        self.assertGreater(height, 400)
        self.assertGreater(width, 300)

    def test_without_landmarks_the_whole_photo_is_used_and_flagged(self):
        engine = FakeEngine(faces=[])
        embedding, aligned = reference_embedding(engine, textured(100, 120))
        self.assertFalse(aligned)
        self.assertEqual(engine.unaligned_calls, 1)
        self.assertEqual(embedding.shape, (1, 128))


class FaceServiceTests(unittest.IsolatedAsyncioTestCase):
    def make(self, engine=None, clock=None):
        self.engine = engine or FakeEngine()
        kwargs = {"clock": clock} if clock else {}
        return FaceService(Path("/nonexistent"), PROFILE, engine=self.engine, **kwargs)

    def frames(self, count=6):
        return [jpeg(textured(seed=i)) for i in range(count)]

    async def start_walk_in(self, service, photo=None):
        service.stash_photo(CID, photo if photo is not None else jpeg(textured(100, 120)))
        return await service.start(CID, "walk_in")

    async def test_walk_in_uses_the_photo_set_aside_by_the_full_read(self):
        service = self.make()
        started = await self.start_walk_in(service)
        self.assertEqual(
            started,
            {"ok": True, "reference": "reading", "max_attempts": PROFILE.max_attempts},
        )
        self.assertEqual(await service.verify(self.frames()), {"result": "match", "attempt": 1})

    async def test_starting_a_check_does_not_throw_away_the_photo_just_set_aside(self):
        # Regression: start() once cleared the stash it was about to read.
        service = self.make()
        started = await self.start_walk_in(service)
        self.assertNotEqual(started["reference"], "unavailable")

    async def test_a_photo_for_another_card_is_not_used(self):
        service = self.make()
        service.stash_photo("9999999999999", jpeg(textured(100, 120)))
        await service.start(CID, "walk_in")
        self.assertEqual(
            await service.verify(self.frames()),
            {"result": "skipped", "attempt": 0, "reason": "no_chip_photo"},
        )

    async def test_check_in_reads_the_photo_from_the_card(self):
        service = self.make()
        photo = jpeg(textured(100, 120))

        async def read_photo():
            return photo

        await service.start(CID, "check_in", read_photo)
        self.assertEqual((await service.verify(self.frames()))["result"], "match")

    async def test_a_card_pulled_out_during_the_photo_read_skips_the_check(self):
        service = self.make()

        async def read_photo():
            raise OSError("card gone")

        await service.start(CID, "check_in", read_photo)
        result = await service.verify(self.frames())
        self.assertEqual((result["result"], result["reason"]), ("skipped", "card_removed"))

    async def test_a_card_without_a_photo_skips_the_check(self):
        service = self.make()

        async def read_photo():
            return None

        await service.start(CID, "check_in", read_photo)
        self.assertEqual((await service.verify(self.frames()))["reason"], "no_chip_photo")

    async def test_a_different_person_retries_then_is_not_confirmed(self):
        service = self.make(FakeEngine(similarities=[0.1]))
        await self.start_walk_in(service)
        for attempt in (1, 2):
            reply = await service.verify(self.frames())
            self.assertEqual((reply["result"], reply["attempt"]), ("retry", attempt))
        final = await service.verify(self.frames())
        self.assertEqual(final, {"result": "not_confirmed", "attempt": 3, "reason": "retry_exhausted"})
        self.assertEqual(await service.verify(self.frames()), final)  # asking again changes nothing

    async def test_the_card_held_to_the_camera_retries_then_is_not_confirmed(self):
        service = self.make(FakeEngine(similarities=[0.95]))
        await self.start_walk_in(service)
        for attempt in range(1, PROFILE.max_attempts):
            reply = await service.verify(self.frames())
            self.assertEqual(reply, {"result": "retry", "hint": "ok", "attempt": attempt})
        reply = await service.verify(self.frames())
        self.assertEqual(
            reply,
            {"result": "not_confirmed", "attempt": PROFILE.max_attempts, "reason": "possible_card_presentation"},
        )

    async def test_a_fake_face_retries_then_is_not_confirmed(self):
        service = self.make(FakeEngine(similarities=[0.7], live=False))
        await self.start_walk_in(service)
        for attempt in range(1, PROFILE.max_attempts):
            reply = await service.verify(self.frames())
            # The retry hint never says the face looked fake.
            self.assertEqual(reply, {"result": "retry", "hint": "ok", "attempt": attempt})
        reply = await service.verify(self.frames())
        self.assertEqual((reply["result"], reply["reason"]), ("not_confirmed", "liveness_failed"))
        self.assertEqual(reply["attempt"], PROFILE.max_attempts)
        self.assertEqual(service.identity_check(mode="on", device_id="d")["liveness"], "fail")

    async def test_a_live_face_on_the_third_attempt_after_two_fakes_matches(self):
        frames = self.frames()
        fakes = [False] * (len(frames) * 2)
        service = self.make(FakeEngine(similarities=[0.7], live=fakes + [True]))
        await self.start_walk_in(service)
        for attempt in (1, 2):
            self.assertEqual((await service.verify(frames))["result"], "retry")
        self.assertEqual(await service.verify(frames), {"result": "match", "attempt": 3})

    async def test_unusable_frames_retry_with_the_commonest_hint_and_cost_no_attempt(self):
        service = self.make(FakeEngine(faces=[]))
        await self.start_walk_in(service)
        for _ in range(PROFILE.max_attempts + 2):
            reply = await service.verify(self.frames())
            self.assertEqual(reply, {"result": "retry", "hint": "no_face", "attempt": 0})
        self.assertIsNone(service._session.outcome)

    async def test_too_few_good_frames_is_a_retry_even_if_they_match_and_is_not_counted(self):
        service = self.make()
        await self.start_walk_in(service)
        frames = self.frames(2)  # the profile wants 3
        reply = await service.verify(frames)
        self.assertEqual((reply["result"], reply["attempt"]), ("retry", 0))
        self.assertEqual(await service.verify(self.frames()), {"result": "match", "attempt": 1})

    async def test_a_spoilt_burst_between_misses_does_not_use_up_an_attempt(self):
        service = self.make(FakeEngine(similarities=[0.1]))
        await self.start_walk_in(service)
        self.assertEqual((await service.verify(self.frames()))["attempt"], 1)
        self.assertEqual((await service.verify(self.frames(2)))["attempt"], 1)
        self.assertEqual((await service.verify(self.frames()))["attempt"], 2)
        self.assertEqual((await service.verify(self.frames()))["result"], "not_confirmed")

    # -- chip photo for check-in ------------------------------------------------------------

    async def start_check_in(self, service, photo):
        async def read_photo():
            return photo

        await service.start(CID, "check_in", read_photo)
        await service._session.reference_task

    async def test_a_check_in_match_hands_the_chip_photo_back_once(self):
        service = self.make()
        photo = jpeg(textured(100, 120))
        await self.start_check_in(service, photo)
        reply = await service.verify(self.frames())
        self.assertEqual((reply["result"], reply["attempt"]), ("match", 1))
        self.assertEqual(base64.b64decode(reply["chip_photo"]), photo)
        self.assertIsNone(service._session.chip_photo)
        self.assertEqual(await service.verify(self.frames()), {"result": "match", "attempt": 1})

    async def test_a_check_in_that_is_not_confirmed_never_gets_the_chip_photo(self):
        service = self.make(FakeEngine(similarities=[0.1]))
        await self.start_check_in(service, jpeg(textured(100, 120)))
        replies = [await service.verify(self.frames()) for _ in range(PROFILE.max_attempts)]
        self.assertEqual(replies[-1]["result"], "not_confirmed")
        self.assertFalse(any("chip_photo" in reply for reply in replies))
        self.assertIsNone(service._session.chip_photo)

    async def test_a_walk_in_match_does_not_send_the_chip_photo(self):
        service = self.make()
        await self.start_walk_in(service)
        await service._session.reference_task
        self.assertIsNone(service._session.chip_photo)
        self.assertNotIn("chip_photo", await service.verify(self.frames()))

    async def test_the_chip_photo_is_wiped_on_cancel_and_on_a_new_check(self):
        service = self.make()
        await self.start_check_in(service, jpeg(textured(100, 120)))
        session = service._session
        self.assertIsNotNone(session.chip_photo)
        service.cancel()
        self.assertIsNone(session.chip_photo)

        await self.start_check_in(service, jpeg(textured(100, 120)))
        session = service._session
        await self.start_check_in(service, jpeg(textured(100, 120)))  # a new card
        self.assertIsNone(session.chip_photo)

    async def test_the_chip_photo_is_wiped_when_the_session_expires(self):
        now = [1000.0]
        service = self.make(clock=lambda: now[0])
        await self.start_check_in(service, jpeg(textured(100, 120)))
        session = service._session
        now[0] += face_service.SESSION_TTL_SEC + 1
        with self.assertRaises(FaceStateError):
            await service.verify(self.frames())
        self.assertIsNone(session.chip_photo)

    async def test_an_unusable_chip_photo_is_not_kept(self):
        service = self.make()
        await self.start_check_in(service, b"\xff\xd8\xffnot really a jpeg")
        self.assertIsNone(service._session.chip_photo)
        self.assertEqual((await service.verify(self.frames()))["result"], "skipped")

    async def test_verify_waits_for_the_chip_photo_but_not_forever(self):
        service = self.make()
        release = asyncio.Event()

        async def slow_photo():
            await release.wait()
            return jpeg(textured(100, 120))

        await service.start(CID, "check_in", slow_photo)
        original = face_service.REFERENCE_WAIT_SEC
        face_service.REFERENCE_WAIT_SEC = 0.05
        try:
            reply = await service.verify(self.frames())
        finally:
            face_service.REFERENCE_WAIT_SEC = original
        self.assertEqual(reply["hint"], "reference_pending")
        self.assertEqual(reply["attempt"], 0)  # an unread photo costs no attempt
        release.set()
        self.assertEqual((await service.verify(self.frames()))["result"], "match")

    async def test_preview_frames_get_a_hint(self):
        service = self.make()
        await self.start_walk_in(service)
        reply = await service.frame(jpeg())
        self.assertEqual(
            {key: reply[key] for key in ("face", "hint", "ready")},
            {"face": True, "hint": "ok", "ready": True},
        )
        self.assertIn(reply["reference"], ("reading", "ready"))
        service = self.make(FakeEngine(faces=[face_row(w=520, x=10)]))
        await self.start_walk_in(service)
        self.assertEqual((await service.frame(jpeg()))["hint"], "too_close")

    async def test_preview_frames_say_when_the_chip_photo_has_been_read(self):
        # The check-in screen keeps "leave the card in" up until this turns ready.
        service = self.make()
        await self.start_walk_in(service)
        await service._session.reference_task
        self.assertEqual((await service.frame(jpeg()))["reference"], "ready")

    async def test_bad_input_is_refused(self):
        service = self.make()
        await self.start_walk_in(service)
        with self.assertRaises(FaceInputError):
            await service.frame(b"not a jpeg")
        with self.assertRaises(FaceInputError):
            await service.verify([])
        with self.assertRaises(FaceInputError):
            await service.verify(self.frames(face_service.MAX_FRAMES + 1))
        with self.assertRaises(FaceInputError):
            await service.start(CID, "elsewhere")

    async def test_nothing_works_without_a_started_check(self):
        service = self.make()
        with self.assertRaises(FaceStateError):
            await service.frame(jpeg())
        with self.assertRaises(FaceStateError):
            await service.verify(self.frames())

    async def test_cancel_wipes_the_session_and_the_stash(self):
        service = self.make()
        await self.start_walk_in(service)
        service.stash_photo(CID, jpeg(textured(100, 120)))
        service.cancel()
        with self.assertRaises(FaceStateError):
            await service.verify(self.frames())
        await service.start(CID, "walk_in")  # the stashed photo is gone too
        self.assertEqual((await service.verify(self.frames()))["reason"], "no_chip_photo")

    async def test_a_session_expires(self):
        now = [1000.0]
        service = self.make(clock=lambda: now[0])
        await self.start_walk_in(service)
        now[0] += face_service.SESSION_TTL_SEC + 1
        with self.assertRaises(FaceStateError):
            await service.verify(self.frames())

    async def test_a_stashed_photo_expires(self):
        now = [1000.0]
        service = self.make(clock=lambda: now[0])
        service.stash_photo(CID, jpeg(textured(100, 120)))
        now[0] += face_service.STASH_TTL_SEC + 1
        await service.start(CID, "walk_in")
        self.assertEqual((await service.verify(self.frames()))["reason"], "no_chip_photo")

    async def test_the_embedding_is_dropped_once_there_is_a_verdict(self):
        service = self.make()
        await self.start_walk_in(service)
        await service.verify(self.frames())
        self.assertIsNone(service._session.reference)

    async def test_identity_check_record(self):
        service = self.make()
        self.assertIsNone(service.identity_check(mode="on", device_id="kiosk-1"))
        await self.start_walk_in(service)
        self.assertIsNone(service.identity_check(mode="on", device_id="kiosk-1"))  # no verdict yet
        await service.verify(self.frames())
        record = service.identity_check(mode="shadow", device_id="kiosk-1")
        self.assertEqual(record["method"], "face_1to1_chip")
        self.assertEqual((record["flow"], record["result"], record["liveness"]), ("walk_in", "match", "pass"))
        self.assertEqual((record["mode"], record["device_id"], record["attempts"]), ("shadow", "kiosk-1", 1))
        self.assertEqual(record["threshold_profile"], "sface-opencv-default-v1")
        self.assertTrue(record["biometric_consented_at"].endswith("Z"))
        self.assertNotIn("reason", record)
        self.assertFalse({"score", "similarity", "embedding"} & set(record))

    async def test_logs_never_carry_the_citizen_id_a_score_or_an_image(self):
        service = self.make(FakeEngine(similarities=[0.123456]))
        with self.assertLogs(face_service.logger, level="INFO") as logs:
            await self.start_walk_in(service)
            for _ in range(PROFILE.max_attempts):
                await service.verify(self.frames())
        text = "\n".join(logs.output)
        self.assertIn("result=not_confirmed", text)
        self.assertNotIn(CID, text)
        self.assertNotIn("0.123", text)
        self.assertNotIn("base64", text)


if __name__ == "__main__":
    unittest.main()
