"""Partner-plane error envelope (CR-154 FR-03).

422 carries `code`; uncaught errors become 500 `internal_error`.
"""

from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from apiapp.core.http_error import unhandled_error_handler
from apiapp.modules.thirdparty_auth.scopes import mint_access_token


async def test_partner_422_includes_validation_error_code(client: AsyncClient) -> None:
    token, _ = mint_access_token(client_id="m6", module_name="M6", scopes=["location-read"])
    response = await client.get(
        "/external/locations",
        params={"page": 0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["status"] == 422
    assert body["code"] == "validation_error"


def _crashing_app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.get("/external/boom")
    async def partner_boom() -> None:
        raise RuntimeError("boom")

    @app.get("/staff/boom")
    async def staff_boom() -> None:
        raise RuntimeError("boom")

    return app


async def test_uncaught_error_on_partner_plane_is_internal_error() -> None:
    transport = ASGITransport(app=_crashing_app(), raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        partner = await ac.get("/external/boom")
        staff = await ac.get("/staff/boom")

    assert partner.status_code == 500
    assert partner.json() == {"status": 500, "message": "Internal error", "code": "internal_error"}
    assert staff.status_code == 500
    assert staff.text == "Internal Server Error"
