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

    def test_http_is_allowed_for_loopback_and_private_lan_hosts(self):
        base = {"DEVICE_ID": "kiosk-01", "DEVICE_SECRET": "real-secret"}
        for url in (
            "http://172.30.92.241:5173/",
            "http://127.0.0.1:5173/",
            "http://localhost:5173/",
        ):
            with self.subTest(url=url):
                config = validate_config({**base, "TENT_BASE_URL": url})
                self.assertEqual(config["TENT_BASE_URL"], url.rstrip("/"))

    def test_http_is_rejected_for_a_named_host_without_the_insecure_opt_in(self):
        base = {"DEVICE_ID": "kiosk-01", "DEVICE_SECRET": "real-secret"}
        with self.assertRaises(ScannerConfigError):
            validate_config({**base, "TENT_BASE_URL": "http://tent.example.go.th"})

    def test_http_for_a_named_host_is_allowed_with_the_insecure_opt_in(self):
        base = {"DEVICE_ID": "kiosk-01", "DEVICE_SECRET": "real-secret"}
        for flag in ("1", "true", "yes", "True"):
            with self.subTest(flag=flag):
                config = validate_config(
                    {
                        **base,
                        "TENT_BASE_URL": "http://tent.example.go.th",
                        "ALLOW_INSECURE_HTTP": flag,
                    }
                )
                self.assertEqual(config["TENT_BASE_URL"], "http://tent.example.go.th")

    def test_https_is_always_allowed_for_a_named_host(self):
        base = {"DEVICE_ID": "kiosk-01", "DEVICE_SECRET": "real-secret"}
        config = validate_config({**base, "TENT_BASE_URL": "https://tent.example.go.th"})
        self.assertEqual(config["TENT_BASE_URL"], "https://tent.example.go.th")


HARDWARE_TEST_BASE = {
    "TENT_BASE_URL": "https://tent.example.go.th",
    "DEVICE_ID": "kiosk-01",
    "DEVICE_SECRET": "real-secret",
}


class HardwareConfigTests(unittest.TestCase):
    def validate(self, **overrides):
        return validate_config({**HARDWARE_TEST_BASE, **overrides})

    def test_unset_hardware_keys_keep_the_original_raspberry_pi_behaviour(self):
        config = self.validate()

        self.assertEqual(config["PRINTER_BACKEND"], "cups")
        self.assertEqual(config["PRINTER_WIDTH_DOTS"], "576")
        self.assertEqual(config["KIOSK_QR_INPUT"], "camera")
        self.assertEqual(config["CARD_READER"], "pcsc")
        self.assertEqual(config["CARD_READER_USB_ID"], "0483:4c43")
        self.assertEqual(config["KIOSK_FACE_CHECK"], "off")
        self.assertEqual(config["KIOSK_FACE_CHECK_FLOWS"], "check_in,walk_in")

    def test_face_check_settings_are_accepted_and_normalised(self):
        config = self.validate(
            KIOSK_FACE_CHECK=" Shadow ",
            KIOSK_FACE_CHECK_FLOWS="walk_in, Check_In,walk_in",
            KIOSK_FACE_THRESHOLD_PROFILE="sface-opencv-default-v1",
            KIOSK_FACE_MODELS_DIR=" /opt/tent/models ",
        )

        self.assertEqual(config["KIOSK_FACE_CHECK"], "shadow")
        self.assertEqual(config["KIOSK_FACE_CHECK_FLOWS"], "walk_in,check_in")
        self.assertEqual(config["KIOSK_FACE_THRESHOLD_PROFILE"], "sface-opencv-default-v1")
        self.assertEqual(config["KIOSK_FACE_MODELS_DIR"], "/opt/tent/models")

    def test_bad_face_check_settings_name_the_key_and_never_start_the_kiosk(self):
        for key, value in (
            ("KIOSK_FACE_CHECK", "maybe"),
            ("KIOSK_FACE_CHECK_FLOWS", "walk_in,qr"),
            ("KIOSK_FACE_CHECK_FLOWS", " , "),
            ("KIOSK_FACE_THRESHOLD_PROFILE", "made-up"),
        ):
            with self.subTest(key=key, value=value):
                with self.assertRaises(ScannerConfigError) as raised:
                    self.validate(**{key: value})
                self.assertIn(key, str(raised.exception))

    def test_kiosk3_settings_are_accepted_and_normalised(self):
        config = self.validate(
            PRINTER_BACKEND="ESCPOS",
            PRINTER_USB_ID="28E9:5812",
            PRINTER_WIDTH_DOTS="576",
            KIOSK_QR_INPUT="Reader",
            KIOSK_QR_READER_MAX_GAP_MS="40",
            KIOSK_CAMERA_LABEL=" JSK-RGB ",
            CARD_READER="rfpro",
            CARD_READER_USB_ID="0483:4C43",
        )

        self.assertEqual(config["PRINTER_BACKEND"], "escpos")
        self.assertEqual(config["PRINTER_USB_ID"], "28e9:5812")
        self.assertEqual(config["KIOSK_QR_INPUT"], "reader")
        self.assertEqual(config["KIOSK_QR_READER_MAX_GAP_MS"], "40")
        self.assertEqual(config["KIOSK_CAMERA_LABEL"], "JSK-RGB")
        self.assertEqual(config["CARD_READER"], "rfpro")
        self.assertEqual(config["CARD_READER_USB_ID"], "0483:4c43")

    def test_escpos_accepts_an_explicit_device_instead_of_a_usb_id(self):
        config = self.validate(PRINTER_BACKEND="escpos", PRINTER_DEVICE="/dev/usb/lp3")

        self.assertEqual(config["PRINTER_DEVICE"], "/dev/usb/lp3")

    def test_invalid_hardware_values_fail_before_startup(self):
        cases = {
            "printer backend": {"PRINTER_BACKEND": "sdk"},
            "printer usb id": {"PRINTER_BACKEND": "escpos", "PRINTER_USB_ID": "28e9-5812"},
            "printer usb id not hex": {"PRINTER_USB_ID": "zzzz:5812"},
            "escpos without target": {"PRINTER_BACKEND": "escpos"},
            "width not integer": {"PRINTER_WIDTH_DOTS": "wide"},
            "width below range": {"PRINTER_WIDTH_DOTS": "376"},
            "width above range": {"PRINTER_WIDTH_DOTS": "840"},
            "width not multiple of 8": {"PRINTER_WIDTH_DOTS": "580"},
            "qr input": {"KIOSK_QR_INPUT": "bluetooth"},
            "qr gap below range": {"KIOSK_QR_READER_MAX_GAP_MS": "5"},
            "qr gap above range": {"KIOSK_QR_READER_MAX_GAP_MS": "101"},
            "qr gap not integer": {"KIOSK_QR_READER_MAX_GAP_MS": "fast"},
            "card reader": {"CARD_READER": "nfc"},
            "card reader usb id": {"CARD_READER": "rfpro", "CARD_READER_USB_ID": "4c43"},
        }
        for name, overrides in cases.items():
            with self.subTest(name=name), self.assertRaises(ScannerConfigError):
                self.validate(**overrides)

    def test_error_messages_name_the_key_but_not_secrets(self):
        with self.assertRaises(ScannerConfigError) as raised:
            self.validate(PRINTER_BACKEND="sdk")

        message = str(raised.exception)
        self.assertIn("PRINTER_BACKEND", message)
        self.assertNotIn("real-secret", message)


if __name__ == "__main__":
    unittest.main()
