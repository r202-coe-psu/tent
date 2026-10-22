import json

import httpx
import pytest

from printer.api import (
    AuthError,
    BffClient,
    ClaimedJob,
    Hello,
    JobConflictError,
    NetworkError,
    ServerError,
)
from printer.config import Config

CONFIG = Config(
    base_url="https://tent.example.org",
    device_id="printer-sh001-reg1",
    device_secret="sk_print_abc",
    printer_name="tent_xprinter",
)

# base64 of b"\x89PNG-fake-label-1" and b"\x89PNG-fake-label-2"
LABEL_1_B64 = "iVBORy1mYWtlLWxhYmVsLTE="
LABEL_2_B64 = "iVBORy1mYWtlLWxhYmVsLTI="


def client_with(handler) -> BffClient:
    return BffClient(CONFIG, transport=httpx.MockTransport(handler))


def test_next_job_returns_claimed_job_with_decoded_labels():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/printer/jobs/next"
        assert json.loads(request.content) == {"queue_state": "ready"}
        return httpx.Response(
            200,
            json={
                "job": {
                    "id": "print_job:01J9ZABC",
                    "label_count": 2,
                    "lease_until": "2026-10-22T10:00:30.000Z",
                },
                "labels": [LABEL_1_B64, LABEL_2_B64],
            },
        )

    job = client_with(handler).next_job("ready")

    assert job == ClaimedJob(
        id="print_job:01J9ZABC",
        label_count=2,
        lease_until="2026-10-22T10:00:30.000Z",
        labels=(b"\x89PNG-fake-label-1", b"\x89PNG-fake-label-2"),
        lease_sec=None,
    )


def test_next_job_carries_the_lease_the_server_sized_for_this_job():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "job": {
                    "id": "print_job:01J9ZABC",
                    "label_count": 1,
                    "lease_sec": 95,
                    "lease_until": "2026-10-22T10:01:35.000Z",
                },
                "labels": [LABEL_1_B64],
            },
        )

    job = client_with(handler).next_job("ready")

    assert job is not None
    assert job.lease_sec == 95


def test_next_job_returns_none_when_server_has_no_work():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    assert client_with(handler).next_job("ready") is None


def test_every_request_carries_device_credentials_headers():
    seen: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers)
        return httpx.Response(204)

    client_with(handler).next_job("ready")

    assert seen[0]["x-device-id"] == "printer-sh001-reg1"
    assert seen[0]["x-device-secret"] == "sk_print_abc"


def test_401_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"error": {"code": "DEVICE_AUTH_FAILED", "message": "bad credentials"}}
        )

    with pytest.raises(AuthError):
        client_with(handler).next_job("ready")


@pytest.mark.parametrize("status", [500, 502, 503])
def test_5xx_raises_server_error(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json={"error": {"code": "DEPENDENCY_UNAVAILABLE", "message": "db down"}}
        )

    with pytest.raises(ServerError):
        client_with(handler).next_job("ready")


@pytest.mark.parametrize(
    "error",
    [httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), httpx.RemoteProtocolError("cut")],
)
def test_transport_failures_raise_network_error(error):
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    with pytest.raises(NetworkError) as excinfo:
        client_with(handler).next_job("ready")

    assert not isinstance(excinfo.value, httpx.HTTPError)


def test_hello_returns_device_identity_and_server_config():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/printer/hello"
        assert json.loads(request.content) == {"agent_version": "0.1.0", "queue_state": "ready"}
        return httpx.Response(
            200,
            json={
                "device": {
                    "device_id": "printer-sh001-reg1",
                    "name": "Registration desk 1",
                    "shelter_code": "SH001",
                },
                "server_time": "2026-10-22T10:00:00.000Z",
                "config": {"wait_sec": 25, "lease_sec": 60},
            },
        )

    hello = client_with(handler).hello(agent_version="0.1.0", queue_state="ready")

    assert hello == Hello(
        device_id="printer-sh001-reg1",
        name="Registration desk 1",
        shelter_code="SH001",
        wait_sec=25,
        lease_sec=60,
    )


def test_report_result_posts_outcome_and_returns_status():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.raw_path == b"/api/v1/printer/jobs/print_job%3A01J9ZABC/result"
        assert json.loads(request.content) == {"printed": 1, "error_code": "printer_timeout"}
        return httpx.Response(200, json={"status": "failed"})

    status = client_with(handler).report_result(
        "print_job:01J9ZABC", printed=1, error_code="printer_timeout"
    )

    assert status == "failed"


def test_report_result_omits_error_code_when_none():
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content) == {"printed": 2}
        return httpx.Response(200, json={"status": "printed"})

    assert client_with(handler).report_result("print_job:01J9ZABC", printed=2, error_code=None) == (
        "printed"
    )


def test_report_result_escapes_path_separators_in_job_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.raw_path == b"/api/v1/printer/jobs/..%2Fhello%3Fx/result"
        return httpx.Response(200, json={"status": "printed"})

    client_with(handler).report_result("../hello?x", printed=1, error_code=None)


def test_report_result_409_raises_job_conflict_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"error": {"code": "JOB_NOT_PRINTING", "message": "not your job"}}
        )

    with pytest.raises(JobConflictError):
        client_with(handler).report_result("print_job:01J9ZABC", printed=1, error_code=None)


@pytest.mark.parametrize(
    "response_or_error",
    [
        httpx.Response(401, json={"error": {"code": "DEVICE_AUTH_FAILED", "message": "bad"}}),
        httpx.Response(503, json={"error": {"code": "DEPENDENCY_UNAVAILABLE", "message": "down"}}),
        httpx.Response(409, json={"error": {"code": "JOB_NOT_PRINTING", "message": "no"}}),
        httpx.ConnectError("refused"),
    ],
)
def test_errors_never_expose_device_secret(response_or_error):
    def handler(request: httpx.Request) -> httpx.Response:
        if isinstance(response_or_error, Exception):
            raise response_or_error
        return response_or_error

    client = client_with(handler)

    with pytest.raises(Exception) as excinfo:
        client.report_result("print_job:01J9ZABC", printed=1, error_code=None)

    assert CONFIG.device_secret not in str(excinfo.value)
    assert CONFIG.device_secret not in repr(excinfo.value)
    assert CONFIG.device_secret not in repr(client)


@pytest.mark.parametrize("status", [400, 404, 413])
@pytest.mark.parametrize("call", ["hello", "next_job", "report_result"])
def test_unhandled_non_2xx_status_raises_server_error(status, call):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json={"error": {"code": "SOMETHING_ELSE", "message": "not for you"}}
        )

    client = client_with(handler)
    calls = {
        "hello": lambda: client.hello("0.1.0", "ready"),
        "next_job": lambda: client.next_job("ready"),
        "report_result": lambda: client.report_result("print_job:01J9ZABC", 1, None),
    }

    with pytest.raises(ServerError) as excinfo:
        calls[call]()

    assert str(status) in str(excinfo.value)
