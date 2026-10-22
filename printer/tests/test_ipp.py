import struct

import httpx

from printer.ipp import job_state

OK = 0x0000
NOT_FOUND = 0x0406


def attr(tag: int, name: str, value: bytes) -> bytes:
    raw = name.encode()
    return struct.pack(">BH", tag, len(raw)) + raw + struct.pack(">H", len(value)) + value


def response(status: int = OK, *attrs: bytes) -> bytes:
    return (
        struct.pack(">BBHI", 2, 0, status, 1)
        + b"\x01"
        + attr(0x47, "attributes-charset", b"utf-8")
        + attr(0x48, "attributes-natural-language", b"en")
        + (b"\x02" + b"".join(attrs) if attrs else b"")
        + b"\x03"
    )


def state(value: int) -> bytes:
    return attr(0x23, "job-state", struct.pack(">i", value))


REASON_STOP_POINT = attr(0x44, "job-state-reasons", b"processing-to-stop-point")


def serve(body: bytes, status_code: int = 200, seen: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status_code, content=body)

    return httpx.MockTransport(handler)


def test_sends_get_job_attributes_for_the_job_number_to_local_cupsd():
    seen: list[httpx.Request] = []

    job_state("tent_xprinter-3", transport=serve(response(OK, state(9)), seen=seen))

    (request,) = seen
    assert request.method == "POST"
    assert request.url.path == "/jobs/3"
    assert request.headers["content-type"] == "application/ipp"
    body = request.content
    assert body[:2] == b"\x02\x00"  # IPP/2.0
    assert struct.unpack(">H", body[2:4])[0] == 0x0009  # Get-Job-Attributes
    assert b"ipp://localhost/jobs/3" in body


def test_completed_job_is_completed_even_with_a_stale_stop_point_reason():
    """CUPS 2.3.3 (Pi OS Bullseye) leaves processing-to-stop-point on finished jobs."""
    body = response(OK, REASON_STOP_POINT, state(9))

    assert job_state("tent_xprinter-3", transport=serve(body)) == "completed"


def test_aborted_and_canceled_jobs_are_reported_as_such():
    assert job_state("q-1", transport=serve(response(OK, state(8)))) == "aborted"
    assert job_state("q-1", transport=serve(response(OK, state(7)))) == "canceled"


def test_unknown_job_is_none():
    assert job_state("q-1", transport=serve(response(NOT_FOUND))) is None


def test_http_error_status_is_none():
    assert job_state("q-1", transport=serve(b"", status_code=403)) is None


def test_unreachable_cupsd_is_none():
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    assert job_state("q-1", transport=httpx.MockTransport(refuse)) is None


def test_truncated_response_is_none():
    body = response(OK, state(9))

    assert job_state("q-1", transport=serve(body[:-7])) is None


def test_job_id_without_a_number_sends_nothing():
    seen: list[httpx.Request] = []

    assert job_state("tent_xprinter", transport=serve(response(OK, state(9)), seen=seen)) is None
    assert seen == []
