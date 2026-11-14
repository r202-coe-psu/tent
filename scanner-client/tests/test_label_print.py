"""The page's label print requests, answered by the scanner client itself and printed on the
USB label printer of this PC. Same contract as the kiosk (frontend kiosk-print.api.ts)."""

import asyncio
import base64
import json

import pytest

from scanner_client.label_print import (
    MAX_LABELS,
    MAX_PNG_BYTES,
    PRINT_PATH,
    PRINTER_PATH,
    LocalPrintRoutes,
    decode_labels,
)

ORIGIN = "https://shelter.example"
PNG = b"\x89PNG\r\n\x1a\n" + b"label"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def body(*labels: bytes) -> bytes:
    return json.dumps({"labels": [b64(label) for label in labels]}).encode()


class FakePrinter:
    def __init__(self, installed=True, results=None):
        self.name = "XP-365B"
        self.installed = installed
        self.results = list(results or [])
        self.printed: list[bytes] = []
        self.timeouts: list[float] = []

    def is_installed(self):
        return self.installed

    def print_png(self, png, timeout):
        self.timeouts.append(timeout)
        ok = self.results.pop(0) if self.results else True
        if ok:
            self.printed.append(png)
        return ok


class FakeRequest:
    def __init__(self, url, method="POST", origin=ORIGIN, data=None):
        self.url = url
        self.method = method
        self.headers = {"origin": origin} if origin else {}
        self.post_data_buffer = data


class FakeRoute:
    def __init__(self, request):
        self.request = request
        self.fulfilled = None
        self.continued = False

    async def fulfill(self, *, status, content_type, headers, body):
        self.fulfilled = {
            "status": status,
            "content_type": content_type,
            "headers": headers,
            "json": json.loads(body),
        }

    async def continue_(self, **kwargs):
        self.continued = True


async def _inline(fn, *args):
    return fn(*args)


def handle(printer, request, clock=None):
    routes = LocalPrintRoutes(ORIGIN, printer, run=_inline, clock=clock or (lambda: 0.0))
    route = FakeRoute(request)
    asyncio.run(routes.handle(route))
    return route


def test_prints_every_label_in_order_and_reports_the_count():
    printer = FakePrinter()
    other = PNG + b"2"

    route = handle(printer, FakeRequest(ORIGIN + PRINT_PATH, data=body(PNG, other)))

    assert route.fulfilled["status"] == 200
    assert route.fulfilled["json"] == {"printed": 2}
    assert route.fulfilled["headers"]["cache-control"] == "no-store"
    assert printer.printed == [PNG, other]


def test_a_failed_label_stops_the_rest_and_reports_what_printed():
    printer = FakePrinter(results=[True, False, True])

    route = handle(printer, FakeRequest(ORIGIN + PRINT_PATH, data=body(PNG, PNG, PNG)))

    assert route.fulfilled["status"] == 502
    assert route.fulfilled["json"]["printed"] == 1
    assert route.fulfilled["json"]["error"]["code"] == "PRINT_FAILED"
    assert isinstance(route.fulfilled["json"]["error"]["message"], str)


def test_labels_stop_once_the_overall_deadline_is_spent():
    # the page's fetch gives up at 30 s; never keep printing after it reported a failure
    times = iter([0.0, 0.0, 26.0])
    printer = FakePrinter()

    route = handle(
        printer, FakeRequest(ORIGIN + PRINT_PATH, data=body(PNG, PNG)), clock=lambda: next(times)
    )

    assert route.fulfilled["status"] == 502
    assert route.fulfilled["json"]["printed"] == 1
    assert route.fulfilled["json"]["error"]["code"] == "PRINT_TIMEOUT"


def test_no_installed_printer_prints_nothing():
    printer = FakePrinter(installed=False)

    route = handle(printer, FakeRequest(ORIGIN + PRINT_PATH, data=body(PNG)))

    assert route.fulfilled["status"] == 503
    assert route.fulfilled["json"]["printed"] == 0
    assert route.fulfilled["json"]["error"]["code"] == "PRINTER_NOT_FOUND"
    assert printer.printed == []


