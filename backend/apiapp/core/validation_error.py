from fastapi import status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

async def http422_error_handler(request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for error in exc.errors():
        errors.append({
            "field": ".".join([str(loc) for loc in error["loc"][1:]]) if len(error["loc"]) > 1 else str(error["loc"][0]),
            "message": error["msg"]
        })
    return JSONResponse(
        {"error": {"code": "VALIDATION_ERROR", "message": "Validation failed", "details": errors}},
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )
