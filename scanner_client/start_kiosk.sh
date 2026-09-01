#!/bin/bash
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

# 7. Supervisor Loop: รัน main.py หากหลุดหรือปิดตัว ให้เปิดใหม่เสมอเพื่อความต่อเนื่องของ Kiosk
echo "=== Starting SmartShelter Kiosk at $(date) (PID: $$, Python: $PYTHON_BIN, Flags: $EXTRA_ARGS) ===" >> "$LOG_FILE"
while true; do
    "$PYTHON_BIN" main.py $EXTRA_ARGS "$@" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    echo "=== SmartShelter Kiosk process exited (code $EXIT_CODE) at $(date). Restarting in 3s... ===" >> "$LOG_FILE"
    sleep 3
done


