"""Startup page in the app's browser window that asks staff which shelter URL to open.

Shown on every start. It names the site it will open (the last origin, else
DEFAULT_SHELTER_ORIGIN) and keeps the URL box hidden until staff choose to change it; the
answer is checked with the same rule as the `.env` file (config.parse_shelter_origin) and the
form stays until it is valid. Card data (ID number, name, address, photo) goes to whichever site
opens, so any site other than DEFAULT_SHELTER_ORIGIN, typed now or saved in `.env` earlier, is
flagged and opens only after staff tick that they checked that exact site: Enter alone never
carries them to a look-alike someone saved on the PC. The page talks to Python only through a
window variable polled by `wait_for_function`, so nothing is exposed to the shelter site opened
afterwards.
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
  #warning { background: #fef2f2; border: 1px solid #b91c1c; border-radius: 8px;
             padding: 12px 14px; margin: 0 0 12px; }
  #warning p { color: #7f1d1d; margin: 0 0 8px; }
  #warning label { font-weight: 600; display: flex; gap: 8px; align-items: flex-start;
                   margin: 0; color: #7f1d1d; }
  #warning input { width: auto; margin-top: 4px; }
  #warning-site { font-weight: 700; word-break: break-all; }
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
  <div id="warning" hidden role="alert">
    <p>⚠ เว็บนี้ไม่ใช่เว็บหลักของศูนย์ ("""
    + DEFAULT_SHELTER_ORIGIN
    + """)
       ข้อมูลบัตรประชาชนที่เสียบ (เลขบัตร ชื่อ ที่อยู่ รูป) จะถูกส่งไปที่เว็บนี้
       ตรวจชื่อเว็บทีละตัวอักษรก่อน ถ้าไม่ได้ตั้งเองหรือไม่แน่ใจ ให้แจ้งผู้ดูแลระบบ</p>
    <label><input id="confirm" type="checkbox">
      <span>ตรวจแล้ว <span id="warning-site"></span> เป็นเว็บของศูนย์พักพิงจริง</span></label>
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
    document.getElementById('warning').hidden = true;
    document.getElementById('error').textContent = message;
    showCustom();
  };
  window.showWarning = (site) => {
    document.getElementById('error').textContent = '';
    document.getElementById('warning-site').textContent = site;
    const confirm = document.getElementById('confirm');
    confirm.checked = false;
    document.getElementById('warning').hidden = false;
    confirm.focus();
  };
  window.showTickHint = () => {
    document.getElementById('error').textContent = 'ติ๊กช่องด้านบนก่อนกด Enter';
    document.getElementById('confirm').focus();
  };
  // A tick is for the site it was given on: editing the URL takes it back.
  document.getElementById('url').addEventListener('input', () => {
    document.getElementById('confirm').checked = false;
    document.getElementById('warning').hidden = true;
  });
  document.getElementById('change').addEventListener('click', showCustom);
  document.getElementById('form').addEventListener('submit', (event) => {
    event.preventDefault();
    window.__tentSubmitted = {
      value: document.getElementById('url').value,
      confirmed: document.getElementById('confirm').checked,
    };
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

SHOW_WARNING_JS = "(site) => window.showWarning(site)"

SHOW_TICK_HINT_JS = "() => window.showTickHint()"

# Truthy only once per submit, and clears it, so each Enter is read exactly once.
TAKE_SUBMISSION_JS = """() => {
  const submitted = window.__tentSubmitted;
  if (submitted === undefined || submitted === null) return null;
  window.__tentSubmitted = null;
  return submitted;
}"""


async def ask_shelter_origin(page: Any, initial: str) -> str | None:
    """Ask until a valid origin is entered (and, off the default site, confirmed); None when
    the window is closed meanwhile."""
    try:
        await page.set_content(PROMPT_HTML)
        shown = initial or DEFAULT_SHELTER_ORIGIN
        await page.evaluate(PREFILL_JS, shown)
        warned: str | None = None
        if shown != DEFAULT_SHELTER_ORIGIN:
            warned = shown
            await page.evaluate(SHOW_WARNING_JS, warned)
        while True:
            handle = await page.wait_for_function(TAKE_SUBMISSION_JS, timeout=0, polling=250)
            submitted = await handle.json_value()
            try:
                origin = parse_shelter_origin(str(submitted["value"]))
            except ConfigError as exc:  # names the key and the rule, never the typed value
                warned = None
                await page.evaluate(SHOW_ERROR_JS, f"ที่อยู่ไม่ถูกต้อง — {exc}")
                continue
            if origin == DEFAULT_SHELTER_ORIGIN:
                return origin
            if origin == warned:
                if submitted.get("confirmed") is True:
                    return origin
                await page.evaluate(SHOW_TICK_HINT_JS)
                continue
            warned = origin
            await page.evaluate(SHOW_WARNING_JS, warned)
    except Exception:  # the window was closed (Playwright raises TargetClosedError)
        return None
