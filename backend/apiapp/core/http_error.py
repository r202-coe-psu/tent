from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if request.url.path.startswith("/external/v1"):
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(exc.detail, status_code=exc.status_code)
        return JSONResponse(
            {"error": {"code": "error", "message": str(exc.detail)}},
            status_code=exc.status_code,
        )
    return JSONResponse({"errors": [exc.detail]}, status_code=exc.status_code)
