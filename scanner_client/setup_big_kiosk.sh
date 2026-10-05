#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - One-shot setup for the big custom kiosk (kiosk3 class, Debian x86_64)
# ------------------------------------------------------------------------------
# Hardware: ESC/POS receipt printer 28e9:5812 · CROWN QR reader 0461:4d81 (keyboard wedge)
#           · RFpro/HOUSESmart HID card reader 0483:4c43. Not for the Raspberry Pi + XP-365B kiosk.
# Steps (idempotent — safe to re-run; each one reports ✅/⚠️/❌ and the run continues):
#   1 hardware check   2 apt packages   3 Python venv   4 .env hardware keys (never secrets)
#   5 printer group lp   6 card reader udev (setup_card_reader.sh)   7 disable cups-browsed
#   8 autostart (setup_autostart.sh)   9 no sleep / no screen blanking   10 summary
# Run as the kiosk user (NOT with sudo) — the script calls sudo itself where needed.
#
# Usage: ./setup_big_kiosk.sh [options]
#   --status       checks only, change nothing
#   --skip-apt     skip apt install (offline / already installed)
#   --skip-venv    skip creating .venv / pip install
#   --test-print   print one test label through app/escpos.py at the end
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR" || exit 1
ENV_FILE="$SCRIPT_DIR/.env"
VENV_PY="$SCRIPT_DIR/.venv/bin/python"

PRINTER_ID="28e9:5812"
QR_READER_ID="0461:4d81"
CARD_READER_ID="0483:4c43"
NO_BLANK_DESKTOP="$HOME/.config/autostart/tent-no-blank.desktop"
APT_PACKAGES=(
    pcscd pcsc-tools libpcsclite-dev libpcsclite1 libccid
    python3 python3-pip python3-venv python3-dev build-essential swig
    libjpeg-dev zlib1g-dev chromium git curl x11-xserver-utils
)
# Hardware keys written to .env only when absent — an existing value always wins.
ENV_DEFAULTS=(
    "PRINTER_BACKEND=escpos"
    "PRINTER_USB_ID=$PRINTER_ID"
    "PRINTER_WIDTH_DOTS=576"
    "PRINTER_CUT_FEED_MM=15"
    "KIOSK_QR_INPUT=reader"
    "CARD_READER=rfpro"
    "CARD_READER_USB_ID=$CARD_READER_ID"
    "BROWSER_EXECUTABLE_PATH=/usr/bin/chromium"
)

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

section() { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }
info() { echo -e "${BLUE}▸ $*${NC}"; }
ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() {
    echo -e "${YELLOW}⚠️  $*${NC}"
    WARNINGS+=("$*")
}
bad() {
    echo -e "${RED}❌ $*${NC}"
    FAILURES+=("$*")
}
have() { command -v "$1" >/dev/null 2>&1; }

STATUS_ONLY=false
SKIP_APT=false
SKIP_VENV=false
TEST_PRINT=false
WARNINGS=()
FAILURES=()

while [ $# -gt 0 ]; do
    case "$1" in
    --status) STATUS_ONLY=true; shift ;;
    --skip-apt) SKIP_APT=true; shift ;;
    --skip-venv) SKIP_VENV=true; shift ;;
    --test-print) TEST_PRINT=true; shift ;;
    -h | --help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "ไม่รู้จัก option: $1 (ดู --help)" >&2; exit 1 ;;
    esac
done

if [ "$(id -u)" -eq 0 ]; then
    echo -e "${RED}❌ รันด้วย user ของ kiosk (ไม่ต้องใส่ sudo) — script จะเรียก sudo เองเฉพาะขั้นที่ต้องใช้${NC}" >&2
    exit 1
fi
KIOSK_USER="$(id -un)"
$STATUS_ONLY || sudo -v || { echo "ต้องใช้สิทธิ์ sudo สำหรับการติดตั้ง" >&2; exit 1; }

usb_present() {
    local dev
    for dev in /sys/bus/usb/devices/*; do
        [ -f "$dev/idVendor" ] || continue
        [ "$(cat "$dev/idVendor"):$(cat "$dev/idProduct")" = "$1" ] && return 0
    done
    return 1
}

env_value() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"'\''[:space:]'
}

in_group() { id -nG "$KIOSK_USER" | tr ' ' '\n' | grep -qx "$1"; }
session_in_group() { id -nG | tr ' ' '\n' | grep -qx "$1"; }

# ------------------------------------------------------------------------------
section "1) ตรวจฮาร์ดแวร์"
[ "$(uname -m)" = "x86_64" ] && ok "x86_64" || warn "เครื่องนี้เป็น $(uname -m) — script ทำมาสำหรับตู้ใหญ่ x86_64"
usb_present "$PRINTER_ID" && ok "printer $PRINTER_ID" ||
    warn "ไม่พบ printer $PRINTER_ID — เปิดสวิตช์ printer (ตั้งค่าต่อได้ แต่จะทดสอบพิมพ์ไม่ได้)"
usb_present "$QR_READER_ID" && ok "QR reader $QR_READER_ID" || warn "ไม่พบ QR reader $QR_READER_ID"
usb_present "$CARD_READER_ID" && ok "เครื่องอ่านบัตร $CARD_READER_ID" || warn "ไม่พบเครื่องอ่านบัตร $CARD_READER_ID"

# ------------------------------------------------------------------------------
section "2) แพ็กเกจระบบ"
missing=()
for pkg in "${APT_PACKAGES[@]}"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [ ${#missing[@]} -eq 0 ]; then
    ok "ติดตั้งครบ ${#APT_PACKAGES[@]} แพ็กเกจ"
elif $STATUS_ONLY || $SKIP_APT; then
    warn "ยังไม่ได้ติดตั้ง: ${missing[*]}"
else
    info "apt install ${missing[*]}"
    if sudo apt-get update && sudo apt-get install -y "${missing[@]}"; then
        ok "ติดตั้งแพ็กเกจแล้ว"
    else
        bad "apt install ไม่สำเร็จ (เน็ตต้อง login captive portal ก่อนหรือไม่?)"
    fi
fi

# ------------------------------------------------------------------------------
section "3) Python venv"
if ! $STATUS_ONLY && ! $SKIP_VENV; then
    if [ ! -x "$VENV_PY" ]; then
        info "สร้าง .venv"
        python3 -m venv .venv || bad "สร้าง .venv ไม่สำเร็จ"
    fi
    if [ -x "$VENV_PY" ]; then
        info "pip install -r requirements.txt"
        "$VENV_PY" -m pip install --quiet --upgrade pip setuptools wheel &&
            "$VENV_PY" -m pip install --quiet -r requirements.txt ||
            bad "pip install ไม่สำเร็จ"
    fi
fi
if [ -x "$VENV_PY" ] && "$VENV_PY" -c "import PIL, playwright, httpx, dotenv, smartcard" 2>/dev/null; then
    ok ".venv พร้อม (Pillow, playwright, httpx, dotenv, pyscard)"
else
    bad ".venv ยังไม่พร้อม — รันใหม่โดยไม่ใส่ --skip-venv"
fi

# Face check (optional, off unless KIOSK_FACE_CHECK is set): OpenCV + the model files.
if [ -x "$VENV_PY" ] && "$VENV_PY" -c "import cv2, numpy" 2>/dev/null; then
    ok "OpenCV พร้อม (ตรวจใบหน้า)"
else
    warn "ยังไม่มี OpenCV ใน .venv — ต้องใช้เมื่อเปิด KIOSK_FACE_CHECK (pip install -r requirements.txt)"
fi
if $STATUS_ONLY; then
    ./models/download_models.sh --check >/dev/null && ok "model ตรวจใบหน้าครบ" ||
        warn "ยังไม่มี model ตรวจใบหน้า — รัน ./models/download_models.sh (ต้องใช้เมื่อเปิด KIOSK_FACE_CHECK)"
else
    ./models/download_models.sh && ok "model ตรวจใบหน้าพร้อม" ||
        warn "ดาวน์โหลด model ตรวจใบหน้าไม่สำเร็จ — รัน ./models/download_models.sh ใหม่เมื่อมีเน็ต (ต้องใช้เมื่อเปิด KIOSK_FACE_CHECK)"
fi

# ------------------------------------------------------------------------------
section "4) .env (เฉพาะค่าฮาร์ดแวร์ — ไม่แตะ secret)"
if [ ! -f "$ENV_FILE" ]; then
    if $STATUS_ONLY; then
        bad "ยังไม่มี .env"
    else
        cp .env.example "$ENV_FILE" && ok "สร้าง .env จาก .env.example"
    fi
fi
if [ -f "$ENV_FILE" ]; then
    for pair in "${ENV_DEFAULTS[@]}"; do
        key="${pair%%=*}"
        current="$(env_value "$key")"
        if [ -n "$current" ]; then
            ok "$key=$current"
        elif $STATUS_ONLY; then
            warn "$key ยังไม่ได้ตั้ง (ค่าแนะนำ ${pair#*=})"
        else
            printf '%s\n' "$pair" >>"$ENV_FILE" && ok "$pair (เพิ่มใหม่)"
        fi
    done
    $STATUS_ONLY || chmod 600 "$ENV_FILE"
    [ "$(stat -c '%a' "$ENV_FILE")" = "600" ] && ok ".env สิทธิ์ 600" || warn ".env ควรเป็นสิทธิ์ 600 (chmod 600 .env)"
    # Report only whether credentials look filled in — values are never printed.
    for key in TENT_BASE_URL DEVICE_ID DEVICE_SECRET; do
        value="$(env_value "$key")"
        if [ -z "$value" ] || [[ "$value" == *"<"* ]]; then
            bad "$key ยังไม่ได้กรอก — คัดลอกจาก System Management (สร้างอุปกรณ์ใหม่) แล้วแก้ใน .env"
        else
            ok "$key กรอกแล้ว"
        fi
    done
fi

# ------------------------------------------------------------------------------
section "5) สิทธิ์ printer (group lp)"
if in_group lp; then
    ok "$KIOSK_USER อยู่ใน group lp"
elif $STATUS_ONLY; then
    bad "$KIOSK_USER ไม่อยู่ใน group lp"
else
    sudo usermod -aG lp "$KIOSK_USER" && ok "เพิ่ม $KIOSK_USER เข้า group lp" || bad "เพิ่ม group lp ไม่สำเร็จ"
fi

# ------------------------------------------------------------------------------
section "6) สิทธิ์เครื่องอ่านบัตร (udev)"
if $STATUS_ONLY; then
    ./setup_card_reader.sh --status
else
    ./setup_card_reader.sh || bad "setup_card_reader.sh ไม่สำเร็จ"
fi
[ -f /etc/udev/rules.d/70-tent-card-reader.rules ] ||
    bad "ยังไม่มี udev rule ของเครื่องอ่านบัตร (./setup_card_reader.sh)"
in_group plugdev || bad "$KIOSK_USER ไม่อยู่ใน group plugdev (./setup_card_reader.sh)"

# ------------------------------------------------------------------------------
section "7) ปิด cups-browsed (กัน printer ในเครือข่ายโผล่เข้ามาเอง)"
if ! systemctl list-unit-files cups-browsed.service >/dev/null 2>&1 ||
    ! systemctl list-unit-files cups-browsed.service | grep -q cups-browsed; then
    ok "ไม่มี cups-browsed"
elif [ "$(systemctl is-enabled cups-browsed 2>/dev/null)" = "disabled" ] ||
    [ "$(systemctl is-enabled cups-browsed 2>/dev/null)" = "masked" ]; then
    ok "cups-browsed ปิดอยู่แล้ว"
elif $STATUS_ONLY; then
    warn "cups-browsed ยังเปิดอยู่"
else
    sudo systemctl disable --now cups-browsed && ok "ปิด cups-browsed แล้ว" || warn "ปิด cups-browsed ไม่สำเร็จ"
fi

# ------------------------------------------------------------------------------
section "8) เปิด kiosk อัตโนมัติตอนบูต"
if $STATUS_ONLY; then
    ./setup_autostart.sh --status
else
    ./setup_autostart.sh || bad "setup_autostart.sh ไม่สำเร็จ"
fi
[ -f "$HOME/.config/autostart/smart-shelter-kiosk.desktop" ] ||
    bad "ยังไม่ได้ตั้ง autostart (./setup_autostart.sh)"

# ------------------------------------------------------------------------------
section "9) ไม่ให้เครื่อง sleep / จอดับ"
SLEEP_TARGETS=(sleep.target suspend.target hibernate.target hybrid-sleep.target)
if [ "$(systemctl is-enabled suspend.target 2>/dev/null)" = "masked" ]; then
    ok "ปิด sleep/suspend ของระบบแล้ว"
elif $STATUS_ONLY; then
    warn "ระบบยัง sleep/suspend ได้"
else
    sudo systemctl mask "${SLEEP_TARGETS[@]}" >/dev/null 2>&1 && ok "ปิด sleep/suspend ของระบบ" ||
        warn "ปิด sleep/suspend ไม่สำเร็จ"
fi

desktop="${XDG_CURRENT_DESKTOP:-}"
session="${XDG_SESSION_TYPE:-}"
info "desktop: ${desktop:-ไม่ทราบ} · session: ${session:-ไม่ทราบ}"
if [[ "${desktop^^}" == *GNOME* ]]; then
    if $STATUS_ONLY; then
        [ "$(gsettings get org.gnome.desktop.session idle-delay 2>/dev/null)" = "uint32 0" ] &&
            ok "GNOME: จอไม่ดับ" || warn "GNOME: จอยังดับเองได้"
    elif gsettings set org.gnome.desktop.session idle-delay 0 &&
        gsettings set org.gnome.desktop.screensaver lock-enabled false &&
        gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'; then
        ok "GNOME: ปิดจอดับ / ล็อกจอ / sleep"
    else
        warn "ตั้งค่า GNOME ไม่ได้ — รัน script นี้จาก terminal บนจอตู้ (ไม่ใช่ผ่าน SSH)"
    fi
fi
# X11 sessions (any desktop): turn off the screensaver and DPMS at every login.
if [ -f "$NO_BLANK_DESKTOP" ]; then
    ok "X11: xset s off -dpms ตอน login ($NO_BLANK_DESKTOP)"
elif $STATUS_ONLY; then
    if [ "$session" != "wayland" ]; then
        warn "ยังไม่ได้ตั้ง xset ตอน login"
    elif [[ "${desktop^^}" != *GNOME* ]]; then
        warn "Wayland ที่ไม่ใช่ GNOME — ตั้งค่าจอดับใน settings ของ desktop เอง"
    fi
else
    mkdir -p "$(dirname "$NO_BLANK_DESKTOP")"
    cat >"$NO_BLANK_DESKTOP" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=SmartShelter no screen blanking
Exec=sh -c 'xset s off; xset s noblank; xset -dpms'
X-GNOME-Autostart-enabled=true
NoDisplay=true
DESKTOP
    ok "X11: เพิ่ม xset s off -dpms ตอน login"
    [ -n "${DISPLAY:-}" ] && have xset && xset s off s noblank -dpms 2>/dev/null
    [ "$session" = "wayland" ] && [[ "${desktop^^}" != *GNOME* ]] &&
        warn "Wayland ที่ไม่ใช่ GNOME — xset ไม่มีผล ตั้งค่าจอดับใน settings ของ desktop เอง"
fi

# ------------------------------------------------------------------------------
if $TEST_PRINT; then
    section "ทดสอบพิมพ์ (app/escpos.py)"
    device=""
    for entry in /sys/class/usbmisc/lp*; do
        [ -e "$entry/device" ] || continue
        usb="$(dirname "$(readlink -f "$entry/device")")"
        [ "$(cat "$usb/idVendor"):$(cat "$usb/idProduct")" = "$PRINTER_ID" ] && device="/dev/usb/$(basename "$entry")"
    done
    if [ -z "$device" ]; then
        bad "ไม่พบ printer $PRINTER_ID — เปิดสวิตช์ printer แล้วลองใหม่"
    elif [ ! -x "$VENV_PY" ]; then
        bad "ไม่มี .venv — ทดสอบพิมพ์ไม่ได้"
    else
        width="$(env_value PRINTER_WIDTH_DOTS)"
        feed="$(env_value PRINTER_CUT_FEED_MM)"
        if "$VENV_PY" - "${width:-576}" "${feed:-15}" <<'PY' | sudo tee "$device" >/dev/null; then
import io, sys
from PIL import Image, ImageDraw
from app.escpos import label_to_escpos
width, feed = int(sys.argv[1]), int(sys.argv[2])
image = Image.new("L", (640, 480), 255)
draw = ImageDraw.Draw(image)
draw.rectangle((0, 0, 639, 479), outline=0, width=8)
draw.text((210, 220), f"SmartShelter test {width}dots feed {feed}mm", fill=0)
png = io.BytesIO()
image.save(png, "PNG")
sys.stdout.buffer.write(label_to_escpos(png.getvalue(), width, feed))
PY
            ok "ส่งหน้าทดสอบไป $device แล้ว (กรอบสูง 6 ซม. + ตัดกระดาษ)"
        else
            bad "ส่งหน้าทดสอบไป $device ไม่สำเร็จ"
        fi
    fi
fi

# ------------------------------------------------------------------------------
section "สรุป"
for item in "${FAILURES[@]}"; do echo -e "${RED}❌ $item${NC}"; done
for item in "${WARNINGS[@]}"; do echo -e "${YELLOW}⚠️  $item${NC}"; done
[ ${#FAILURES[@]} -eq 0 ] && [ ${#WARNINGS[@]} -eq 0 ] && ok "ทุกขั้นเรียบร้อย"

if ! $STATUS_ONLY; then
    echo
    info "ขั้นต่อไป:"
    if ! session_in_group lp || ! session_in_group plugdev; then
        echo "   1. รีบูต (sudo reboot) ให้สิทธิ์ group lp / plugdev มีผล"
    else
        echo "   1. (สิทธิ์ group มีผลแล้วใน session นี้)"
    fi
    echo "   2. กรอก TENT_BASE_URL / DEVICE_ID / DEVICE_SECRET ใน .env ถ้ายังไม่ได้กรอก"
    echo "   3. ตรวจอีกครั้ง: ./setup_big_kiosk.sh --status"
    echo "   4. ทดสอบเครื่องอ่านบัตร (ไม่ใช้ sudo): python3 inspect_card_rfpro.py ping"
    echo "   5. ทดสอบพิมพ์: ./setup_big_kiosk.sh --status --test-print"
    echo "   ⚠️  printer ยังตัดกระดาษยาว ~17 ซม./ใบ จนกว่าจะปิดโหมด black mark ที่ตัว printer (รอผู้ขาย)"
fi
[ ${#FAILURES[@]} -eq 0 ]
