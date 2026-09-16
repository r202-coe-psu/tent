from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

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
