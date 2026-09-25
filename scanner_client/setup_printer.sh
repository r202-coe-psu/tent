#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Label printer setup (Xprinter XP-365B, USB, CUPS) for Raspberry Pi
# ------------------------------------------------------------------------------
# ติดตั้ง driver ทางการของ Xprinter + ตั้งค่า CUPS ให้ปุ่ม "พิมพ์ QR Code" ของ kiosk
# พิมพ์ label ได้ทันที (Chromium --kiosk-printing → CUPS default queue → XP-365B)
# รันซ้ำได้ (idempotent) — ต้องรันใหม่ทุกครั้งที่ติดตั้ง/อัปเกรด .deb, เปลี่ยนเครื่อง หรือเปลี่ยนขนาดม้วน
#
# Usage: ./setup_printer.sh [printer-driver-xprinter_*.deb] [options]
#   --label WxH      ขนาด label เป็น mm (default: KIOSK_LABEL_MM ใน frontend print-label.ts)
#   --gap N          ระยะ gap ระหว่าง label ของม้วนจริง (mm, 0–10, default: 2)
#   --queue NAME     ชื่อ CUPS queue (default: PRINTER_NAME ใน .env หรือ tent_xprinter)
#   --test           พิมพ์ label ทดสอบ 1 ดวงหลังตั้งค่าเสร็จ (รันผ่าน SSH ได้)
#   --force          ยอมให้รันบนเครื่องที่ไม่ใช่ Raspberry Pi (จะลบ queue อื่นของ XP-365B!)
#   --status         แสดงสถานะการตั้งค่าแล้วออก (ไม่แก้อะไร)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
LABEL_TS="$SCRIPT_DIR/../frontend/src/lib/features/kiosk/domain/print-label.ts"
POLICY_SRC="$SCRIPT_DIR/chromium-policy/tent-kiosk-print.json"
POLICY_DST="/etc/chromium/policies/managed/tent-kiosk-print.json"
PPD="xprinter/XP-365B.ppd"
FILTER_DIR="/usr/lib/cups/filter"
TSPL_FILTER="$FILTER_DIR/rastertosnailtspl-xprinter"
WRAPPER_MARK="tent: wrapper"
MAX_WIDTH_MM=82
USB_ID="1fc9:2016"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${BLUE}▸ $*${NC}"; }
ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
bad() { echo -e "${RED}❌ $*${NC}"; }
die() {
    bad "$*" >&2
    exit 1
}

DEB=""
LABEL=""
GAP=2
QUEUE="${PRINTER_NAME:-}"
DO_TEST=false
FORCE=false
STATUS_ONLY=false

while [ $# -gt 0 ]; do
    case "$1" in
    --label) LABEL="${2:?--label ต้องเป็น WxH เช่น 80x60}"; shift 2 ;;
    --gap) GAP="${2:?--gap ต้องเป็นตัวเลข mm}"; shift 2 ;;
    --queue) QUEUE="${2:?--queue ต้องมีชื่อ}"; shift 2 ;;
    --test) DO_TEST=true; shift ;;
    --force) FORCE=true; shift ;;
    --status) STATUS_ONLY=true; shift ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) die "ไม่รู้จัก option: $1 (ดู --help)" ;;
    *)
        [ -z "$DEB" ] || die "ระบุไฟล์ .deb ได้ไฟล์เดียว"
        DEB="$(realpath "$1")"
        [ -f "$DEB" ] || die "ไม่พบไฟล์ $1"
        shift
        ;;
    esac
done

# --- Resolve settings ----------------------------------------------------------
if [ -z "$QUEUE" ] && [ -f "$SCRIPT_DIR/.env" ]; then
    QUEUE="$(sed -n 's/^PRINTER_NAME=//p' "$SCRIPT_DIR/.env" | tail -1 | tr -d '"'\''[:space:]')"
fi
QUEUE="${QUEUE:-tent_xprinter}"
[[ "$QUEUE" =~ ^[A-Za-z0-9_.-]+$ ]] || die "ชื่อ queue '$QUEUE' ใช้ได้เฉพาะ A-Z a-z 0-9 _ . -"

# Single source of truth for the label size = KIOSK_LABEL_MM (frontend @page is generated from it).
if [ -z "$LABEL" ]; then
    [ -f "$LABEL_TS" ] || die "ไม่พบ $LABEL_TS — ระบุ --label WxH เอง"
    LABEL="$(sed -nE 's/.*KIOSK_LABEL_MM = \{ width: ([0-9.]+), height: ([0-9.]+) \}.*/\1x\2/p' "$LABEL_TS")"
    [ -n "$LABEL" ] || die "อ่าน KIOSK_LABEL_MM จาก print-label.ts ไม่ได้ — ระบุ --label WxH เอง"
