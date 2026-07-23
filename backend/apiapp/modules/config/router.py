from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from .schemas import ConfigResponse
from .use_case import ConfigUseCase, get_config_use_case

router = APIRouter(prefix="/public/v1/config", tags=["Config"])

CACHE_CONTROL = "public, max-age=60"

@router.get("/faqs", response_model=ConfigResponse)
async def get_faqs(
    response: Response,
    use_case: ConfigUseCase = Depends(get_config_use_case),  # noqa: B008
) -> ConfigResponse:
    """Get public FAQs from the MongoDB read model."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.get_public_faqs()
