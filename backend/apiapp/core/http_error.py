from fastapi import HTTPException
from loguru import logger
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response

_M2_PREFIX = "/external/v1"


def _is_partner_path(path: str) -> bool:
    """Partner OAuth plane under /external — exclude legacy M2 /external/v1."""
    return path.startswith("/external") and not path.startswith(_M2_PREFIX)


def _partner_error_body(exc: HTTPException) -> dict:
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        inner = exc.detail["error"]
        code = inner.get("code")
        body: dict = {"status": exc.status_code, "message": inner.get("message", "")}
        if code:
            body["code"] = code
        if "detail" in inner:
            body["detail"] = inner["detail"]
        if code == "location_not_found":
            body["result"] = []
        return body
    return {"status": exc.status_code, "message": str(exc.detail)}


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    path = request.url.path
    if path.startswith(_M2_PREFIX):
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(exc.detail, status_code=exc.status_code)
        return JSONResponse(
            {"error": {"code": "error", "message": str(exc.detail)}},
            status_code=exc.status_code,
        )
    if _is_partner_path(path):
        return JSONResponse(_partner_error_body(exc), status_code=exc.status_code)
    return JSONResponse({"errors": [exc.detail]}, status_code=exc.status_code)


async def unhandled_error_handler(request: Request, exc: Exception) -> Response:
    """Uncaught exceptions — partner plane gets its envelope (CR-154 `internal_error`);
    every other path keeps Starlette's default plain-text 500."""
    logger.exception(f"unhandled error on {request.method} {request.url.path}: {exc!r}")
    if _is_partner_path(request.url.path):
        return JSONResponse(
            {"status": 500, "message": "Internal error", "code": "internal_error"},
            status_code=500,
        )
    return PlainTextResponse("Internal Server Error", status_code=500)
