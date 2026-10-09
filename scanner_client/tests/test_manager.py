import asyncio
import io
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from app import manager
from app.escpos import CUT_SELF_FEED_MM, ESC_INIT, LABEL_LENGTH_MM, label_to_escpos
from app.rfpro import RfproProtocolError
from app.scard import ReaderLostError


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.content = b"{}"

    def json(self):
        return self._payload


class FakeClient:
    responses = []
    requested_headers = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, _url, *, json, headers):
        self.requested_headers.append(headers)
        return self.responses.pop(0)


class FakeHttpx:
    AsyncClient = FakeClient
    RequestError = OSError


def valid_config(**overrides):
    config = {
        "TENT_BASE_URL": "https://tent.example.go.th",
        "DEVICE_ID": "kiosk-sh001-01",
        "DEVICE_SECRET": "sk_scan_real_secret_value",
        "BOOTSTRAP_ATTEMPTS": "2",
        "BOOTSTRAP_BACKOFF": "0.25",
    }
    config.update(overrides)
    return config


class ScannerBootstrapTests(unittest.IsolatedAsyncioTestCase):
    async def test_valid_bootstrap_returns_server_device_without_starting_browser(self):
        FakeClient.requested_headers = []
        FakeClient.responses = [
            FakeResponse(
                200,
                {
                    "device": {
                        "device_id": "kiosk-sh001-01",
                        "name": "Kiosk จุดคัดกรอง 1",
                        "shelter_code": "SH001",
                        "shelter_name": "ศูนย์พักพิงทดสอบ",
                        "station_name": "โต๊ะ 1",
                    },
                    "server_time": "2026-09-22T00:00:00Z",
                },
            )
        ]
        manager.httpx = FakeHttpx
        client = manager.ScannerClientManager(valid_config())

        result = await client.bootstrap()

        self.assertEqual(result["device"]["device_id"], "kiosk-sh001-01")
        self.assertIsNone(client.page)
        query = parse_qs(urlparse(client.home_url).query)
        self.assertEqual(query["shelter_code"], ["SH001"])
        self.assertEqual(query["shelter_name"], ["ศูนย์พักพิงทดสอบ"])
        self.assertEqual(query["station_name"], ["โต๊ะ 1"])
        self.assertEqual(query["device_name"], ["Kiosk จุดคัดกรอง 1"])
        self.assertNotIn("phone_check_in", query)
        self.assertEqual(urlparse(client.home_url).path, "/kiosk")
        self.assertEqual(urlparse(client.waiting_url).path, "/kiosk/scanner/waiting")
        self.assertEqual(
            FakeClient.requested_headers[-1]["X-Device-Secret"],
            "sk_scan_real_secret_value",
        )

    async def test_legacy_env_flag_is_not_added_to_kiosk_urls(self):
        FakeClient.requested_headers = []
        FakeClient.responses = [
            FakeResponse(
                200,
                {
                    "device": {
                        "device_id": "kiosk-sh001-01",
                        "name": "Kiosk จุดคัดกรอง 1",
                        "shelter_code": "SH001",
                        "shelter_name": "ศูนย์พักพิงทดสอบ",
                        "station_name": "โต๊ะ 1",
                    },
                    "server_time": "2026-09-22T00:00:00Z",
                },
            )
        ]
        manager.httpx = FakeHttpx
        client = manager.ScannerClientManager(valid_config(KIOSK_PHONE_CHECK_IN_ENABLED="false"))

        await client.bootstrap()

        for url in (
            client.home_url,
            client.waiting_url,
            client.reading_url,
            client.remove_card_url,
            client.error_url,
            client._kiosk_url(client.error_path, {"error_msg": "failed"}),
        ):
            with self.subTest(url=url):
                query = parse_qs(urlparse(url).query)
                self.assertNotIn("phone_check_in", query)
                self.assertEqual(query["shelter_code"], ["SH001"])
                self.assertEqual(query["shelter_name"], ["ศูนย์พักพิงทดสอบ"])
                self.assertEqual(query["station_name"], ["โต๊ะ 1"])
                self.assertEqual(query["device_name"], ["Kiosk จุดคัดกรอง 1"])

    async def test_401_fails_closed_before_browser_launch(self):
        FakeClient.requested_headers = []
        FakeClient.responses = [FakeResponse(401, {"error": {"code": "DEVICE_AUTH_FAILED"}})]
        manager.httpx = FakeHttpx
        client = manager.ScannerClientManager(valid_config())

        with self.assertRaises(manager.BootstrapAuthError):
            await client.bootstrap()
        self.assertIsNone(client.page)

    async def test_503_uses_bounded_retry_and_does_not_log_or_expose_secret(self):
        FakeClient.requested_headers = []
        FakeClient.responses = [FakeResponse(503, {}), FakeResponse(503, {})]
        manager.httpx = FakeHttpx
        client = manager.ScannerClientManager(valid_config())

        async def no_sleep(_seconds):
            return None

        with patch.object(asyncio, "sleep", new=no_sleep):
            with self.assertRaises(manager.BootstrapUnavailableError):
                await client.bootstrap()
        self.assertEqual(len(FakeClient.requested_headers), 2)
        self.assertEqual(len(FakeClient.responses), 0)

class FakePage:
    def __init__(self, url, *, client_nav_fails=False):
        self.url = url
        self.client_nav_fails = client_nav_fails
        self.evaluated = []
        self.gotos = []
        self.waited_selectors = []

    def is_closed(self):
        return False

    async def evaluate(self, _script, arg=None):
        if self.client_nav_fails:
            raise RuntimeError("router not ready")
        self.evaluated.append(arg)
        self.url = arg

    async def wait_for_url(self, predicate, **_kwargs):
        if not predicate(self.url):
            raise TimeoutError()

    async def goto(self, url, **_kwargs):
        self.gotos.append(url)
        self.url = url

    async def wait_for_selector(self, selector, **_kwargs):
        self.waited_selectors.append(selector)


class EventFakePage(FakePage):
    async def evaluate(self, script, arg=None):
        self.evaluated.append((script, arg))


class KioskNavigationTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_origin_screen_change_uses_client_router_not_full_reload(self):
        client = manager.ScannerClientManager(valid_config())
        client.page = FakePage(client.waiting_url)

        await client._navigate(client.reading_url)

        self.assertEqual(client.page.evaluated, [client.reading_url])
        self.assertEqual(client.page.gotos, [])

    async def test_client_router_failure_falls_back_to_full_load(self):
        client = manager.ScannerClientManager(valid_config())
        client.page = FakePage(client.waiting_url, client_nav_fails=True)

        await client._navigate(client.reading_url)

        self.assertEqual(client.page.gotos, [client.reading_url])

    async def test_other_origin_uses_full_load(self):
        client = manager.ScannerClientManager(valid_config())
        client.page = FakePage("about:blank")

        await client._navigate(client.home_url)

        self.assertEqual(client.page.evaluated, [])
        self.assertEqual(client.page.gotos, [client.home_url])


class FakeReader:
    def __init__(self, *, inserted=False, raises=False, states=None):
        self.inserted = inserted
        self.raises = raises
        self.states = list(states or [])

    def is_card_inserted(self):
        if self.raises:
            raise OSError("reader unavailable")
        if self.states:
            return self.states.pop(0)
        return self.inserted


