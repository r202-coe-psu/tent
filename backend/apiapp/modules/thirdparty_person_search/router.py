"""EXT-012 — partner person search (#736).

`POST` (not GET) so the name / national ID never lands in a URL or an nginx access log. Not
scope-gated at the router level — the scope check happens inside the use case so a denied attempt
can still be logged with its `purpose` (same as EXT-007 / EXT-011)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response

from ...utils.request_meta import client_ip
from ..thirdparty_auth.scopes import ThirdPartyClaims, verify_thirdparty_token
from .schemas import PersonSearchEnvelope, PersonSearchErrorResponse, PersonSearchRequest
from .use_case import ThirdPartyPersonSearchUseCase, get_thirdparty_person_search_use_case

router = APIRouter(prefix="/external", tags=["External"])


@router.post(
    "/persons/search",
    response_model=PersonSearchEnvelope,
    responses={
        400: {"model": PersonSearchErrorResponse},
        401: {"model": PersonSearchErrorResponse},
        403: {"model": PersonSearchErrorResponse},
        422: {"model": PersonSearchErrorResponse},
    },
    # The body is read by hand (below) so a malformed body still goes through purpose → scope →
    # validation and is logged; declare its schema here so OpenAPI still documents it.
    openapi_extra={
        "requestBody": {
            "required": False,
            "description": "A missing or malformed body is answered with 422 `validation_error`.",
            "content": {"application/json": {"schema": PersonSearchRequest.model_json_schema()}},
        }
    },
)
async def search_persons(
    request: Request,
    response: Response,
    purpose: str | None = Query(default=None, description="วัตถุประสงค์การค้นหา (บังคับ)"),
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyPersonSearchUseCase = Depends(  # noqa: B008
        get_thirdparty_person_search_use_case
    ),
) -> PersonSearchEnvelope:
    # Personal data: a success response must never be cached by a proxy or the client.
    response.headers["Cache-Control"] = "no-store"
    return await use_case.search(
        search=await _read_search(request),
        purpose=purpose,
        claims=claims,
        client_ip=client_ip(request),
    )


async def _read_search(request: Request) -> Any:
    """`search` from the JSON body, or None when the body is missing, not JSON, or not an object.

    The use case rejects anything that is not a string with 422 `validation_error` — after the
    purpose and scope checks, and logged — instead of FastAPI rejecting the body up front."""
    try:
        payload = await request.json()
    except ValueError, RecursionError:  # bad JSON / bad UTF-8 / absurdly deep nesting
        return None
    return payload.get("search") if isinstance(payload, dict) else None
