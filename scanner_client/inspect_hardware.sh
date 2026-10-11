#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Hardware inspection (QR reader, printer, card reader, serial, camera, display)
# ------------------------------------------------------------------------------
# ตรวจฮาร์ดแวร์ทั้งตู้ในรอบเดียว แล้วสรุปว่าอุปกรณ์ไหนใช้กับ scanner_client ได้/ยังขาดอะไร
# ค่าเริ่มต้นเป็น read-only — ไม่ติดตั้ง/ไม่แก้ค่าใดๆ และไม่ส่งข้อมูลไปที่พอร์ต
# บันทึกผล (ไม่มีสี) ลงไฟล์ report เพื่อส่งต่อให้ทีม dev
#
# Usage: sudo ./inspect_hardware.sh [options]
#   --probe-printer  ยิงคำสั่ง ESC/POS ไปที่ serial (ttyS/ttyUSB/ttyACM) ทุก baud ที่ใช้บ่อย + /dev/lp*
#                    → ถามสถานะ (DLE EOT 1) และ "พิมพ์กระดาษทดสอบ" (ข้อความบอกพอร์ต/baud ที่ถูก)
#   --qr             รอให้ยิง QR 1 ครั้ง (15 วิ) — อ่านจาก hidraw ของ CROWN (ใช้ผ่าน SSH ได้) + บอกว่ามี Enter ต่อท้ายไหม
#   --test-printer   พิมพ์หน้าทดสอบ ESC/POS ที่ printer USB ในตู้: ภาพ raster (วิธีเดียวกับที่ระบบจะใช้),
#                    ไม้บรรทัดวัดความกว้างกระดาษ, QR แบบ native (GS ( k) แล้วตัดกระดาษ
#   --no-network     ข้ามการตรวจเน็ต/SSL ไป GitHub
#   --out FILE       ที่เก็บ report (default: /tmp/kiosk-hw-<hostname>-<เวลา>.txt)
# ==============================================================================
set -uo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${BLUE}▸ $*${NC}"; }
ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
bad() { echo -e "${RED}❌ $*${NC}"; }
section() { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }
have() { command -v "$1" >/dev/null 2>&1; }

PROBE_PRINTER=false
TEST_PRINTER=false
TEST_QR=false
CHECK_NET=true
REPORT="/tmp/kiosk-hw-$(hostname)-$(date +%Y%m%d-%H%M%S).txt"

while [ $# -gt 0 ]; do
    case "$1" in
    --probe-printer) PROBE_PRINTER=true; shift ;;
    --qr) TEST_QR=true; shift ;;
    --test-printer) TEST_PRINTER=true; shift ;;
    --no-network) CHECK_NET=false; shift ;;
    --out) REPORT="${2:?--out ต้องมีชื่อไฟล์}"; shift 2 ;;
    -h | --help) sed -n '2,18p' "$0"; exit 0 ;;
    *) bad "ไม่รู้จัก option: $1 (ดู --help)"; exit 1 ;;
    esac
done

IS_ROOT=false
[ "$(id -u)" -eq 0 ] && IS_ROOT=true
RUN_USER="${SUDO_USER:-$USER}"

# Terminal keeps colors; the report file gets them stripped.
exec > >(tee >(sed -u 's/\x1b\[[0-9;]*m//g' >"$REPORT")) 2>&1

# Known devices (VID:PID) — keep in sync with setup_printer.sh / README.
XP365B_ID="1fc9:2016"
CROWN_QR_ID="0461:4d81"      # kiosk3: CROWN Barcode KeyBorad FS (HID keyboard wedge) — lsusb mislabels as a Dell mouse
KIOSK_ESCPOS_ID="28e9:5812"  # kiosk3: built-in receipt printer with cutter ("Printer in FS Mode", usblp)
HOUSESMART_ID="0483:4c43"    # kiosk3: card reader module (YE XIN EF-011C socket) — vendor HID protocol (0xAA frames), not CCID

