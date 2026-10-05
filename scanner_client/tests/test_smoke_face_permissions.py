import unittest

import smoke_face_permissions as smoke


class VerdictTests(unittest.TestCase):
    def test_granted_and_a_working_camera_passes(self):
        ok, message = smoke.verdict("granted", None)
        self.assertTrue(ok)
        self.assertIn("without a prompt", message)

    def test_a_prompt_state_fails_because_nobody_can_answer_it_on_a_kiosk(self):
        for state in ("prompt", "denied", "unsupported", None):
            self.assertFalse(smoke.verdict(state, None)[0], state)

    def test_a_machine_without_a_camera_still_passes_the_permission_check(self):
        ok, message = smoke.verdict("granted", "NotFoundError")
        self.assertTrue(ok)
        self.assertIn("no camera", message)

    def test_a_refusal_at_open_time_fails_even_if_the_state_said_granted(self):
        self.assertFalse(smoke.verdict("granted", "NotAllowedError")[0])

    def test_origin_drops_the_path_and_keeps_the_port(self):
        self.assertEqual(
            smoke.origin_of("https://tent.example.go.th:8443/app/x?y=1"),
            "https://tent.example.go.th:8443",
        )


if __name__ == "__main__":
    unittest.main()
