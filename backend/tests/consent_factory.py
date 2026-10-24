from __future__ import annotations

from typing import Any


def web_consent(**overrides: Any) -> dict[str, Any]:
    """One member's unbound web grant; FastAPI binds channel and giver."""
    return {
        "mode": "full",
        "health": True,
        "ref": "CS-7K3QZ9MD",
        "given_at": "2026-10-25T03:15:00.000Z",
        "notice_version": "2026-10-25",
        "given_by": "self",
        **overrides,
    }


def consent_fields(*, search_excluded: bool = False, **overrides: Any) -> dict[str, Any]:
    return {"consent": web_consent(**overrides), "search_excluded": search_excluded}
