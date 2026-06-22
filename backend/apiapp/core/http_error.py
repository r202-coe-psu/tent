from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException
from loguru import logger

async def http_error_handler(request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": exc.status_code, "message": str(exc.detail)}},
        status_code=exc.status_code,
    )
