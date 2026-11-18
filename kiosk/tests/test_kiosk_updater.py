import subprocess
import tempfile
import time
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

    on_call = None

    def __call__(self, name, kiosk_dir):
        self.calls.append(name)
        if self.on_call:
            self.on_call(name)
        if name == self.cut_power_at:
            raise PowerCut()
        if name in self.crash:
            raise OSError(f"{name} blew up")
        return name not in self.fail


class KioskCheckoutCase(unittest.TestCase):
    """A release repo and a kiosk cloned from it, with the updater log in the temp dir."""

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


class UpdateOnBootTests(KioskCheckoutCase):
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

    def test_main_survives_a_crashing_rollback_without_re_exec_when_code_is_back(self):
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

    def cut_power_during_pip(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        with self.assertRaises(PowerCut):
            kiosk_updater.update_on_boot(self.kiosk_dir, run_step=FakeSteps(cut_power_at="pip"))

    def test_offline_boot_after_a_power_cut_still_finishes_the_install(self):
        self.cut_power_during_pip()
        new = self.head()
        git(self.device, "remote", "set-url", "origin", str(self.origin.parent / "missing"))

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual(self.steps.calls, ["pip"])

    def test_checkout_cut_short_by_a_power_cut_is_completed_not_reported_dirty(self):
        before = self.head()
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        # The updater wrote its marker, then power died with main.py half written.
        state = kiosk_updater.state_dir(self.kiosk_dir)
        state.mkdir()
        (state / "pending").write_text(f"{before}\n{new}\n")
        (self.kiosk_dir / "main.py").write_text("v")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "v2\n")

    def test_marker_left_empty_by_a_power_cut_does_not_block_updates(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        state = kiosk_updater.state_dir(self.kiosk_dir)
        state.mkdir()
        (state / "pending").write_text("")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)

    def test_commit_made_on_the_kiosk_and_never_pushed_is_kept(self):
        git(self.device, "config", "user.email", "tech@example.com")
        git(self.device, "config", "user.name", "tech")
        (self.kiosk_dir / "main.py").write_text("site hotfix\n")
        git(self.device, "commit", "-q", "-am", "site hotfix")
        hotfix = self.head()
        self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "diverged")
        self.assertEqual(self.head(), hotfix)

    def test_failed_restore_keeps_the_snapshot_for_the_next_boot(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        state = kiosk_updater.state_dir(self.kiosk_dir)
        snapshot = state / kiosk_updater.PIP_SNAPSHOT
        # Stand in for run_install_step, which freezes the venv before its first pip install.
        self.steps.on_call = lambda name: name == "pip" and snapshot.write_text("httpx==0.27.0\n")
        self.steps.fail.update({"pip", "pip-restore"})

        self.assertEqual(self.update(), "rolled-back")
        self.assertEqual(snapshot.read_text(), "httpx==0.27.0\n")

    def test_snapshot_left_from_an_old_update_is_not_reused(self):
        state = kiosk_updater.state_dir(self.kiosk_dir)
        state.mkdir()
        (state / kiosk_updater.PIP_SNAPSHOT).write_text("httpx==0.20.0\n")
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        self.steps.fail.add("pip")
        seen = []
        self.steps.on_call = lambda name: seen.append((state / kiosk_updater.PIP_SNAPSHOT).exists())

        self.update()
        # No marker: that snapshot is stale, so pip must take a fresh one.
        self.assertEqual(seen[0], False)

    def test_playwright_installed_from_a_url_counts_as_playwright(self):
        self.commit_file("kiosk/requirements.txt", "playwright @ https://example.com/p-1.whl\n")
        self.release("kiosk-v0.2.0")
        self.update()
        self.steps.calls.clear()
        self.commit_file("kiosk/requirements.txt", "playwright @ https://example.com/p-2.whl\n")
        self.release("kiosk-v0.3.0")

        self.update()
        self.assertEqual(self.steps.calls, ["pip", "playwright"])

    def test_release_that_adds_requirements_txt_installs_it(self):
        git(self.origin, "rm", "-q", "kiosk/requirements.txt")
        git(self.origin, "commit", "-q", "-m", "drop requirements")
        self.release("kiosk-v0.1.1")
        self.assertEqual(self.update(), "updated")
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\n")
        self.release("kiosk-v0.2.0")
        self.steps.calls.clear()

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.steps.calls, ["pip", "playwright"])

    def leave_a_stale_marker(self):
        """A release whose pip and rollback both failed (network gone): marker stays, HEAD is old."""
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        steps = FakeSteps(fail={"pip", "pip-restore"})
        # Stand in for run_install_step, which freezes the venv before its first pip install.
        snapshot = kiosk_updater.state_dir(self.kiosk_dir) / kiosk_updater.PIP_SNAPSHOT
        steps.on_call = lambda name: name == "pip" and snapshot.write_text("httpx==0.27.0\n")
        self.assertEqual(kiosk_updater.update_on_boot(self.kiosk_dir, run_step=steps), "rolled-back")
        self.assertTrue((kiosk_updater.state_dir(self.kiosk_dir) / "pending").exists())

    def test_stale_marker_does_not_overwrite_a_hand_edit_the_release_never_touches(self):
        self.leave_a_stale_marker()
        (self.kiosk_dir / "main.py").write_text("site hotfix\n")

        self.assertEqual(self.update(), "dirty")
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "site hotfix\n")

    def test_stale_marker_does_not_drop_a_commit_made_on_the_kiosk(self):
        self.leave_a_stale_marker()
        git(self.device, "config", "user.email", "tech@example.com")
        git(self.device, "config", "user.name", "tech")
        (self.kiosk_dir / "main.py").write_text("site hotfix\n")
        git(self.device, "commit", "-q", "-am", "site hotfix")
        hotfix = self.head()

        self.assertEqual(self.update(), "diverged")
        self.assertEqual(self.head(), hotfix)

    def test_reverting_kiosk_stable_after_a_failed_rollback_restores_the_packages(self):
        self.leave_a_stale_marker()
        git(self.origin, "tag", "-f", "kiosk-stable", "kiosk-v0.1.0")

        self.assertEqual(self.update(), "restored")
        self.assertEqual(self.steps.calls, ["pip-restore"])
        self.steps.calls.clear()
        self.assertEqual(self.update(), "up-to-date")
        self.assertEqual(self.steps.calls, [])

    def test_offline_boot_completes_a_checkout_cut_short_by_a_power_cut(self):
        before = self.head()
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        git(self.device, "fetch", "-q", "origin", "+refs/tags/kiosk-stable:refs/tags/kiosk-stable")
        state = kiosk_updater.state_dir(self.kiosk_dir)
        state.mkdir()
        (state / "pending").write_text(f"{before}\n{new}\n")
        (self.kiosk_dir / "main.py").write_text("v")
        git(self.device, "remote", "set-url", "origin", str(self.origin.parent / "missing"))

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "v2\n")

    def test_release_that_starts_tracking_a_local_file_does_not_overwrite_it(self):
        before = self.head()
        (self.kiosk_dir / "notes.txt").write_text("site data\n")
        self.commit_file("kiosk/notes.txt", "from the release\n")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "dirty")
        self.assertEqual(self.head(), before)
        self.assertEqual((self.kiosk_dir / "notes.txt").read_text(), "site data\n")
        self.assertEqual(self.update(), "dirty")

    def test_tag_moved_off_main_mid_install_still_finishes_the_trusted_install(self):
        self.cut_power_during_pip()
        installed = self.head()
        git(self.origin, "switch", "-q", "-c", "feat/unreviewed")
        self.commit_file("kiosk/main.py", "unreviewed\n")
        self.release("kiosk-v0.3.0")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), installed)
        self.assertEqual(self.steps.calls, ["pip"])

    def test_git_lock_left_by_a_power_cut_mid_checkout_does_not_strand_the_kiosk(self):
        before = self.head()
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        git(self.device, "fetch", "-q", "origin", "+refs/tags/kiosk-stable:refs/tags/kiosk-stable")
        state = kiosk_updater.state_dir(self.kiosk_dir)
        state.mkdir()
        (state / "pending").write_text(f"{before}\n{new}\n")
        (self.device / ".git" / "index.lock").write_text("")
        (self.kiosk_dir / "main.py").unlink()

        self.assertEqual(self.update(), "updated")
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "v2\n")

    def test_checkout_that_fails_for_another_reason_keeps_the_marker(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        real_git = kiosk_updater._git

        def checkout_dies(cwd, *args, **kwargs):
            if args[0] == "checkout":
                raise subprocess.CalledProcessError(128, ["git", *args], stderr="fatal: killed mid-write")
            return real_git(cwd, *args, **kwargs)

        with mock.patch.object(kiosk_updater, "_git", checkout_dies):
            self.assertEqual(self.update(), "dirty")
        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)

    def test_hotfix_after_an_unfinished_rollback_is_not_overwritten(self):
        self.commit_file("kiosk/main.py", "v2\n")
        self.leave_a_stale_marker()
        (self.kiosk_dir / "main.py").write_text("site hotfix\n")

        self.assertEqual(self.update(), "dirty")
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "site hotfix\n")

    def test_reverting_the_tag_after_a_power_cut_undoes_every_step_the_release_ran(self):
        self.commit_file("kiosk/models/download_models.sh", "# new sha256\n")
        self.release("kiosk-v0.2.0")
        with self.assertRaises(PowerCut):
            kiosk_updater.update_on_boot(self.kiosk_dir, run_step=FakeSteps(cut_power_at="models"))
        git(self.origin, "tag", "-f", "kiosk-stable", "kiosk-v0.1.0")

        self.assertEqual(self.update(), "restored")
        self.assertEqual(self.steps.calls, ["models"])

    def test_rollback_gets_its_own_time_even_after_the_install_used_up_the_budget(self):
        self.commit_file("kiosk/requirements.txt", "playwright>=1.40.0\nhttpx>=0.28.0\n")
        self.release("kiosk-v0.2.0")
        self.steps.fail.add("pip")
        timeouts = {}
        self.steps.on_call = lambda name: timeouts.setdefault(name, kiosk_updater._step_timeout())
        spent = mock.patch.object(kiosk_updater, "_deadline", time.monotonic() - 1)
        spent.start()
        self.addCleanup(spent.stop)

        self.update()
        self.assertGreater(timeouts["pip-restore"], 60)

    def test_power_cut_mid_checkout_of_a_rename_is_completed(self):
        before = self.head()
        self.commit_file("kiosk/app_module.py", "".join(f"line {n}\n" for n in range(50)))
        self.release("kiosk-v0.1.1")
        self.assertEqual(self.update(), "updated")
        before = self.head()
        git(self.origin, "mv", "kiosk/app_module.py", "kiosk/renamed_module.py")
        git(self.origin, "commit", "-q", "-m", "rename module")
        new = git(self.origin, "rev-parse", "HEAD")
        self.release("kiosk-v0.2.0")
        git(self.device, "fetch", "-q", "origin", "+refs/tags/kiosk-stable:refs/tags/kiosk-stable")
        state = kiosk_updater.state_dir(self.kiosk_dir)
        (state / "pending").write_text(f"{before}\n{new}\n")
        # Power died after git removed the old path and before it wrote the new one.
        (self.kiosk_dir / "app_module.py").unlink()

        self.assertEqual(self.update(), "updated")
        self.assertTrue((self.kiosk_dir / "renamed_module.py").exists())

    def test_ref_lock_left_by_a_power_cut_does_not_strand_the_kiosk(self):
        before = self.head()
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        state = kiosk_updater.state_dir(self.kiosk_dir)
        state.mkdir()
        (state / "pending").write_text(f"{before}\n{new}\n")
        (self.device / ".git" / "refs" / "heads" / "main.lock").write_text("")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)

    def test_restore_after_a_power_cut_clears_the_git_lock_first(self):
        self.commit_file("kiosk/models/download_models.sh", "# new sha256\n")
        self.release("kiosk-v0.2.0")
        with self.assertRaises(PowerCut):
            kiosk_updater.update_on_boot(self.kiosk_dir, run_step=FakeSteps(cut_power_at="models"))
        git(self.origin, "tag", "-f", "kiosk-stable", "kiosk-v0.1.0")
        (self.device / ".git" / "index.lock").write_text("")

        self.assertEqual(self.update(), "restored")

    def test_hand_edit_after_an_unfinished_restore_is_not_overwritten(self):
        self.commit_file("kiosk/main.py", "v2\n")
        self.commit_file("kiosk/models/download_models.sh", "# new sha256\n")
        self.release("kiosk-v0.2.0")
        with self.assertRaises(PowerCut):
            kiosk_updater.update_on_boot(self.kiosk_dir, run_step=FakeSteps(cut_power_at="models"))
        git(self.origin, "tag", "-f", "kiosk-stable", "kiosk-v0.1.0")
        self.steps.fail.add("models")
        self.assertEqual(self.update(), "rolled-back")
        (self.kiosk_dir / "main.py").write_text("site hotfix\n")

        self.assertEqual(self.update(), "dirty")
        self.assertEqual((self.kiosk_dir / "main.py").read_text(), "site hotfix\n")

    def test_checkout_that_cannot_write_a_file_is_not_taken_as_updated(self):
        before = self.head()
        self.commit_file("kiosk/sub/keep.py", "x\n")
        self.release("kiosk-v0.1.1")
        self.update()
        before = self.head()
        new = self.commit_file("kiosk/sub/new.py", "new\n")
        self.release("kiosk-v0.2.0")
        sub = self.kiosk_dir / "sub"
        sub.chmod(0o555)  # stands in for a full SD card or an I/O error
        self.addCleanup(sub.chmod, 0o755)

        self.assertEqual(self.update(), "dirty")
        self.assertEqual(self.head(), before)
        sub.chmod(0o755)
        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)
        self.assertTrue((sub / "new.py").exists())

    def test_ref_lock_from_a_power_cut_during_fetch_does_not_look_offline_forever(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        (self.device / ".git" / "refs" / "tags" / "kiosk-stable.lock").write_text("")

        self.assertEqual(self.update(), "updated")
        self.assertEqual(self.head(), new)

    def test_release_that_tracks_an_ignored_local_file_does_not_overwrite_it(self):
        self.commit_file(".gitignore", ".env\n")
        self.release("kiosk-v0.1.1")
        self.update()
        (self.kiosk_dir / ".env").write_text("DEVICE_SECRET=kiosk1\n")
        (self.origin / "kiosk" / ".env").write_text("DEVICE_SECRET=example\n")
        git(self.origin, "add", "-f", "kiosk/.env")
        git(self.origin, "commit", "-q", "-m", "track .env")
        self.release("kiosk-v0.2.0")

        self.assertEqual(self.update(), "dirty")
        self.assertEqual((self.kiosk_dir / ".env").read_text(), "DEVICE_SECRET=kiosk1\n")


class UpdateInfoTests(KioskCheckoutCase):
    """What the kiosk info panel reads back from the checkout and the updater log."""

    def info(self):
        return kiosk_updater.update_info(self.kiosk_dir)

    def test_a_kiosk_never_updated_shows_its_commit_and_no_update(self):
        self.assertEqual(
            self.info(),
            {"commit": self.head()[:7], "updated_at": None, "last_check": None},
        )

    def test_shows_when_an_update_last_changed_the_commit_and_what_each_boot_said(self):
        new = self.commit_file("kiosk/main.py", "v2\n")
        self.release("kiosk-v0.2.0")
        with mock.patch.object(kiosk_updater, "datetime") as clock:
            clock.now.return_value.isoformat.return_value = "2026-11-17T08:01:12"
            kiosk_updater.main(self.kiosk_dir, run_step=self.steps)
            clock.now.return_value.isoformat.return_value = "2026-11-18T07:59:40"
            kiosk_updater.main(self.kiosk_dir, run_step=self.steps)

        self.assertEqual(
            self.info(),
            {
                "commit": new[:7],
                "updated_at": "2026-11-17T08:01:12",
                "last_check": {"at": "2026-11-18T07:59:40", "outcome": "up-to-date"},
            },
        )

    def test_a_skipped_boot_shows_only_the_outcome_word_and_other_lines_are_ignored(self):
        kiosk_updater.LOG_FILE.write_text(
            "[kiosk-updater] 2026-11-17T08:00:00 running pip\n"
            "[kiosk-updater] 2026-11-17T08:00:05 skipped: OSError: disk full: abc1234 -> abc1234\n"
            "garbage\n"
        )

        self.assertEqual(
            self.info()["last_check"], {"at": "2026-11-17T08:00:05", "outcome": "skipped"}
        )
        self.assertIsNone(self.info()["updated_at"])

    def test_answers_none_for_what_it_cannot_read(self):
        with tempfile.TemporaryDirectory() as not_a_repo:
            self.assertEqual(
                kiosk_updater.update_info(Path(not_a_repo), Path(not_a_repo) / "missing.log"),
                {"commit": None, "updated_at": None, "last_check": None},
            )


class RunCommandTests(unittest.TestCase):
    def test_timeout_kills_the_step_and_everything_it_started(self):
        with tempfile.TemporaryDirectory() as directory:
            late = Path(directory) / "late"
            # Like download_models.sh -> curl: the grandchild would outlive a plain kill.
            script = f"(sleep 1; touch {late}) & sleep 30"

            started = time.monotonic()
            self.assertFalse(kiosk_updater.run_command(["bash", "-c", script], directory, 0.3))
            self.assertLess(time.monotonic() - started, 5)
            time.sleep(1.5)
            self.assertFalse(late.exists())

    def test_reports_the_exit_status(self):
        self.assertTrue(kiosk_updater.run_command(["true"], ".", 5))
        self.assertFalse(kiosk_updater.run_command(["false"], ".", 5))


if __name__ == "__main__":
    unittest.main()