fi
[[ "$LABEL" =~ ^([0-9]+(\.[0-9]+)?)x([0-9]+(\.[0-9]+)?)$ ]] || die "--label ต้องเป็นรูปแบบ WxH (mm) เช่น 80x60"
LABEL_W="${BASH_REMATCH[1]}"
awk -v w="$LABEL_W" -v max="$MAX_WIDTH_MM" 'BEGIN { exit !(w > 0 && w <= max) }' ||
    die "label กว้าง ${LABEL_W} mm เกินหัวพิมพ์ XP-365B (${MAX_WIDTH_MM} mm)"
[[ "$GAP" =~ ^([0-9]|10)$ ]] || die "--gap ต้องเป็นจำนวนเต็ม 0–10 (mm)"

case "$(uname -m)" in # suffix ของ binary ใน .deb
aarch64) ARCH=aarch64 ;; # Pi OS 64-bit
armv7l) ARCH=armv7l ;;   # Pi OS 32-bit
x86_64) ARCH=x64 ;;      # dev laptop (--force)
*) die "ไม่รองรับ arch: $(uname -m)" ;;
esac

find_app_dir() {
    local dir
    for dir in /opt/xprinter_printer/printer-driver-xprinter /opt/xprinter/printer-driver-xprinter; do
        if [ -x "$dir/bin/rastertosnailtspl-$ARCH" ]; then
            echo "$dir"
            return 0
        fi
    done
    return 1
}

find_printer_uri() {
    lpinfo -v 2>/dev/null | awk '$2 ~ /^usb:\/\// && tolower($2) ~ /xprinter|xp-365/ {print $2; exit}'
}

# Every queue (ours included) whose device URI is the XP-365B.
xprinter_queues() {
    lpstat -v 2>/dev/null | awk 'tolower($NF) ~ /^usb:\/\/xprinter\/xp-365/ {sub(/:$/, "", $3); print $3}'
}

# lpoptions only reports "Custom.WIDTHxHEIGHT" for a custom size; the real value is in the queue PPD
# (/etc/cups/ppd is root:lp 0640).
queue_page_size() {
    sudo sed -n 's/^\*DefaultPageSize: *//p' "/etc/cups/ppd/$QUEUE.ppd" 2>/dev/null | tr -d '\r'
}

queue_option() { # queue_option <OptionName> → current default choice
    lpoptions -p "$QUEUE" -l 2>/dev/null | sed -nE "s/^$1\/[^:]*:.*\*([^ ]+).*/\1/p"
}