class CardRescanTests(unittest.IsolatedAsyncioTestCase):
    async def test_register_path_reads_each_card_after_removal_and_reinsertion(self):
        client = manager.ScannerClientManager(valid_config())
        page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")
        client.page = page
        reads = []
        client.reader = SimpleNamespace(
            is_card_inserted=iter([True, False, True, False]).__next__,
            read_all_data=lambda: reads.append(len(reads)) or {"citizen_id": "1234567890123"},
        )
        sleeps = []

        async def return_home_after_second_removal(seconds):
            sleeps.append(seconds)
            if len(sleeps) == 4:
                page.url = client.home_url

        with patch.object(asyncio, "sleep", new=return_home_after_second_removal):
            saw_new_card = await client._wait_for_home_or_new_card()

        self.assertFalse(saw_new_card)
        self.assertEqual(len(reads), 2)
        full_reads = [call for call in page.evaluated if "kiosk:smart-card-full-read" in call[0]]
        self.assertEqual(len(full_reads), 2)

    async def test_wait_for_home_breaks_when_new_card_is_inserted(self):
        client = manager.ScannerClientManager(valid_config())
        client.page = FakePage(client.remove_card_url)
        client.reader = FakeReader(states=[False, True])
        sleeps = []

        async def keep_waiting(seconds):
            sleeps.append(seconds)

        with patch.object(asyncio, "sleep", new=keep_waiting):
            saw_new_card = await client._wait_for_home_or_new_card()

        self.assertTrue(saw_new_card)
        self.assertEqual(urlparse(client.page.url).path, client.remove_card_path)
        self.assertEqual(sleeps, [0.5])

    async def test_full_card_read_runs_only_on_registration_card_path(self):
        client = manager.ScannerClientManager(valid_config())
        page = EventFakePage(client.remove_card_url)
        client.page = page
        card = {"citizen_id": "1234567890123", "first_name_th": "Test"}
        client.reader = SimpleNamespace(read_all_data=lambda: card)

        self.assertFalse(await client._read_full_card_if_register_path())
        self.assertEqual(page.evaluated, [])

        page.url = f"https://tent.example.go.th{client.register_card_path}"
        with self.assertLogs(manager.logger, level="INFO") as logs:
            self.assertTrue(await client._read_full_card_if_register_path())

        self.assertEqual(page.waited_selectors, ['[data-kiosk-register-ready="true"]'])
        self.assertEqual(page.evaluated[-1][1], card)
        self.assertIn("kiosk:smart-card-full-read", page.evaluated[-1][0])
        self.assertTrue(all("1234567890123" not in line for line in logs.output))
        self.assertTrue(all("Test" not in line for line in logs.output))

    async def test_registration_page_is_told_the_read_started_before_it_starts(self):
        # Without this the page shows "insert card" for the whole ~20-30s read and people pull
        # the card out mid-photo.
        client = manager.ScannerClientManager(valid_config())
        page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")
        client.page = page
        events_before_read = []

        def read_all_data():
            events_before_read.extend(script for script, _ in page.evaluated)
            return {"citizen_id": "1234567890123"}

        client.reader = SimpleNamespace(read_all_data=read_all_data)

        self.assertTrue(await client._read_full_card_if_register_path())

        self.assertEqual(len(events_before_read), 1)
        self.assertIn("kiosk:smart-card-reading", events_before_read[0])
        self.assertNotIn("detail", events_before_read[0])  # no card data in the start signal

    async def test_full_card_read_error_notifies_registration_screen_without_card_data(self):
        client = manager.ScannerClientManager(valid_config())
        page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")
        client.page = page

        def failed_read():
            raise OSError("reader failure with private payload")

        client.reader = SimpleNamespace(read_all_data=failed_read)

        with self.assertLogs(manager.logger, level="ERROR") as logs:
            result = await client._read_full_card_if_register_path()

        self.assertFalse(result)
        self.assertIn("kiosk:smart-card-full-read-error", page.evaluated[-1][0])
        self.assertTrue(all("private payload" not in line for line in logs.output))

    async def test_full_card_read_failure_log_names_the_stage_and_the_reader_error(self):
        client = manager.ScannerClientManager(valid_config())
        client.page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")

        def unanswered():
            raise RfproProtocolError("no reply to command 1881 within 3s")

        client.reader = SimpleNamespace(read_all_data=unanswered)

        with self.assertLogs(manager.logger, level="ERROR") as logs:
            self.assertFalse(await client._read_full_card_if_register_path())

        line = "\n".join(logs.output)
        self.assertIn("failed at read: RfproProtocolError (no reply to command 1881 within 3s)", line)
        self.assertIn("test_manager.py", line)  # innermost code location, no message for others

    async def test_full_card_handoff_failure_is_reported_as_the_handoff_stage(self):
        client = manager.ScannerClientManager(valid_config())
        page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")
        client.page = page
        client.reader = SimpleNamespace(read_all_data=lambda: {"citizen_id": "1234567890123"})

        async def never_ready(*_args, **_kwargs):
            raise TimeoutError("page secret 1234567890123")

        page.wait_for_selector = never_ready

        with self.assertLogs(manager.logger, level="ERROR") as logs:
            self.assertFalse(await client._read_full_card_if_register_path())

        line = "\n".join(logs.output)
        self.assertIn("failed at handoff: TimeoutError at", line)
        self.assertNotIn("1234567890123", line)

    async def test_card_inserted_on_consent_page_does_not_restart_the_lookup_flow(self):
        # Regression test: a card left in the reader (or re-inserted) on any walk-in step
        # after /card — e.g. /kiosk/register/consent — must not be treated as "a new card",
        # which would restart the lookup flow out from under the person filling in consent.
        client = manager.ScannerClientManager(valid_config())
        page = FakePage("https://tent.example.go.th/kiosk/register/consent")
        client.page = page
        client.reader = FakeReader(states=[True, True, False])

        async def return_home_eventually(seconds):
            if client.reader.states == []:
                page.url = client.home_url

        with patch.object(asyncio, "sleep", new=return_home_eventually):
            saw_new_card = await client._wait_for_home_or_new_card()

        self.assertFalse(saw_new_card)

    async def test_wait_for_home_survives_reader_error(self):
        client = manager.ScannerClientManager(valid_config())
        client.page = FakePage(client.remove_card_url)
        client.reader = FakeReader(raises=True)
        sleeps = []

        async def return_home_after_poll(seconds):
            sleeps.append(seconds)
            client.page.url = client.home_url

        with patch.object(asyncio, "sleep", new=return_home_after_poll):
            saw_new_card = await client._wait_for_home_or_new_card()

        self.assertFalse(saw_new_card)
        self.assertEqual(sleeps, [0.5])


class FakeRoute:
    def __init__(self, *, url, method, headers):
        self.request = SimpleNamespace(url=url, method=method, headers=headers)
        self.continued_headers = None

    async def continue_(self, *, headers):
        self.continued_headers = headers


class KioskApiRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_route_kiosk_api_injects_only_allowlisted_posts(self):
        client = manager.ScannerClientManager(valid_config())
        cases = [
            (
                "same-origin allowlisted POST",
                "https://tent.example.go.th/api/v1/scanner/kiosk/lookup",
                "POST",
                "https://tent.example.go.th",
                True,
            ),
            (
                "same-origin kiosk config POST",
                "https://tent.example.go.th/api/v1/scanner/kiosk/config",
                "POST",
                "https://tent.example.go.th",
                True,
            ),
            (
                "same-origin kiosk register POST",
                "https://tent.example.go.th/api/v1/scanner/kiosk/register",
                "POST",
                "https://tent.example.go.th",
                True,
            ),
            (
                "same-origin staff PIN verify POST",
                "https://tent.example.go.th/api/v1/scanner/kiosk/staff-pin/verify",
                "POST",
                "https://tent.example.go.th",
                True,
            ),
            (
                "staff PIN verify from a foreign Origin header",
                "https://tent.example.go.th/api/v1/scanner/kiosk/staff-pin/verify",
                "POST",
                "https://attacker.example",
                False,
            ),
            (
                "staff PIN verify on a foreign request URL",
                "https://attacker.example/api/v1/scanner/kiosk/staff-pin/verify",
                "POST",
                "https://tent.example.go.th",
                False,
            ),
            (
                "staff PIN verify GET",
                "https://tent.example.go.th/api/v1/scanner/kiosk/staff-pin/verify",
                "GET",
                "https://tent.example.go.th",
                False,
            ),
            (
                "GET",
                "https://tent.example.go.th/api/v1/scanner/kiosk/lookup",
                "GET",
                "https://tent.example.go.th",
                False,
            ),
            (
                "kiosk config GET",
                "https://tent.example.go.th/api/v1/scanner/kiosk/config",
                "GET",
                "https://tent.example.go.th",
                False,
            ),
            (
                "foreign Origin header",
                "https://tent.example.go.th/api/v1/scanner/kiosk/lookup",
                "POST",
                "https://attacker.example",
                False,
            ),
            (
                "foreign request URL",
                "https://attacker.example/api/v1/scanner/kiosk/lookup",
                "POST",
                "https://tent.example.go.th",
                False,
            ),
            (
                "non-allowlisted path",
                "https://tent.example.go.th/api/v1/scanner/draft",
                "POST",
                "https://tent.example.go.th",
                False,
            ),
            (
                "register path suffix",
                "https://tent.example.go.th/api/v1/scanner/kiosk/register/extra",
                "POST",
                "https://tent.example.go.th",
                False,
            ),
        ]

        for name, url, method, origin, should_inject in cases:
            with self.subTest(name=name):
                route = FakeRoute(
                    url=url,
                    method=method,
                    headers={
                        "origin": origin,
                        "x-device-id": "spoofed-device",
                        "x-device-secret": "spoofed-secret",
                    },
                )

                await client._route_kiosk_api(route)

                if should_inject:
                    self.assertEqual(
                        route.continued_headers["x-device-id"], client.device_id
                    )
                    self.assertEqual(
                        route.continued_headers["x-device-secret"], client.device_secret
                    )
                else:
                    self.assertNotIn("x-device-id", route.continued_headers)
                    self.assertNotIn("x-device-secret", route.continued_headers)


class SilentPrintArgsTests(unittest.TestCase):
    def build(self, **overrides):
        with patch.object(manager.ScannerClientManager, "_resolve_executable_path", return_value=manager.SYSTEM_CHROMIUM_PATH):
            client = manager.ScannerClientManager(valid_config(**overrides))
        return client._build_browser_args()

    def test_kiosk_mode_prints_silently_by_default(self):
        self.assertIn("--kiosk-printing", self.build(DEBUG="false"))

    def test_debug_mode_keeps_print_preview_by_default(self):
        self.assertNotIn("--kiosk-printing", self.build(DEBUG="true"))

    def test_explicit_true_enables_silent_print_in_debug_window(self):
        self.assertIn("--kiosk-printing", self.build(DEBUG="true", KIOSK_SILENT_PRINT="true"))

    def test_explicit_false_disables_silent_print_in_kiosk_mode(self):
        self.assertNotIn("--kiosk-printing", self.build(DEBUG="false", KIOSK_SILENT_PRINT="false"))

    def test_warns_when_policies_may_not_apply(self):
        with patch.object(manager.ScannerClientManager, "_resolve_executable_path", return_value=None):
            client = manager.ScannerClientManager(valid_config(DEBUG="false"))
        with self.assertLogs(manager.logger, level="WARNING") as logs:
            args = client._build_browser_args()

        self.assertIn("--kiosk-printing", args)
        self.assertTrue(any("managed print policies" in line for line in logs.output))


PNG = b"\x89PNG\r\n\x1a\n" + b"label"


class FakePrintRoute(FakeRoute):
    def __init__(self, *, url="https://tent.example.go.th/api/v1/scanner/kiosk/print",
                 origin="https://tent.example.go.th", body=None):
        super().__init__(url=url, method="POST", headers={"origin": origin})
        self.request.post_data_buffer = body
        self.fulfilled = None

    async def fulfill(self, *, status, content_type, headers, body):
        self.fulfilled = {"status": status, "body": manager.json.loads(body)}


def labels_body(*images):
    encoded = [manager.base64.b64encode(image).decode() for image in images]
    return manager.json.dumps({"labels": encoded}).encode()


class FakeLpProcess:
    def __init__(self, returncode=0):
        self.returncode = returncode
        self.stdin_data = []

    async def communicate(self, data):
        self.stdin_data.append(data)
        return b"", b""


