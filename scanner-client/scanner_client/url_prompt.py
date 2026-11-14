"""Startup page in the app's browser window that asks staff which shelter URL to open.

Shown on every start. It names the site it will open (the last origin, else
DEFAULT_SHELTER_ORIGIN) and keeps the URL box hidden until staff choose to change it; the
answer is checked with the same rule as the `.env` file (config.parse_shelter_origin) and the
form stays until it is valid. The page talks to Python only through a window variable polled
by `wait_for_function`, so nothing is exposed to the shelter site opened afterwards.
"""

from typing import Any

from scanner_client.config import ConfigError, parse_shelter_origin

DEFAULT_SHELTER_ORIGIN = "https://shelter.psu.ac.th"

PROMPT_HTML = (
    """<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>tent — เลือกศูนย์พักพิง</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: "Segoe UI", Tahoma, sans-serif; background: #f4f6f8; color: #1f2933; }
  form { background: #fff; padding: 32px; border-radius: 12px; width: min(560px, 90vw);
         box-shadow: 0 4px 24px rgba(0, 0, 0, .08); }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: #52606d; line-height: 1.5; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; font-size: 18px; padding: 10px 12px;
          border: 1px solid #9aa5b1; border-radius: 8px; }
  button { margin-top: 16px; width: 100%; font-size: 18px; padding: 10px; border: 0;
           border-radius: 8px; background: #1d4ed8; color: #fff; cursor: pointer; }
  #error { color: #b91c1c; margin: 10px 0 0; min-height: 1.5em; }
  #target { font-size: 20px; font-weight: 600; color: #1d4ed8; word-break: break-all;
            margin: 0 0 4px; }
  button.secondary { background: #fff; color: #1d4ed8; border: 1px solid #1d4ed8; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<form id="form" autocomplete="off">
  <h1>ที่อยู่เว็บศูนย์พักพิง</h1>
  <p>โปรแกรมจะเปิด</p>
  <p id="target"></p>
  <p>ค่าเริ่มต้นคือ """
    + DEFAULT_SHELTER_ORIGIN
    + """ ถ้าต้องการเปลี่ยน domain ให้กดปุ่ม "เปลี่ยน domain" แล้วกรอก URL ใหม่</p>
  <div id="custom" hidden>
    <label for="url">SHELTER_URL</label>
    <p>ใส่แค่ https://ชื่อเว็บ ไม่ต้องมี path เช่น https://shelter.example.org<br>
       เครื่อง edge ในวง LAN ใช้ http:// ได้เฉพาะ IP วงภายใน เช่น http://192.168.1.10</p>
    <input id="url" name="url" type="text" spellcheck="false">
  </div>
  <p id="error" role="alert"></p>
  <button type="submit" id="open">เปิดเว็บศูนย์ฯ (Enter)</button>
  <button type="button" id="change" class="secondary">เปลี่ยน domain</button>
</form>
<script>
  const showCustom = () => {
    document.getElementById('custom').hidden = false;
    document.getElementById('change').hidden = true;
    const input = document.getElementById('url');
    input.focus();
    input.select();
  };
  window.showCustom = showCustom;
  window.showError = (message) => {
    document.getElementById('error').textContent = message;
    showCustom();
  };
  document.getElementById('change').addEventListener('click', showCustom);
  document.getElementById('form').addEventListener('submit', (event) => {
    event.preventDefault();
    window.__tentSubmitted = document.getElementById('url').value;
  });
</script>
</body>
</html>
"""
)

PREFILL_JS = """(value) => {
  document.getElementById('url').value = value;
  document.getElementById('target').textContent = value;
  document.getElementById('open').focus();
}"""

SHOW_ERROR_JS = "(message) => window.showError(message)"

# Truthy only once per submit, and clears it, so each Enter is read exactly once.
TAKE_SUBMISSION_JS = """() => {
  const value = window.__tentSubmitted;
  if (value === undefined || value === null) return null;
  window.__tentSubmitted = null;
  return { value };
}"""


async def ask_shelter_origin(page: Any, initial: str) -> str | None:
    """Ask until a valid origin is entered; None when the window is closed meanwhile."""
    try:
        await page.set_content(PROMPT_HTML)
        await page.evaluate(PREFILL_JS, initial or DEFAULT_SHELTER_ORIGIN)
        while True:
            handle = await page.wait_for_function(TAKE_SUBMISSION_JS, timeout=0, polling=250)
            raw = str((await handle.json_value())["value"])
            try:
                return parse_shelter_origin(raw)
            except ConfigError as exc:  # names the key and the rule, never the typed value
                await page.evaluate(SHOW_ERROR_JS, f"ที่อยู่ไม่ถูกต้อง — {exc}")
    except Exception:  # the window was closed (Playwright raises TargetClosedError)
        return None
