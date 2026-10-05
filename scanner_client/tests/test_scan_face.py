import unittest

import numpy as np

import scan_face
from app.face import quality
from app.face.liveness import LivenessResult
from app.face.profiles import DEFAULT_PROFILE
from tests.test_face import FakeEngine, face_row, textured


class AnalyseFrameTests(unittest.TestCase):
    def test_a_good_frame_reports_the_face_and_the_liveness(self):
        report = scan_face.analyse_frame(FakeEngine(live=True), textured(), DEFAULT_PROFILE)

        self.assertEqual(report.hint, quality.OK)
        self.assertTrue(report.face_found)
        self.assertTrue(report.live)
        self.assertAlmostEqual(report.eye_px, 80.0, places=0)
        self.assertAlmostEqual(report.eye_ratio, 80.0 / 640, places=3)

    def test_no_face_means_no_measurements_and_no_liveness_call(self):
        report = scan_face.analyse_frame(FakeEngine(faces=[]), textured(), DEFAULT_PROFILE)

        self.assertEqual((report.hint, report.face_found), (quality.NO_FACE, False))
        self.assertIsNone(report.live)

    def test_a_face_that_fails_the_gate_is_still_measured(self):
        report = scan_face.analyse_frame(
            FakeEngine(faces=[face_row(yaw_shift=0.5)]), textured(), DEFAULT_PROFILE
        )

        self.assertEqual(report.hint, quality.TURN_STRAIGHT)
        self.assertTrue(report.face_found)
        self.assertGreater(report.yaw, 0.25)

    def test_a_fake_face_is_reported_as_not_live(self):
        report = scan_face.analyse_frame(FakeEngine(live=False), textured(), DEFAULT_PROFILE)

        self.assertFalse(report.live)


class FormatTests(unittest.TestCase):
    def test_scores_only_show_when_asked(self):
        report = scan_face.FrameReport(
            hint="ok", face_found=True, eye_px=90, eye_ratio=0.14, yaw=0.05, pitch=0.5, roll=2,
            live=True, p_real=0.93,
        )

        plain = scan_face.format_report(report, show_scores=False)
        detailed = scan_face.format_report(report, show_scores=True)

        self.assertNotIn("p_real", plain)
        self.assertIn("p_real=0.93", detailed)
        self.assertIn("yaw=0.05", detailed)

    def test_every_hint_has_advice(self):
        for hint in (quality.OK, quality.NO_FACE, quality.MULTIPLE_FACES, quality.TOO_FAR,
                     quality.TOO_CLOSE, quality.TURN_STRAIGHT, quality.TOO_DARK,
                     quality.TOO_BRIGHT, quality.BLURRY):
            self.assertIn(hint, scan_face.HINT_ADVICE)


class SummaryTests(unittest.TestCase):
    def report(self, hint="ok", face=True, live=True):
        return scan_face.FrameReport(hint=hint, face_found=face, live=live if face else None)

    def test_enough_good_frames_is_ready(self):
        lines = scan_face.summarise([self.report()] * 4, DEFAULT_PROFILE)

        self.assertIn("✅", "\n".join(lines))

    def test_too_few_good_frames_names_the_commonest_problem(self):
        reports = [self.report()] + [self.report(hint="too_far")] * 5 + [self.report("no_face", False)]

        text = "\n".join(scan_face.summarise(reports, DEFAULT_PROFILE))

        self.assertIn("⚠️", text)
        self.assertIn("ไกลเกินไป ×5", text)

    def test_no_frames_at_all_points_at_the_camera(self):
        self.assertIn("--list", scan_face.summarise([], DEFAULT_PROFILE)[0])

    def test_liveness_is_counted_over_frames_with_a_face(self):
        reports = [self.report(live=True), self.report(live=False), self.report("no_face", False)]

        text = "\n".join(scan_face.summarise(reports, DEFAULT_PROFILE))

        self.assertIn("1/2", text)


class FakeCapture:
    def __init__(self, frames):
        self.frames = frames
        self.released = False

    def isOpened(self):
        return self.frames is not None

    def read(self):
        return (True, self.frames) if self.frames is not None else (False, None)

    def release(self):
        self.released = True


class ListCameraTests(unittest.TestCase):
    def test_tells_colour_from_grey_and_says_why_one_will_not_open(self):
        colour = textured()
        grey = np.repeat(textured()[..., :1], 3, axis=2)
        frames = {0: colour, 1: None, 2: grey}
        captures = []

        def factory(index):
            capture = FakeCapture(frames.get(index))
            captures.append(capture)
            return capture

        lines = scan_face.list_cameras(factory, indexes=[0, 1, 2], sleep=lambda _: None)

        self.assertIn("0: 640x480", lines[0])
        self.assertIn("RGB", lines[0])
        self.assertIn("1: เปิดไม่ได้", lines[1])
        self.assertIn("2: 640x480", lines[2])
        self.assertIn("IR", lines[2])
        self.assertTrue(all(capture.released for capture in captures))

    def test_the_first_frames_are_discarded_so_a_grey_placeholder_is_not_judged(self):
        placeholder = np.full((480, 640, 3), 128, np.uint8)
        real = textured(level=60)

        class WarmingUp(FakeCapture):
            reads = 0

            def read(self):
                self.reads += 1
                return True, placeholder if self.reads < scan_face.WARM_UP_FRAMES else real

        lines = scan_face.list_cameras(lambda index: WarmingUp(real), indexes=[0], sleep=lambda _: None)

        self.assertIn("สว่างเฉลี่ย 60", lines[0])

    def test_no_camera_gives_a_hint_about_who_holds_it(self):
        lines = scan_face.list_cameras(
            lambda index: FakeCapture(None), indexes=[0, 1], sleep=lambda _: None
        )

        text = "\n".join(lines)
        self.assertIn("ไม่มีกล้องที่ให้ภาพเลย", text)
        self.assertIn("fuser -v /dev/video0", text)

    def test_a_camera_that_is_busy_for_a_moment_is_tried_again(self):
        attempts = []

        def factory(index):
            attempts.append(index)
            return FakeCapture(textured() if len(attempts) >= 3 else None)

        capture = scan_face.open_camera(0, factory, sleep=lambda _: None)

        self.assertTrue(capture.isOpened())
        self.assertEqual(len(attempts), 3)

    def test_a_camera_that_never_opens_is_given_up_after_a_few_tries(self):
        attempts = []

        def factory(index):
            attempts.append(index)
            return FakeCapture(None)

        capture = scan_face.open_camera(0, factory, sleep=lambda _: None)

        self.assertFalse(capture.isOpened())
        self.assertEqual(len(attempts), scan_face.OPEN_ATTEMPTS)

    def test_only_existing_video_nodes_are_tried(self):
        import unittest.mock as mock

        with mock.patch.object(scan_face.glob, "glob", return_value=["/dev/video2", "/dev/video0", "/dev/videoX"]):
            self.assertEqual(scan_face.camera_indexes(), [0, 2])
        with mock.patch.object(scan_face.glob, "glob", return_value=[]):
            self.assertEqual(scan_face.camera_indexes(), list(range(scan_face.MAX_CAMERA_INDEX)))


if __name__ == "__main__":
    unittest.main()
