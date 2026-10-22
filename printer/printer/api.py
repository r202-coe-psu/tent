import base64
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from printer.config import Config


class AuthError(Exception):
    pass


class ServerError(Exception):
    pass


class NetworkError(Exception):
    pass


class JobConflictError(Exception):
    pass


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

    def hello(self, agent_version: str, queue_state: str) -> Hello:
        response = self._post(
            "/api/v1/printer/hello",
            {"agent_version": agent_version, "queue_state": queue_state},
        )
        body = response.json()
        return Hello(
            device_id=body["device"]["device_id"],
            name=body["device"]["name"],
            shelter_code=body["device"]["shelter_code"],
            wait_sec=body["config"]["wait_sec"],
            lease_sec=body["config"]["lease_sec"],
        )

    def report_result(self, job_id: str, printed: int, error_code: str | None) -> str:
        payload: dict = {"printed": printed}
        if error_code is not None:
            payload["error_code"] = error_code
        response = self._post(f"/api/v1/printer/jobs/{quote(job_id, safe='')}/result", payload)
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
        if not response.is_success:
            raise ServerError(f"server error {response.status_code}")
        return response

    def next_job(self, queue_state: str) -> ClaimedJob | None:
        response = self._post("/api/v1/printer/jobs/next", {"queue_state": queue_state})
        if response.status_code == 204:
            return None
        body = response.json()
        job = body["job"]
        return ClaimedJob(
            id=job["id"],
            label_count=job["label_count"],
            lease_until=job["lease_until"],
            labels=tuple(base64.b64decode(label) for label in body["labels"]),
            lease_sec=job.get("lease_sec"),
        )
