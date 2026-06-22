import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_refresh_token_flow(client: AsyncClient):
    # Register
    register_payload = {
        "email": "test@example.com",
        "username": "testuser",
        "password": "password123",
        "confirm_password": "password123",
        "name": "Test User",
    }
    response = await client.post("/v1/users/register", json=register_payload)
    # If user already exists, we might get 400, which is fine for login.
    if response.status_code != 201:
        assert response.status_code == 400
        # If 400, it might be "User already exists", which is fine.

    # Login
    login_data = {"username": "testuser", "password": "password123", "strategy": "cookies"}
    response = await client.post("/v1/auth/login", json=login_data)
    assert response.status_code == 200
    tokens = response.json()
    access_token = tokens["access_token"]

    # Get refresh token from cookie
    refresh_token_cookie = response.cookies.get("refresh_token")
    assert refresh_token_cookie is not None

    import asyncio

    await asyncio.sleep(1.1)

    # Test 1: Refresh with Cookie
    response = await client.get(
        "/v1/auth/refresh_token", cookies={"refresh_token": refresh_token_cookie}
    )
    assert response.status_code == 200
    new_tokens = response.json()
    assert "access_token" in new_tokens
    assert new_tokens["access_token"] != access_token

    # Test 2: Refresh with Bearer Token (Simulating Mobile/API client)
    # First, let's get a refresh token in the body (mobile login usually returns it)
    login_data_mobile = {
        "username": "testuser",
        "password": "password123",
        "strategy": "jwt",
    }
    response = await client.post("/v1/auth/login", json=login_data_mobile)
    assert response.status_code == 200
    tokens_mobile = response.json()
    refresh_token_bearer = tokens_mobile["refresh_token"]
    assert refresh_token_bearer is not None

    await asyncio.sleep(1.1)

    response = await client.get(
        "/v1/auth/refresh_token",
        headers={"Authorization": f"Bearer {refresh_token_bearer}"},
    )
    assert response.status_code == 200
    assert "access_token" in response.json()

    # Test 3: No token
    client.cookies.clear()
    refresh_token_bearer = None  # clear var
    response = await client.get("/v1/auth/refresh_token", headers={})
    assert response.status_code == 401
