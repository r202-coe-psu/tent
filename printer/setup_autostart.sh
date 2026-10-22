#!/usr/bin/env bash
# ==============================================================================
# tent-printer — เปิด agent อัตโนมัติหลัง boot (PoC, แบบเดียวกับ kiosk/setup_autostart.sh)
# ใช้ systemd แทน desktop autostart: Pi ที่เป็น print server ไม่มีจอ/ไม่มีคน login ก็ขึ้นได้
# และถ้า agent ล้มจะถูก restart เองใน 5 วินาที
#
# รัน ./run.sh จากโฟลเดอร์นี้ด้วย user ปัจจุบัน (ไม่ต้องย้ายโค้ดไป /opt แบบ setup_printer_server.sh)
#
# Usage: ./setup_autostart.sh [--status | --disable] [--dry-run]
#   (ไม่ใส่)    ติดตั้ง + เปิดใช้งานทันที
#   --status    ดูสถานะ service และ log ล่าสุด
#   --disable   หยุดและเอา service ออก (กลับไปรัน ./run.sh เองได้)
#   --dry-run   พิมพ์คำสั่งที่จะรัน แทนการรันจริง
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
UNIT="tent-printer-autostart.service"
UNIT_PATH="/etc/systemd/system/$UNIT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

die() { echo -e "${RED}❌ $*${NC}" >&2; exit 1; }
ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }

ACTION=install
DRY_RUN=false
while [ $# -gt 0 ]; do
    case "$1" in
    --status | -s) ACTION=status; shift ;;
    --disable | --remove | -d) ACTION=disable; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help | -h) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "ไม่รู้จักตัวเลือก: $1 (ดู --help)" ;;
    esac
done

# Run a mutating command, or only print it with --dry-run.
run() {
    if $DRY_RUN; then
        echo "[dry-run] $*"
    else
        "$@"
    fi
}

# Under sudo, run the agent as the person who called sudo, never as root.
AGENT_USER="${SUDO_USER:-${USER:-$(id -un)}}"

unit_text() {
    cat <<EOF
[Unit]
Description=Tent print agent (autostart from $SCRIPT_DIR)
After=network-online.target cups.service
Wants=network-online.target cups.service

[Service]
User=$AGENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

install_autostart() {
    [ -f "$SCRIPT_DIR/.env" ] || die "ไม่พบ $SCRIPT_DIR/.env — cp .env.example .env แล้วใส่ TENT_BASE_URL / DEVICE_ID / DEVICE_SECRET / PRINTER_NAME ก่อน"
    [ "$AGENT_USER" != root ] || die "อย่ารัน agent ด้วย root — รันสคริปต์นี้ด้วย user ปกติ (สคริปต์เรียก sudo เอง)"

    if ! $DRY_RUN && systemctl is-enabled --quiet tent-printer.service 2>/dev/null; then
        warn "มี tent-printer.service (ติดตั้งจริง Phase 5) เปิดอยู่ — agent สองตัวจะแย่งงานกัน: sudo systemctl disable --now tent-printer"
    fi

    # Build .venv now (as this user), so the first boot doesn't wait on pip.
    run "$SCRIPT_DIR/run.sh" --setup

    if $DRY_RUN; then
        echo "[dry-run] sudo tee $UNIT_PATH <<"
        unit_text
    else
        unit_text | sudo tee "$UNIT_PATH" >/dev/null
    fi
    run sudo systemctl daemon-reload
    run sudo systemctl enable --now "$UNIT"

    ok "ตั้งค่า autostart แล้ว: agent รันด้วย user $AGENT_USER และขึ้นเองทุกครั้งที่ boot"
    echo "   ดู log:  journalctl -u $UNIT -f"
    echo "   สถานะ:  ./setup_autostart.sh --status"
    echo "   ปิด:    ./setup_autostart.sh --disable   (ก่อนรัน ./run.sh เอง ไม่งั้นจะมี agent สองตัว)"
}

disable_autostart() {
    run sudo systemctl disable --now "$UNIT"
    run sudo rm -f "$UNIT_PATH"
    run sudo systemctl daemon-reload
    ok "ปิด autostart แล้ว — รัน ./run.sh เองได้"
}

status_autostart() {
    if [ ! -f "$UNIT_PATH" ]; then
        warn "ยังไม่ได้ติดตั้ง ($UNIT_PATH) — รัน ./setup_autostart.sh"
        return 0
    fi
    echo "enabled: $(systemctl is-enabled "$UNIT" 2>/dev/null || true)"
    echo "active:  $(systemctl is-active "$UNIT" 2>/dev/null || true)"
    echo "--- log 10 บรรทัดล่าสุด ---"
    journalctl -u "$UNIT" -n 10 --no-pager 2>/dev/null || warn "อ่าน log ไม่ได้ — ลอง sudo journalctl -u $UNIT -n 10"
}

case "$ACTION" in
install) install_autostart ;;
disable) disable_autostart ;;
status) status_autostart ;;
esac
