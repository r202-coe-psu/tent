#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Card reader permission setup (RFpro HID module, e.g. kiosk3 HOUSESmart)
# ------------------------------------------------------------------------------
# /dev/hidraw* is root-only (0600) on Debian, so the kiosk (running as a normal user) cannot open
# the card reader and keeps logging "Waiting for Smart Card Reader hardware (rfpro): no permission".
# This installs one udev rule that gives the chosen group read/write on THIS reader only
# (matched by VID:PID), adds the user to that group and re-applies it to the plugged-in device.
# Idempotent: safe to run again. Uses sudo for the system changes.
#
# Usage: ./setup_card_reader.sh [options]
#   --user NAME      user that runs the kiosk (default: current user)
#   --group NAME     group that gets access (default: plugdev)
#   --usb-id V:P     reader VID:PID (default: CARD_READER_USB_ID in .env, else 0483:4c43)
#   --status         show rule / device permissions / group / .env, change nothing
#   --remove         delete the udev rule
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
RULE_FILE="/etc/udev/rules.d/70-tent-card-reader.rules"
DEFAULT_USB_ID="0483:4c43"

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

TARGET_USER="${SUDO_USER:-$(id -un)}"
GROUP="plugdev"
USB_ID=""
MODE="install"

while [ $# -gt 0 ]; do
    case "$1" in
    --user) TARGET_USER="${2:?--user ต้องมีชื่อ user}"; shift 2 ;;
    --group) GROUP="${2:?--group ต้องมีชื่อ group}"; shift 2 ;;
    --usb-id) USB_ID="${2:?--usb-id ต้องเป็น VID:PID}"; shift 2 ;;
    --status) MODE="status"; shift ;;
    --remove) MODE="remove"; shift ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "ไม่รู้จัก option: $1 (ดู --help)" ;;
    esac
done

env_value() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"'\''[:space:]'
}

if [ -z "$USB_ID" ]; then
    USB_ID="$(env_value CARD_READER_USB_ID)"
fi
USB_ID="$(echo "${USB_ID:-$DEFAULT_USB_ID}" | tr 'A-F' 'a-f')"
[[ "$USB_ID" =~ ^([0-9a-f]{4}):([0-9a-f]{4})$ ]] || die "USB id '$USB_ID' ต้องเป็น VID:PID ฐาน 16 เช่น 0483:4c43"
VID="${BASH_REMATCH[1]}"
PID="${BASH_REMATCH[2]}"
[[ "$GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "ชื่อ group '$GROUP' ไม่ถูกต้อง"
id "$TARGET_USER" >/dev/null 2>&1 || die "ไม่พบ user '$TARGET_USER'"

RULE="SUBSYSTEM==\"hidraw\", ATTRS{idVendor}==\"$VID\", ATTRS{idProduct}==\"$PID\", GROUP=\"$GROUP\", MODE=\"0660\""

# hidraw nodes of this reader (it exposes more than one interface).
reader_nodes() {
    local h id
    id="$(echo "0003:0000$VID:0000$PID" | tr 'a-f' 'A-F')"
    for h in /sys/class/hidraw/hidraw*; do
        [ -e "$h/device/uevent" ] || continue
        if grep -qi "^HID_ID=$id$" "$h/device/uevent"; then
            echo "/dev/$(basename "$h")"
        fi
    done
}

user_in_group() { id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx "$GROUP"; }

show_status() {
    echo
    info "เครื่องอ่านบัตร $USB_ID · user $TARGET_USER · group $GROUP"
    if [ -f "$RULE_FILE" ] && grep -qF "$RULE" "$RULE_FILE"; then
        ok "udev rule: $RULE_FILE"
    elif [ -f "$RULE_FILE" ]; then
        warn "udev rule มีอยู่แต่ไม่ตรงกับค่าที่ต้องการ: $RULE_FILE (รัน ./setup_card_reader.sh ใหม่)"
    else
        bad "ยังไม่มี udev rule ($RULE_FILE)"
    fi

    local nodes node perms owner group_of all_ok=true
    nodes="$(reader_nodes)"
    if [ -z "$nodes" ]; then
        bad "ไม่พบ /dev/hidraw* ของ $USB_ID — เสียบ USB ของโมดูลเครื่องอ่านบัตร"
        all_ok=false
    fi
    for node in $nodes; do
        perms="$(stat -c '%A' "$node")"
        owner="$(stat -c '%U' "$node")"
        group_of="$(stat -c '%G' "$node")"
        if [ "$group_of" = "$GROUP" ] && [[ "$perms" == crw-rw* ]]; then
            ok "$node $perms $owner:$group_of"
        else
            bad "$node $perms $owner:$group_of (ต้องเป็น crw-rw---- root:$GROUP)"
            all_ok=false
        fi
    done

    if user_in_group; then
        ok "$TARGET_USER อยู่ใน group $GROUP"
    else
        bad "$TARGET_USER ไม่อยู่ใน group $GROUP"
        all_ok=false
    fi
    # Group changes only apply to new login sessions.
    if [ "$TARGET_USER" = "$(id -un)" ] && ! id -nG | tr ' ' '\n' | grep -qx "$GROUP"; then
        warn "session นี้ยังไม่ได้สิทธิ์ group $GROUP — logout/login หรือรีบูต แล้ว restart kiosk"
    fi

    case "$(env_value CARD_READER)" in
    rfpro) ok ".env: CARD_READER=rfpro" ;;
    "") warn ".env ไม่ได้ตั้ง CARD_READER (default = pcsc) — เพิ่ม CARD_READER=rfpro" ;;
    *) warn ".env: CARD_READER=$(env_value CARD_READER) — kiosk3 ต้องเป็น rfpro" ;;
    esac

    $all_ok && ok "พร้อม: user $TARGET_USER เปิดเครื่องอ่านบัตรได้โดยไม่ต้อง sudo"
    return 0
}

