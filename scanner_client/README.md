# 💳 Smart Card Scanner Client สำหรับ SmartShelter (Tent)

โปรแกรม Client ฝั่งจุดบริการสำหรับเชื่อมต่อเครื่องอ่านบัตรประจำตัวประชาชนไทย (Smart Card Reader) ควบคุมหน้าจอ Kiosk ผ่าน Playwright และส่งข้อมูลบัตรพร้อมรูปถ่ายเข้าสู่ระบบ SmartShelter โดยอัตโนมัติ

---

## 🛠️ ความต้องการของระบบ (Prerequisites)

1. **ระบบปฏิบัติการ**: Linux (Ubuntu/Debian), macOS หรือ Windows
2. **โปรแกรม PC/SC Daemon (สำหรับ Linux)**:
   ```bash
   sudo apt update
   sudo apt install -y pcscd libpcsclite-dev
   sudo systemctl enable --now pcscd
   ```
3. **Python 3.11 ขึ้นไป**

---

## 🚀 ขั้นตอนการติดตั้งและการใช้งาน

### 1. ติดตั้ง Dependencies
```bash
cd scanner_client
pip install -r requirements.txt
# ติดตั้ง Chromium สำหรับ Playwright
playwright install chromium
```

### 2. ลงทะเบียนอุปกรณ์ใน Back Office ของ Tent
1. เข้าสู่ระบบ Tent ในฐานะ Admin
2. ไปที่เมนู **ระบบส่วนกลาง -> เครื่องสแกนบัตร (Scanners)** (`/portal/system-management/scanners`)
3. กดปุ่ม **"ลงทะเบียนเครื่องสแกนใหม่"**
4. กรอก `Device ID` (เช่น `SCAN-01`), ชื่ออุปกรณ์ และรหัสศูนย์พักพิง (`SH001`)
5. ระบบจะแสดง `Device Secret` ให้คัดลอกไว้

### 3. ตั้งค่าไฟล์ `.env`
คัดลอกไฟล์ตัวอย่าง `.env.example` เป็น `.env`:
```bash
cp .env.example .env
```
แก้ไขค่าใน `.env`:
```env
TENT_BASE_URL=http://localhost:5173
DEVICE_ID=SCAN-01
DEVICE_SECRET=sk_scan_...  # ใส่ Secret ที่ได้จากข้อ 2
DEBUG=true                 # true สำหรับหน้าต่างทั่วไป, false สำหรับ Fullscreen Kiosk
```

### 4. เริ่มต้นการทำงาน

#### ทดสอบอ่านบัตรผ่าน Terminal (Hardware Check):
```bash
python test_card.py
```

#### รันระบบเต็มรูปแบบ (Playwright Kiosk + Inbound Sync):
```bash
python main.py
```

---

## 🔄 Flow การทำงาน
1. `scanner_client` เปิด Browser หน้า `/kiosk/scanner/waiting` บน Tent Server
2. เมื่อผู้ประสบภัยเสียบบัตรประชาชน:
   - หน้าจอ Kiosk เปลี่ยนเป็น `/kiosk/scanner/reading` พร้อมข้อความยินยอม PDPA
   - ระบบอ่านข้อมูล CID, ชื่อ-สกุล (ไทย/อังกฤษ), วันเกิด, เพศ, ที่อยู่ และรูปถ่าย JPEG จากชิป
   - ส่งข้อมูลเข้า Tent Inbound API (`/api/v1/scanner/draft`) และบันทึกเป็น Draft ใน CouchDB
   - หน้าจอ Kiosk เปลี่ยนเป็น `/kiosk/scanner/remove-card` แจ้งให้ถอดบัตรออก
3. เจ้าหน้าที่จุดลงทะเบียนหน้างานสามารถกดปุ่ม **"ดึงข้อมูลจากเครื่องสแกน"** ในฟอร์มลงทะเบียนเพื่อ Auto-fill ข้อมูลและรูปถ่ายได้ทันที
