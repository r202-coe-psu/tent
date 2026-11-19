import struct
import unittest

import httpx

from app.ipp import job_state

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


class JobStateTests(unittest.TestCase):
    def test_sends_get_job_attributes_for_the_job_number_to_local_cupsd(self):
        seen: list[httpx.Request] = []

        job_state("tent_xprinter-3", transport=serve(response(OK, state(9)), seen=seen))

        (request,) = seen
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/jobs/3")
        self.assertEqual(request.headers["content-type"], "application/ipp")
        body = request.content
        self.assertEqual(body[:2], b"\x02\x00")  # IPP/2.0
        self.assertEqual(struct.unpack(">H", body[2:4])[0], 0x0009)  # Get-Job-Attributes
        self.assertIn(b"ipp://localhost/jobs/3", body)

    def test_completed_job_is_completed_even_with_a_stale_stop_point_reason(self):
        """CUPS 2.3.3 (Pi OS Bullseye) leaves processing-to-stop-point on finished jobs."""
        body = response(OK, REASON_STOP_POINT, state(9))

        self.assertEqual(job_state("tent_xprinter-3", transport=serve(body)), "completed")

    def test_aborted_and_canceled_jobs_are_reported_as_such(self):
        self.assertEqual(job_state("q-1", transport=serve(response(OK, state(8)))), "aborted")
        self.assertEqual(job_state("q-1", transport=serve(response(OK, state(7)))), "canceled")

    def test_unknown_job_is_none(self):
        self.assertIsNone(job_state("q-1", transport=serve(response(NOT_FOUND))))

    def test_http_error_status_is_none(self):
        self.assertIsNone(job_state("q-1", transport=serve(b"", status_code=403)))

    def test_unreachable_cupsd_is_none(self):
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        self.assertIsNone(job_state("q-1", transport=httpx.MockTransport(refuse)))

    def test_truncated_response_is_none(self):
        body = response(OK, state(9))

        self.assertIsNone(job_state("q-1", transport=serve(body[:-7])))

    def test_job_id_without_a_number_sends_nothing(self):
        seen: list[httpx.Request] = []

        self.assertIsNone(
            job_state("tent_xprinter", transport=serve(response(OK, state(9)), seen=seen))
        )
        self.assertEqual(seen, [])
