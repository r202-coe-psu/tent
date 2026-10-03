import struct
import unittest.mock
import unittest
from pathlib import Path

import maintenance_hotkey as hotkey

LEFT_CTRL, RIGHT_CTRL = 29, 97
LEFT_ALT, RIGHT_ALT = 56, 100
LEFT_SHIFT, RIGHT_SHIFT = 42, 54
KEY_T, KEY_A = 20, 30
PRESS, RELEASE, REPEAT = 1, 0, 2


def feed_all(tracker, events):
    return [tracker.feed(code, value) for code, value in events]


class ComboTrackerTests(unittest.TestCase):
    def test_ctrl_alt_shift_t_triggers_once_on_press(self):
        tracker = hotkey.ComboTracker()
        results = feed_all(
            tracker,
            [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS), (LEFT_SHIFT, PRESS), (KEY_T, PRESS), (KEY_T, RELEASE)],
        )
        self.assertEqual(results, [False, False, False, True, False])

    def test_right_hand_modifiers_count(self):
        tracker = hotkey.ComboTracker()
        results = feed_all(tracker, [(RIGHT_CTRL, PRESS), (RIGHT_ALT, PRESS), (RIGHT_SHIFT, PRESS), (KEY_T, PRESS)])
        self.assertTrue(results[-1])

    def test_missing_modifier_does_not_trigger(self):
        for held in ([LEFT_CTRL, LEFT_ALT], [LEFT_CTRL, LEFT_SHIFT], [LEFT_ALT, LEFT_SHIFT], []):
            tracker = hotkey.ComboTracker()
            feed_all(tracker, [(code, PRESS) for code in held])
            self.assertFalse(tracker.feed(KEY_T, PRESS), held)

    def test_autorepeat_does_not_open_a_second_terminal(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS), (LEFT_SHIFT, PRESS)])
        self.assertTrue(tracker.feed(KEY_T, PRESS))
        self.assertFalse(tracker.feed(KEY_T, REPEAT))

    def test_released_modifier_is_forgotten(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS), (LEFT_SHIFT, PRESS), (LEFT_SHIFT, RELEASE)])
        self.assertFalse(tracker.feed(KEY_T, PRESS))

    def test_other_keys_do_not_trigger(self):
        tracker = hotkey.ComboTracker()
        feed_all(tracker, [(LEFT_CTRL, PRESS), (LEFT_ALT, PRESS), (LEFT_SHIFT, PRESS)])
        self.assertFalse(tracker.feed(KEY_A, PRESS))


class IterEventsTests(unittest.TestCase):
    def test_parses_complete_events_and_ignores_trailing_bytes(self):
        data = struct.pack(hotkey.EVENT_FORMAT, 1, 2, 1, KEY_T, PRESS)
        data += struct.pack(hotkey.EVENT_FORMAT, 1, 3, 0, 0, 0)
        data += b"\x00" * 5
        self.assertEqual(list(hotkey.iter_events(data)), [(1, KEY_T, PRESS), (0, 0, 0)])


class TerminalCommandTests(unittest.TestCase):
    script = Path("/opt/tent/scanner_client/maintenance_terminal.sh")

    def test_prefers_foot_without_spawn_terminal_or_url_launch(self):
        command = hotkey.terminal_command(self.script, which=lambda name: f"/usr/bin/{name}")
        self.assertEqual(command[0], "foot")
        self.assertIn("--override=key-bindings.spawn-terminal=none", command)
        self.assertIn("--override=key-bindings.show-urls-launch=none", command)
        self.assertEqual(command[-2:], ["--", str(self.script)])

    def test_falls_back_to_xterm(self):
        command = hotkey.terminal_command(self.script, which=lambda name: "/usr/bin/xterm" if name == "xterm" else None)
        self.assertEqual(command[0], "xterm")
        self.assertEqual(command[-2:], ["-e", str(self.script)])

    def test_no_terminal_installed(self):
        self.assertIsNone(hotkey.terminal_command(self.script, which=lambda _name: None))


class OpenTerminalTests(unittest.TestCase):
    def test_does_not_open_a_second_terminal_while_one_is_running(self):
        daemon = hotkey.HotkeyDaemon(Path("/nonexistent"))

        class Running:
            def poll(self):
                return None

        daemon.terminal = Running()
        with unittest.mock.patch.object(hotkey.subprocess, "Popen") as popen:
            daemon.open_terminal()
        popen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
