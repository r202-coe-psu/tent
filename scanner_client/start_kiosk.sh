#!/bin/bash
trap "exit" INT TERM
# ==============================================================================
# SmartShelter Kiosk Startup Script (Optimized for Raspberry Pi OS / Labwc / Wayland)
# ==============================================================================

# 1. หน่วงเวลาเล็กน้อยเพื่อให้ Desktop Environment, Wayland/X11 และ Network โหลดพร้อม
DELAY_SEC="${STARTUP_DELAY:-3}"
sleep "$DELAY_SEC"

# 2. ย้ายไปยังโฟลเดอร์ของ script อัตโนมัติ (รองรับทุก Username และ Absolute Path)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$SCRIPT_DIR"

LOG_FILE="/tmp/kiosk_autostart.log"

# 3. ป้องกันการรันซ้อนกันหลาย Process (Single Instance Guard via flock)
# เนื่องจาก Raspberry Pi OS บางเวอร์ชันอาจรันทั้ง XDG Autostart และ Labwc Autostart
LOCK_FILE="/tmp/smart_shelter_kiosk.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "[$(date)] SmartShelter Kiosk is already running (PID: $$). Skipping duplicate instance." >> "$LOG_FILE"
    exit 0
fi

# 4. กำหนดตัวแปรแสดงผล Display สำหรับ Wayland (Labwc/Wayfire) และ X11
export DISPLAY="${DISPLAY:-:0}"
if [ -z "$WAYLAND_DISPLAY" ] && [ -n "$XDG_RUNTIME_DIR" ]; then
    if [ -e "$XDG_RUNTIME_DIR/wayland-0" ]; then
        export WAYLAND_DISPLAY="wayland-0"
    elif [ -e "$XDG_RUNTIME_DIR/wayland-1" ]; then
        export WAYLAND_DISPLAY="wayland-1"
    fi
fi

# 5. กำหนดค่าเริ่มต้นเป็น Fullscreen Kiosk Mode เมื่อรันผ่าน Startup Script
# (สามารถ override ชั่วคราวได้ด้วย: DEBUG=true ./start_kiosk.sh)
export DEBUG="${DEBUG:-false}"
EXTRA_ARGS=""
if [ "$DEBUG" = "false" ] || [ -z "$DEBUG" ]; then
    EXTRA_ARGS="--kiosk"
fi

# 6. เลือก Python จาก Virtual Environment หากมี
if [ -f "$SCRIPT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"
elif [ -f "$SCRIPT_DIR/../.venv/bin/python" ]; then
    PYTHON_BIN="$SCRIPT_DIR/../.venv/bin/python"
else
    PYTHON_BIN="$(which python3)"
fi

# 6.1 Re-enable the label printer queue: CUPS stops it after a paper-out/USB error and it stays
# stopped across reboots. Never block the kiosk when the printer or queue is missing.
PRINTER_NAME="${PRINTER_NAME:-$(sed -n 's/^PRINTER_NAME=//p' "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 | tr -d '"'\''[:space:]')}"
PRINTER_NAME="${PRINTER_NAME:-tent_xprinter}"
if command -v cupsenable >/dev/null 2>&1 && lpstat -p "$PRINTER_NAME" >/dev/null 2>&1; then
    cupsenable "$PRINTER_NAME" >> "$LOG_FILE" 2>&1 || echo "[$(date)] cupsenable $PRINTER_NAME failed (user needs lpadmin group)" >> "$LOG_FILE"
fi

# 7. Supervisor Loop: รัน main.py หากหลุดหรือปิดตัว ให้เปิดใหม่เสมอเพื่อความต่อเนื่องของ Kiosk
echo "=== Starting SmartShelter Kiosk at $(date) (PID: $$, Python: $PYTHON_BIN, Flags: $EXTRA_ARGS) ===" >> "$LOG_FILE"
while true; do
    "$PYTHON_BIN" main.py $EXTRA_ARGS "$@" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 78 ] || [ "$EXIT_CODE" -eq 79 ]; then
        echo "=== SmartShelter Kiosk stopped: permanent configuration/authentication failure (code $EXIT_CODE). Fix .env and restart. ===" >> "$LOG_FILE"
        exit "$EXIT_CODE"
    fi
    echo "=== SmartShelter Kiosk process exited (code $EXIT_CODE) at $(date). Restarting in ${RESTART_DELAY_SEC:-30}s... ===" >> "$LOG_FILE"
    sleep "${RESTART_DELAY_SEC:-30}"
done
