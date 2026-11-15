import subprocess
import tempfile
import unittest
from pathlib import Path

import kiosk_updater


def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


class FakeSteps:
    """Records the post-checkout steps the updater asks for; fails the ones listed."""

    def __init__(self, fail=()):
        self.calls = []
        self.fail = set(fail)

    def __call__(self, name, kiosk_dir):
        self.calls.append(name)
        return name not in self.fail


class UpdateOnBootTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.origin = root / "origin"
        self.origin.mkdir()
        git(self.origin, "init", "-q", "-b", "develop")
        git(self.origin, "config", "user.email", "dev@example.com")
        git(self.origin, "config", "user.name", "dev")
        self.commit_file("kiosk/main.py", "v1\n")
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.27.0\n")
        self.release("kiosk-v0.1.0")

        self.device = root / "device"
        git(root, "clone", "-q", str(self.origin), str(self.device))
        git(self.device, "fetch", "-q", "origin", "+refs/tags/kiosk-stable:refs/tags/kiosk-stable")
        git(self.device, "checkout", "-q", "--detach", "kiosk-stable")
        self.kiosk_dir = self.device / "kiosk"
        self.steps = FakeSteps()

    def commit_file(self, path, content):
        file = self.origin / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
        git(self.origin, "add", path)
        git(self.origin, "commit", "-q", "-m", f"change {path}")
        return git(self.origin, "rev-parse", "HEAD")

    def release(self, version):
        git(self.origin, "tag", version)
        git(self.origin, "tag", "-f", "kiosk-stable", version)

    def head(self):
        return git(self.device, "rev-parse", "HEAD")

    def update(self):
        return kiosk_updater.update_on_boot(self.kiosk_dir, run_step=self.steps)

    def test_moves_to_the_commit_kiosk_stable_points_at(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "v2\n")

    def test_already_on_kiosk_stable_runs_no_install_step(self):
        before = self.head()

        self.assertEqual(self.update(), "up-to-date")
        self.assertEqual(self.head(), before)
        self.assertEqual(self.steps.calls, [])

    def test_unreachable_remote_keeps_the_current_version(self):
        before = self.head()
        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        git(self.device, "remote", "set-url", "origin", str(self.origin.parent / "missing"))

        self.assertEqual(self.update(), "offline")
        self.assertEqual(self.head(), before)

    def test_local_edits_on_the_kiosk_block_the_update(self):
        before = self.head()
        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        (self.kiosk_dir / "main.py").write_text("hotfix on site\n")

        self.assertEqual(self.update(), "dirty")
        self.assertEqual(self.head(), before)
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "hotfix on site\n")

    def test_untracked_files_like_env_do_not_block_the_update(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        (self.kiosk_dir / ".env").write_text("DEVICE_ID=kiosk1\n")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual((self.kiosk_dir / ".env").read_text(), "DEVICE_ID=kiosk1\n")

    def test_code_only_release_runs_no_install_step(self):
        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")

        self.update()
        self.assertEqual(self.steps.calls, [])

    def test_changed_requirements_reinstall_python_packages(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.steps.calls, ["pip"])

    def test_new_playwright_version_also_reinstalls_its_browser(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.50.0\nhttpx>=0.27.0\n")
        self.release("kiosk-v0.2.0")

        self.update()
        self.assertEqual(self.steps.calls, ["pip", "playwright"])

    def test_new_model_checksums_download_the_models(self):
        self.commit_file("kiosk/models/download_models.sh", "# new sha256\n")
        self.release("kiosk-v0.2.0")

        self.update()
        self.assertEqual(self.steps.calls, ["models"])

    def test_failed_install_step_returns_to_the_previous_version(self):
        before = self.head()
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.commit_file("kiosk/models/download_models.sh", "# new sha256\n")
        self.release("kiosk-v0.2.0")
        self.steps.fail.add("models")

        self.assertEqual(self.update(), "rolled-back")
        self.assertEqual(self.head(), before)
        # pip already ran for the new requirements, so it runs again for the old ones.
        self.assertEqual(self.steps.calls, ["pip", "models", "pip"])


if __name__ == "__main__":
    unittest.main()
