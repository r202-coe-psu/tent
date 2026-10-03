import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "setup_kiosk_lockdown.sh"

DEBIAN_DAEMON_CONF = """# GDM configuration storage
#
# See /usr/share/gdm/gdm.schemas for a list of available options.

[daemon]

# Enabling automatic login
#  AutomaticLoginEnable = true
#  AutomaticLogin = user1

# Enabling timed login
#  TimedLoginEnable = true
#  TimedLogin = user1
#  TimedLoginDelay = 10

[security]

[debug]
# Uncomment the line below to turn on debugging
#Enable=true
"""


def run_helper(snippet: str) -> str:
    """Source the script (its main() only runs when executed directly) and run one helper."""
    result = subprocess.run(
        ["bash", "-c", f'source "$1"; {snippet}', "bash", str(SCRIPT)],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


class GdmAutologinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.conf = Path(self.tmp.name) / "daemon.conf"

    def autologin_user(self) -> str:
        return run_helper(f'gdm_autologin_user "{self.conf}"').strip()

    def with_autologin(self, user: str = "kiosk") -> str:
        return run_helper(f'gdm_with_autologin "{self.conf}" {user}')

    def test_debian_default_has_autologin_off(self):
        self.conf.write_text(DEBIAN_DAEMON_CONF)
        self.assertEqual(self.autologin_user(), "")

    def test_enables_autologin_under_daemon_and_keeps_comments(self):
        self.conf.write_text(DEBIAN_DAEMON_CONF)
        updated = self.with_autologin()
        lines = updated.splitlines()
        daemon = lines.index("[daemon]")
        self.assertEqual(lines[daemon + 1 : daemon + 3], ["AutomaticLoginEnable=true", "AutomaticLogin=kiosk"])
        self.assertIn("#  AutomaticLogin = user1", lines)
        self.assertIn("[security]", lines)
        self.conf.write_text(updated)
        self.assertEqual(self.autologin_user(), "kiosk")

    def test_replaces_existing_keys_only_inside_daemon(self):
        self.conf.write_text(
            "[daemon]\nAutomaticLoginEnable = false\nAutomaticLogin = old\n[debug]\nAutomaticLogin=keep\n"
        )
        updated = self.with_autologin()
        self.assertNotIn("AutomaticLogin = old", updated)
        self.assertNotIn("AutomaticLoginEnable = false", updated)
        self.assertEqual(updated.count("AutomaticLogin=kiosk"), 1)
        self.assertIn("[debug]\nAutomaticLogin=keep", updated)

    def test_is_idempotent(self):
        self.conf.write_text(DEBIAN_DAEMON_CONF)
        once = self.with_autologin()
        self.conf.write_text(once)
        self.assertEqual(self.with_autologin(), once)

    def test_adds_daemon_section_when_missing(self):
        self.conf.write_text("[security]\n")
        self.assertTrue(self.with_autologin().endswith("[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=kiosk\n"))


    def test_creates_config_when_file_is_missing(self):
        self.assertEqual(self.with_autologin(), "[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=kiosk\n")

    def test_reads_spaced_values_and_ignores_disabled_autologin(self):
        self.conf.write_text("[daemon]\nAutomaticLoginEnable = True\nAutomaticLogin = kiosk\n")
        self.assertEqual(self.autologin_user(), "kiosk")
        self.conf.write_text("[daemon]\nAutomaticLoginEnable=false\nAutomaticLogin=kiosk\n")
        self.assertEqual(self.autologin_user(), "")


class KioskSessionIdTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.wayland = Path(self.tmp.name) / "wayland-sessions"
        self.xorg = Path(self.tmp.name) / "xsessions"
        self.wayland.mkdir()
        self.xorg.mkdir()

    def session_id(self) -> str:
        result = subprocess.run(
            [
                "bash",
                "-c",
                'source "$1"; SESSION_DIRS=("$2" "$3"); kiosk_session_id',
                "bash",
                str(SCRIPT),
                str(self.wayland),
                str(self.xorg),
            ],
            capture_output=True,
            text=True,
        )
        return result.stdout.strip() if result.returncode == 0 else ""

    def test_prefers_wayland_kiosk_script_session(self):
        (self.wayland / "gnome.desktop").write_text("[Desktop Entry]\nExec=gnome-session\n")
        (self.wayland / "gnome-kiosk-script-wayland.desktop").write_text("[Desktop Entry]\nExec=gnome-session --session gnome-kiosk-script\n")
        (self.xorg / "gnome-kiosk-script-xorg.desktop").write_text("[Desktop Entry]\nExec=gnome-session --session gnome-kiosk-script\n")
        self.assertEqual(self.session_id(), "gnome-kiosk-script-wayland")

    def test_falls_back_to_xorg_and_reports_missing(self):
        self.assertEqual(self.session_id(), "")
        (self.xorg / "gnome-kiosk-script-xorg.desktop").write_text("[Desktop Entry]\nExec=gnome-session --session gnome-kiosk-script\n")
        self.assertEqual(self.session_id(), "gnome-kiosk-script-xorg")


class SessionScriptTests(unittest.TestCase):
    def test_loops_start_kiosk_and_skips_while_locked(self):
        body = run_helper(
            'session_script_content "/opt/tent/scanner_client/start_kiosk.sh" '
            '"/opt/tent/scanner_client/maintenance_hotkey.py"'
        )
        self.assertTrue(body.startswith("#!/bin/sh\n# Managed by tent scanner_client/setup_kiosk_lockdown.sh"))
        self.assertIn('flock -n "/tmp/smart_shelter_kiosk.lock" true', body)
        self.assertIn('"/opt/tent/scanner_client/start_kiosk.sh"', body)
        self.assertIn("while true; do", body)
        subprocess.run(["sh", "-n"], input=body, text=True, check=True)

    def test_starts_maintenance_hotkey_in_background_with_real_path(self):
        body = run_helper(
            'session_script_content "/opt/tent/scanner_client/start_kiosk.sh" '
            '"/opt/tent/scanner_client/maintenance_hotkey.py"'
        )
        hotkey_line = 'python3 "/opt/tent/scanner_client/maintenance_hotkey.py" >>"/tmp/kiosk_maintenance_hotkey.log" 2>&1'
        self.assertIn(hotkey_line, body)
        self.assertIn(") &", body)
        # The hotkey loop is started before the foreground kiosk loop, which never returns.
        self.assertLess(body.index(hotkey_line), body.index('flock -n "/tmp/smart_shelter_kiosk.lock"'))


class MaintenanceTerminalScriptTests(unittest.TestCase):
    def test_terminal_script_is_valid_bash_and_requires_password(self):
        script = SCRIPT.parent / "maintenance_terminal.sh"
        subprocess.run(["bash", "-n", str(script)], check=True)
        body = script.read_text()
        self.assertIn('su -l "$USER_NAME"', body)
        self.assertNotIn("exec bash", body)
        self.assertNotIn("exec sh", body)


if __name__ == "__main__":
    unittest.main()
