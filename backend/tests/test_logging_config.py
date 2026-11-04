"""``LOGGING_LEVEL`` reaches the app's own stdlib loggers."""

from __future__ import annotations

import logging

from apiapp.core.config import Settings


def test_app_info_logs_are_not_dropped_by_the_root_level() -> None:
    Settings(LOGGING_LEVEL=logging.INFO).configure_logging()

    assert logging.getLogger("apiapp.modules.donations.use_case").isEnabledFor(logging.INFO)
    # Libraries keep the root's WARNING.
    assert not logging.getLogger("pymongo").isEnabledFor(logging.INFO)
