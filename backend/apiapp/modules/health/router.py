from fastapi import APIRouter
from .schemas import HealthCheckResponse

router = APIRouter(prefix="/v1/health", tags=["Health"])

@router.get("", summary="Health Check")
async def health_check() -> HealthCheckResponse:
    return HealthCheckResponse(status="ok")
