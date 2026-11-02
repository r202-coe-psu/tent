"""
Router initialization - auto-discovery from modules
"""

import importlib
import pkgutil

from fastapi import APIRouter, FastAPI
from loguru import logger

from ..core.config import Settings


def _discover_routers(
    modules_package_name: str = "apiapp.modules",
) -> list[tuple[str, APIRouter]]:
    """Discover all routers from modules/*/router.py

    A module without a ``router.py`` is skipped silently (expected). Any other
    failure while importing it (e.g. a missing symbol or dependency) is logged
    at ERROR with a traceback so its routes do not vanish unnoticed.
    """
    routers = []

    try:
        modules_package = importlib.import_module(modules_package_name)

        for _, module_name, ispkg in pkgutil.iter_modules(
            modules_package.__path__, modules_package.__name__ + "."
        ):
            if not ispkg:
                continue

            router_path = f"{module_name}.router"
            try:
                router_module = importlib.import_module(router_path)
            except ModuleNotFoundError as e:
                # Only the probed `router` module itself being absent means "no router".
                if e.name != router_path:
                    logger.exception(f"Failed to import router module {router_path}: {e!r}")
                continue
            except Exception as e:
                logger.exception(f"Failed to import router module {router_path}: {e!r}")
                continue

            name = module_name.split(".")[-1]
            if hasattr(router_module, "router"):
                router = router_module.router
                if isinstance(router, APIRouter):
                    routers.append((name, router))
            # Optional second surface (e.g. `/staff/v1/*` alongside `/public/v1/*`).
            if hasattr(router_module, "staff_router"):
                staff_router = router_module.staff_router
                if isinstance(staff_router, APIRouter):
                    routers.append((f"{name}_staff", staff_router))

    except Exception as e:
        logger.error(f"Failed to discover routers: {e}")

    return routers


def init_routers(app: FastAPI, settings: Settings) -> None:
    """Initialize all routers from modules (auto-discovery)"""
    routers = _discover_routers()

    logger.info(f"Discovered {len(routers)} routers:")
    for name, router in routers:
        app.include_router(router, prefix=settings.API_PREFIX)
        logger.info(f"  - {name}")
