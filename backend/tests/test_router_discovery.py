"""Router auto-discovery must skip router-less modules quietly but log real import failures."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from loguru import logger

from apiapp.core.router import _discover_routers


@pytest.fixture
def error_logs() -> Iterator[list[str]]:
    messages: list[str] = []
    sink_id = logger.add(lambda m: messages.append(str(m)), level="ERROR")
    yield messages
    logger.remove(sink_id)


def _write(path: Path, content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


@pytest.fixture
def modules_pkg(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> Path:
    # Unique name per test: sys.modules would otherwise serve a previous test's package.
    name = f"router_discovery_{request.node.name}"
    _write(tmp_path / name / "__init__.py")
    monkeypatch.syspath_prepend(str(tmp_path))
    return tmp_path / name


def test_module_without_router_is_skipped_silently(
    modules_pkg: Path, error_logs: list[str]
) -> None:
    _write(modules_pkg / "plain" / "__init__.py")
    _write(
        modules_pkg / "ok" / "router.py",
        "from fastapi import APIRouter\nrouter = APIRouter()\n",
    )
    _write(modules_pkg / "ok" / "__init__.py")

    names = [name for name, _ in _discover_routers(modules_pkg.name)]

    assert names == ["ok"]
    assert error_logs == []


def test_router_import_error_is_logged_and_others_still_load(
    modules_pkg: Path, error_logs: list[str]
) -> None:
    _write(modules_pkg / "broken" / "__init__.py")
    _write(
        modules_pkg / "broken" / "router.py",
        "from json import DoesNotExist\nrouter = None\n",
    )
    _write(modules_pkg / "missing_dep" / "__init__.py")
    _write(modules_pkg / "missing_dep" / "router.py", "import not_a_real_dependency_xyz\n")
    _write(modules_pkg / "ok" / "__init__.py")
    _write(
        modules_pkg / "ok" / "router.py",
        "from fastapi import APIRouter\nrouter = APIRouter()\n",
    )

    names = [name for name, _ in _discover_routers(modules_pkg.name)]

    assert names == ["ok"]
    joined = "\n".join(error_logs)
    assert f"{modules_pkg.name}.broken.router" in joined
    assert "DoesNotExist" in joined
    assert f"{modules_pkg.name}.missing_dep.router" in joined
    assert "not_a_real_dependency_xyz" in joined


def test_real_modules_all_import() -> None:
    """Guards against a module silently dropping out of the app (stale deps, bad imports)."""
    modules_dir = Path(__file__).parent.parent / "apiapp" / "modules"
    expected = sum(1 for p in modules_dir.glob("*/router.py"))

    assert len(_discover_routers()) >= expected