FOUND_QR=""
FOUND_PRINTER=""
FOUND_CARD=""
REAL_SERIAL=()
NOTES=()

usb_class_name() {
    case "$1" in
    01) echo "Audio" ;; 02) echo "CDC" ;; 03) echo "HID" ;; 06) echo "Image" ;;
    07) echo "Printer" ;; 08) echo "Storage" ;; 09) echo "Hub" ;; 0a) echo "CDC-Data" ;;
    0b) echo "SmartCard" ;; 0e) echo "Video" ;; e0) echo "Wireless" ;; ef) echo "Misc" ;;
    ff) echo "Vendor" ;; *) echo "0x$1" ;;
    esac
}

# ------------------------------------------------------------------------------
section "ระบบ"
echo "host:    $(hostname)"
echo "date:    $(date '+%F %T %z')"
echo "user:    $RUN_USER (root=$IS_ROOT)"
echo "kernel:  $(uname -r) ($(uname -m))"
[ -r /etc/os-release ] && echo "os:      $(. /etc/os-release && echo "$PRETTY_NAME")"
[ -r /sys/class/dmi/id/board_vendor ] &&
    echo "board:   $(cat /sys/class/dmi/id/board_vendor 2>/dev/null) $(cat /sys/class/dmi/id/board_name 2>/dev/null)"
echo "groups:  $(id -nG "$RUN_USER")"
for g in dialout lp; do
    id -nG "$RUN_USER" | grep -qw "$g" ||
        warn "$RUN_USER ไม่อยู่ใน group '$g' → ใช้ serial/printer ไม่ได้ถ้าไม่ sudo (sudo usermod -aG $g $RUN_USER แล้ว login ใหม่)"
done
$IS_ROOT || warn "ไม่ได้รันด้วย sudo — ข้อมูล serial port / dmesg / lpinfo จะไม่ครบ"

