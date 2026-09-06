"""Use case for EXT-001 token issuance (ADR 0002, partner ODT)."""

from __future__ import annotations

import secrets

from fastapi import HTTPException, status
from loguru import logger
from tent_model.third_party_client import ThirdPartyClient

from ...utils.masking import sha256_hex
from .schemas import TokenResponse
from .scopes import mint_access_token

# Partner ODT's own documented 401 example — one message for unknown client_id, wrong
# client_secret, and inactive client alike (never reveals which, to avoid enumeration).
_INVALID_CLIENT_MESSAGE = "Invalid client credentials."


def _oauth_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


class ThirdPartyAuthUseCase:
    async def issue_token(
        self, grant_type: str, client_id: str, client_secret: str, client_ip: str
    ) -> TokenResponse:
        # ODT: "ขอให้บันทึกทุกครั้งที่มีการขอ Token ลง log พร้อมเวลาและหมายเลข IP ต้นทาง"
        # — every token request, logged with (timestamp via loguru) + source IP. Values
        # are embedded directly in the message, not via `.bind()` — the app's loguru
        # sink uses the default format, which drops `extra` fields silently.
        logger.info(f"third-party token request client_id={client_id} ip={client_ip}")

        if grant_type != "client_credentials":
            raise _oauth_error(
                status.HTTP_400_BAD_REQUEST,
                "unsupported_grant_type",
                "Only grant_type=client_credentials is supported",
            )

        client = await ThirdPartyClient.find_one(ThirdPartyClient.client_id == client_id)
        if client is None or not client.is_active:
            logger.warning(
                f"third-party token request rejected client_id={client_id} ip={client_ip} "
                "reason=unknown_or_inactive_client"
            )
            raise _oauth_error(
                status.HTTP_401_UNAUTHORIZED, "invalid_client", _INVALID_CLIENT_MESSAGE
            )

        expected = sha256_hex(client_secret)
        if not secrets.compare_digest(client.client_secret_hash, expected):
            logger.warning(
                f"third-party token request rejected client_id={client_id} ip={client_ip} "
                "reason=invalid_secret"
            )
            raise _oauth_error(
                status.HTTP_401_UNAUTHORIZED, "invalid_client", _INVALID_CLIENT_MESSAGE
            )

        token, expires_in = mint_access_token(
            client_id=client.client_id,
            module_name=client.module_name,
            scopes=client.allowed_scopes,
        )
        logger.info(
            f"third-party token issued client_id={client_id} ip={client_ip} "
            f"module_name={client.module_name}"
        )
        return TokenResponse(
            access_token=token,
            expires_in=expires_in,
            module_name=client.module_name,
            scopes=client.allowed_scopes,
        )


def get_thirdparty_auth_use_case() -> ThirdPartyAuthUseCase:
    return ThirdPartyAuthUseCase()