class KioskPrintRouteTests(unittest.IsolatedAsyncioTestCase):
    def client(self, **overrides):
        return manager.ScannerClientManager(valid_config(DEBUG="false", **overrides))

    async def test_prints_each_label_through_lp_stdin_without_reaching_server(self):
        client = self.client(PRINTER_NAME="label_q")
        route = FakePrintRoute(body=labels_body(PNG, PNG))
        process = FakeLpProcess()
        calls = []

        async def fake_exec(*args, **kwargs):
            calls.append(args)
            return process

        with patch.object(manager.asyncio, "create_subprocess_exec", new=fake_exec):
            await client._route_kiosk_api(route)

        self.assertIsNone(route.continued_headers)
        self.assertEqual(route.fulfilled, {"status": 200, "body": {"printed": 2}})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][:3], ("lp", "-d", "label_q"))
        self.assertEqual(calls[0][-1], "-")
        self.assertEqual(process.stdin_data, [PNG, PNG])

    async def test_rejects_invalid_payloads_without_printing(self):
        client = self.client()
        bodies = {
            "not json": b"nope",
            "no labels": manager.json.dumps({"labels": []}).encode(),
            "not png": labels_body(b"GIF89a"),
            "bad base64": manager.json.dumps({"labels": ["***"]}).encode(),
            "too many": labels_body(*([PNG] * (manager.KIOSK_PRINT_MAX_LABELS + 1))),
        }

        async def fail_exec(*_args, **_kwargs):
            raise AssertionError("lp must not run")

        for name, body in bodies.items():
            with self.subTest(name=name):
                route = FakePrintRoute(body=body)
                with patch.object(manager.asyncio, "create_subprocess_exec", new=fail_exec):
                    await client._route_kiosk_api(route)
                self.assertEqual(route.fulfilled["status"], 400)

    async def test_reports_lp_failure(self):
        client = self.client()
        route = FakePrintRoute(body=labels_body(PNG))

        async def failing_exec(*_args, **_kwargs):
            return FakeLpProcess(returncode=1)

        with patch.object(manager.asyncio, "create_subprocess_exec", new=failing_exec):
            with self.assertLogs(manager.logger, level="ERROR"):
                await client._route_kiosk_api(route)

        self.assertEqual(route.fulfilled["status"], 502)
        self.assertEqual(route.fulfilled["body"]["printed"], 0)

    async def test_stops_printing_once_the_overall_deadline_is_exceeded(self):
        # Regression test: the frontend's fetch to KIOSK_PRINT_PATH times out at 30s: with up to
        # KIOSK_PRINT_MAX_LABELS labels, printing must not silently run past that and leave the
        # browser showing "failed" while labels keep spooling underneath it.
        client = self.client()
        route = FakePrintRoute(body=labels_body(PNG, PNG, PNG))
        process = FakeLpProcess()
        clock = [0.0]

        async def fake_exec(*_args, **_kwargs):
            return process

        async def advance_clock_past_the_deadline(_data):
            clock[0] += manager.KIOSK_PRINT_OVERALL_DEADLINE_SEC
            return b"", b""

        process.communicate = advance_clock_past_the_deadline

        with (
            patch.object(manager.asyncio, "create_subprocess_exec", new=fake_exec),
            patch.object(manager.time, "monotonic", new=lambda: clock[0]),
            self.assertLogs(manager.logger, level="ERROR"),
        ):
            await client._route_kiosk_api(route)

        self.assertEqual(route.fulfilled["status"], 502)
        self.assertEqual(route.fulfilled["body"]["printed"], 1)
        self.assertEqual(route.fulfilled["body"]["error"]["code"], "PRINT_TIMEOUT")

    async def test_prints_directly_in_every_mode_without_extra_config(self):
        cases = {
            "debug window": manager.ScannerClientManager(valid_config(DEBUG="true")),
            "silent print off": self.client(KIOSK_SILENT_PRINT="false"),
        }

        async def fake_exec(*_args, **_kwargs):
            return FakeLpProcess()

        for name, client in cases.items():
            with self.subTest(name=name):
                route = FakePrintRoute(body=labels_body(PNG))
                with patch.object(manager.asyncio, "create_subprocess_exec", new=fake_exec):
                    await client._route_kiosk_api(route)
                self.assertIsNone(route.continued_headers)
                self.assertEqual(route.fulfilled["status"], 200)

    async def test_foreign_origin_is_never_printed_nor_forwarded_to_the_server(self):
        client = self.client()
        route = FakePrintRoute(origin="https://attacker.example", body=labels_body(PNG))

        async def fail_exec(*_args, **_kwargs):
            raise AssertionError("lp must not run")

        with patch.object(manager.asyncio, "create_subprocess_exec", new=fail_exec):
            await client._route_kiosk_api(route)

        self.assertEqual(route.fulfilled["status"], 404)  # answered locally, AC-Q8
        self.assertIsNone(route.continued_headers)


