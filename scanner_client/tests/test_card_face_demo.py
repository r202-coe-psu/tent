import base64
import time
import unittest
from unittest import mock

import cv2
import numpy as np

import card_face_demo as demo
from app.face import quality
from app.face.profiles import DEFAULT_PROFILE
from tests.test_face import FakeEngine, face_row, textured

PROFILE = DEFAULT_PROFILE
CID = "1234567890123"


def photo_url(width=110, height=121):
    ok, buffer = cv2.imencode(".jpg", textured(width, height))
    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode()


def wait_for(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class HelperTests(unittest.TestCase):
    def test_only_the_last_four_digits_of_the_id_are_shown(self):
        self.assertEqual(demo.mask_citizen_id(CID), "*********0123"[:9] + "0123")
        self.assertNotIn("12345", demo.mask_citizen_id(CID))
        self.assertEqual(demo.mask_citizen_id(""), "(ไม่ทราบ)")
        self.assertEqual(demo.mask_citizen_id("12"), "(ไม่ทราบ)")

    def test_a_headless_opencv_is_recognised_so_the_tool_can_explain(self):
        self.assertFalse(demo.gui_available("Video I/O:\n  GUI:                           NONE\n"))
        self.assertTrue(demo.gui_available("  GUI:                           GTK3\n"))
        self.assertTrue(demo.gui_available("    GUI:   QT5\n"))
        self.assertFalse(demo.gui_available("nothing about a gui"))

    def test_a_thai_font_is_found_when_one_exists_and_none_when_not(self):
        import os

        existing = next((p for p in demo.FONT_CANDIDATES if os.path.isfile(p)), __file__)
        self.assertEqual(demo.find_thai_font((existing,)), existing)
        with mock.patch.object(demo.subprocess, "run", side_effect=OSError("no fc-match")):
            self.assertIsNone(demo.find_thai_font(("/no/such/font.ttf",)))


class FakeReader:
    def __init__(self, data=None, error=None):
        self.inserted = False
        self.reads = 0
        self.error = error
        self.data = data if data is not None else {"citizen_id": CID, "first_name_th": "x", "photo_base64": photo_url()}

    def is_card_inserted(self):
        return self.inserted

    def read_all_data(self):
        self.reads += 1
        if self.error:
            raise self.error
        return dict(self.data)


def stub_reference(photo):
    return np.ones((1, 128), np.float32), True, textured(110, 121)


class CardWatcherTests(unittest.TestCase):
    def watch(self, reader=None, build=stub_reference, factory=None):
        self.reader = reader or FakeReader()
        watcher = demo.CardWatcher(factory or (lambda: self.reader), build, poll_sec=0.01, retry_sec=0.01)
        watcher.start()
        self.addCleanup(watcher.stop)
        return watcher

    def test_waits_for_a_card_then_reads_it_and_builds_the_reference(self):
        watcher = self.watch()
        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "waiting"))

        self.reader.inserted = True

        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "ready"))
        card = watcher.snapshot()
        self.assertEqual(card["data"]["citizen_id"], CID)
        self.assertNotIn("photo_base64", card["data"])
        self.assertIsNotNone(card["photo"])
        self.assertIsNotNone(card["reference"])

    def test_a_card_left_in_is_read_once(self):
        watcher = self.watch()
        self.reader.inserted = True
        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "ready"))

        time.sleep(0.15)

        self.assertEqual(self.reader.reads, 1)

    def test_a_new_card_after_removal_is_read_again(self):
        watcher = self.watch()
        self.reader.inserted = True
        self.assertTrue(wait_for(lambda: self.reader.reads == 1))
        self.reader.inserted = False
        time.sleep(0.05)

        self.reader.inserted = True

        self.assertTrue(wait_for(lambda: self.reader.reads == 2))
        self.assertEqual(watcher.snapshot()["state"] in ("reading", "ready"), True)

    def test_reset_reads_a_card_that_is_still_in(self):
        watcher = self.watch()
        self.reader.inserted = True
        self.assertTrue(wait_for(lambda: self.reader.reads == 1))

        watcher.reset()

        self.assertTrue(wait_for(lambda: self.reader.reads == 2))

    def test_a_read_failure_is_reported_and_does_not_end_the_watcher(self):
        watcher = self.watch(FakeReader(error=OSError("card moved")))
        self.reader.inserted = True

        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "error"))
        self.assertIn("อ่านบัตรไม่สำเร็จ", watcher.snapshot()["message"])
        self.assertTrue(watcher.is_alive())

    def test_a_card_without_a_usable_photo_is_reported(self):
        watcher = self.watch(FakeReader({"citizen_id": CID, "photo_base64": None}))
        self.reader.inserted = True

        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "error"))
        self.assertIn("ไม่มีรูป", watcher.snapshot()["message"])

    def test_a_photo_with_no_face_is_reported(self):
        watcher = self.watch(build=lambda photo: None)
        self.reader.inserted = True

        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "error"))
        self.assertIn("หาใบหน้า", watcher.snapshot()["message"])

    def test_a_missing_reader_is_reported_and_found_when_it_appears(self):
        calls = []

        def factory():
            calls.append(1)
            if len(calls) < 3:
                raise RuntimeError("No Smart Card Reader detected")
            return self.reader

        self.reader = FakeReader()
        watcher = self.watch(self.reader, factory=factory)

        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "error"))
        self.assertIn("ไม่พบตัวอ่านบัตร", watcher.snapshot()["message"])
        self.assertTrue(wait_for(lambda: watcher.snapshot()["state"] == "waiting"))


