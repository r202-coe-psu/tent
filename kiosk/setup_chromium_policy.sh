#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Chromium browser policy (no "Translate this page?" bubble)
# ------------------------------------------------------------------------------
# The kiosk page is Thai (lang="th-TH"); on a machine whose OS locale is not Thai, Chromium pops the
# translate bubble in the top-right corner. --disable-features=Translate (app/manager.py) is ignored
# by current Chromium builds, so this installs a managed policy (TranslateEnabled: false) instead.
# Policies under /etc/chromium/policies are read by the Debian / Pi OS build (/usr/bin/chromium)
# only — set BROWSER_EXECUTABLE_PATH=/usr/bin/chromium in .env. Applies when Chromium restarts.
# Idempotent: safe to run again. Uses sudo for the system change.
#
# Usage: ./setup_chromium_policy.sh [--status | --remove | --help]
#   (none)     install chromium-policy/tent-kiosk-browser.json
#   --status   check the installed policy, change nothing (exit 1 when missing or outdated)
#   --remove   delete the installed policy
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
POLICY_SRC="$SCRIPT_DIR/chromium-policy/tent-kiosk-browser.json"
POLICY_DST="/etc/chromium/policies/managed/tent-kiosk-browser.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
bad() { echo -e "${RED}❌ $*${NC}"; }

MODE="install"
while [ $# -gt 0 ]; do
    case "$1" in
    --status) MODE="status"; shift ;;
    --remove) MODE="remove"; shift ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) bad "ไม่รู้จัก option: $1 (ดู --help)" >&2; exit 1 ;;
    esac
done

show_status() {
    if [ ! -f "$POLICY_DST" ]; then
        bad "ยังไม่มี Chromium policy ($POLICY_DST) — bubble แปลภาษาจะยังเด้ง"
        return 1
    fi
    if ! cmp -s "$POLICY_SRC" "$POLICY_DST"; then
        warn "Chromium policy ไม่ตรงกับ $POLICY_SRC — รัน ./setup_chromium_policy.sh ใหม่"
        return 1
    fi
    ok "Chromium policy: ปิด bubble แปลภาษา ($POLICY_DST)"
    [ -x /usr/bin/chromium ] || warn "ไม่พบ /usr/bin/chromium — policy นี้ใช้กับ Chromium ของ Debian / Pi OS เท่านั้น"
    return 0
}

case "$MODE" in
status)
    show_status
    ;;
remove)
    sudo rm -f "$POLICY_DST"
    ok "ลบ $POLICY_DST แล้ว (มีผลเมื่อ Chromium เปิดใหม่)"
    ;;
install)
    sudo install -D -m 0644 "$POLICY_SRC" "$POLICY_DST"
    show_status
    echo "   ปิด/เปิด kiosk ใหม่ให้ Chromium อ่าน policy · ตรวจได้ที่ chrome://policy (โหมด debug)"
    ;;
esac