def test_bad_labels_are_rejected_before_printing():
    printer = FakePrinter()

    route = handle(printer, FakeRequest(ORIGIN + PRINT_PATH, data=b"not json"))

    assert route.fulfilled["status"] == 400
    assert route.fulfilled["json"]["error"]["code"] == "INVALID_LABELS"
    assert printer.printed == []


def test_the_page_learns_whether_this_pc_has_the_printer():
    route = handle(FakePrinter(), FakeRequest(ORIGIN + PRINTER_PATH))
    assert route.fulfilled["status"] == 200
    assert route.fulfilled["json"] == {"available": True, "name": "XP-365B"}

    route = handle(FakePrinter(installed=False), FakeRequest(ORIGIN + PRINTER_PATH))
    assert route.fulfilled["json"] == {"available": False, "name": "XP-365B"}


@pytest.mark.parametrize(
    "request_",
    [
        FakeRequest("https://evil.example" + PRINT_PATH, origin="https://evil.example"),
        FakeRequest(ORIGIN + PRINT_PATH, origin="https://evil.example"),
        FakeRequest(ORIGIN + PRINT_PATH, origin=None),
        FakeRequest(ORIGIN + PRINT_PATH, method="GET"),
        FakeRequest(ORIGIN + PRINTER_PATH, method="GET"),
    ],
    ids=["other-site", "cross-origin", "no-origin", "get-print", "get-printer"],
)
def test_only_same_origin_posts_from_the_shelter_reach_the_printer(request_):
    printer = FakePrinter()
    request_.post_data_buffer = body(PNG)

    route = handle(printer, request_)

    assert route.fulfilled["status"] == 404  # never forwarded to a server either
    assert printer.printed == []


def test_each_label_gets_a_bounded_timeout():
    printer = FakePrinter()

    handle(printer, FakeRequest(ORIGIN + PRINT_PATH, data=body(PNG)))

    assert 0 < printer.timeouts[0] <= 25


@pytest.mark.parametrize(
    "raw",
    [
        None,
        b"",
        b"[]",
        json.dumps({"labels": []}).encode(),
        json.dumps({"labels": [b64(PNG)] * (MAX_LABELS + 1)}).encode(),
        json.dumps({"labels": [123]}).encode(),
        json.dumps({"labels": ["not base64!"]}).encode(),
        json.dumps({"labels": [b64(b"GIF89a")]}).encode(),
        json.dumps({"labels": [b64(PNG + b"x" * MAX_PNG_BYTES)]}).encode(),
    ],
    ids=["none", "empty", "list", "no-labels", "too-many", "not-text", "bad-b64", "not-png", "big"],
)
def test_decode_labels_rejects_anything_but_1_to_20_small_pngs(raw):
    assert decode_labels(raw) is None


def test_decode_labels_returns_the_png_bytes():
    assert decode_labels(body(PNG, PNG)) == [PNG, PNG]


def test_a_print_that_hangs_counts_as_failed(monkeypatch):
    # a stuck Windows spooler call cannot be interrupted; stop waiting for it instead
    from scanner_client import label_print

    monkeypatch.setattr(label_print, "LABEL_TIMEOUT_SEC", 0.01)
    monkeypatch.setattr(label_print, "HANG_GRACE_SEC", 0.01)

    async def run(fn, *args):
        if fn.__name__ == "print_png":
            await asyncio.sleep(10)
        return fn(*args)

    routes = LocalPrintRoutes(ORIGIN, FakePrinter(), run=run, clock=lambda: 0.0)
    route = FakeRoute(FakeRequest(ORIGIN + PRINT_PATH, data=body(PNG)))
    asyncio.run(routes.handle(route))

    assert route.fulfilled["status"] == 502
    assert route.fulfilled["json"]["error"]["code"] == "PRINT_FAILED"
