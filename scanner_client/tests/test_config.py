import os
import tempfile
import unittest
from pathlib import Path

from app.config import ScannerConfigError, load_and_validate_config, load_config, validate_config


class ScannerConfigTests(unittest.TestCase):
    def test_env_file_loads_and_process_environment_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "TENT_BASE_URL=https://from-file.example\n"
                "DEVICE_ID=file-device\n"
                "DEVICE_SECRET=file-secret\n",
                encoding="utf-8",
            )

            loaded = load_config(env_path, {"DEVICE_ID": "process-device"})
            self.assertEqual(loaded["DEVICE_ID"], "process-device")
            self.assertEqual(loaded["DEVICE_SECRET"], "file-secret")

            validated = load_and_validate_config(env_path, {"DEVICE_ID": "process-device"})
            self.assertEqual(validated["DEVICE_ID"], "process-device")

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

    def test_non_loopback_http_is_rejected_but_loopback_is_allowed(self):
        base = {"DEVICE_ID": "kiosk-01", "DEVICE_SECRET": "real-secret"}
        with self.assertRaises(ScannerConfigError):
            validate_config({**base, "TENT_BASE_URL": "http://tent.example.go.th"})

        config = validate_config({**base, "TENT_BASE_URL": "http://127.0.0.1:5173/"})
        self.assertEqual(config["TENT_BASE_URL"], "http://127.0.0.1:5173")


if __name__ == "__main__":
    unittest.main()