# --- --status ----------------------------------------------------------------
show_status() {
    local page_size shared queues crontab_out
    echo -e "${BLUE}=== Label printer status (queue: $QUEUE, label: ${LABEL} mm) ===${NC}"

    if lsusb 2>/dev/null | grep -qi "$USB_ID"; then ok "XP-365B ต่อ USB อยู่ ($USB_ID)"; else bad "ไม่พบ XP-365B บน USB ($USB_ID)"; fi
    if systemctl is-active --quiet cups; then ok "cups.service ทำงาน"; else bad "cups.service ไม่ทำงาน"; fi
    if [ -n "$(find_app_dir || true)" ]; then ok "driver ติดตั้งแล้ว ($(find_app_dir))"; else bad "ยังไม่ได้ติดตั้ง driver Xprinter"; fi

    if grep -qs "$WRAPPER_MARK" "$TSPL_FILTER"; then
        ok "TSPL filter เป็น wrapper ที่ลบภาพงานพิมพ์หลังทุก job"
    else
        bad "TSPL filter ไม่ใช่ wrapper ของ tent — ภาพ label จะค้างใน /tmp (รัน setup ซ้ำ)"
    fi

    if ! crontab_out="$(sudo crontab -l 2>&1)" && ! grep -q "no crontab" <<<"$crontab_out"; then
        warn "ตรวจ root crontab ไม่ได้ (ต้องใช้ sudo)"
    elif grep -q mvimg.sh <<<"$crontab_out"; then
        bad "root crontab ยังมี mvimg.sh (ย้ายภาพพิมพ์ไป /var/log/prnlog)"
    else
        ok "ไม่มี cron mvimg.sh"
    fi
    if [ -e /var/log/prnlog ]; then bad "/var/log/prnlog ยังอยู่"; else ok "ไม่มี /var/log/prnlog"; fi

    if lpstat -p "$QUEUE" >/dev/null 2>&1; then
        ok "มี queue $QUEUE"
        lpstat -p "$QUEUE" | sed 's/^/    /'
        page_size="$(queue_page_size || true)"
        if [ -z "$page_size" ]; then
            warn "อ่าน PageSize จาก /etc/cups/ppd/$QUEUE.ppd ไม่ได้ (ต้องใช้ sudo)"
        elif [ "$page_size" = "Custom.${LABEL}mm" ]; then
            ok "PageSize = $page_size"
        else
            bad "PageSize = $page_size (ต้องเป็น Custom.${LABEL}mm)"
        fi
        echo "    PaperType=$(queue_option PaperType) GapsHeight=$(queue_option GapsHeight) Darkness=$(queue_option Darkness) PrintSpeed=$(queue_option PrintSpeed)"
        shared="$(lpoptions -p "$QUEUE" 2>/dev/null | grep -o 'printer-is-shared=[a-z]*' || true)"
        if [ "$shared" = "printer-is-shared=false" ]; then ok "queue ไม่แชร์"; else bad "queue ${shared:-printer-is-shared=?}"; fi
    else
        bad "ไม่มี queue $QUEUE"
    fi
    if [ "$(lpstat -d 2>/dev/null | sed -nE 's/^system default destination: (.+)$/\1/p')" = "$QUEUE" ]; then
        ok "$QUEUE เป็น default printer"
    else
        bad "default printer ไม่ใช่ $QUEUE ($(lpstat -d 2>&1))"
    fi
    queues="$(xprinter_queues | tr '\n' ' ' || true)"
    if [ "$(xprinter_queues | wc -l)" -le 1 ]; then ok "มี queue ของ XP-365B queue เดียว"; else bad "มีหลาย queue ชี้ XP-365B: $queues"; fi

    if cupsctl 2>/dev/null | grep -qE '^_(remote_admin|remote_any|share_printers)=1'; then
        bad "CUPS เปิดให้เครื่องอื่นเข้าถึง: $(cupsctl | grep -E '^_(remote_admin|remote_any|share_printers)=' | tr '\n' ' ')"
    else
        ok "CUPS ปิด remote admin / remote any / sharing"
    fi
    if [ -f "$POLICY_DST" ]; then ok "Chromium policy ติดตั้งแล้ว ($POLICY_DST)"; else bad "ไม่มี Chromium policy ($POLICY_DST)"; fi
    if [ -x /usr/bin/chromium ]; then ok "มี /usr/bin/chromium"; else warn "ไม่มี /usr/bin/chromium — policy จะไม่มีผลกับ browser อื่น"; fi
    if id -nG | tr ' ' '\n' | grep -qx lpadmin; then
        ok "user $(id -un) อยู่กลุ่ม lpadmin (start_kiosk.sh enable queue ได้)"
    else
        warn "user $(id -un) ไม่อยู่กลุ่ม lpadmin — start_kiosk.sh จะ enable queue หลังกระดาษหมดไม่ได้"
    fi
}

if $STATUS_ONLY; then
    show_status
    exit 0
fi

# --- Guard: this script rewrites system-wide printer config ----------------------
if ! grep -qs "Raspberry Pi" /proc/device-tree/model && ! $FORCE; then
    die "เครื่องนี้ไม่ใช่ Raspberry Pi — script นี้ลบ queue อื่นของ XP-365B และติดตั้ง Chromium policy ทั้งระบบ
   บนเครื่อง dev ให้ใช้ ./test_label_print.sh --configure แทน (หรือใส่ --force ถ้าตั้งใจ)"
fi

echo -e "${BLUE}=== SmartShelter label printer setup: queue $QUEUE, label ${LABEL} mm, gap ${GAP} mm ===${NC}"

# 1) CUPS + tools
info "[1/7] ติดตั้ง CUPS + qrencode"
sudo apt-get install -y cups cups-client cups-filters qrencode
sudo systemctl enable --now cups
sudo cupsctl --no-remote-admin --no-remote-any --no-share-printers # FR-P16

# 2) Official Xprinter driver
info "[2/7] Driver Xprinter"
if [ -n "$DEB" ]; then
    if ! sudo apt-get install -y "$DEB"; then
        die "ติดตั้ง $DEB ไม่สำเร็จ — ถ้า apt แจ้งหา libcupsimage2 ไม่พบ (Pi OS Trixie): sudo apt-get install -y libcupsimage2t64 แล้วรันใหม่"
    fi
fi
APP_DIR="$(find_app_dir)" || die "ยังไม่ได้ติดตั้ง driver — รัน: ./setup_printer.sh <printer-driver-xprinter_*.deb>"
ok "driver: $APP_DIR (arch $ARCH)"

