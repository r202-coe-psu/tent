import os
import tempfile
import unittest
from pathlib import Path

from inspect_card_rfpro import other_openers


class OtherOpenersTests(unittest.TestCase):
    def process(self, proc: Path, pid: int, command: str, holds: list[str]) -> None:
        fds = proc / str(pid) / "fd"
        fds.mkdir(parents=True)
        for number, target in enumerate(holds):
            os.symlink(target, fds / str(number))
        (proc / str(pid) / "cmdline").write_bytes(command.replace(" ", "\0").encode())

    def test_lists_only_the_processes_holding_the_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Path(tmp)
            self.process(proc, 4001, "python main.py --kiosk", ["/dev/null", "/dev/hidraw0"])
            self.process(proc, 4002, "python other.py", ["/dev/hidraw1"])
            (proc / "self").mkdir()  # non-numeric entries are not processes

            self.assertEqual(
                other_openers("/dev/hidraw0", proc), [(4001, "python main.py --kiosk")]
            )

    def test_free_node_and_unreadable_processes_report_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Path(tmp)
            self.process(proc, 4001, "python main.py", ["/dev/null"])
            (proc / "4002").mkdir()  # no fd directory, like another user's process

            self.assertEqual(other_openers("/dev/hidraw0", proc), [])


if __name__ == "__main__":
    unittest.main()
