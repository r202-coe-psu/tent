import struct
import subprocess
import unittest
import unittest.mock

import maintenance_hotkey as hotkey

LEFT_CTRL, RIGHT_CTRL = 29, 97
LEFT_ALT, RIGHT_ALT = 56, 100
LEFT_SHIFT = 42
KEY_F1, KEY_F3, KEY_F6, KEY_F7 = 59, 61, 64, 65
KEY_A = 30
PRESS, RELEASE, REPEAT = 1, 0, 2


def feed_all(tracker, events):
    return [tracker.feed(code, value) for code, value in events]


class ComboTrackerTests(unittest.TestCase):
    def test_ctrl_alt_f3_switches_to_vt3_once_on_press(self):
        tracker = hotkey.ComboTracker()
        results = feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS), (KEY_F3, PRESS), (KEY_F3, RELEASE)])
        self.assertEqual(results, [None, None, 3, None])

    def test_f1_to_f6_map_to_vt_1_to_6(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS)])
        self.assertEqual(tracker.feed(KEY_F1, PRESS), 1)
        self.assertEqual(tracker.feed(KEY_F6, PRESS), 6)

    def test_f7_and_above_are_ignored(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS)])
        self.assertIsNone(tracker.feed(KEY_F7, PRESS))

    def test_right_hand_modifiers_count(self):
        tracker = hotkey.ComboTracker()
        results = feed_all(tracker, [(RIGHT_CTRL, PRESS), (RIGHT_ALT, PRESS), (KEY_F3, PRESS)])
        self.assertEqual(results[-1], 3)

    def test_missing_modifier_does_not_switch(self):
        for held in ([LEFT_CTRL], [LEFT_ALT], [LEFT_CTRL, LEFT_SHIFT], []):
            tracker = hotkey.ComboTracker()
            feed_all(tracker, [(code, PRESS) for code in held])
            self.assertIsNone(tracker.feed(KEY_F3, PRESS), held)

    def test_autorepeat_does_not_switch_again(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS)])
        self.assertEqual(tracker.feed(KEY_F3, PRESS), 3)
        self.assertIsNone(tracker.feed(KEY_F3, REPEAT))

    def test_released_modifier_is_forgotten(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS), (LEFT_ALT, RELEASE)])
        self.assertIsNone(tracker.feed(KEY_F3, PRESS))

    def test_other_keys_do_not_switch(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS)])
        self.assertIsNone(tracker.feed(KEY_A, PRESS))


class IterEventsTests(unittest.TestCase):
    def test_parses_complete_events_and_ignores_trailing_bytes(self):
        data = struct.pack(hotkey.EVENT_FORMAT, 1, 2, 1, KEY_F3, PRESS)
        data += struct.pack(hotkey.EVENT_FORMAT, 1, 3, 0, 0, 0)
        data += b"\x00" * 5
        self.assertEqual(list(hotkey.iter_events(data)), [(1, KEY_F3, PRESS), (0, 0, 0)])


class SwitchVtTests(unittest.TestCase):
    def test_runs_sudo_non_interactive_chvt_with_absolute_path(self):
        self.assertEqual(hotkey.chvt_command(3), ["sudo", "-n", "/usr/bin/chvt", "3"])

    def test_switch_vt_runs_chvt_without_raising_on_failure(self):
        daemon = hotkey.HotkeyDaemon()
        failed = subprocess.CompletedProcess(args=[], returncode=1, stderr="sudo: a password is required")
        with unittest.mock.patch.object(hotkey.subprocess, "run", return_value=failed) as run:
            daemon.switch_vt(3)
        self.assertEqual(run.call_args.args[0], ["sudo", "-n", "/usr/bin/chvt", "3"])

    def test_switch_vt_survives_missing_sudo(self):
        daemon = hotkey.HotkeyDaemon()
        with unittest.mock.patch.object(hotkey.subprocess, "run", side_effect=FileNotFoundError):
            daemon.switch_vt(3)


if __name__ == "__main__":
    unittest.main()
