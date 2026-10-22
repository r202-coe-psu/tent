#!/bin/bash
# ==============================================================================
# Tent print agent - installer for a Raspberry Pi / kiosk machine
# ------------------------------------------------------------------------------
# Usage: sudo ./setup_printer_server.sh --env-file FILE --host-kind standalone|kiosk [options]
#   --env-file FILE     .env ของ agent (ได้จากสคริปต์ provision) — บังคับ; จะถูกวางเป็น <prefix>/.env (600)
#   --host-kind KIND    standalone = Pi แยก | kiosk = ใช้ queue ร่วมกับเครื่อง kiosk — บังคับ
#   --queue NAME        ชื่อ CUPS queue (default: PRINTER_NAME ใน --env-file หรือ tent_xprinter)
#   --prefix DIR        ที่ติดตั้ง (default: /opt/tent/printer)
#   --kiosk-env FILE    .env ของ kiosk ที่จะตรวจ PRINTER_BACKEND (default: /home/*/tent/kiosk/.env)
#   --allow-cupsenable  เพิ่ม tent-printer เข้ากลุ่ม lpadmin เพื่อให้สั่ง cupsenable ได้ (O-5; default ปิด)
#   --unit-dir DIR      ที่วาง systemd unit (default: /etc/systemd/system)
#   --dry-run           พิมพ์คำสั่งที่จะรัน แทนการรันจริง (ไม่ต้องเป็น root, ไม่เขียนอะไร)
#   --status            แสดงสถานะ unit / queue / log 5 บรรทัดล่าสุด แล้วออก (ไม่แก้อะไร)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SERVICE_USER=tent-printer
UNIT_NAME=tent-printer.service
DEFAULT_PREFIX=/opt/tent/printer

BLUE='\033[0;34m'
GREEN='\033[0;32m'
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

DRY_RUN=false
STATUS_ONLY=false
HOST_KIND=""
ENV_FILE=""
QUEUE=""
QUEUE_GIVEN=false
KIOSK_ENV=""
PREFIX="$DEFAULT_PREFIX"
UNIT_DIR=/etc/systemd/system
ALLOW_CUPSENABLE=false