class TextTests(unittest.TestCase):
    def test_thai_and_latin_text_are_cut_into_runs_for_their_own_fonts(self):
        self.assertEqual(
            demo.split_runs("เลขบัตร ***0123"),
            [(True, "เลขบัตร "), (False, "***0123")],
        )
        self.assertEqual(demo.split_runs("Q ออก · R"), [(False, "Q "), (True, "ออก "), (False, "· R")])
        self.assertEqual(demo.split_runs(""), [])
        self.assertEqual(demo.split_runs("abc"), [(False, "abc")])

    def test_digits_get_real_glyphs_not_empty_boxes(self):
        fonts = demo.find_fonts()
        if fonts is None:
            self.skipTest("no Thai font on this machine")
        blank = np.full((60, 400, 3), 255, np.uint8)

        drawn = demo.draw_texts(blank, [("เลข 0123 Q", (5, 5), 28, (0, 0, 0))], fonts)

        self.assertGreater(int((drawn < 128).sum()), 300)  # ink was laid down
        self.assertEqual(fonts.latin != fonts.thai or fonts.latin == fonts.thai, True)

    def test_the_latin_font_is_not_the_thai_only_one_when_a_better_one_exists(self):
        import os

        fonts = demo.find_fonts()
        if fonts is None or not any(os.path.isfile(p) for p in demo.LATIN_FONT_CANDIDATES):
            self.skipTest("no Latin font on this machine")
        self.assertIn(fonts.latin, demo.LATIN_FONT_CANDIDATES)


class VerdictTests(unittest.TestCase):
    def recent(self, sims, lives=None):
        recent = demo.Recent()
        for i, similarity in enumerate(sims):
            recent.add(similarity, True if lives is None else lives[i])
        return recent

    def test_no_card_yet(self):
        self.assertEqual(demo.verdict_for(self.recent([]), PROFILE, False).kind, "waiting")

    def test_too_few_frames_is_still_collecting(self):
        self.assertEqual(demo.verdict_for(self.recent([0.6, 0.6]), PROFILE, True).kind, "collecting")

    def test_the_same_person(self):
        verdict = demo.verdict_for(self.recent([0.6, 0.55, 0.62]), PROFILE, True)
        self.assertEqual(verdict.kind, "match")
        self.assertAlmostEqual(verdict.similarity, 0.6)

    def test_another_person(self):
        self.assertEqual(demo.verdict_for(self.recent([0.1, 0.12, 0.08]), PROFILE, True).kind, "no_match")

    def test_the_card_held_up_to_the_camera(self):
        self.assertEqual(demo.verdict_for(self.recent([0.95, 0.93, 0.96]), PROFILE, True).kind, "card")

    def test_a_face_judged_fake(self):
        verdict = demo.verdict_for(self.recent([0.6, 0.6, 0.6], [False, False, False]), PROFILE, True)
        self.assertEqual(verdict.kind, "fake")

    def test_old_frames_are_forgotten(self):
        now = [100.0]
        recent = demo.Recent(now=lambda: now[0])
        for _ in range(3):
            recent.add(0.6, True)
        now[0] += demo.WINDOW_SEC + 1

        self.assertEqual(demo.verdict_for(recent, PROFILE, True).kind, "collecting")


