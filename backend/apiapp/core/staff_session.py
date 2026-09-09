"""Staff session auth for FastAPI `/staff/v1/*` (Couch AuthSession cookie)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Cookie, Depends, Header, HTTPException, Request, status

from .config import settings

_SESSION_TIMEOUT_SECONDS = 5.0


@dataclass(frozen=True)
class StaffSession:
    name: str
    roles: list[str]
    shelter_code: str | None
    is_sa: bool


def _shelter_code_from_roles(roles: list[str]) -> str | None:
    for role in roles:
        if role.startswith("shelter:") and len(role) > len("shelter:"):
            return role[len("shelter:") :]
    return None


def _is_system_admin(roles: list[str]) -> bool:
    return "system_admin" in roles or "_admin" in roles


def _is_shelter_manager(roles: list[str], shelter_code: str | None = None) -> bool:
    if "shelter_manager" in roles:
        return True
    if shelter_code and f"{shelter_code}:shelter_manager" in roles:
        return True
    return any(r.endswith(":shelter_manager") for r in roles)


def _has_registration_staff(roles: list[str], shelter_code: str | None = None) -> bool:
    if "registration_staff" in roles:
        return True
    if shelter_code and f"{shelter_code}:registration_staff" in roles:
        return True
    return any(r.endswith(":registration_staff") for r in roles)


def _unauthenticated(message: str = "Authentication required") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "UNAUTHENTICATED", "message": message}},
    )


def _forbidden(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"error": {"code": "FORBIDDEN", "message": message}},
    )


async def _fetch_couch_session(cookie_header: str | None) -> dict | None:
    couch_url = (settings.COUCHDB_URL or "").rstrip("/")
    if not couch_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": {
                    "code": "ONLINE_REQUIRED",
                    "message": "Staff session verification is unavailable",
                }
            },
        )
    headers = {"Accept": "application/json"}
    if cookie_header:
        headers["Cookie"] = cookie_header
    try:
        async with httpx.AsyncClient(timeout=_SESSION_TIMEOUT_SECONDS) as client:
            response = await client.get(f"{couch_url}/_session", headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": {
                    "code": "ONLINE_REQUIRED",
                    "message": "Could not reach central auth to verify staff session",
                }
            },
        ) from exc
    if response.status_code >= 400:
        return None
    try:
        return response.json()
    except ValueError:
        return None


async def require_staff_session(
    request: Request,
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    auth_session: Annotated[str | None, Cookie(alias="AuthSession")] = None,
) -> StaffSession:
    """Resolve the caller from the Couch AuthSession cookie (api-contract §2)."""
    cookie_header = cookie or request.headers.get("cookie")
    if not cookie_header and auth_session:
        cookie_header = f"AuthSession={auth_session}"
    if not cookie_header:
        raise _unauthenticated()

    data = await _fetch_couch_session(cookie_header)
    user_ctx = (data or {}).get("userCtx") or {}
    name = user_ctx.get("name")
    roles = list(user_ctx.get("roles") or [])
    if not name:
        raise _unauthenticated()

    is_sa = _is_system_admin(roles)
    shelter_code = None if is_sa else _shelter_code_from_roles(roles)
    return StaffSession(name=name, roles=roles, shelter_code=shelter_code, is_sa=is_sa)


async def require_shelter_scoped_staff(
    session: Annotated[StaffSession, Depends(require_staff_session)],
) -> StaffSession:
    """Shelter-scoped staff or SA — federated intake search (#251 / CR-115).

    Wider than claim (``require_registration_staff``) but tighter than a bare
    authenticated session: callers must be system_admin or carry a shelter scope.
    """
    if session.is_sa:
        return session
    if session.shelter_code:
        return session
    raise _forbidden("Requires shelter-scoped staff")


async def require_registration_staff(
    session: Annotated[StaffSession, Depends(require_staff_session)],
) -> StaffSession:
    """Registration desk gate — SA, shelter_manager, or registration_staff."""
    if session.is_sa:
        return session
    if _is_shelter_manager(session.roles, session.shelter_code):
        return session
    if _has_registration_staff(session.roles, session.shelter_code):
        return session
    raise _forbidden("Requires registration_staff, shelter_manager, or system_admin")


async def require_system_admin(
    session: Annotated[StaffSession, Depends(require_staff_session)],
) -> StaffSession:
    """System-admin-only gate — e.g. hard-delete of Unassigned Registration (FR-UR-04)."""
    if session.is_sa:
        return session
    raise _forbidden("Requires system_admin")