missing=()
for t in lsusb openssl curl lpstat pcsc_scan v4l2-ctl; do have "$t" || missing+=("$t"); done
if [ ${#missing[@]} -gt 0 ]; then
    warn "ไม่มีเครื่องมือ: ${missing[*]} — ส่วนที่เกี่ยวข้องจะถูกข้าม"
    echo "   ติดตั้ง: sudo apt install usbutils openssl curl cups-client pcsc-tools v4l-utils"
fi

# ------------------------------------------------------------------------------
section "อุปกรณ์ USB"
for dev in /sys/bus/usb/devices/*; do
    [ -f "$dev/idVendor" ] || continue
    vid="$(cat "$dev/idVendor")"
    pid="$(cat "$dev/idProduct")"
    [ "$vid" = "1d6b" ] && continue # root hubs
    id="$vid:$pid"
    name="$(cat "$dev/manufacturer" 2>/dev/null) $(cat "$dev/product" 2>/dev/null)"
    ifaces=""
    classes=" "
    for itf in "$dev/$(basename "$dev")":*; do
        [ -f "$itf/bInterfaceClass" ] || continue
        cls="$(cat "$itf/bInterfaceClass")"
        drv="$(basename "$(readlink "$itf/driver" 2>/dev/null)" 2>/dev/null)"
        classes+="$cls "
        ifaces+="$(usb_class_name "$cls")/${drv:-none} "
    done
    [[ "$classes" == " 09 " ]] && continue # plain hubs

    role=""
    if [ "$id" = "$XP365B_ID" ]; then
        role="Label printer XP-365B (รองรับใน setup_printer.sh)"
        FOUND_PRINTER="USB $id XP-365B"
    elif [ "$id" = "$CROWN_QR_ID" ]; then
        role="QR reader CROWN (keyboard wedge)"
        FOUND_QR="USB $id CROWN"
    elif [ "$id" = "$KIOSK_ESCPOS_ID" ]; then
        role="Receipt printer ESC/POS + cutter (ยังไม่รองรับใน setup_printer.sh)"
        FOUND_PRINTER="USB $id receipt printer"
    elif [ "$id" = "$HOUSESMART_ID" ]; then
        role="เครื่องอ่านบัตร HOUSESmart (HID โปรโตคอลเฉพาะ — ไม่ใช่ PC/SC, scard.py ใช้ไม่ได้)"
        FOUND_CARD="USB $id HOUSESmart (HID vendor protocol — ต้องมี protocol/SDK หรือสลับเป็น CCID)"
    elif [[ "$classes" == *" 07 "* ]]; then
        role="Printer (USB printer class)"
        FOUND_PRINTER="${FOUND_PRINTER:-USB $id $name}"
    elif [[ "$classes" == *" 0b "* ]]; then
        role="Smart card reader (CCID)"
        FOUND_CARD="USB $id $name"
    elif [[ "$classes" == *" 0e "* ]]; then
        role="Camera"
    elif [[ "$ifaces" =~ (cdc_acm|ch341|pl2303|ftdi_sio|cp210x) ]]; then
        role="USB-serial (อาจเป็น printer/เครื่องอ่าน — ดูส่วน Serial)"
    elif [[ "${name,,}" =~ (touch|ilitek) ]]; then
        role="Touchscreen"
    elif [[ "${name,,}" =~ (scan|barcode|qr|honeywell|zebra|newland|datalogic) ]]; then
        role="Barcode/QR reader?"
        FOUND_QR="${FOUND_QR:-USB $id $name}"
    fi
    printf '  %-10s %-45s %s\n' "$id" "${name:0:45}" "$ifaces"
    [ -n "$role" ] && echo -e "             ${GREEN}→ $role${NC}"
done

# ------------------------------------------------------------------------------
section "Input devices (HID / keyboard wedge)"
awk -F'"' '/^N: Name=/ {print "  " $2}' /proc/bus/input/devices 2>/dev/null
if ls /sys/class/hidraw/hidraw* >/dev/null 2>&1; then
    echo "  hidraw (อ่านข้อมูลดิบได้โดยไม่ต้องมี focus):"
    for h in /sys/class/hidraw/hidraw*; do
        echo "    /dev/$(basename "$h"): $(sed -n 's/^HID_NAME=//p' "$h/device/uevent" 2>/dev/null)"
    done
fi

# ------------------------------------------------------------------------------
section "Serial / Parallel ports"
# sysfs "type" is the UART type (0 = PORT_UNKNOWN = placeholder with no hardware); works without root
# and on kernels where /proc/tty/driver/serial is missing.
for t in /sys/class/tty/ttyS*; do
    [ -r "$t/type" ] || continue
    [ "$(cat "$t/type")" != "0" ] || continue
    p="/dev/$(basename "$t")"
    REAL_SERIAL+=("$p")
    echo "  $p  uart-type=$(cat "$t/type") io=$(cat "$t/port" 2>/dev/null) irq=$(cat "$t/irq" 2>/dev/null)"
done
# Modem lines (CTS/DSR/CD) asserted usually means something is plugged in and powered — root only.
if $IS_ROOT && [ -r /proc/tty/driver/serial ]; then
    while read -r line; do
        num="${line%%:*}"
        [[ "$num" =~ ^[0-9]+$ ]] && [[ "$line" != *"uart:unknown"* ]] || continue
        [[ "$line" =~ (CTS|DSR|CD) ]] &&
            echo -e "  /dev/ttyS$num ${GREEN}→ มีสัญญาณ handshake (${BASH_REMATCH[0]}) — น่าจะมีอุปกรณ์ต่ออยู่${NC}"
    done </proc/tty/driver/serial
fi
for p in /dev/ttyUSB* /dev/ttyACM*; do
    [ -e "$p" ] || continue
    REAL_SERIAL+=("$p")
    echo "  $p  ($(udevadm info -q property -n "$p" 2>/dev/null | sed -n 's/^ID_MODEL=//p'))"
done
[ ${#REAL_SERIAL[@]} -eq 0 ] && info "ไม่พบ serial port จริง"
for p in /dev/lp* /dev/usb/lp*; do [ -e "$p" ] && echo "  $p (parallel/USB printer)"; done
if $IS_ROOT; then
    dmesg 2>/dev/null | grep -E 'ttyS[0-9]+ at|parport[0-9]|usblp|lp[0-9]:' | sed 's/^/  dmesg: /'
fi

# ------------------------------------------------------------------------------
section "Printer (CUPS)"
if have lpstat; then
    timeout 10 lpstat -t 2>&1 | sed 's/^/  /'
    if $IS_ROOT && have lpinfo; then
        echo "  backend ที่มองเห็น:"
        timeout 20 lpinfo -v 2>/dev/null | grep -E '^direct|usb://|serial:|parallel:' | sed 's/^/    /'
    fi
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
if [ -x "$SCRIPT_DIR/setup_printer.sh" ] && [[ "$FOUND_PRINTER" == *XP-365B* ]]; then
    info "setup_printer.sh --status:"
    "$SCRIPT_DIR/setup_printer.sh" --status 2>&1 | sed 's/^/  /'
fi

# ------------------------------------------------------------------------------
section "เครื่องอ่านบัตร (PC/SC)"
if have systemctl; then
    echo "  pcscd: $(systemctl is-active pcscd.socket 2>/dev/null)/$(systemctl is-active pcscd 2>/dev/null) (socket/service)"
fi
if have pcsc_scan; then
    readers="$(timeout 5 pcsc_scan -r 2>&1 | grep -E '^ *[0-9]+:' || true)"
    if [ -n "$readers" ]; then
        echo "$readers" | sed 's/^/  /'
        FOUND_CARD="${FOUND_CARD:-PC/SC $(echo "$readers" | head -1 | sed 's/^ *[0-9]*: //')}"
    else
        echo "  pcsc_scan ไม่พบ reader"
    fi
fi

# ------------------------------------------------------------------------------
section "กล้อง"
if have v4l2-ctl; then
    v4l2-ctl --list-devices 2>/dev/null | sed 's/^/  /'
else
    for v in /sys/class/video4linux/video*; do
        [ -e "$v" ] && echo "  /dev/$(basename "$v"): $(cat "$v/name")"
    done
fi

# ------------------------------------------------------------------------------
section "จอแสดงผล"
if have xrandr && [ -n "${DISPLAY:-}" ]; then
    xrandr --query 2>/dev/null | grep -w connected | sed 's/^/  /'
else
    for c in /sys/class/drm/card*-*; do
        [ -f "$c/status" ] || continue
        [ "$(cat "$c/status")" = "connected" ] &&
            echo "  $(basename "$c"): connected $(head -1 "$c/modes" 2>/dev/null)"
    done
fi

# ------------------------------------------------------------------------------
if $CHECK_NET; then
    section "เครือข่าย / SSL"
    if have curl; then
        loc="$(curl -sI -m 8 http://neverssl.com 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')"
        if [ -n "$loc" ]; then
            warn "ถูก redirect ไป $loc → น่าจะติด captive portal (ต้อง login เน็ต)"
            NOTES+=("เน็ตติด captive portal: login ที่ $loc")
        fi
    fi
    if have openssl; then
        issuer="$(timeout 10 openssl s_client -connect github.com:443 -servername github.com </dev/null 2>/dev/null |
            openssl x509 -noout -issuer 2>/dev/null)"
        echo "  github.com $issuer"
        if [ -z "$issuer" ]; then
            bad "ต่อ github.com:443 ไม่ได้"
        elif ! [[ "$issuer" =~ (Sectigo|DigiCert|USERTrust) ]]; then
            warn "cert ไม่ได้ออกโดย CA ของ GitHub → เครือข่ายทำ SSL inspection (ใช้ git ผ่าน SSH หรือติดตั้ง CA องค์กร)"
            NOTES+=("SSL inspection: $issuer")
        else
            ok "SSL ไป GitHub ปกติ"
        fi
    fi
fi

# ------------------------------------------------------------------------------
if $TEST_QR; then
    section "ทดสอบ QR reader"
    # Prefer the reader's hidraw node: no terminal focus needed (works over SSH) and it shows
    # whether the scanner appends Enter. Falls back to reading the keyboard-wedge text from the tty.
    qr_hidraw=""
    for h in /sys/class/hidraw/hidraw*; do
        if grep -qi "^HID_ID=0003:0000${CROWN_QR_ID%%:*}:0000${CROWN_QR_ID##*:}$" "$h/device/uevent" 2>/dev/null; then
            qr_hidraw="/dev/$(basename "$h")"
            break
        fi
    done
    if [ -n "$qr_hidraw" ] && $IS_ROOT && have python3; then
        info "ยิง QR ภายใน 15 วินาที (อ่านจาก $qr_hidraw — ไม่ต้องมี focus)..."
        qr_out="$(python3 - "$qr_hidraw" <<'PY'
import os, select, sys, time

# USB HID keyboard usage IDs → US layout (what a keyboard-wedge scanner emits).
lo = "abcdefghijklmnopqrstuvwxyz1234567890"
up = "ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()"
sp = {44: " ", 45: "-", 46: "=", 47: "[", 48: "]", 49: "\\", 51: ";", 52: "'", 53: "`", 54: ",", 55: ".", 56: "/"}
ss = {44: " ", 45: "_", 46: "+", 47: "{", 48: "}", 49: "|", 51: ":", 52: '"', 53: "~", 54: "<", 55: ">", 56: "?"}
fd = os.open(sys.argv[1], os.O_RDONLY)
out, got, enter = [], False, "no"
presses = []  # key-press timestamps → inter-key gap (wedge vs human typing threshold)
deadline = time.monotonic() + 15
while (left := deadline - time.monotonic()) > 0:
    # After the first key, 0.5 s of silence ends the scan (covers scanners with no Enter suffix).
    ready, _, _ = select.select([fd], [], [], min(left, 0.5) if got else left)
    if not ready:
        if got:
            break
        continue
    rep = os.read(fd, 64)
    if len(rep) < 3 or rep[2] == 0:
        continue
    got = True
    presses.append(time.monotonic())
    shift = bool(rep[0] & 0x22)
    key = rep[2]
    if key in (40, 88):  # Enter / keypad Enter
        enter = "yes"
        break
    if 4 <= key <= 39:
        out.append((up if shift else lo)[key - 4])
    elif key in sp:
        out.append((ss if shift else sp)[key])
    else:
        out.append(f"<{key:02x}>")
gaps = [b - a for a, b in zip(presses, presses[1:])]
max_gap = f"{max(gaps) * 1000:.0f}" if gaps else "-"
print(f"{enter}\t{max_gap}\t{''.join(out)}")
PY
)"
        IFS=$'\t' read -r qr_enter qr_gap qr <<<"$qr_out"
    else
        info "ยิง QR ภายใน 15 วินาที (หน้าต่าง terminal นี้ต้องมี focus)..."
        qr=""
        qr_gap=""
        qr_enter="unknown"
        # read keeps partial input on timeout — that is the "no Enter suffix" case.
        if read -r -t 15 qr </dev/tty; then qr_enter="yes"; elif [ -n "$qr" ]; then qr_enter="no"; fi
    fi
    if [ -n "$qr" ]; then
        ok "ได้รับ ${#qr} ตัวอักษร: ${qr:0:80}"
        [ -n "${qr_gap:-}" ] && [ "$qr_gap" != "-" ] && info "ช่วงห่างระหว่างตัวอักษรสูงสุด: ${qr_gap} ms (ใช้ตั้ง KIOSK_QR_READER_MAX_GAP_MS)"
        case "$qr_enter" in
        yes) ok "scanner ส่ง Enter ต่อท้าย" ;;
        no) warn "scanner ไม่ส่ง Enter ต่อท้าย — หน้า kiosk ที่รอ Enter จะไม่รู้ว่าสแกนจบ (ตั้ง suffix CR/Enter ด้วย config barcode ในคู่มือ CROWN)" ;;
        esac
        [[ "$qr" == *"<"*">"* ]] && warn "มี key code ที่แปลงไม่ได้ (<xx>) — อาจเป็นอักษรนอก US layout"
        FOUND_QR="${FOUND_QR:-keyboard wedge (ไม่รู้ VID:PID)}"
    else
        bad "ไม่ได้รับข้อมูลภายใน 15 วินาที"
    fi
fi

# ------------------------------------------------------------------------------
if $TEST_PRINTER; then
    section "ทดสอบ printer ESC/POS (raster + QR + ตัดกระดาษ)"
    # usbmisc lpN → its USB device's VID:PID; picks the kiosk's built-in printer, not any USB printer.
    esc_dev=""
    for l in /sys/class/usbmisc/lp*; do
        [ -e "$l/device/../idVendor" ] || continue
        if [ "$(cat "$l/device/../idVendor"):$(cat "$l/device/../idProduct")" = "$KIOSK_ESCPOS_ID" ]; then
            esc_dev="/dev/usb/$(basename "$l")"
            break
        fi
    done
    if ! $IS_ROOT; then
        bad "ต้องรันด้วย sudo — ข้าม"
    elif [ -z "$esc_dev" ]; then
        bad "ไม่พบ printer $KIOSK_ESCPOS_ID — เปิด printer แล้วลองใหม่"
    elif ! have python3; then
        bad "ไม่มี python3 — ข้าม"
    else
        info "พิมพ์หน้าทดสอบไปที่ $esc_dev ..."
        if python3 - <<'PY' | timeout 10 tee "$esc_dev" >/dev/null; then
import sys

out = sys.stdout.buffer
ESC, GS = b"\x1b", b"\x1d"

def raster(width_dots: int, rows: list[bytes]) -> bytes:
    # GS v 0: 1-bit raster, MSB = leftmost dot — the same command an image backend would send.
    w = width_dots // 8
    return GS + b"v0\x00" + bytes([w & 0xFF, w >> 8, len(rows) & 0xFF, len(rows) >> 8]) + b"".join(rows)

def row(width_dots: int, black) -> bytes:
    data = bytearray(width_dots // 8)
    for x in range(width_dots):
        if black(x):
            data[x // 8] |= 0x80 >> (x % 8)
    return bytes(data)

W = 576  # 80 mm paper @ 203 dpi; a 58 mm head prints only the first 384 dots (or wraps)
bar = [row(W, lambda x: True)] * 24
ruler = [row(W, lambda x: x % 64 < 3 or 380 <= x < 388)] * 48

qr = b"evacuee:TEST-0001"
n = len(qr) + 3
out.write(ESC + b"@" + ESC + b"a\x00")
out.write(b"TENT kiosk printer test\n1) Width ruler: tick = 8 mm, thick tick = 48 mm\n")
out.write(raster(W, bar + ruler))
out.write(b"\nBar length = printable width (58mm paper ~48mm, 80mm ~72mm)\n\n")
out.write(b"2) Native QR (GS ( k) - should scan as evacuee:TEST-0001\n")
out.write(ESC + b"a\x01")
out.write(GS + b"(k\x04\x001A2\x00")             # model 2
out.write(GS + b"(k\x03\x001C\x06")              # module size 6 dots
out.write(GS + b"(k\x03\x001E1")                 # error correction M
out.write(GS + b"(k" + bytes([n & 0xFF, n >> 8]) + b"1P0" + qr)
out.write(GS + b"(k\x03\x001Q0")
out.write(b"\n" + ESC + b"a\x00" + b"(no QR above = no native QR; print as image instead)\n")
out.write(ESC + b"J\x78" + ESC + b"i")           # feed 15 mm past the cutter, cut (not GS V: black-mark tied)
PY
            ok "ส่งงานแล้ว — ดูกระดาษ:"
            echo "   1) แถบดำยาวกี่มม. = ความกว้างพิมพ์จริง (~48 มม. = กระดาษ 58, ~72 มม. = กระดาษ 80)"
            echo "      ถ้าแถบขาดเป็นสองบรรทัด/ภาพเพี้ยน = หัวพิมพ์แคบกว่า 576 dots (กระดาษ 58 มม.)"
            echo "   2) มี QR ไหม + ยิงด้วย CROWN ได้ evacuee:TEST-0001 ไหม"
            echo "   3) ตัดกระดาษหลังข้อความสุดท้ายโดยไม่ตัดข้อความ"
        else
            bad "ส่งงานไป $esc_dev ไม่สำเร็จ/timeout"
        fi
    fi
fi

if $PROBE_PRINTER; then
    section "Probe printer (ESC/POS)"
    if ! $IS_ROOT; then
        bad "ต้องรันด้วย sudo — ข้าม"
    else
        for p in "${REAL_SERIAL[@]}"; do
            for b in 9600 19200 38400 115200; do
                stty -F "$p" "$b" raw -echo cs8 -cstopb -parenb clocal -crtscts 2>/dev/null || continue
                # DLE EOT 1 = real-time status; any reply byte means a printer is listening at this baud.
                reply="$(timeout 2 bash -c "exec 3<>'$p'; printf '\x10\x04\x01' >&3; timeout 1 head -c 8 <&3" 2>/dev/null | od -An -tx1 | tr -d ' \n')"
                printf '\x1b@TEST %s %s baud\n\n\n\n' "$p" "$b" | timeout 3 tee "$p" >/dev/null 2>&1
                if [ -n "$reply" ]; then
                    ok "$p @ $b ตอบกลับ 0x$reply → น่าจะเป็น printer ESC/POS"
                    FOUND_PRINTER="${FOUND_PRINTER:-serial $p @ $b baud (ESC/POS)}"
                else
                    echo "  $p @ $b: ไม่ตอบ (ส่งข้อความทดสอบแล้ว — ดูว่ากระดาษออกไหม)"
                fi
                sleep 1
            done
        done
        for p in /dev/lp* /dev/usb/lp*; do
            [ -e "$p" ] || continue
            if printf '\x1b@TEST %s\n\n\n\n' "$p" | timeout 3 tee "$p" >/dev/null 2>&1; then
                echo "  $p: ส่งข้อความทดสอบแล้ว — ดูว่ากระดาษออกไหม"
            else
                echo "  $p: เขียนไม่ได้/timeout (ไม่มีอุปกรณ์ต่อ)"
            fi
        done
        info "ถ้ากระดาษออก ข้อความบนกระดาษจะบอกพอร์ตและ baud ที่ถูกต้อง"
    fi
fi

# ------------------------------------------------------------------------------
section "สรุป"
if [ -n "$FOUND_QR" ]; then ok "QR reader: $FOUND_QR"; else bad "QR reader: ไม่พบ"; fi
if [ -n "$FOUND_PRINTER" ]; then
    ok "Printer: $FOUND_PRINTER"
    [[ "$FOUND_PRINTER" == *XP-365B* ]] || warn "ไม่ใช่ XP-365B — setup_printer.sh ยังไม่รองรับรุ่นนี้"
else
    bad "Printer: ไม่พบใน USB/CUPS"
    if [ ${#REAL_SERIAL[@]} -gt 0 ] && ! $PROBE_PRINTER; then
        echo "   มี serial port: ${REAL_SERIAL[*]} → ลอง: sudo $0 --probe-printer"
    fi
fi
if [ -n "$FOUND_CARD" ]; then
    ok "เครื่องอ่านบัตร: $FOUND_CARD"
else
    bad "เครื่องอ่านบัตร: ไม่พบ (scard.py ต้องใช้ reader แบบ USB CCID ผ่าน pcscd)"
fi
for n in "${NOTES[@]}"; do warn "$n"; done

sleep 0.2 # let the tee/sed pipeline flush before printing the path
echo
ok "บันทึก report: $REPORT"
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$REPORT" 2>/dev/null
exit 0
