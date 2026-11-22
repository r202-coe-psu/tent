"""smart-shelter.exe is python.org's PSF-signed pythonw.exe renamed (Smart App Control blocks any
.exe we build). Started with no arguments, sitecustomize hands over to `launch`."""

import pytest

from scanner_client.launcher import launch, should_launch

EXE = r"C:\Users\staff\AppData\Local\Programs\smart-shelter\smart-shelter.exe"


@pytest.mark.parametrize(
    ("executable", "orig_argv", "expected"),
    [
        (EXE, [EXE], True),
        (r"C:\smart-shelter\SMART-SHELTER.EXE", [r"C:\smart-shelter\SMART-SHELTER.EXE"], True),
        (r"C:\tent\tent.exe", [r"C:\tent\tent.exe"], False),
        (r"C:\tent\python.exe", [r"C:\tent\python.exe"], False),  # debug REPL stays a REPL
        (EXE, [EXE, "-c", "import scanner_client"], False),  # build smoke test, -m runs
    ],
)
def test_only_smart_shelter_exe_without_arguments_launches_the_client(
    executable, orig_argv, expected
):
    assert should_launch(executable, orig_argv) is expected


class Exited(Exception):
    pass


def _exit_recorder(codes):
    def exit_(code):
        codes.append(code)
        raise Exited  # os._exit never returns

    return exit_


def test_launch_runs_the_client_and_exits_with_its_code():
    codes = []

    with pytest.raises(Exited):
        launch(EXE, [EXE], prepare=lambda: None, run=lambda: 2, exit_=_exit_recorder(codes))

    assert codes == [2]


def test_launch_exits_with_failure_when_the_client_crashes():
    codes = []

    def crash():
        raise RuntimeError("boom")

    with pytest.raises(Exited):
        launch(EXE, [EXE], prepare=lambda: None, run=crash, exit_=_exit_recorder(codes))

    assert codes == [1]


def test_launch_does_nothing_for_other_interpreters():
    def never():
        raise AssertionError("must not run")

    launch(r"C:\tent\python.exe", [r"C:\tent\python.exe"], run=never, exit_=never)


def test_launch_makes_the_shortcuts_before_running_the_client():
    calls = []

    with pytest.raises(Exited):
        launch(
            EXE,
            [EXE],
            prepare=lambda: calls.append("shortcuts"),
            run=lambda: calls.append("client") or 0,
            exit_=_exit_recorder([]),
        )

    assert calls == ["shortcuts", "client"]


def test_a_shortcut_failure_still_runs_the_client():
    codes = []

    def fail():
        raise OSError("access denied")

    with pytest.raises(Exited):
        launch(EXE, [EXE], prepare=fail, run=lambda: 0, exit_=_exit_recorder(codes))

    assert codes == [0]
