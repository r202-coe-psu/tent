import os
import tempfile
import unittest
from pathlib import Path

from app.config import ScannerConfigError, load_and_validate_config, load_config, validate_config


class ScannerConfigTests(unittest.TestCase):
    BASE_CONFIG = {
        "TENT_BASE_URL": "https://tent.example.go.th",
        "DEVICE_ID": "kiosk-01",
        "DEVICE_SECRET": "real-secret",
    }

    def test_env_file_loads_and_process_environment_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "TENT_BASE_URL=https://from-file.example\n"
                "DEVICE_ID=file-device\n"
                "DEVICE_SECRET=file-secret\n"
                "EXTRA_SETTING=ignored-by-scanner\n",
                encoding="utf-8",
            )

            loaded = load_config(
                env_path,
                {"DEVICE_ID": "process-device"},
            )
            self.assertEqual(loaded["DEVICE_ID"], "process-device")
            self.assertEqual(loaded["DEVICE_SECRET"], "file-secret")

            validated = load_and_validate_config(
                env_path,
                {"DEVICE_ID": "process-device"},
            )
            self.assertEqual(validated["DEVICE_ID"], "process-device")
            self.assertNotIn("KIOSK_PHONE_CHECK_IN_ENABLED", validated)

    def test_missing_and_placeholder_credentials_fail_before_startup(self):
        for config in (
            {"TENT_BASE_URL": "https://tent.example.go.th", "DEVICE_SECRET": "secret"},
            {
                "TENT_BASE_URL": "https://tent.example.go.th",
                "DEVICE_ID": "kiosk-test",
                "DEVICE_SECRET": "real-secret",
            },
            {
                "TENT_BASE_URL": "https://tent.example.go.th",
                "DEVICE_ID": "kiosk-01",
                "DEVICE_SECRET": "<one-time-key>",
            },
        ):
            with self.assertRaises(ScannerConfigError):
                validate_config(config)

    def test_http_is_allowed_for_non_loopback_and_loopback_hosts(self):
        base = {"DEVICE_ID": "kiosk-01", "DEVICE_SECRET": "real-secret"}
        for url in (
            "http://tent.example.go.th",
            "http://172.30.92.241:5173/",
            "http://127.0.0.1:5173/",
        ):
            with self.subTest(url=url):
                config = validate_config({**base, "TENT_BASE_URL": url})
                self.assertEqual(config["TENT_BASE_URL"], url.rstrip("/"))


if __name__ == "__main__":
    unittest.main()