def real_png():
    from PIL import Image

    image = Image.new("RGB", (200, 80), "white")
    image.paste("black", (10, 10, 190, 70))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class EscposPrintRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Multi-label tests must not really wait between labels.
        no_pause = patch.object(manager, "ESCPOS_LABEL_PAUSE_SEC", 0)
        no_pause.start()
        self.addCleanup(no_pause.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def fake_usb_printers(self, *printers):
        """Build a fake /sys/class/usbmisc + /dev/usb; printers = (name, 'vid:pid')."""
        sysfs, dev = self.root / "usbmisc", self.root / "dev-usb"
        sysfs.mkdir(exist_ok=True)
        dev.mkdir(exist_ok=True)
        for name, usb_id in printers:
            usb_device = self.root / "usb" / name
            interface = usb_device / "1-2:1.0"
            interface.mkdir(parents=True)
            vendor, product = usb_id.split(":")
            (usb_device / "idVendor").write_text(vendor + "\n")
            (usb_device / "idProduct").write_text(product + "\n")
            (sysfs / name).mkdir()
            os.symlink(interface, sysfs / name / "device")
            (dev / name).touch()
        return sysfs, dev

    def client(self, **overrides):
        config = {
            "PRINTER_BACKEND": "escpos",
            "DEBUG": "false",
            **overrides,
        }
        return manager.ScannerClientManager(valid_config(**config))

    async def print_with(self, client, sysfs, dev, body):
        route = FakePrintRoute(body=body)

        async def no_lp(*_args, **_kwargs):
            raise AssertionError("lp must not run for the escpos backend")

        with (
            patch.object(manager, "USBMISC_SYSFS", sysfs),
            patch.object(manager, "USB_DEV_DIR", dev),
            patch.object(manager.asyncio, "create_subprocess_exec", new=no_lp),
        ):
            await client._route_kiosk_api(route)
        return route

    async def test_finds_the_printer_by_usb_id_among_other_lp_devices(self):
        sysfs, dev = self.fake_usb_printers(("lp0", "03f0:1234"), ("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")

        # A regular file stands in for the device: append so every label's bytes are kept.
        real_open = os.open
        with patch.object(manager.os, "open", side_effect=lambda path, flags: real_open(path, flags | os.O_APPEND)):
            route = await self.print_with(client, sysfs, dev, labels_body(real_png(), real_png()))

        self.assertEqual(route.fulfilled, {"status": 200, "body": {"printed": 2}})
        # ESC @ only before the first label: a reset right after a cut makes kiosk3 drop that cut.
        first = label_to_escpos(real_png(), 576, 0, LABEL_LENGTH_MM, self_feed_mm=CUT_SELF_FEED_MM)
        rest = label_to_escpos(real_png(), 576, 0, LABEL_LENGTH_MM, init=False, self_feed_mm=CUT_SELF_FEED_MM)
        self.assertEqual((dev / "lp3").read_bytes(), first + rest)
        self.assertTrue(first.startswith(ESC_INIT))
        self.assertNotIn(ESC_INIT, rest)
        self.assertEqual((dev / "lp0").read_bytes(), b"")

    async def test_pauses_between_labels_so_each_person_is_cut_off(self):
        # The write returns once kiosk3 has the bytes; the next label arriving mid-cut drops the cut.
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")
        events = []
        real_send = client._send_escpos

        def record_send(image, timeout, init=True):
            events.append("label")
            return real_send(image, timeout, init)

        async def fake_sleep(seconds):
            events.append(seconds)

        with (
            patch.object(manager, "ESCPOS_LABEL_PAUSE_SEC", 1.5),
            patch.object(client, "_send_escpos", side_effect=record_send),
            patch.object(manager.asyncio, "sleep", new=fake_sleep),
        ):
            route = await self.print_with(
                client, sysfs, dev, labels_body(real_png(), real_png(), real_png())
            )

        self.assertEqual(route.fulfilled, {"status": 200, "body": {"printed": 3}})
        self.assertEqual(events, ["label", 1.5, "label", 1.5, "label"])

    async def test_waits_for_the_last_write_to_drain_before_closing_the_printer(self):
        # usblp kills an in-flight URB on close(): closing before POLLOUT loses the label's tail
        # (and its cut command), so a printer that never drains must fail the job, not "print".
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")
        calls = []

        def fake_select(_r, w, _x, _timeout):
            calls.append(bool(w))
            writes_done = (dev / "lp3").stat().st_size > 0
            return ([], [] if writes_done else w, [])

        with (
            patch.object(manager.select, "select", side_effect=fake_select),
            self.assertLogs(manager.logger, level="ERROR") as logs,
        ):
            route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 502)
        self.assertEqual(route.fulfilled["body"]["printed"], 0)
        self.assertGreaterEqual(len(calls), 2)  # one before the write, one drain wait after it
        self.assertTrue(any("did not finish" in line for line in logs.output))

    async def test_lookup_is_repeated_per_label_so_replug_does_not_need_a_restart(self):
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")
        await self.print_with(client, sysfs, dev, labels_body(real_png()))

        # Replug: the same printer now enumerates as lp5.
        (sysfs / "lp3" / "device").unlink()
        (sysfs / "lp3").rmdir()
        self.fake_usb_printers(("lp5", "28e9:5812"))
        route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 200)
        self.assertGreater((dev / "lp5").stat().st_size, 0)

    async def test_missing_printer_returns_print_failed_and_logs_no_label_content(self):
        sysfs, dev = self.fake_usb_printers(("lp0", "03f0:1234"))
        client = self.client(PRINTER_USB_ID="28e9:5812")

        with self.assertLogs(manager.logger, level="ERROR") as logs:
            route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 502)
        self.assertEqual(route.fulfilled["body"]["printed"], 0)
        self.assertEqual(route.fulfilled["body"]["error"]["code"], "PRINT_FAILED")
        self.assertTrue(any("not found" in line for line in logs.output))

    async def test_explicit_device_path_overrides_usb_id_lookup(self):
        sysfs, dev = self.fake_usb_printers()
        target = self.root / "printer.bin"
        target.touch()
        client = self.client(PRINTER_DEVICE=str(target), PRINTER_USB_ID="28e9:5812")

        route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 200)
        self.assertGreater(target.stat().st_size, 0)

    async def test_unusable_device_path_and_unconvertible_label_fail_with_printed_count(self):
        sysfs, dev = self.fake_usb_printers()
        cases = {
            "device path missing": (str(self.root / "nope"), labels_body(real_png())),
            # Passes the route's PNG-signature check but cannot be decoded.
            "label not decodable": (str(self.root / "ok.bin"), labels_body(PNG)),
        }
        (self.root / "ok.bin").touch()
        for name, (device, body) in cases.items():
            with self.subTest(name=name):
                client = self.client(PRINTER_DEVICE=device)
                with self.assertLogs(manager.logger, level="ERROR"):
                    route = await self.print_with(client, sysfs, dev, body)
                self.assertEqual(route.fulfilled["status"], 502)
                self.assertEqual(route.fulfilled["body"]["printed"], 0)

    async def test_permission_error_tells_the_operator_to_join_group_lp(self):
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")

        with (
            patch.object(manager.os, "open", side_effect=PermissionError),
            self.assertLogs(manager.logger, level="ERROR") as logs,
        ):
            route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 502)
        self.assertTrue(any("group lp" in line for line in logs.output))

    async def test_oversized_or_bomb_png_gets_an_answer_instead_of_hanging(self):
        from PIL import Image

        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")
        buffer = io.BytesIO()
        Image.new("1", (14000, 14000), 1).save(buffer, format="PNG")  # ~50 KB, declares 196M px
        self.assertLess(len(buffer.getvalue()), manager.KIOSK_PRINT_MAX_PNG_BYTES)

        with self.assertLogs(manager.logger, level="ERROR"):
            route = await self.print_with(client, sysfs, dev, labels_body(buffer.getvalue()))

        self.assertEqual(route.fulfilled["status"], 502)
        self.assertEqual(route.fulfilled["body"]["printed"], 0)
        self.assertEqual(route.fulfilled["body"]["error"]["code"], "PRINT_FAILED")

    async def test_any_unexpected_error_still_fulfils_the_route(self):
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")

        with (
            patch.object(client, "_send_escpos", side_effect=RuntimeError("boom")),
            self.assertLogs(manager.logger, level="ERROR"),
        ):
            route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 502)

    async def test_printer_that_never_becomes_writable_times_out(self):
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")

        with (
            patch.object(manager.select, "select", return_value=([], [], [])),
            patch.object(manager, "USBMISC_SYSFS", sysfs),
            patch.object(manager, "USB_DEV_DIR", dev),
            self.assertLogs(manager.logger, level="ERROR") as logs,
        ):
            started = time.monotonic()
            ok = await asyncio.to_thread(client._send_escpos, real_png(), 0.2)

        self.assertFalse(ok)
        self.assertLess(time.monotonic() - started, 2.0)
        self.assertEqual((dev / "lp3").stat().st_size, 0)  # nothing was written
        self.assertTrue(any("timed out" in line for line in logs.output))

    async def test_would_block_write_is_retried_until_it_goes_through(self):
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")
        real_write = os.write
        attempts = []

        def flaky_write(fd, data):
            attempts.append(len(data))
            if len(attempts) == 1:
                raise BlockingIOError
            return real_write(fd, data)

        with patch.object(manager.os, "write", side_effect=flaky_write):
            route = await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(route.fulfilled["status"], 200)
        self.assertGreaterEqual(len(attempts), 2)
        self.assertEqual((dev / "lp3").read_bytes(), label_to_escpos(real_png(), 576, 0, LABEL_LENGTH_MM, self_feed_mm=CUT_SELF_FEED_MM))

    async def test_default_backend_never_loads_pillow(self):
        code = (
            "import sys; import app.manager as m; "
            "c = m.ScannerClientManager({'TENT_BASE_URL': 'https://t.example', 'DEVICE_ID': 'd', "
            "'DEVICE_SECRET': 's'}); print('PIL' in sys.modules)"
        )
        out = await asyncio.to_thread(
            subprocess.run, [sys.executable, "-c", code], capture_output=True, text=True, check=True
        )
        self.assertEqual(out.stdout.strip(), "False")

    async def test_default_backend_still_spools_through_lp(self):
        client = manager.ScannerClientManager(valid_config(DEBUG="false"))
        route = FakePrintRoute(body=labels_body(PNG))
        calls = []

        async def fake_exec(*args, **_kwargs):
            calls.append(args)
            return FakeLpProcess()

        with patch.object(manager.asyncio, "create_subprocess_exec", new=fake_exec):
            await client._route_kiosk_api(route)

        self.assertEqual(route.fulfilled["status"], 200)
        self.assertEqual(calls[0][:3], ("lp", "-d", "tent_xprinter"))

    async def test_label_files_are_not_left_on_disk(self):
        sysfs, dev = self.fake_usb_printers(("lp3", "28e9:5812"))
        client = self.client(PRINTER_USB_ID="28e9:5812")
        before = set(self.root.rglob("*"))

        await self.print_with(client, sysfs, dev, labels_body(real_png()))

        self.assertEqual(set(self.root.rglob("*")), before)


class FakeHardwareRoute(FakePrintRoute):
    def __init__(self, **kwargs):
        super().__init__(url="https://tent.example.go.th/api/v1/scanner/kiosk/hardware", **kwargs)


class KioskHardwareRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_answers_locally_with_the_machine_settings_and_no_credentials(self):
        client = manager.ScannerClientManager(
            valid_config(
                KIOSK_QR_INPUT="both",
                KIOSK_CAMERA_LABEL="JSK-RGB",
                KIOSK_QR_READER_MAX_GAP_MS="40",
            )
        )
        route = FakeHardwareRoute()

        await client._route_kiosk_api(route)

        self.assertIsNone(route.continued_headers)  # never forwarded to the server
        self.assertEqual(route.fulfilled["status"], 200)
        self.assertEqual(
            route.fulfilled["body"],
            {
                "qr_input": "both",
                "camera_label": "JSK-RGB",
                "reader_max_gap_ms": 40,
                "face_check": {"mode": "off", "flows": []},
            },
        )
        body = manager.json.dumps(route.fulfilled["body"])
        self.assertNotIn(client.device_id, body)
        self.assertNotIn(client.device_secret, body)

    async def test_unconfigured_machine_reports_the_camera_default(self):
        route = FakeHardwareRoute()

        await manager.ScannerClientManager(valid_config())._route_kiosk_api(route)

        self.assertEqual(
            route.fulfilled["body"],
            {
                "qr_input": "camera",
                "camera_label": None,
                "reader_max_gap_ms": 50,
                "face_check": {"mode": "off", "flows": []},
            },
        )

    async def test_response_is_not_cacheable(self):
        client = manager.ScannerClientManager(valid_config())
        captured = {}

        class CapturingRoute(FakeHardwareRoute):
            async def fulfill(self, *, status, content_type, headers, body):
                captured.update(headers=headers, content_type=content_type)
                await super().fulfill(status=status, content_type=content_type, headers=headers, body=body)

        await client._route_kiosk_api(CapturingRoute())

        self.assertEqual(captured["headers"]["cache-control"], "no-store")
        self.assertEqual(captured["content_type"], "application/json")

    async def test_foreign_origin_or_get_gets_a_local_404_and_never_reaches_the_server(self):
        client = manager.ScannerClientManager(valid_config())
        foreign = FakeHardwareRoute(origin="https://attacker.example")
        get = FakeHardwareRoute()
        get.request.method = "GET"

        for route in (foreign, get):
            await client._route_kiosk_api(route)
            self.assertEqual(route.fulfilled["status"], 404)
            self.assertNotIn("qr_input", route.fulfilled["body"])
            self.assertIsNone(route.continued_headers)  # not forwarded: no server access log


class CardPollTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_slow_reader_poll_does_not_stall_other_kiosk_routes(self):
        client = manager.ScannerClientManager(valid_config())

        def slow_poll():
            time.sleep(0.3)  # an HID reader that is slow to answer
            return True

        client.reader = SimpleNamespace(is_card_inserted=slow_poll)
        route = FakeHardwareRoute()
        order = []

        async def poll():
            await client._card_inserted_safely()
            order.append("poll")

        async def serve():
            await asyncio.sleep(0.05)
            await client._route_kiosk_api(route)
            order.append("route")

        await asyncio.gather(poll(), serve())

        self.assertEqual(route.fulfilled["status"], 200)
        self.assertEqual(order, ["route", "poll"])

    async def test_lost_reader_is_dropped_immediately_without_repeating_the_warning(self):
        client = manager.ScannerClientManager(valid_config(CARD_READER="rfpro"))
        closed = []

        class Unplugged:
            def is_card_inserted(self):
                raise ReaderLostError("gone")

            def close(self):
                closed.append(True)

        client.reader = Unplugged()

        with self.assertLogs(manager.logger, level="WARNING") as logs:
            first = await client._card_inserted_safely()
            second = await client._card_inserted_safely()  # reader is already None

        self.assertEqual((first, second), (False, False))
        self.assertIsNone(client.reader)
        self.assertEqual(closed, [True])
        self.assertEqual(len(logs.output), 1)


class DropReaderTests(unittest.IsolatedAsyncioTestCase):
    async def test_closing_a_lost_reader_runs_off_the_event_loop(self):
        client = manager.ScannerClientManager(valid_config())
        loop_thread = threading.get_ident()
        close_threads = []

        def slow_close():
            close_threads.append(threading.get_ident())
            time.sleep(0.2)  # pcscd / an HID node slow to let go

        client.reader = SimpleNamespace(close=slow_close)
        ticks = []

        async def tick():
            for _ in range(5):
                ticks.append(True)
                await asyncio.sleep(0.02)

        await asyncio.gather(client._drop_reader(), tick())

        self.assertIsNone(client.reader)
        self.assertEqual(len(close_threads), 1)
        self.assertNotEqual(close_threads[0], loop_thread)
        self.assertEqual(len(ticks), 5)

    async def test_the_reader_is_forgotten_before_close_finishes(self):
        client = manager.ScannerClientManager(valid_config())
        seen = []
        client.reader = SimpleNamespace(close=lambda: seen.append(client.reader))
        await client._drop_reader()
        self.assertEqual(seen, [None])

    async def test_close_waits_for_a_chip_photo_read_on_the_same_reader(self):
        client = manager.ScannerClientManager(valid_config())
        events = []

        def read_photo():
            events.append("photo-start")
            time.sleep(0.15)
            events.append("photo-end")
            return b"\xff\xd8\xff-photo"

        client.reader = SimpleNamespace(
            read_photo=read_photo, close=lambda: events.append("close")
        )
        photo_task = asyncio.create_task(client._read_chip_photo())
        await asyncio.sleep(0.02)  # the photo read is under way
        await client._drop_reader()
        self.assertEqual(await photo_task, b"\xff\xd8\xff-photo")
        self.assertEqual(events, ["photo-start", "photo-end", "close"])

    async def test_a_photo_read_waiting_for_the_lock_skips_a_reader_dropped_meanwhile(self):
        client = manager.ScannerClientManager(valid_config())
        events = []
        client.reader = SimpleNamespace(
            read_photo=lambda: events.append("read"), close=lambda: events.append("close")
        )
        await client._reader_lock.acquire()  # a card poll is in progress
        photo_task = asyncio.create_task(client._read_chip_photo())
        await asyncio.sleep(0)  # the photo read holds the old reader and waits its turn
        drop_task = asyncio.create_task(client._drop_reader())  # the poll found it unplugged
        await asyncio.sleep(0)
        client._reader_lock.release()

        self.assertIsNone(await photo_task)
        await drop_task
        self.assertEqual(events, ["close"])  # never read through the closed handle

    async def test_a_failing_close_still_drops_the_reader(self):
        client = manager.ScannerClientManager(valid_config())

        def broken_close():
            raise OSError("already gone")

        client.reader = SimpleNamespace(close=broken_close)
        with self.assertLogs(manager.logger, level="WARNING"):
            await client._drop_reader()
        self.assertIsNone(client.reader)

    async def test_a_reader_without_close_is_just_forgotten(self):
        client = manager.ScannerClientManager(valid_config())
        client.reader = SimpleNamespace()
        await client._drop_reader()
        self.assertIsNone(client.reader)


class ReaderLostDuringReadTests(unittest.IsolatedAsyncioTestCase):
    async def run_loop_with(self, client, reader):
        init_calls = []

        async def fake_init_reader():
            init_calls.append(True)
            if len(init_calls) == 1:
                client.reader = reader
            else:
                client.running = False
            return True

        async def no_sleep(_seconds):
            return None

        with (
            patch.object(client, "init_reader", new=fake_init_reader),
            patch.object(asyncio, "sleep", new=no_sleep),
            self.assertLogs(manager.logger, level="WARNING"),
        ):
            await client.card_reading_loop()
        return init_calls

    async def test_unplugging_mid_read_waits_for_the_reader_instead_of_showing_a_read_error(self):
        client = manager.ScannerClientManager(valid_config(CARD_READER="rfpro"))
        client.page = FakePage(client.home_url)

        class UnpluggedWhileReading:
            closed = False

            def is_card_inserted(self):
                return True

            def read_citizen_id(self):
                raise ReaderLostError("gone")

            def close(self):
                self.closed = True

        reader = UnpluggedWhileReading()

        init_calls = await self.run_loop_with(client, reader)

        self.assertEqual(len(init_calls), 2)  # waited for the hardware again
        self.assertTrue(reader.closed)
        self.assertIsNone(client.reader)
        visited = [urlparse(url).path for url in client.page.evaluated if isinstance(url, str)]
        self.assertNotIn(client.error_path, visited)  # no "อ่านข้อมูลบัตรไม่สำเร็จ" screen
        self.assertEqual(urlparse(client.page.url).path, client.home_path)  # not stranded on reading


