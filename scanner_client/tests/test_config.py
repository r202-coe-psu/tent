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

    def test_phone_check_in_boolean_defaults_to_enabled(self):
        self.assertIs(validate_config(self.BASE_CONFIG)["KIOSK_PHONE_CHECK_IN_ENABLED"], True)
        self.assertIs(
            validate_config({**self.BASE_CONFIG, "KIOSK_PHONE_CHECK_IN_ENABLED": "  "})[
                "KIOSK_PHONE_CHECK_IN_ENABLED"
            ],
            True,
        )

    def test_phone_check_in_boolean_accepts_true_and_false_spellings(self):
        for value in ("true", "1", "Yes", "on"):
            with self.subTest(value=value):
                self.assertIs(
                    validate_config(
                        {**self.BASE_CONFIG, "KIOSK_PHONE_CHECK_IN_ENABLED": value}
                    )["KIOSK_PHONE_CHECK_IN_ENABLED"],
                    True,
                )
        for value in ("false", "0", "no", "OFF"):
            with self.subTest(value=value):
                self.assertIs(
                    validate_config(
                        {**self.BASE_CONFIG, "KIOSK_PHONE_CHECK_IN_ENABLED": value}
                    )["KIOSK_PHONE_CHECK_IN_ENABLED"],
                    False,
                )

    def test_invalid_phone_check_in_setting_fails_without_echoing_value(self):
        with self.assertRaisesRegex(
            ScannerConfigError, "KIOSK_PHONE_CHECK_IN_ENABLED must be true or false"
        ) as error:
            validate_config(
                {**self.BASE_CONFIG, "KIOSK_PHONE_CHECK_IN_ENABLED": "ture-secret"}
            )
        self.assertNotIn("ture-secret", str(error.exception))

    def test_env_file_loads_and_process_environment_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "TENT_BASE_URL=https://from-file.example\n"
                "DEVICE_ID=file-device\n"
                "DEVICE_SECRET=file-secret\n"
                "KIOSK_PHONE_CHECK_IN_ENABLED=true\n",
                encoding="utf-8",
            )

            loaded = load_config(
                env_path,
                {"DEVICE_ID": "process-device", "KIOSK_PHONE_CHECK_IN_ENABLED": "false"},
            )
            self.assertEqual(loaded["DEVICE_ID"], "process-device")
            self.assertEqual(loaded["DEVICE_SECRET"], "file-secret")

            validated = load_and_validate_config(
                env_path,
                {"DEVICE_ID": "process-device", "KIOSK_PHONE_CHECK_IN_ENABLED": "false"},
            )
            self.assertEqual(validated["DEVICE_ID"], "process-device")
            self.assertIs(validated["KIOSK_PHONE_CHECK_IN_ENABLED"], False)

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
