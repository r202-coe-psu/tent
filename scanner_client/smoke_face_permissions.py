#!/usr/bin/env python3
"""On-machine smoke test (not CI): does the kiosk browser get the camera with no permission prompt?

  ./smoke_face_permissions.py                 # uses .env (TENT_BASE_URL); stub page, no server needed
  ./smoke_face_permissions.py --headed        # watch it in a window
  ./smoke_face_permissions.py --live          # open the real /kiosk/register/face page instead
  ./smoke_face_permissions.py --fake-camera   # Chromium test camera, for a machine with no camera

It starts a fresh Chromium profile the way the manager does (same launch arguments, same
`_grant_camera_permission` call, face check forced to at least `shadow`) and asks the page what the
camera permission is. `granted` means the person will never see a prompt. It never answers a prompt
itself (no --use-fake-ui-for-media-stream), so a missing grant shows up as `prompt`. Nothing is
recorded: the camera stream is closed at once and only the verdicts are printed. Exit 0 = ok.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import tempfile
import urllib.parse
from typing import Optional

from app.config import ScannerConfigError, load_and_validate_config
from app.manager import ScannerClientManager

FACE_PAGE_PATH = "/kiosk/register/face"
STUB_HTML = "<!doctype html><title>camera permission smoke</title>"

# What the page reports about getUserMedia. NotFoundError only means this machine has no camera
# (use --fake-camera to try anyway): the permission itself was not the problem.
_CAMERA_ERRORS = {
    "NotAllowedError": "the browser refused the camera (denied, or it would have asked)",
    "NotFoundError": "no camera found (permission was not the problem)",
    "NotSupportedError": "this headless browser cannot open a camera (try --headed)",
    "NotReadableError": "camera is busy or cannot be opened (another program holds it?)",
}


def origin_of(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def verdict(state: Optional[str], camera_error: Optional[str]) -> tuple[bool, str]:
    """Judge what the page saw. Only a `granted` state passes: `prompt` is the kiosk-breaking case."""
    if state != "granted":
        return False, f"camera permission is {state!r}, a person would be asked (needs 'granted')"
    if camera_error == "NotAllowedError":
        return False, _CAMERA_ERRORS["NotAllowedError"]
    if camera_error:
        reason = _CAMERA_ERRORS.get(camera_error, camera_error)
        return True, f"permission granted without a prompt; opening the camera said: {reason}"
    return True, "permission granted without a prompt and the camera opened"


PROBE_JS = """async () => {
  let state = null, error = null;
  try { state = (await navigator.permissions.query({ name: 'camera' })).state; }
  catch (e) { state = 'unsupported'; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (e) { error = e && e.name ? e.name : 'Error'; }
  return { state, error };
}"""


async def run(args: argparse.Namespace) -> int:
    from playwright.async_api import async_playwright

    try:
        config = load_and_validate_config(args.env)
    except ScannerConfigError as error:
        print(f"Config invalid: {error}", file=sys.stderr)
        return 78
    if str(config.get("KIOSK_FACE_CHECK") or "off").strip().lower() == "off":
        config["KIOSK_FACE_CHECK"] = "shadow"  # the manager grants the camera only when the check runs
        print("KIOSK_FACE_CHECK is off in .env; testing as if it were 'shadow'")
    config["DEBUG"] = "true" if args.headed else "false"
    config["KIOSK_SILENT_PRINT"] = "false"  # printing is not under test
    manager = ScannerClientManager(config)
    origin = origin_of(manager.tent_base_url)
    launch_args = manager._build_browser_args()
    # --kiosk makes no sense for a throwaway probe; the rest matches the real launch.
    launch_args = [arg for arg in launch_args if arg not in ("--kiosk", "--start-maximized")]
    if args.fake_camera:
        launch_args.append("--use-fake-device-for-media-stream")

    async with async_playwright() as p:
        with tempfile.TemporaryDirectory(prefix="smoke_face_") as profile:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=profile,  # fresh, so no earlier "allow" can hide a missing grant
                headless=not args.headed,
                executable_path=manager.executable_path,
                args=launch_args,
                ignore_default_args=["--enable-automation"],
            )
            try:
                await manager._grant_camera_permission(context)
                page = context.pages[0] if context.pages else await context.new_page()
                url = manager.tent_base_url + FACE_PAGE_PATH
                if not args.live:

                    async def stub(route):
                        await route.fulfill(status=200, content_type="text/html", body=STUB_HTML)

                    await context.route(f"{origin}/**", stub)
                await page.goto(url)
                result = await page.evaluate(PROBE_JS)
            finally:
                await context.close()

    ok, message = verdict(result.get("state"), result.get("error"))
    print(f"origin: {origin}\nstate:  {result.get('state')}\ngetUserMedia: {result.get('error') or 'ok'}")
    print(("PASS: " if ok else "FAIL: ") + message)
    return 0 if ok else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--env", default=".env", help="config file (default .env)")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--live", action="store_true", help="load the real kiosk face page, not a stub")
    parser.add_argument("--fake-camera", action="store_true", help="use Chromium's test camera")
    return asyncio.run(run(parser.parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
