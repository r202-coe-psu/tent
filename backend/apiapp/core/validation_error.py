from fastapi.exceptions import RequestValidationError
from fastapi.openapi.constants import REF_PREFIX
from fastapi.openapi.utils import validation_error_response_definition
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_422_UNPROCESSABLE_CONTENT


async def http422_error_handler(
    request: Request,
    exc: RequestValidationError | ValidationError,
) -> JSONResponse:
    if request.url.path.startswith("/external/v1"):
        messages = [
            f"{'.'.join(str(loc) for loc in err.get('loc', []))}: {err.get('msg', '')}"
            for err in exc.errors()
        ]
        return JSONResponse(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Validation failed: " + "; ".join(messages),
                }
            },
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
        )
    return JSONResponse(
        {"errors": exc.errors()},
        status_code=HTTP_422_UNPROCESSABLE_CONTENT,
    )


validation_error_response_definition["properties"] = {
    "errors": {
        "title": "Errors",
        "type": "array",
        "items": {"$ref": f"{REF_PREFIX}ValidationError"},
    },
}
