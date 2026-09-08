from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TokenRequest(BaseModel):
    grant_type: str
    client_id: str = Field(min_length=1, max_length=64)
    client_secret: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int
    module_name: str
    scopes: list[str]


class TokenErrorDetail(BaseModel):
    code: str
    message: str


class TokenErrorResponse(BaseModel):
    error: TokenErrorDetail
