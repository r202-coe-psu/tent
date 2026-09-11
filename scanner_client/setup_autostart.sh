#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Automated Autostart Setup Script for Raspberry Pi
# ==============================================================================
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
KIOSK_SCRIPT="$SCRIPT_DIR/start_kiosk.sh"
XDG_AUTOSTART_DIR="$HOME/.config/autostart"
XDG_DESKTOP_FILE="$XDG_AUTOSTART_DIR/smart-shelter-kiosk.desktop"
LABWC_CONFIG_DIR="$HOME/.config/labwc"
LABWC_AUTOSTART_FILE="$LABWC_CONFIG_DIR/autostart"
WAYFIRE_CONFIG_FILE="$HOME/.config/wayfire.ini"

# Color Codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}==============================================================${NC}"
    echo -e "${BLUE}  SmartShelter Kiosk - Raspberry Pi Autostart Configuration   ${NC}"
    echo -e "${BLUE}==============================================================${NC}"
}

check_env() {
    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        echo -e "${YELLOW}⚠️  คำเตือน: ไม่พบไฟล์ .env ใน $SCRIPT_DIR${NC}"
        echo -e "   กรุณาคัดลอกไฟล์ตัวอย่างด้วยคำสั่ง:"
        echo -e "   cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
        echo -e "   และกำหนดค่า TENT_BASE_URL, DEVICE_ID, DEVICE_SECRET ให้เรียบร้อย\n"
    fi
}

install_autostart() {
    print_banner
    check_env

    echo -e "📂 ตำแหน่งโปรแกรม: ${GREEN}$SCRIPT_DIR${NC}"
    echo -e "⚙️  กำลังเตรียมการตั้งค่า Autostart...\n"

    # 1. ตั้งสิทธิ์ให้ start_kiosk.sh สามารถรันได้
    if [ -f "$KIOSK_SCRIPT" ]; then
        chmod +x "$KIOSK_SCRIPT"
        echo -e "✅ กำหนดสิทธิ์ Executable ให้ start_kiosk.sh สำเร็จ"
    else
        echo -e "${RED}❌ ไม่พบไฟล์ $KIOSK_SCRIPT${NC}"
        exit 1
    fi

    # 2. ติดตั้ง XDG Autostart (.desktop) - รองรับ Desktop Environment ทั่วไป
    mkdir -p "$XDG_AUTOSTART_DIR"
    cat > "$XDG_DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=SmartShelter Kiosk
Comment=Start SmartShelter Card Scanner Kiosk in Fullscreen
Exec=sh -c 'cd "$SCRIPT_DIR" && exec ./start_kiosk.sh'
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
Categories=Utility;
EOF
    chmod +x "$XDG_DESKTOP_FILE"
    echo -e "✅ ติดตั้ง XDG Desktop Autostart: ${GREEN}$XDG_DESKTOP_FILE${NC}"

    # 3. ติดตั้งสำหรับ Labwc (Raspberry Pi OS Bookworm ล่าสุด)
    mkdir -p "$LABWC_CONFIG_DIR"
    if [ ! -f "$LABWC_AUTOSTART_FILE" ]; then
        echo "#!/bin/sh" > "$LABWC_AUTOSTART_FILE"
    fi

    # ลบ config เดิมของ smart-shelter หากมีอยู่แล้ว เพื่อป้องกันการซ้ำซ้อน
    sed -i '/# BEGIN SMARTSHELTER KIOSK/,/# END SMARTSHELTER KIOSK/d' "$LABWC_AUTOSTART_FILE"

    # เพิ่มคำสั่งรันเข้าไปใน labwc autostart
    cat >> "$LABWC_AUTOSTART_FILE" <<EOF

# BEGIN SMARTSHELTER KIOSK
sh -c 'cd "$SCRIPT_DIR" && exec ./start_kiosk.sh' &
# END SMARTSHELTER KIOSK
EOF
    chmod +x "$LABWC_AUTOSTART_FILE"
    echo -e "✅ ติดตั้ง Labwc Autostart: ${GREEN}$LABWC_AUTOSTART_FILE${NC}"

    # 4. ติดตั้งสำหรับ Wayfire (หากมี wayfire.ini อยู่ในระบบ)
    if [ -f "$WAYFIRE_CONFIG_FILE" ]; then
        if ! grep -q "smart_shelter_kiosk" "$WAYFIRE_CONFIG_FILE"; then
            if grep -q "\[autostart\]" "$WAYFIRE_CONFIG_FILE"; then
                sed -i "/\[autostart\]/a smart_shelter_kiosk = sh -c 'cd $SCRIPT_DIR && exec ./start_kiosk.sh'" "$WAYFIRE_CONFIG_FILE"
            else
                echo -e "\n[autostart]\nsmart_shelter_kiosk = sh -c 'cd $SCRIPT_DIR && exec ./start_kiosk.sh'" >> "$WAYFIRE_CONFIG_FILE"
            fi
            echo -e "✅ ติดตั้ง Wayfire Autostart: ${GREEN}$WAYFIRE_CONFIG_FILE${NC}"
        fi
    fi

    # 5. ตรวจสอบและเปิดใช้งานบริการ pcscd (Smart Card Daemon)
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "🔌 กำลังตรวจสอบบริการอ่านบัตร (pcscd.socket)..."
        if sudo -n true 2>/dev/null; then
            if sudo systemctl enable --now pcscd.socket 2>/dev/null; then
                echo -e "✅ เปิดใช้งาน pcscd.socket สำเร็จ"
            fi
        else
            echo -e "${YELLOW}ℹ️  คำแนะนำ: หากยังไม่ได้เปิด pcscd ให้รัน: sudo systemctl enable --now pcscd.socket${NC}"
        fi
    fi

    echo -e "\n${GREEN}🎉 ตั้งค่า Autostart สำเร็จเรียบร้อย!${NC}"
    echo -e "เมื่อเปิดเครื่องหรือรีสตาร์ท Raspberry Pi ระบบจะเข้าสู่หน้าจอ Kiosk เต็มจอทันที"
    echo -e "💡 ทริก: หากต้องการปิดชั่วคราวเพื่อซ่อมบำรุง ให้รัน: ${BLUE}./setup_autostart.sh --disable${NC}"
    echo -e "💡 ตรวจสอบ Log ข้อผิดพลาดได้ที่: ${BLUE}cat /tmp/kiosk_autostart.log${NC}\n"
}

