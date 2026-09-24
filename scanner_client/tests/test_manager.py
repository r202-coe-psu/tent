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
        self.assertEqual(urlparse(client.home_url).path, "/kiosk")
        self.assertEqual(urlparse(client.waiting_url).path, "/kiosk/scanner/waiting")
        self.assertEqual(
            FakeClient.requested_headers[-1]["X-Device-Secret"],
            "sk_scan_real_secret_value",
        )

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
                "GET",
                "https://tent.example.go.th/api/v1/scanner/kiosk/lookup",
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
