#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk Startup Script
# ==============================================================================

# 1. หน่วงเวลาเล็กน้อยเพื่อให้ Desktop Environment และ Wayland/X11 โหลดเสร็จสมบูรณ์
sleep 3

# 2. ย้ายไปยังโฟลเดอร์ของ script อัตโนมัติ (รองรับทุก Username)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$SCRIPT_DIR"

# 3. กำหนดตัวแปรแสดงผล Display
export DISPLAY="${DISPLAY:-:0}"
if [ -z "$WAYLAND_DISPLAY" ] && [ -n "$XDG_RUNTIME_DIR" ] && [ -e "$XDG_RUNTIME_DIR/wayland-0" ]; then
    export WAYLAND_DISPLAY="wayland-0"
fi

# 4. เลือก Python จาก Virtual Environment หากมี
if [ -f "$SCRIPT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"
else
    PYTHON_BIN="python3"
fi

# 5. รัน main.py พร้อมบันทึก log เพื่อตรวจสอบหากเกิดข้อผิดพลาด
echo "=== Starting SmartShelter Kiosk at $(date) ===" >> /tmp/kiosk_autostart.log
exec "$PYTHON_BIN" main.py >> /tmp/kiosk_autostart.log 2>&1
