import json
import stat
from collections.abc import Callable
from pathlib import Path

import pytest

FAKE_SCRIPT = """#!/usr/bin/env python3
import json
import os
import shutil
import sys
import time

D = {fake_dir!r}
name = os.path.basename(sys.argv[0])
argv = sys.argv[1:]

if name == "lp":
    data = sys.stdin.buffer.read()
    with open(os.path.join(D, "lp.stdin"), "wb") as f:
        f.write(data)
    with open(os.path.join(D, "lp.stdins.jsonl"), "a") as f:
        f.write(json.dumps(data.hex()) + "\\n")

with open(os.path.join(D, "calls.jsonl"), "a") as f:
    f.write(json.dumps({{"cmd": name, "argv": argv, "lc_all": os.environ.get("LC_ALL")}}) + "\\n")

key = name
if name == "lpstat":
    if "-p" in argv:
        key = "lpstat_p"
    elif "not-completed" in argv:
        key = "lpstat_pending"
    elif "completed" in argv:
        key = "lpstat_completed"


counter = os.path.join(D, key + ".count")
n = int(open(counter).read()) + 1 if os.path.exists(counter) else 1
with open(counter, "w") as f:
    f.write(str(n))


def read(suffix, default=""):
    path = os.path.join(D, f"{{key}}.{{n}}{{suffix}}")
    if not os.path.exists(path):
        path = os.path.join(D, key + suffix)
    if os.path.exists(path):
        with open(path) as fh:
            return fh.read()
    return default


time.sleep(float(read(".sleep", "0") or 0))
rc = int(read(".rc", "0") or 0)
sys.stdout.write(read(".out"))
if name == "cupsenable" and rc == 0:
    after = os.path.join(D, "cupsenable.then_p")
    if os.path.exists(after):
        shutil.copy(after, os.path.join(D, "lpstat_p.out"))
sys.exit(rc)
"""


class FakeCups:
    """Fake lp/lpstat/cupsenable/cancel executables on PATH, with recorded calls."""

    COMMANDS = ("lp", "lpstat", "cupsenable", "cancel")

    def __init__(self, directory: Path):
        self.dir = directory
        # IPP job-state per CUPS job id; a missing id behaves like an unreachable cupsd (None).
        self.job_states: dict[str, str] = {}

    def job_state(self, job_id: str) -> str | None:
        return self.job_states.get(job_id)

    def install(self) -> None:
        for command in self.COMMANDS:
            path = self.dir / command
            path.write_text(FAKE_SCRIPT.format(fake_dir=str(self.dir)))
            path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def set(self, key: str, out: str = "", rc: int = 0, sleep: float = 0) -> None:
        """key: lp | lpstat_p | lpstat_pending | lpstat_completed | cupsenable | cancel"""
        (self.dir / f"{key}.out").write_text(out)
        (self.dir / f"{key}.rc").write_text(str(rc))
        (self.dir / f"{key}.sleep").write_text(str(sleep))

    def set_nth(self, key: str, n: int, out: str = "", rc: int = 0, sleep: float = 0) -> None:
        """Override the n-th (1-based) call of `key`; other calls keep the `set` behavior."""
        (self.dir / f"{key}.{n}.out").write_text(out)
        (self.dir / f"{key}.{n}.rc").write_text(str(rc))
        (self.dir / f"{key}.{n}.sleep").write_text(str(sleep))

    def after_enable_lpstat_p_is(self, out: str) -> None:
        (self.dir / "cupsenable.then_p").write_text(out)

    def calls(self, cmd: str | None = None) -> list[dict]:
        path = self.dir / "calls.jsonl"
        if not path.exists():
            return []
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        return [r for r in rows if cmd is None or r["cmd"] == cmd]

    def lp_stdin(self) -> bytes:
        return (self.dir / "lp.stdin").read_bytes()

    def lp_stdins(self) -> list[bytes]:
        """stdin of every lp call, in order."""
        path = self.dir / "lp.stdins.jsonl"
        if not path.exists():
            return []
        return [bytes.fromhex(json.loads(line)) for line in path.read_text().splitlines()]


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps: list[float] = []
        self.on_sleep: Callable[[int], None] = lambda count: None

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds
        self.on_sleep(len(self.sleeps))


@pytest.fixture
def fake_cups(tmp_path, monkeypatch) -> FakeCups:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = FakeCups(bin_dir)
    fake.install()
    monkeypatch.setattr("printer.cups.ipp_job_state", fake.job_state)
    monkeypatch.setenv("PATH", f"{bin_dir}:/usr/bin:/bin")
    monkeypatch.setenv("LC_ALL", "en_US.UTF-8")
    return fake