while [ $# -gt 0 ]; do
    case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --status) STATUS_ONLY=true; shift ;;
    --host-kind) HOST_KIND="${2-}"; shift $(($# > 1 ? 2 : 1)) ;;
    --env-file) ENV_FILE="${2-}"; shift $(($# > 1 ? 2 : 1)) ;;
    --queue) QUEUE="${2-}"; QUEUE_GIVEN=true; shift $(($# > 1 ? 2 : 1)) ;;
    --prefix) PREFIX="${2-}"; shift $(($# > 1 ? 2 : 1)) ;;
    --kiosk-env) KIOSK_ENV="${2-}"; shift $(($# > 1 ? 2 : 1)) ;;
    --unit-dir) UNIT_DIR="${2-}"; shift $(($# > 1 ? 2 : 1)) ;;
    --allow-cupsenable) ALLOW_CUPSENABLE=true; shift ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "ไม่รู้จัก option: $1 (ดู --help)" ;;
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

# Value of KEY= in a dotenv-style file (last wins, edge whitespace and one pair of quotes stripped).
# Prints only that one value - never the rest of the file.
env_value() {
    sed -n "s/^$2=//p" "$1" | tail -1 | sed -E "s/^[[:space:]]+//; s/[[:space:]]+\$//; s/^([\"'])(.*)\1\$/\2/"
}

# --- Validate arguments (before anything is planned or touched) ------------------
if ! $STATUS_ONLY; then
    case "$HOST_KIND" in
    standalone | kiosk) ;;
    *) die "--host-kind ต้องเป็น standalone หรือ kiosk" ;;
    esac
fi
[[ "$PREFIX" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "--prefix ต้องเป็น path เต็มที่ใช้ได้เฉพาะ A-Z a-z 0-9 _ . / -"

if ! $STATUS_ONLY; then
    [ -n "$ENV_FILE" ] || die "--env-file จำเป็น: ระบุไฟล์ .env ของ agent (DEVICE_ID / DEVICE_SECRET จากสคริปต์ provision)"
    [ -f "$ENV_FILE" ] || die "ไม่พบไฟล์ --env-file: $ENV_FILE"
fi

if ! $QUEUE_GIVEN; then
    for candidate in "$ENV_FILE" "$PREFIX/.env"; do
        if [ -n "$candidate" ] && [ -r "$candidate" ]; then
            QUEUE="$(env_value "$candidate" PRINTER_NAME)"
            break
        fi
    done
    QUEUE="${QUEUE:-tent_xprinter}"
fi
[[ "$QUEUE" =~ ^[A-Za-z0-9_.-]+$ ]] || die "ชื่อ queue '$QUEUE' ใช้ได้เฉพาะ A-Z a-z 0-9 _ . -"

# --- --status: read-only report ---------------------------------------------------
if $STATUS_ONLY; then
    echo -e "${BLUE}=== Tent print agent status (queue: $QUEUE) ===${NC}"
    unit_state="$(systemctl is-active tent-printer 2>&1 || true)"
    if [ "$unit_state" = active ]; then ok "tent-printer: $unit_state"; else bad "tent-printer: $unit_state"; fi
    if queue_line="$(LC_ALL=C lpstat -p "$QUEUE" 2>&1)"; then
        ok "queue $QUEUE"
    else
        bad "queue $QUEUE ไม่พร้อม"
    fi
    # shellcheck disable=SC2001 # per-line prefix, not a substring replace
    sed 's/^/    /' <<<"$queue_line"
    info "log ล่าสุด 5 บรรทัด"
    journalctl -u tent-printer -n 5 --no-pager 2>&1 | sed 's/^/    /' || true
    exit 0
fi

# --- Preflight (real runs only: --dry-run must work anywhere without root) --------
if ! $DRY_RUN; then
    [ "$EUID" -eq 0 ] || die "ต้องรันด้วย root: sudo $0 ... (หรือใช้ --dry-run เพื่อดูแผน)"
    command -v uv >/dev/null || die "ไม่พบ uv — ติดตั้งก่อน: https://docs.astral.sh/uv/"
    command -v rsync >/dev/null || die "ไม่พบ rsync — sudo apt-get install -y rsync"
    command -v lpstat >/dev/null || die "ไม่พบ CUPS — รัน kiosk/setup_printer.sh --queue $QUEUE ก่อน"
    lpstat -p "$QUEUE" >/dev/null 2>&1 || die "ไม่พบ CUPS queue $QUEUE — รัน kiosk/setup_printer.sh --queue $QUEUE ก่อน"
fi

echo -e "${BLUE}=== Tent print agent setup: prefix $PREFIX, queue $QUEUE, host $HOST_KIND ===${NC}"

# 1) Service user (no login, no home; group lp so it can talk to the printer queue)
info "[1/6] user $SERVICE_USER"
if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    ok "user $SERVICE_USER มีอยู่แล้ว"
else
    run useradd --system --gid lp --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# 2) Code + locked dependencies. Code and .venv stay root-owned: the agent cannot rewrite itself.
#    scripts/ (provision_poc.py, enqueue.py hold CouchDB admin credentials) is deliberately NOT copied.
info "[2/6] ติดตั้งโค้ดที่ $PREFIX"
run install -d -m 0755 "$PREFIX"
run rsync -a --delete --exclude=__pycache__ "$SCRIPT_DIR/printer/" "$PREFIX/printer/"
run install -D -m 0644 "$SCRIPT_DIR/pyproject.toml" "$PREFIX/pyproject.toml"
run install -D -m 0644 "$SCRIPT_DIR/uv.lock" "$PREFIX/uv.lock"
# only-system: a downloaded interpreter would live under root's home, unreadable by the service user.
run uv sync --frozen --no-dev --python-preference only-system --project "$PREFIX"

# 3) Secret file: owner = service user, mode 600. Contents are never echoed.
info "[3/6] วาง .env (600, owner $SERVICE_USER)"
if [ "$ENV_FILE" -ef "$PREFIX/.env" ]; then # re-run pointing at the installed file: nothing to copy
    run chown "$SERVICE_USER:lp" "$PREFIX/.env"
    run chmod 600 "$PREFIX/.env"
else
    run install -m 600 -o "$SERVICE_USER" -g lp "$ENV_FILE" "$PREFIX/.env"
fi

# 4) Error policy + kiosk coexistence (plan §5.6)
info "[4/6] error policy"
if [ "$HOST_KIND" = standalone ]; then
    run lpadmin -p "$QUEUE" -o printer-error-policy=abort-job
else
    warn "ข้ามการตั้ง printer-error-policy=abort-job: queue $QUEUE ใช้ร่วมกับ kiosk บนเครื่องเดียวกัน"
    echo "   (kiosk พึ่ง cupsenable ใน start_kiosk.sh — ตกลงกับฝั่ง kiosk ก่อนค่อยตั้งเอง)"
    # If the kiosk drives the printer itself, it and this agent would both claim /dev/usb/lpN.
    kiosk_envs=("$KIOSK_ENV")
    [ -n "$KIOSK_ENV" ] || kiosk_envs=(/home/*/tent/kiosk/.env)
    for kiosk_env in "${kiosk_envs[@]}"; do
        [ -f "$kiosk_env" ] || continue
        if grep -Eq "^PRINTER_BACKEND=[\"']?escpos([\"']|[[:space:]]|$)" "$kiosk_env"; then
            warn "$kiosk_env ตั้ง PRINTER_BACKEND=escpos — kiosk จะแย่ง /dev/usb/lpN กับ CUPS; ต้องเป็น cups"
        fi
    done
fi

# 5) cupsenable rights (O-5 still open: off unless asked)
info "[5/6] สิทธิ์ cupsenable"
if $ALLOW_CUPSENABLE; then
    run usermod -aG lpadmin "$SERVICE_USER"
else
    echo "   ไม่ให้สิทธิ์ cupsenable (ใส่ --allow-cupsenable ถ้าต้องการ) — agent จะรายงาน queue_state=disabled ให้ server แทน"
fi

# 6) systemd unit (the shipped unit hardcodes /opt/tent/printer; rewrite it for --prefix)
info "[6/6] systemd unit"
UNIT_SRC="$SCRIPT_DIR/systemd/$UNIT_NAME"
UNIT_DST="$UNIT_DIR/$UNIT_NAME"
if $DRY_RUN; then
    echo "[dry-run] sed s#$DEFAULT_PREFIX#$PREFIX#g $UNIT_SRC | install -D -m 0644 /dev/stdin $UNIT_DST"
else
    [ -f "$UNIT_SRC" ] || die "ไม่พบ $UNIT_SRC"
    sed "s#$DEFAULT_PREFIX#$PREFIX#g" "$UNIT_SRC" | install -D -m 0644 /dev/stdin "$UNIT_DST"
fi
was_active=false
if ! $DRY_RUN && systemctl is-active --quiet tent-printer; then was_active=true; fi
run systemctl daemon-reload
run systemctl enable --now tent-printer
if $was_active; then
    # enable --now leaves a running agent on its old code/.env
    run systemctl restart tent-printer
fi

echo
ok "เสร็จ — ตรวจสถานะ: sudo $0 --status   |   log: journalctl -u tent-printer -f"