class AnalyseLiveTests(unittest.TestCase):
    def test_the_heavy_work_runs_only_when_asked_and_only_on_a_good_frame(self):
        engine = FakeEngine(similarities=[0.6])
        reference = np.ones((1, 128), np.float32)

        light = demo.analyse_live(engine, textured(), PROFILE, reference, heavy=False)
        heavy = demo.analyse_live(engine, textured(), PROFILE, reference, heavy=True)

        self.assertEqual(light.hint, quality.OK)
        self.assertIsNone(light.similarity)
        self.assertAlmostEqual(heavy.similarity, 0.6)
        self.assertTrue(heavy.live)

    def test_a_badly_framed_face_is_not_matched(self):
        engine = FakeEngine(faces=[face_row(yaw_shift=0.5)])

        reading = demo.analyse_live(engine, textured(), PROFILE, np.ones((1, 128), np.float32), heavy=True)

        self.assertEqual(reading.hint, quality.TURN_STRAIGHT)
        self.assertIsNone(reading.similarity)

    def test_without_a_card_the_face_is_judged_for_liveness_only(self):
        reading = demo.analyse_live(FakeEngine(), textured(), PROFILE, None, heavy=True)

        self.assertIsNone(reading.similarity)
        self.assertTrue(reading.live)


class DrawingTests(unittest.TestCase):
    def view(self, **kwargs):
        camera = np.full((demo.CAMERA_H, demo.CAMERA_W, 3), 90, np.uint8)
        return demo.View(camera, **kwargs)

    def test_the_window_is_one_picture_of_the_expected_size(self):
        picture = demo.compose(self.view(), None)

        self.assertEqual(picture.shape, (demo.CANVAS_H, demo.CANVAS_W, 3))

    def test_every_state_draws_with_and_without_a_thai_font(self):
        fonts = demo.find_fonts()
        states = (
            {"state": "waiting"},
            {"state": "reading"},
            {"state": "error", "message": "x"},
            {"state": "ready", "photo": textured(110, 121), "data": {"citizen_id": CID, "full_name_th": "ก"},
             "read_sec": 1.2, "aligned": False},
        )
        for card in states:
            for path in (None, fonts):
                with self.subTest(state=card["state"], thai=path is not None):
                    picture = demo.compose(self.view(card=card, hint=quality.TOO_FAR, show_name=True), path)
                    self.assertEqual(picture.shape[:2], (demo.CANVAS_H, demo.CANVAS_W))

    def test_the_bar_colour_follows_the_verdict(self):
        for kind, colour in (("match", demo.GREEN), ("no_match", demo.AMBER), ("card", demo.RED)):
            picture = demo.compose(self.view(verdict=demo.Verdict(kind, "x")), None)
            self.assertEqual(tuple(picture[demo.CAMERA_H + 5, demo.CANVAS_W - 5]), colour, kind)

    def test_no_camera_picture_still_draws(self):
        picture = demo.compose(demo.View(None), None)

        self.assertEqual(picture.shape[:2], (demo.CANVAS_H, demo.CANVAS_W))

    def test_the_card_shows_only_the_masked_id_and_the_name_only_on_request(self):
        card = {"state": "ready", "data": {"citizen_id": CID, "full_name_th": "สมชาย"}, "photo": None}
        with mock.patch.object(demo, "draw_texts", side_effect=lambda canvas, items, fonts: items) as drawn:
            demo.compose(self.view(card=card), demo.Fonts("thai.ttf", "latin.ttf"))
            items = drawn.call_args.args[1]
            self.assertTrue(any("0123" in text for text, *_ in items))
            self.assertFalse(any(CID in text for text, *_ in items))
            self.assertFalse(any("สมชาย" in text for text, *_ in items))
            demo.compose(self.view(card=card, show_name=True), demo.Fonts("thai.ttf", "latin.ttf"))
            items = drawn.call_args.args[1]
            self.assertTrue(any("สมชาย" in text for text, *_ in items))
            self.assertFalse(any(CID in text for text, *_ in items))

    def test_the_face_box_is_mirrored_with_the_picture(self):
        frame = textured()  # 640x480, the same as the window's camera area
        reading = demo.LiveReading(quality.OK, face_row(x=100, y=50, w=200, h=240))

        shown, box, points = demo.mirrored_view(frame, reading)

        self.assertEqual(shown.shape, (demo.CAMERA_H, demo.CAMERA_W, 3))
        self.assertEqual(box[0], demo.CAMERA_W - (100 + 200))
        self.assertEqual(len(points), 5)
        self.assertTrue(np.array_equal(shown, cv2.flip(frame, 1)))

    def test_no_face_means_no_box(self):
        _, box, points = demo.mirrored_view(textured(), demo.LiveReading(quality.NO_FACE))

        self.assertIsNone(box)
        self.assertEqual(points, [])