if __name__ == "__main__":
    unittest.main()


FACE_URL = "https://tent.example.go.th/api/v1/scanner/kiosk/face/"
CID = "1234567890123"


class FakeFaceService:
    """Records what the manager asks of the face service; answers with canned replies."""

    def __init__(self):
        self.calls = []
        self.error = None
        self.stashed = []

    def _answer(self, name, reply):
        self.calls.append(name)
        if self.error:
            raise self.error
        return reply

    async def start(self, citizen_id, flow, read_photo=None):
        self.started = (citizen_id, flow, read_photo)
        return self._answer("start", {"ok": True, "reference": "reading", "max_attempts": 3})

    async def frame(self, raw):
        self.frame_bytes = raw
        return self._answer(
            "frame", {"face": True, "hint": "ok", "ready": True, "reference": "ready"}
        )

    async def verify(self, frames):
        self.verified_frames = frames
        return self._answer("verify", {"result": "match", "attempt": 1})

    def cancel(self):
        self.calls.append("cancel")

    def stash_photo(self, citizen_id, photo):
        self.stashed.append((citizen_id, photo))


class FaceRouteTests(unittest.IsolatedAsyncioTestCase):
    def client(self, **overrides):
        client = manager.ScannerClientManager(valid_config(KIOSK_FACE_CHECK="on", **overrides))
        client.face_service = FakeFaceService()
        return client

    async def call(self, client, action, body=None, **route_kwargs):
        route = FakePrintRoute(url=FACE_URL + action, body=body, **route_kwargs)
        await client._route_kiosk_api(route)
        return route

    @staticmethod
    def payload(**fields):
        return manager.json.dumps(fields).encode()

    async def test_face_check_is_off_unless_configured(self):
        client = manager.ScannerClientManager(valid_config())
        self.assertIsNone(client.face_service)
        route = await self.call(client, "start", self.payload(citizen_id=CID, flow="walk_in"))
        self.assertEqual(route.fulfilled["status"], 404)
        self.assertEqual(route.fulfilled["body"]["error"]["code"], "FACE_CHECK_DISABLED")

    async def test_hardware_reports_the_face_check_mode_and_flows(self):
        client = self.client(KIOSK_FACE_CHECK_FLOWS="walk_in")
        route = FakeHardwareRoute()
        await client._route_kiosk_api(route)
        self.assertEqual(route.fulfilled["body"]["face_check"], {"mode": "on", "flows": ["walk_in"]})

    async def test_face_requests_are_answered_locally_and_never_forwarded(self):
        client = self.client()
        for action, body in (
            ("start", self.payload(citizen_id=CID, flow="walk_in")),
            ("frame", b"\xff\xd8\xff0"),
            ("verify", self.payload(frames=[manager.base64.b64encode(b"x").decode()])),
            ("cancel", b"{}"),
        ):
            route = await self.call(client, action, body)
            self.assertIsNone(route.continued_headers, action)
            self.assertEqual(route.fulfilled["status"], 200, action)
            self.assertEqual(route.fulfilled["body"].get("error"), None, action)
        self.assertEqual(client.face_service.calls, ["start", "frame", "verify", "cancel"])

    async def test_a_foreign_origin_gets_a_local_404(self):
        client = self.client()
        route = await self.call(
            client, "verify", b"{}", origin="https://attacker.example",
        )
        self.assertEqual(route.fulfilled["status"], 404)
        self.assertIsNone(route.continued_headers)
        self.assertEqual(client.face_service.calls, [])

    async def test_check_in_reads_the_photo_from_the_card_and_walk_in_does_not(self):
        client = self.client()
        await self.call(client, "start", self.payload(citizen_id=CID, flow="check_in"))
        self.assertEqual(client.face_service.started[1], "check_in")
        self.assertEqual(client.face_service.started[2], client._read_chip_photo)
        await self.call(client, "start", self.payload(citizen_id=CID, flow="walk_in"))
        self.assertIsNone(client.face_service.started[2])

    async def test_start_refuses_a_bad_id_an_unknown_flow_or_a_flow_that_is_switched_off(self):
        client = self.client(KIOSK_FACE_CHECK_FLOWS="walk_in")
        for body in (
            self.payload(citizen_id="123", flow="walk_in"),
            self.payload(citizen_id=CID, flow="elsewhere"),
            self.payload(citizen_id=CID, flow="check_in"),
            b"not json",
            b"[]",
        ):
            route = await self.call(client, "start", body)
            self.assertEqual(route.fulfilled["status"], 400)
            self.assertEqual(route.fulfilled["body"]["error"]["code"], "INVALID_FACE_INPUT")
        self.assertEqual(client.face_service.calls, [])

    async def test_verify_decodes_the_frames_and_refuses_bad_ones(self):
        client = self.client()
        frames = [b"\xff\xd8\xff-one", b"\xff\xd8\xff-two"]
        encoded = [manager.base64.b64encode(frame).decode() for frame in frames]
        route = await self.call(client, "verify", self.payload(frames=encoded))
        self.assertEqual(route.fulfilled["body"], {"result": "match", "attempt": 1})
        self.assertEqual(client.face_service.verified_frames, frames)
        for bad in (None, [], "x", [1], ["@@@"], ["AAAA"] * 9):
            route = await self.call(client, "verify", self.payload(frames=bad))
            self.assertEqual(route.fulfilled["status"], 400, bad)

    async def test_frames_are_passed_through_as_raw_bytes(self):
        client = self.client()
        route = await self.call(client, "frame", b"\xff\xd8\xff-frame")
        self.assertEqual(client.face_service.frame_bytes, b"\xff\xd8\xff-frame")
        self.assertEqual(
            route.fulfilled["body"],
            {"face": True, "hint": "ok", "ready": True, "reference": "ready"},
        )

    async def test_start_and_frame_replies_reach_the_page_with_the_new_fields(self):
        client = self.client()
        route = await self.call(client, "start", self.payload(citizen_id=CID, flow="check_in"))
        self.assertEqual(
            route.fulfilled["body"], {"ok": True, "reference": "reading", "max_attempts": 3}
        )

    async def test_an_oversized_body_is_refused_before_any_work(self):
        client = self.client()
        route = await self.call(client, "frame", b"0" * (manager.KIOSK_FACE_MAX_BODY_BYTES + 1))
        self.assertEqual(route.fulfilled["status"], 413)
        self.assertEqual(client.face_service.calls, [])

    async def test_errors_map_to_http_codes_without_leaking_details(self):
        from app.face.service import FaceStateError

        client = self.client()
        cases = (
            (FaceStateError("secret detail"), 409, "FACE_CHECK_NOT_STARTED"),
            (FileNotFoundError("models/x.onnx"), 503, "FACE_MODELS_MISSING"),
            (RuntimeError("private payload 1234567890123"), 500, "FACE_CHECK_FAILED"),
        )
        for error, status, code in cases:
            client.face_service.error = error
            if status == 409:  # an expected state, not a fault: nothing to log
                with self.assertNoLogs(manager.logger, level="ERROR"):
                    route = await self.call(client, "frame", b"\xff\xd8\xff0")
                logged = ""
            else:
                with self.assertLogs(manager.logger, level="ERROR") as logs:
                    route = await self.call(client, "frame", b"\xff\xd8\xff0")
                logged = "\n".join(logs.output)
            self.assertEqual(route.fulfilled["status"], status)
            self.assertEqual(route.fulfilled["body"]["error"]["code"], code)
            self.assertNotIn("secret detail", manager.json.dumps(route.fulfilled["body"]))
            self.assertNotIn("private payload", logged)
            self.assertNotIn(CID, logged)

    async def test_cancel_wipes_the_service(self):
        client = self.client()
        await self.call(client, "cancel", b"{}")
        self.assertEqual(client.face_service.calls, ["cancel"])

    async def test_cancel_logs_an_allowed_reason_and_nothing_else(self):
        client = self.client()
        self.assertIn("staff_bypass", manager.KIOSK_FACE_END_REASONS)
        for reason in sorted(manager.KIOSK_FACE_END_REASONS):
            with self.assertLogs(manager.logger, level="INFO") as logs:
                route = await self.call(client, "cancel", self.payload(reason=reason))
            self.assertEqual(route.fulfilled["status"], 200)
            self.assertEqual(route.fulfilled["body"], {"ok": True})
            self.assertEqual(
                [record.getMessage() for record in logs.records],
                [f"Face check ended early: reason={reason}"],
            )

    async def test_cancel_ignores_an_unknown_or_malformed_reason_but_still_succeeds(self):
        client = self.client()
        bodies = (
            b"",
            b"{}",
            b"not json",
            b"\xff\xfe",
            b"[]",
            b'"camera_denied"',
            self.payload(reason="because " + CID),
            self.payload(reason=["camera_denied"]),
            self.payload(reason=None),
            self.payload(reason="camera_denied ", other=CID),
        )
        for body in bodies:
            with self.assertNoLogs(manager.logger, level="INFO"):
                route = await self.call(client, "cancel", body)
            self.assertEqual(route.fulfilled["status"], 200, body)
            self.assertEqual(route.fulfilled["body"], {"ok": True}, body)
        self.assertEqual(client.face_service.calls, ["cancel"] * len(bodies))


class FaceReaderTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_photo_read_and_the_card_poll_never_overlap(self):
        client = manager.ScannerClientManager(valid_config())
        events = []

        def read_photo():
            events.append("photo-start")
            time.sleep(0.15)
            events.append("photo-end")
            return b"\xff\xd8\xff-photo"

        def is_card_inserted():
            events.append("poll")
            return True

        client.reader = SimpleNamespace(read_photo=read_photo, is_card_inserted=is_card_inserted)
        photo_task = asyncio.create_task(client._read_chip_photo())
        await asyncio.sleep(0.02)  # the photo read is under way
        await client._card_inserted()
        self.assertEqual(await photo_task, b"\xff\xd8\xff-photo")
        self.assertEqual(events, ["photo-start", "photo-end", "poll"])

    async def test_no_reader_means_no_photo(self):
        client = manager.ScannerClientManager(valid_config())
        client.reader = None
        self.assertIsNone(await client._read_chip_photo())

    async def test_the_full_read_sets_the_chip_photo_aside_for_a_walk_in_face_check(self):
        client = manager.ScannerClientManager(valid_config(KIOSK_FACE_CHECK="on"))
        client.face_service = FakeFaceService()
        client.page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")
        card = {"citizen_id": CID, "photo_base64": "data:image/jpeg;base64,AAAA"}
        client.reader = SimpleNamespace(read_all_data=lambda: card)

        self.assertTrue(await client._read_full_card_if_register_path())

        self.assertEqual(client.face_service.stashed, [(CID, "data:image/jpeg;base64,AAAA")])

    async def test_nothing_is_set_aside_when_walk_in_face_check_is_off(self):
        client = manager.ScannerClientManager(
            valid_config(KIOSK_FACE_CHECK="on", KIOSK_FACE_CHECK_FLOWS="check_in")
        )
        client.face_service = FakeFaceService()
        client.page = EventFakePage(f"https://tent.example.go.th{client.register_card_path}")
        client.reader = SimpleNamespace(
            read_all_data=lambda: {"citizen_id": CID, "photo_base64": "data:image/jpeg;base64,AAAA"}
        )

        self.assertTrue(await client._read_full_card_if_register_path())

        self.assertEqual(client.face_service.stashed, [])


class FaceCameraPermissionTests(unittest.IsolatedAsyncioTestCase):
    class FakeContext:
        def __init__(self, error=None):
            self.granted = []
            self.error = error

        async def grant_permissions(self, permissions, *, origin):
            if self.error:
                raise self.error
            self.granted.append((permissions, origin))

    async def test_the_kiosk_origin_is_given_the_camera_when_the_face_check_runs(self):
        client = manager.ScannerClientManager(valid_config(KIOSK_FACE_CHECK="on"))
        context = self.FakeContext()

        await client._grant_camera_permission(context)

        self.assertEqual(context.granted, [(["camera"], "https://tent.example.go.th")])

    async def test_only_the_origin_is_granted_not_a_path(self):
        client = manager.ScannerClientManager(
            valid_config(TENT_BASE_URL="https://tent.example.go.th:8443/app", KIOSK_FACE_CHECK="on")
        )
        context = self.FakeContext()

        await client._grant_camera_permission(context)

        self.assertEqual(context.granted[0][1], "https://tent.example.go.th:8443")

    async def test_the_kiosk_origin_is_given_the_camera_when_qr_codes_are_scanned_by_camera(self):
        for qr_input in ("camera", "both"):
            with self.subTest(qr_input=qr_input):
                client = manager.ScannerClientManager(valid_config(KIOSK_QR_INPUT=qr_input))
                context = self.FakeContext()

                await client._grant_camera_permission(context)

                self.assertEqual(context.granted, [(["camera"], "https://tent.example.go.th")])

    async def test_nothing_is_granted_to_a_reader_only_kiosk_with_the_face_check_off(self):
        client = manager.ScannerClientManager(valid_config(KIOSK_QR_INPUT="reader"))
        context = self.FakeContext()

        await client._grant_camera_permission(context)

        self.assertEqual(context.granted, [])

    async def test_a_refused_grant_never_stops_the_kiosk_from_starting(self):
        client = manager.ScannerClientManager(valid_config(KIOSK_FACE_CHECK="on"))

        with self.assertLogs(manager.logger, level="WARNING") as logs:
            await client._grant_camera_permission(self.FakeContext(error=RuntimeError("denied")))

        self.assertIn("camera permission", "\n".join(logs.output))

    def test_on_mode_warns_that_the_thresholds_are_not_calibrated(self):
        with self.assertLogs(manager.logger, level="WARNING") as logs:
            manager.ScannerClientManager(valid_config(KIOSK_FACE_CHECK="on"))

        self.assertIn("KIOSK_FACE_CHECK=off", "\n".join(logs.output))

    def test_off_does_not_warn(self):
        with self.assertNoLogs(manager.logger, level="WARNING"):
            manager.ScannerClientManager(valid_config(KIOSK_FACE_CHECK="off"))