disable_autostart() {
    print_banner
    echo -e "🛑 กำลังปิดการทำงาน Autostart...\n"

    # ลบ XDG Autostart
    if [ -f "$XDG_DESKTOP_FILE" ]; then
        rm -f "$XDG_DESKTOP_FILE"
        echo -e "✅ ลบไฟล์ ${GREEN}$XDG_DESKTOP_FILE${NC}"
    fi

    # ลบจาก Labwc Autostart
    if [ -f "$LABWC_AUTOSTART_FILE" ]; then
        sed -i '/# BEGIN SMARTSHELTER KIOSK/,/# END SMARTSHELTER KIOSK/d' "$LABWC_AUTOSTART_FILE"
        echo -e "✅ นำการเรียกใช้งานออกจาก ${GREEN}$LABWC_AUTOSTART_FILE${NC}"
    fi

    # ลบจาก Wayfire
    if [ -f "$WAYFIRE_CONFIG_FILE" ]; then
        sed -i '/smart_shelter_kiosk/d' "$WAYFIRE_CONFIG_FILE"
        echo -e "✅ นำการเรียกใช้งานออกจาก ${GREEN}$WAYFIRE_CONFIG_FILE${NC}"
    fi

    echo -e "\n${GREEN}✅ ปิด Autostart สำเร็จ เครื่องจะไม่เปิดโปรแกรม Kiosk อัตโนมัติเมื่อบูต${NC}"
    echo -e "หากต้องการเปิดใช้งานอีกครั้ง ให้รัน: ${BLUE}./setup_autostart.sh${NC}\n"
}

status_autostart() {
    print_banner
    echo -e "📊 ตรวจสอบสถานะการตั้งค่า Autostart:\n"

    # ตรวจสอบ XDG
    if [ -f "$XDG_DESKTOP_FILE" ]; then
        echo -e "  [XDG Desktop]: ${GREEN}เปิดใช้งานอยู่ (Active)${NC} -> $XDG_DESKTOP_FILE"
    else
        echo -e "  [XDG Desktop]: ${YELLOW}ไม่ได้ตั้งค่า (Not installed)${NC}"
    fi

    # ตรวจสอบ Labwc
    if [ -f "$LABWC_AUTOSTART_FILE" ] && grep -q "SMARTSHELTER KIOSK" "$LABWC_AUTOSTART_FILE"; then
        echo -e "  [Labwc]:       ${GREEN}เปิดใช้งานอยู่ (Active)${NC} -> $LABWC_AUTOSTART_FILE"
    else
        echo -e "  [Labwc]:       ${YELLOW}ไม่ได้ตั้งค่า (Not installed)${NC}"
    fi

    # ตรวจสอบ Wayfire
    if [ -f "$WAYFIRE_CONFIG_FILE" ] && grep -q "smart_shelter_kiosk" "$WAYFIRE_CONFIG_FILE"; then
        echo -e "  [Wayfire]:     ${GREEN}เปิดใช้งานอยู่ (Active)${NC} -> $WAYFIRE_CONFIG_FILE"
    else
        echo -e "  [Wayfire]:     ${YELLOW}ไม่ได้ตั้งค่า (Not installed)${NC}"
    fi

    # ตรวจสอบ pcscd
    if command -v systemctl >/dev/null 2>&1; then
        if systemctl is-active --quiet pcscd.socket 2>/dev/null || systemctl is-active --quiet pcscd 2>/dev/null; then
            echo -e "  [pcscd]:       ${GREEN}กำลังทำงาน (Active / Running)${NC}"
        else
            echo -e "  [pcscd]:       ${YELLOW}ไม่ได้ทำงาน (Inactive)${NC}"
        fi
    fi

    # ตรวจสอบ Log ล่าสุด
    if [ -f "/tmp/kiosk_autostart.log" ]; then
        echo -e "\n📄 Log ล่าสุดจาก /tmp/kiosk_autostart.log (5 บรรทัดท้าย):"
        echo -e "--------------------------------------------------------"
        tail -n 5 "/tmp/kiosk_autostart.log"
        echo -e "--------------------------------------------------------"
    fi
    echo ""
}

case "$1" in
    --disable|--remove|-d|-r)
        disable_autostart
        ;;
    --status|-s)
        status_autostart
        ;;
    --help|-h)
        print_banner
        echo "การใช้งาน:"
        echo "  ./setup_autostart.sh           ติดตั้งและเปิดใช้งาน Autostart"
        echo "  ./setup_autostart.sh --status  ตรวจสอบสถานะ Autostart และ Log"
        echo "  ./setup_autostart.sh --disable ปิดการทำงาน Autostart ชั่วคราว"
        echo "  ./setup_autostart.sh --help    แสดงคำแนะนำนี้"
        echo ""
        ;;
    *)
        install_autostart
        ;;
esac
