#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - ED-MONITOR-101C Setup & Calibration Script
# สำหรับบอร์ด Raspberry Pi OS (Labwc / Wayland / X11)
# ==============================================================================
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
ENV_FILE="$SCRIPT_DIR/.env"
UDEV_RULE_FILE="/etc/udev/rules.d/99-ed-monitor-touch.rules"
LABWC_AUTOSTART="$HOME/.config/labwc/autostart"

# Color Codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}==============================================================${NC}"
    echo -e "${BLUE}   ED-MONITOR-101C (10.1\" Touch) Setup & Calibration Tool    ${NC}"
    echo -e "${BLUE}==============================================================${NC}"
}

detect_hdmi_output() {
    # ค้นหาชื่อพอร์ต HDMI ที่ต่ออยู่ (เช่น HDMI-A-1 หรือ HDMI-A-2)
    if command -v wlr-randr >/dev/null 2>&1 && [ -n "$WAYLAND_DISPLAY" ]; then
        OUTPUT_NAME=$(wlr-randr 2>/dev/null | grep -E "^[A-Za-z0-9-]+ " | head -n 1 | awk '{print $1}')
    fi
    if [ -z "$OUTPUT_NAME" ]; then
        OUTPUT_NAME="HDMI-A-1"
    fi
    echo "$OUTPUT_NAME"
}

check_touch_device() {
    echo -e "🔍 กำลังตรวจสอบอุปกรณ์สัมผัส (Touchscreen)..."
    TOUCH_NAME=""
    if [ -f "/proc/bus/input/devices" ]; then
        TOUCH_NAME=$(grep -E -i "touch|ed-monitor|ilitek|goodix|egalax" /proc/bus/input/devices | head -n 1 | sed -E 's/.*Name="([^"]+)".*/\1/' || true)
    fi
    if [ -n "$TOUCH_NAME" ]; then
        echo -e "   พบอุปกรณ์: ${GREEN}$TOUCH_NAME${NC}"
    else
        echo -e "   ${YELLOW}ไม่พบชื่ออุปกรณ์เฉพาะเจาะจง (ระบบจะใช้ Generic Touchscreen Matcher)${NC}"
    fi
}

apply_matrix_udev() {
    local matrix="$1"
    local desc="$2"

    echo -e "⚙️  กำลังเขียนค่า Calibration Matrix (${CYAN}$desc${NC})..."
    
    RULE_CONTENT="# ED-MONITOR-101C Touchscreen Calibration Matrix ($desc)
ENV{ID_INPUT_TOUCHSCREEN}==\"1\", ENV{LIBINPUT_CALIBRATION_MATRIX}=\"$matrix\"
ACTION==\"add|change\", KERNEL==\"event*\", ENV{ID_INPUT_TOUCHSCREEN}==\"1\", ENV{LIBINPUT_CALIBRATION_MATRIX}=\"$matrix\"
"

    # บันทึกผ่าน sudo (หากมีสิทธิ์)
    if sudo -n true 2>/dev/null || [ "$EUID" -eq 0 ]; then
        echo "$RULE_CONTENT" | sudo tee "$UDEV_RULE_FILE" >/dev/null
        sudo udevadm control --reload-rules 2>/dev/null || true
        sudo udevadm trigger 2>/dev/null || true
        echo -e "✅ ติดตั้ง udev rule เรียบร้อย: ${GREEN}$UDEV_RULE_FILE${NC}"
    else
        echo -e "${YELLOW}⚠️  ต้องใช้สิทธิ์ sudo ในการเขียน $UDEV_RULE_FILE${NC}"
        echo -e "   กำลังลองรัน sudo..."
        if echo "$RULE_CONTENT" | sudo tee "$UDEV_RULE_FILE" >/dev/null; then
            sudo udevadm control --reload-rules 2>/dev/null || true
            sudo udevadm trigger 2>/dev/null || true
            echo -e "✅ ติดตั้ง udev rule เรียบร้อย: ${GREEN}$UDEV_RULE_FILE${NC}"
        else
            echo -e "${RED}❌ ไม่สามารถเขียน $UDEV_RULE_FILE ได้ กรุณารันคำสั่งด้วย sudo${NC}"
        fi
    fi
}

set_env_dimensions() {
    local width="$1"
    local height="$2"
    if [ -f "$ENV_FILE" ]; then
        sed -i "s/^WINDOW_WIDTH=.*/WINDOW_WIDTH=$width/" "$ENV_FILE" || true
        sed -i "s/^WINDOW_HEIGHT=.*/WINDOW_HEIGHT=$height/" "$ENV_FILE" || true
        echo -e "✅ อัปเดต .env: ${GREEN}WINDOW_WIDTH=$width, WINDOW_HEIGHT=$height${NC}"
    fi
}