class StubWatcher:
    def __init__(self, snapshot):
        self._snapshot = snapshot
        self.resets = 0

    def snapshot(self):
        return self._snapshot

    def reset(self):
        self.resets += 1


class FakeCapture:
    def __init__(self, frame, ok=True):
        self.frame, self.ok = frame, ok

    def read(self):
        return (self.ok, self.frame if self.ok else None)


class RunDemoTests(unittest.TestCase):
    def run_loop(self, keys, snapshot, capture=None, engine=None, **kwargs):
        shown = []
        sequence = list(keys)
        watcher = StubWatcher(snapshot)
        demo.run_demo(
            engine or FakeEngine(similarities=[0.6]),
            PROFILE,
            capture or FakeCapture(textured()),
            watcher,
            show=shown.append,
            wait_key=lambda: sequence.pop(0) if sequence else ord("q"),
            **kwargs,
        )
        return shown, watcher

    def ready_card(self):
        return {"state": "ready", "message": "", "data": {"citizen_id": CID}, "photo": textured(110, 121),
                "reference": np.ones((1, 128), np.float32), "aligned": True, "read_sec": 1.0}

    def test_with_a_card_and_a_matching_face_the_bar_turns_green(self):
        shown, _ = self.run_loop([-1] * 15, self.ready_card())

        last = shown[-1]
        self.assertEqual(tuple(last[demo.CAMERA_H + 5, demo.CANVAS_W - 5]), demo.GREEN)

    def test_without_a_card_it_only_waits(self):
        shown, _ = self.run_loop([-1] * 15, {"state": "waiting", "message": "", "data": {}, "photo": None,
                                              "reference": None, "aligned": True, "read_sec": 0.0})

        self.assertEqual(tuple(shown[-1][demo.CAMERA_H + 5, demo.CANVAS_W - 5]), demo.GREY)

    def test_q_quits_at_once(self):
        shown, _ = self.run_loop([ord("q")], self.ready_card())

        self.assertEqual(len(shown), 1)

    def test_esc_quits_too(self):
        shown, _ = self.run_loop([27], self.ready_card())

        self.assertEqual(len(shown), 1)

    def test_r_asks_the_watcher_to_read_the_card_again(self):
        _, watcher = self.run_loop([ord("r"), ord("q")], self.ready_card())

        self.assertEqual(watcher.resets, 1)

    def test_closing_the_window_ends_the_loop(self):
        shown, _ = self.run_loop([-1] * 10, self.ready_card(), window_open=lambda: False)

        self.assertEqual(shown, [])

    def test_a_camera_that_gives_no_frame_does_not_crash_the_window(self):
        shown, _ = self.run_loop([-1, -1, ord("q")], self.ready_card(), capture=FakeCapture(None, ok=False))

        self.assertGreaterEqual(len(shown), 1)

    def test_s_shows_the_numbers(self):
        with mock.patch.object(demo, "compose", wraps=demo.compose) as compose:
            self.run_loop([ord("s"), ord("q")], self.ready_card())

        flags = [call.args[0].show_scores for call in compose.call_args_list]
        self.assertEqual(flags, [False, True])


if __name__ == "__main__":
    unittest.main()
