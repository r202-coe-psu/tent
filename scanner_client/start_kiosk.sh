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

# 3. กำหนดตัวแปรแสดงผล Display สำหรับ Wayland (Labwc/Wayfire) และ X11
export DISPLAY="${DISPLAY:-:0}"
if [ -z "$WAYLAND_DISPLAY" ] && [ -n "$XDG_RUNTIME_DIR" ]; then
    if [ -e "$XDG_RUNTIME_DIR/wayland-0" ]; then
        export WAYLAND_DISPLAY="wayland-0"
    elif [ -e "$XDG_RUNTIME_DIR/wayland-1" ]; then
        export WAYLAND_DISPLAY="wayland-1"
    fi
fi

# 4. กำหนดค่าเริ่มต้นเป็น Fullscreen Kiosk Mode เมื่อรันผ่าน Startup Script
# (สามารถ override ชั่วคราวได้ด้วย: DEBUG=true ./start_kiosk.sh)
export DEBUG="${DEBUG:-false}"

# 5. เลือก Python จาก Virtual Environment หากมี
if [ -f "$SCRIPT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"
elif [ -f "$SCRIPT_DIR/../.venv/bin/python" ]; then
    PYTHON_BIN="$SCRIPT_DIR/../.venv/bin/python"
else
    PYTHON_BIN="$(which python3)"
fi

# 6. รัน main.py พร้อมบันทึก log เพื่อตรวจสอบหากเกิดข้อผิดพลาด
LOG_FILE="/tmp/kiosk_autostart.log"
echo "=== Starting SmartShelter Kiosk at $(date) (PID: $$, Python: $PYTHON_BIN) ===" >> "$LOG_FILE"
exec "$PYTHON_BIN" main.py "$@" >> "$LOG_FILE" 2>&1

