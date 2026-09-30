import asyncio
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from app import manager


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


if __name__ == "__main__":
    unittest.main()


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

    async def test_foreign_origin_is_never_printed(self):
        client = self.client()
        route = FakePrintRoute(origin="https://attacker.example", body=labels_body(PNG))
        await client._route_kiosk_api(route)
        self.assertIsNone(route.fulfilled)
        self.assertNotIn("x-device-id", route.continued_headers)