set_orientation() {
    local mode="$1" # landscape, portrait-right (90), portrait-left (270)
    local output
    output=$(detect_hdmi_output)

    case "$mode" in
        landscape)
            echo -e "\n🖥️  ตั้งค่า: ${GREEN}แนวนอน (Landscape - 1024x600)${NC}"
            # 1. หมุนจอทันทีหากรันอยู่บน Wayland
            if command -v wlr-randr >/dev/null 2>&1 && [ -n "$WAYLAND_DISPLAY" ]; then
                wlr-randr --output "$output" --transform normal 2>/dev/null || true
            fi
            # 2. Touch matrix = 1 0 0 0 1 0 (Identity)
            apply_matrix_udev "1 0 0 0 1 0" "Landscape 0°"
            set_env_dimensions 1024 600
            ;;
        portrait-right|portrait|90)
            echo -e "\n🖥️  ตั้งค่า: ${GREEN}แนวตั้ง หมุนขวา 90° (Portrait - 600x1024)${NC}"
            if command -v wlr-randr >/dev/null 2>&1 && [ -n "$WAYLAND_DISPLAY" ]; then
                wlr-randr --output "$output" --transform 90 2>/dev/null || true
            fi
            # 90 degrees matrix: 0 1 0 -1 0 1
            apply_matrix_udev "0 1 0 -1 0 1" "Portrait 90°"
            set_env_dimensions 600 1024
            ;;
        portrait-left|270)
            echo -e "\n🖥️  ตั้งค่า: ${GREEN}แนวตั้ง หมุนซ้าย 270° (Portrait - 600x1024)${NC}"
            if command -v wlr-randr >/dev/null 2>&1 && [ -n "$WAYLAND_DISPLAY" ]; then
                wlr-randr --output "$output" --transform 270 2>/dev/null || true
            fi
            # 270 degrees matrix: 0 -1 1 1 0 0
            apply_matrix_udev "0 -1 1 1 0 0" "Portrait 270°"
            set_env_dimensions 600 1024
            ;;
        *)
            echo -e "${RED}โหมดไม่ถูกต้อง: $mode${NC}"
            exit 1
            ;;
    esac

    echo -e "\n🎉 ตั้งค่าหน้าจอและทัชสกรีนเสร็จสิ้น!"
    echo -e "💡 หากพิกัดยังไม่อัปเดตทันที แนะนำให้ถอดสาย USB ทัชแล้วเสียบใหม่ หรือรีบูตเครื่อง (${BLUE}sudo reboot${NC})\n"
}

disable_screen_blanking() {
    echo -e "\n💡 กำลังตั้งค่าป้องกันหน้าจอดับ (Disable Screen Blanking)..."
    
    # 1. ผ่าน raspi-config nonint (ถ้ามี)
    if command -v raspi-config >/dev/null 2>&1; then
        sudo raspi-config nonint do_blanking 1 2>/dev/null || true
        echo -e "✅ ปิด Screen Blanking ผ่าน raspi-config สำเร็จ"
    fi

    # 2. ปิด DPMS ใน Labwc Autostart
    if [ -f "$LABWC_AUTOSTART" ]; then
        if ! grep -q "xset s off" "$LABWC_AUTOSTART"; then
            echo -e "\n# Disable screen blanking for Kiosk\nxset s off -dpms 2>/dev/null || true" >> "$LABWC_AUTOSTART"
            echo -e "✅ เพิ่มคำสั่ง xset s off ใน $LABWC_AUTOSTART"
        fi
    fi

    echo -e "${GREEN}✅ ตั้งค่าจอให้สว่างตลอดเวลาเรียบร้อย (No Sleep)${NC}\n"
}

test_touch() {
    print_banner
    echo -e "👆 เข้าสู่โหมดทดสอบการสัมผัส (Touchscreen Diagnostic)\n"

    if ! command -v evtest >/dev/null 2>&1; then
        echo -e "📦 กำลังติดตั้งเครื่องมือทดสอบ evtest..."
        sudo apt update && sudo apt install -y evtest
    fi

    echo -e "คำแนะนำ:"
    echo -e "1. เลือกหมายเลขของอุปกรณ์ Touchscreen จากรายการด้านล่าง"
    echo -e "2. ใช้นิ้วแตะที่หน้าจอ 4 มุม (มุมซ้ายบน, ขวาบน, ซ้ายล่าง, ขวาล่าง)"
    echo -e "3. ตรวจสอบดูว่าค่าพิกัด ABS_MT_POSITION_X / Y วิ่งตามนิ้วถูกต้องหรือไม่"
    echo -e "4. กด ${BLUE}Ctrl + C${NC} เพื่อออกจากโปรแกรมทดสอบ\n"

    sudo evtest
}