# 3) Filters: point to the right arch + wrap the TSPL filter so print images never stay on disk (FR-P14)
info "[3/7] ตั้งค่า filter + wrapper ลบภาพงานพิมพ์"
for f in ep ep2 tspl2 zpl zpl2 xpl ppli; do
    if [ -e "$APP_DIR/bin/rastertosnail${f}-${ARCH}" ]; then
        sudo ln -sfn "$APP_DIR/bin/rastertosnail${f}-${ARCH}" "$FILTER_DIR/rastertosnail${f}-xprinter"
    fi
done
sudo rm -f "$TSPL_FILTER"
sudo tee "$TSPL_FILTER" >/dev/null <<WRAP
#!/bin/sh
# $WRAPPER_MARK — the Xprinter filter writes every printed label (name + QR) to /tmp as a bitmap;
# delete them after each job. Re-created by scanner_client/setup_printer.sh.
"$APP_DIR/bin/rastertosnailtspl-${ARCH}" "\$@"
rc=\$?
rm -f /tmp/origin_*.bmp /tmp/dithered_*.bmp /tmp/prnimg_*.bmp /tmp/xxxxx.log
exit \$rc
WRAP
sudo chmod 0755 "$TSPL_FILTER"
sudo rm -f /tmp/origin_*.bmp /tmp/dithered_*.bmp /tmp/prnimg_*.bmp /tmp/xxxxx.log

# 4) Privacy: the driver's postinst adds a root cron that copies print images to /var/log/prnlog
info "[4/7] ลบ cron mvimg.sh + /var/log/prnlog"
{ sudo crontab -l 2>/dev/null || true; } | { grep -v 'mvimg.sh' || true; } | sudo crontab -
sudo rm -rf /var/log/prnlog

# 5) Find the printer (lpinfo scans backends slowly — retry)
info "[5/7] หา XP-365B บน USB"
URI="${PRINTER_URI:-}"
for _ in 1 2 3; do
    [ -n "$URI" ] && break
    URI="$(find_printer_uri || true)"
    [ -n "$URI" ] || sleep 3
done
if [ -z "$URI" ]; then
    lpinfo -v 2>/dev/null | grep usb || true
    die "ไม่พบ XP-365B บน USB — ตรวจสาย/ไฟ/ปุ่มเปิดเครื่อง (lsusb ต้องเห็น $USB_ID) หรือกำหนด PRINTER_URI"
fi
ok "URI: $URI"

# 6) One queue for the label printer, set as default (FR-P6, FR-P16, FR-P18, FR-P21)
info "[6/7] ตั้ง queue $QUEUE"
sudo lpadmin -p "$QUEUE" -E -v "$URI" -m "$PPD" \
    -D "Xprinter XP-365B (kiosk label)" \
    -o PageSize="Custom.${LABEL}mm" \
    -o MediaMethod=Direct -o PaperType=LabelGaps -o GapsHeight="$GAP" \
    -o PostAction=TearOff -o Occurrence=Every \
    -o Darkness=10 -o PrintSpeed=3 \
    -o printer-error-policy=abort-job \
    -o printer-is-shared=false -o job-sheets-default=none,none
for q in $(xprinter_queues); do
    if [ "$q" != "$QUEUE" ]; then
        info "ลบ queue ซ้ำ $q (สร้างโดย driver postinst)"
        sudo lpadmin -x "$q"
    fi
done
sudo lpadmin -d "$QUEUE"
sudo cupsenable "$QUEUE"
sudo cupsaccept "$QUEUE"

# 7) Chromium managed policy: no header/footer, default printer, no "Save as PDF" (FR-P10, FR-P15)
info "[7/7] ติดตั้ง Chromium policy"
sudo install -D -m 0644 "$POLICY_SRC" "$POLICY_DST"

echo
show_status

if $DO_TEST; then
    echo
    info "พิมพ์ label ทดสอบ (payload ไม่ใช่ข้อมูลจริง)"
    TEST_PNG="$(mktemp --suffix=.png)"
    qrencode -s 8 -m 4 -o "$TEST_PNG" 'evacuee:TEST-PRINT'
    lp -d "$QUEUE" -o fit-to-page "$TEST_PNG"
    rm -f "$TEST_PNG"
    ok "ส่งงานแล้ว — ต้องออก 1 ดวงพอดี ไม่คร่อมรอยฉีก และ QR สแกนได้"
fi

echo
ok "เสร็จ — ตั้ง PRINTER_NAME=$QUEUE ใน scanner_client/.env แล้วรีบูต (หรือรัน ./test_label_print.sh จากหน้าจอ Pi)"
