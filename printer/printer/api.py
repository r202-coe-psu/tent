import base64
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from printer.config import Config


class AuthError(Exception):
    pass


class ServerError(Exception):
    pass


class RejectedError(ServerError):
    """A definitive 4xx: the server understood and refused, so repeating the request is futile."""


class NetworkError(Exception):
    pass


class JobConflictError(Exception):
    pass


@contextmanager
def _parsing() -> Iterator[None]:
    """A 2xx body we cannot read (proxy HTML page, missing key, bad base64) is a server fault."""
    try:
        yield
    except (ValueError, KeyError, TypeError) as exc:  # JSONDecodeError, binascii.Error: ValueError
        raise ServerError(f"malformed server response: {type(exc).__name__}") from None


# 408 (timeout), 425 (too early) and 429 (rate limit) say "try again later"; other 4xx do not.
_RETRYABLE_CLIENT_STATUSES = frozenset({408, 425, 429})
_MIN_LEASE_SEC = 1
_MAX_LEASE_SEC = 3600


def _lease_sec(value: object) -> int | None:
    """A usable lease length, or None. bool is an int subclass but never a lease."""
    if isinstance(value, int) and not isinstance(value, bool):
        if _MIN_LEASE_SEC <= value <= _MAX_LEASE_SEC:
            return value
    return None


@dataclass(frozen=True)
class Hello:
    device_id: str
    name: str
    shelter_code: str
    wait_sec: int
    lease_sec: int


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    label_count: int
    lease_until: str
    labels: tuple[bytes, ...]
    # Server-sized lease for this job; None from an older BFF (fall back to hello's lease_sec).
    lease_sec: int | None = None


class BffClient:
    def __init__(self, config: Config, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(
            base_url=config.base_url,
            headers={
                "x-device-id": config.device_id,
                "x-device-secret": config.device_secret,
            },
            timeout=40.0,
            transport=transport,
        )

    def hello(
        self, agent_version: str, queue_state: str, local_ips: list[str] | None = None
    ) -> Hello:
        response = self._post(
            "/api/v1/printer/hello",
            {
                "agent_version": agent_version,
                "queue_state": queue_state,
                "local_ips": local_ips or [],
            },
        )
        with _parsing():
            body = response.json()
            lease_sec = _lease_sec(body["config"]["lease_sec"])
            if lease_sec is None:
                raise ValueError("lease_sec out of range")
            return Hello(
                device_id=body["device"]["device_id"],
                name=body["device"]["name"],
                shelter_code=body["device"]["shelter_code"],
                wait_sec=body["config"]["wait_sec"],
                lease_sec=lease_sec,
            )

    def report_result(self, job_id: str, printed: int, error_code: str | None) -> str:
        payload: dict = {"printed": printed}
        if error_code is not None:
            payload["error_code"] = error_code
        response = self._post(f"/api/v1/printer/jobs/{quote(job_id, safe='')}/result", payload)
        with _parsing():
            return response.json()["status"]

    def _post(self, path: str, json: dict) -> httpx.Response:
        try:
            response = self._http.post(path, json=json)
        except httpx.TransportError as exc:
            raise NetworkError(f"cannot reach server: {type(exc).__name__}") from None
        if response.status_code == 401:
            raise AuthError("device authentication failed")
        if response.status_code == 409 and path.endswith("/result"):
            raise JobConflictError("job is no longer claimed by this device")
        if (
            400 <= response.status_code < 500
            and response.status_code not in _RETRYABLE_CLIENT_STATUSES
        ):
            raise RejectedError(f"server rejected request {response.status_code}")
        if not response.is_success:
            raise ServerError(f"server error {response.status_code}")
        return response

    def next_job(self, queue_state: str) -> ClaimedJob | None:
        response = self._post("/api/v1/printer/jobs/next", {"queue_state": queue_state})
        if response.status_code == 204:
            return None
        # A claim we cannot read stays `printing` on the server until its lease expires.
        with _parsing():
            body = response.json()
            job = body["job"]
            return ClaimedJob(
                id=job["id"],
                label_count=job["label_count"],
                lease_until=job["lease_until"],
                labels=tuple(base64.b64decode(label) for label in body["labels"]),
                # An unusable lease is dropped (the caller falls back to hello's), never fatal:
                # the job is already `printing` on the server.
                lease_sec=_lease_sec(job.get("lease_sec")),
            )
