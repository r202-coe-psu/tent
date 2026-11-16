import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import kiosk_updater


def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


class PowerCut(BaseException):
    """The kiosk loses power: the updater process dies mid-step."""


class FakeSteps:
    """Records the post-checkout steps the updater asks for; fails or kills on the ones listed."""

    def __init__(self, fail=(), cut_power_at=None, crash=()):
        self.calls = []
        self.fail = set(fail)
        self.cut_power_at = cut_power_at
        self.crash = set(crash)

    def __call__(self, name, kiosk_dir):
        self.calls.append(name)
        if name == self.cut_power_at:
            raise PowerCut()
        if name in self.crash:
            raise OSError(f"{name} blew up")
        return name not in self.fail


class UpdateOnBootTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.origin = root / "origin"
        self.origin.mkdir()
        git(self.origin, "init", "-q", "-b", "main")
        git(self.origin, "config", "user.email", "dev@example.com")
        git(self.origin, "config", "user.name", "dev")
        self.commit_file("kiosk/main.py", "v1\n")
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.27.0\n")
        self.release("kiosk-v0.1.0")
        log = mock.patch.object(kiosk_updater, "LOG_FILE", root / "updater.log")
        log.start()
        self.addCleanup(log.stop)

        self.device = root / "device"
        # A kiosk installed per README: a clone with main checked out.
        git(root, "clone", "-q", str(self.origin), str(self.device))
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

    def branch(self):
        return git(self.device, "branch", "--show-current")

    def update(self):
        return kiosk_updater.update_on_boot(self.kiosk_dir, run_step=self.steps)

    def test_moves_to_the_commit_kiosk_stable_points_at(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "v2\n")
        self.assertEqual(self.branch(), "main")

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
        # pip install -r of the old >= requirements keeps newer packages, so restore the snapshot
        # pip took first; the old download script puts back the models the old code expects.
        self.assertEqual(self.steps.calls, ["pip", "models", "pip-restore", "models"])

    def test_failed_pip_install_restores_the_package_snapshot(self):
        before = self.head()
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        self.steps.fail.add("pip")

        self.assertEqual(self.update(), "rolled-back")
        self.assertEqual(self.head(), before)
        self.assertEqual(self.steps.calls, ["pip", "pip-restore"])

    def test_power_cut_during_install_resumes_the_install_on_next_boot(self):
        new = self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        with self.assertRaises(PowerCut):
            kiosk_updater.update_on_boot(self.kiosk_dir, run_step=FakeSteps(cut_power_at="pip"))

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual(self.steps.calls, ["pip"])

    def test_install_step_that_raises_counts_as_failed_and_rolls_back(self):
        before = self.head()
        self.commit_file("kiosk/models/download_models.sh", "# new sha256\n")
        self.release("kiosk-v0.2.0")
        self.steps.crash.add("models")

        self.assertEqual(self.update(), "rolled-back")
        self.assertEqual(self.head(), before)

    def test_main_tells_start_kiosk_to_re_exec_only_when_the_code_moved(self):
        run = lambda: kiosk_updater.main(self.kiosk_dir, run_step=self.steps)
        self.assertEqual(run(), 0)

        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        self.assertEqual(run(), kiosk_updater.UPDATED_EXIT)

    def test_main_never_raises_and_re_execs_if_the_code_moved_before_a_crash(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        # pip fails, then the rollback itself crashes after the checkout back: code did not move.
        self.steps.fail.add("pip")
        self.steps.crash.add("pip-restore")

        self.assertEqual(kiosk_updater.main(self.kiosk_dir, run_step=self.steps), 0)

    def test_kiosk_stable_on_an_unmerged_branch_is_refused(self):
        before = self.head()
        git(self.origin, "switch", "-q", "-c", "feat/unreviewed")
        self.commit_file("kiosk/main.py", "unreviewed\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "untrusted")
        self.assertEqual(self.head(), before)

    def test_release_only_on_develop_is_refused(self):
        before = self.head()
        git(self.origin, "switch", "-q", "-c", "develop")
        self.commit_file("kiosk/main.py", "develop only\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "untrusted")
        self.assertEqual(self.head(), before)

    def test_kiosk_on_another_branch_never_updates(self):
        git(self.device, "switch", "-q", "-c", "develop")
        before = self.head()
        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "disabled")
        self.assertEqual(self.head(), before)
        self.assertEqual(self.branch(), "develop")

    def test_detached_kiosk_never_updates(self):
        git(self.device, "checkout", "-q", "--detach")
        before = self.head()
        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "disabled")
        self.assertEqual(self.head(), before)

    def test_rolled_back_kiosk_stays_on_main(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        self.steps.fail.add("pip")

        self.assertEqual(self.update(), "rolled-back")
        self.assertEqual(self.branch(), "main")

    def test_package_named_like_playwright_does_not_reinstall_the_browser(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.27.0\nplaywright-stealth>=1.0\n")
        self.release("kiosk-v0.2.0")

        self.update()
        self.assertEqual(self.steps.calls, ["pip"])


if __name__ == "__main__":
    unittest.main()