reload_udev() {
    sudo udevadm control --reload
    sudo udevadm trigger --subsystem-match=hidraw --action=change
    sudo udevadm settle --timeout=5 || true
}

case "$MODE" in
status)
    show_status
    exit 0
    ;;
remove)
    if [ -f "$RULE_FILE" ]; then
        sudo rm -f "$RULE_FILE"
        reload_udev
        ok "ลบ $RULE_FILE แล้ว (สิทธิ์ของ /dev/hidraw* กลับเป็น root-only)"
    else
        info "ไม่มี $RULE_FILE อยู่แล้ว"
    fi
    exit 0
    ;;
esac

# --- install --------------------------------------------------------------------
info "ติดตั้งสิทธิ์เครื่องอ่านบัตร $USB_ID ให้ user $TARGET_USER (group $GROUP)"

if ! getent group "$GROUP" >/dev/null; then
    info "สร้าง group $GROUP"
    sudo groupadd "$GROUP"
fi

if user_in_group; then
    ok "$TARGET_USER อยู่ใน group $GROUP แล้ว"
else
    sudo usermod -aG "$GROUP" "$TARGET_USER"
    ok "เพิ่ม $TARGET_USER เข้า group $GROUP"
fi

if [ -f "$RULE_FILE" ] && [ "$(cat "$RULE_FILE")" = "$RULE" ]; then
    ok "udev rule เป็นค่าล่าสุดแล้ว: $RULE_FILE"
else
    echo "$RULE" | sudo tee "$RULE_FILE" >/dev/null
    sudo chmod 0644 "$RULE_FILE"
    ok "เขียน udev rule: $RULE_FILE"
fi

reload_udev
show_status

echo
info "ขั้นต่อไป:"
echo "   1. logout/login หรือรีบูต (ให้ user ได้สิทธิ์ group $GROUP)"
echo "   2. ทดสอบโดยไม่ใช้ sudo: python3 inspect_card_rfpro.py ping"
echo "   3. restart kiosk: ./start_kiosk.sh (หรือรีบูตถ้าใช้ autostart)"