show_status() {
    print_banner
    echo -e "📊 ตรวจสอบสถานะการเชื่อมต่อหน้าจอและทัชสกรีน:\n"

    # 1. ตรวจสอบ Display Server
    if [ -n "$WAYLAND_DISPLAY" ]; then
        echo -e "  [Display Server]: ${GREEN}Wayland ($WAYLAND_DISPLAY)${NC}"
    elif [ -n "$DISPLAY" ]; then
        echo -e "  [Display Server]: ${GREEN}X11 ($DISPLAY)${NC}"
    else
        echo -e "  [Display Server]: ${YELLOW}ไม่พบตัวแปร Display (อาจรันผ่าน SSH)${NC}"
    fi

    # 2. ตรวจสอบ Resolution / Output
    output=$(detect_hdmi_output)
    echo -e "  [Active Output]:  ${GREEN}$output${NC}"
    if command -v wlr-randr >/dev/null 2>&1 && [ -n "$WAYLAND_DISPLAY" ]; then
        echo -e "\n  [wlr-randr Display Info]:"
        wlr-randr 2>/dev/null | grep -E "HDMI|enabled|position|transform" | sed 's/^/    /' || true
    fi

    # 3. ตรวจสอบ USB Touch Device
    echo -e "\n  [USB Devices]:"
    lsusb | grep -E -i "touch|ilitek|goodix|egalax|eda" | sed 's/^/    /' || echo "    ไม่พบอุปกรณ์ที่มีคำว่า touch ใน lsusb (อาจใช้ Generic HID ID)"

    # 4. ตรวจสอบ Udev Rule
    echo -e "\n  [Touch Calibration Matrix]:"
    if [ -f "$UDEV_RULE_FILE" ]; then
        echo -e "    ${GREEN}พบไฟล์ $UDEV_RULE_FILE${NC}"
        grep "LIBINPUT_CALIBRATION_MATRIX" "$UDEV_RULE_FILE" | head -n 1 | sed 's/^/    /' || true
    else
        echo -e "    ${YELLOW}ยังไม่ได้สร้าง udev calibration rule (ใช้พิกัดเริ่มต้นจากโรงงาน 1:1)${NC}"
    fi

    # 5. ตรวจสอบขนาดใน .env
    if [ -f "$ENV_FILE" ]; then
        echo -e "\n  [scanner_client/.env Settings]:"
        grep -E "WINDOW_WIDTH|WINDOW_HEIGHT|DEBUG" "$ENV_FILE" | sed 's/^/    /' || true
    fi
    echo ""
}

show_interactive_menu() {
    print_banner
    check_touch_device
    echo ""
    echo "กรุณาเลือกคำสั่งที่ต้องการ:"
    echo "  1) ตั้งค่าเป็น แนวนอน (Landscape: 1024x600) [ค่าเริ่มต้น แนะนำ]"
    echo "  2) ตั้งค่าเป็น แนวตั้ง หมุนขวา 90° (Portrait: 600x1024)"
    echo "  3) ตั้งค่าเป็น แนวตั้ง หมุนซ้าย 270° (Portrait: 600x1024)"
    echo "  4) ทดสอบแตะสัมผัสหน้าจอ (Test Touch via evtest)"
    echo "  5) ป้องกันหน้าจอดับ (Disable Screen Blanking / Always On)"
    echo "  6) ตรวจสอบสถานะการเชื่อมต่อ (Show Status)"
    echo "  0) ออกจากโปรแกรม"
    echo ""
    read -rp "เลือกตัวเลือก [1-6, 0]: " choice

    case "$choice" in
        1) set_orientation "landscape" ;;
        2) set_orientation "portrait-right" ;;
        3) set_orientation "portrait-left" ;;
        4) test_touch ;;
        5) disable_screen_blanking ;;
        6) show_status ;;
        0) exit 0 ;;
        *) echo "ตัวเลือกไม่ถูกต้อง"; exit 1 ;;
    esac
}

# CLI Arguments Handler
case "$1" in
    --landscape|-l)
        print_banner
        set_orientation "landscape"
        ;;
    --portrait-right|--portrait|-p|--90)
        print_banner
        set_orientation "portrait-right"
        ;;
    --portrait-left|--270)
        print_banner
        set_orientation "portrait-left"
        ;;
    --test-touch|--test|-t)
        test_touch
        ;;
    --disable-blanking|--no-sleep)
        print_banner
        disable_screen_blanking
        ;;
    --status|-s)
        show_status
        ;;
    --help|-h)
        print_banner
        echo "การใช้งาน:"
        echo "  ./setup_monitor.sh                   เปิดเมนูตั้งค่าแบบโต้ตอบ (Interactive Menu)"
        echo "  ./setup_monitor.sh --landscape       ตั้งค่าแนวนอน (1024x600) พร้อมรีเซ็ต Matrix"
        echo "  ./setup_monitor.sh --portrait        ตั้งค่าแนวตั้ง 90° (600x1024) พร้อม Calibrate Touch"
        echo "  ./setup_monitor.sh --portrait-left   ตั้งค่าแนวตั้ง 270° (600x1024)"
        echo "  ./setup_monitor.sh --test-touch      ทดสอบแตะสัมผัสหน้าจอแบบ Realtime"
        echo "  ./setup_monitor.sh --disable-blanking ป้องกันหน้าจอดับอัตโนมัติ"
        echo "  ./setup_monitor.sh --status          ตรวจสอบสถานะความละเอียดและ Touch Matrix"
        echo "  ./setup_monitor.sh --help            แสดงคำแนะนำนี้"
        echo ""
        ;;
    *)
        show_interactive_menu
        ;;
esac
