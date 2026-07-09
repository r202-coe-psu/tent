import pytest
from httpx import AsyncClient

from apiapp.core.config import get_settings


@pytest.mark.asyncio
async def test_verify_without_secret_returns_401(client: AsyncClient):
	response = await client.get("/v1/auth/verify")
	assert response.status_code == 401


@pytest.mark.asyncio
async def test_verify_with_invalid_secret_returns_401(client: AsyncClient):
	response = await client.get(
		"/v1/auth/verify",
		headers={"Authorization": "Bearer wrong-secret"},
	)
	assert response.status_code == 401


@pytest.mark.asyncio
async def test_verify_with_valid_secret_returns_200(client: AsyncClient):
	settings = get_settings()
	response = await client.get(
		"/v1/auth/verify",
		headers={"Authorization": f"Bearer {settings.EXTERNAL_API_SECRET}"},
	)
	assert response.status_code == 200
	assert response.json() == {"status": "ok"}
