import asyncio
import unittest
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
        query = parse_qs(urlparse(client.waiting_url).query)
        self.assertEqual(query["shelter_code"], ["SH001"])
        self.assertEqual(query["shelter_name"], ["ศูนย์พักพิงทดสอบ"])
        self.assertEqual(query["station_name"], ["โต๊ะ 1"])
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

    async def test_upstream_messages_redact_scanner_key_and_cid(self):
        safe = manager.safe_server_message(
            "secret=sk_scan_0123456789abcdef and cid=1234567890123",
            "fallback",
        )
        self.assertNotIn("sk_scan_", safe)
        self.assertNotIn("1234567890123", safe)
        self.assertIn("[redacted]", safe)


if __name__ == "__main__":
    unittest.main()
