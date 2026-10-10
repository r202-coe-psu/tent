# 💳 Smart Card Scanner Client สำหรับ SmartShelter (Tent)

คู่มือการติดตั้งและตั้งค่าโปรแกรม **Scanner Client** บนบอร์ด **Raspberry Pi** (หรือคอมพิวเตอร์ Linux/Ubuntu/Debian) แบบละเอียดตั้งแต่เริ่มต้น (From Scratch) เพื่อทำหน้าที่เป็น **ตู้ Kiosk เสียบบัตรประชาชนอัตโนมัติ** ณ จุดลงทะเบียนศูนย์พักพิง

---

## 📋 สารบัญ

1. [ภาพรวมสถาปัตยกรรม (Architecture)](#-ภาพรวมสถาปัตยกรรม-architecture)
2. [อุปกรณ์ฮาร์ดแวร์ที่แนะนำ (Hardware Requirements)](#-อุปกรณ์ฮาร์ดแวร์ที่แนะนำ-hardware-requirements)
3. [ขั้นตอนการติดตั้งตั้งแต่เริ่มต้น (Step-by-Step Installation)](#-ขั้นตอนการติดตั้งตั้งแต่เริ่มต้น-step-by-step-installation)
   - [Step 1: การเตรียมความพร้อมก่อนเริ่มต้น (Pre-Preparation & SSH Remote Access)](#step-1-การเตรียมความพร้อมก่อนเริ่มต้น-pre-preparation--ssh-remote-access)
   - [Step 2: ติดตั้ง System Packages & Smart Card Driver](#step-2-ติดตั้ง-system-packages--smart-card-driver)
   - [Step 3: ทดสอบการทำงานของเครื่องอ่านบัตร (Hardware Check)](#step-3-ทดสอบการทำงานของเครื่องอ่านบัตร-hardware-check)
   - [Step 4: Clone โปรเจกต์ & สร้าง Python Virtual Environment](#step-4-clone-โปรเจกต์--สร้าง-python-virtual-environment)
   - [Step 5: ติดตั้ง Playwright & Browser Dependencies](#step-5-ติดตั้ง-playwright--browser-dependencies)
   - [Step 6: ตั้งค่า Configuration (.env)](#step-6-ตั้งค่า-configuration-env)
   - [Step 7: ทดสอบรันระบบ](#step-7-ทดสอบรันระบบ)
4. [การตั้งค่าให้รันอัตโนมัติเมื่อเปิดเครื่อง (Autostart on Boot)](#-การตั้งค่าให้รันอัตโนมัติเมื่อเปิดเครื่อง-autostart-on-boot)
5. [การตั้งค่าจอแสดงผลแนวตั้งและการป้องกันจอดับ (Display Optimization)](#-การตั้งค่าจอแสดงผลแนวตั้งและการป้องกันจอดับ-display-optimization)
6. [ตู้ใหญ่ kiosk3 (ESC/POS + เครื่องอ่าน QR + เครื่องอ่านบัตร RFpro)](#-ตู้ใหญ่-kiosk3-escpos--เครื่องอ่าน-qr--เครื่องอ่านบัตร-rfpro)
   - [ล็อกไม่ให้ออกจากหน้า kiosk (ตู้ใหญ่)](#ล็อกไม่ให้ออกจากหน้า-kiosk-ตู้ใหญ่)
7. [เครื่องพิมพ์ Label XP-365B (USB Label Printer)](#-เครื่องพิมพ์-label-xp-365b-usb-label-printer)
8. [การแก้ไขปัญหาที่พบบ่อย (Troubleshooting & FAQ)](#-การแก้ไขปัญหาที่พบบ่อย-troubleshooting--faq)

---

## 🏛️ ภาพรวมสถาปัตยกรรม (Architecture)

```mermaid
flowchart LR
    A[🪪 บัตรประชาชน หรือ QR ลงทะเบียน] --> B[📟 Kiosk UI / Playwright]
    B -->|ค้นหาแบบเดียวกัน| C[☁️ Tent Kiosk API]
    D[🐍 Python Scanner Client] -->|ส่งเลขบัตรในหน่วยความจำ| B
    D -->|แนบ device auth เฉพาะ kiosk API| C
    C -->|ยืนยันเครื่องและกำหนดศูนย์จาก device| E[(🗄️ ฐานข้อมูลศูนย์)]
    E -->|ผู้ลงทะเบียนและครัวเรือน| B
    B -->|เลือกสมาชิกแล้วรายงานตัว| C
    C -->|สถานะ arriving + QR รายคน| B
    B -->|พิมพ์สายรัดข้อมือ| F[🖨️ เครื่องพิมพ์]
```

1. **Kiosk UI**: QR และบัตรเข้าสู่หน้าแสดงผู้ลงทะเบียนและสมาชิกครัวเรือนชุดเดียวกัน
2. **Card Engine**: ใช้เลขประจำตัวประชาชน 13 หลักเพื่อค้นหา; ชื่อและที่อยู่จากบัตรไม่ถูกส่งเข้า API ตอนค้นหาหรือรายงานตัว
   ยกเว้นรูปจากชิป: ถ้าเปิด face check และผลเป็น `match` ตอนรายงานตัวด้วยบัตร หน้า kiosk แนบรูปจากชิปไปกับ `/check-in`
   server เก็บเป็นรูปของเจ้าของบัตรเฉพาะเมื่อยังไม่มีรูป (ไม่ทับรูปเดิม; รูปผิดรูปแบบหรือบันทึกไม่ได้ก็รายงานตัวสำเร็จตามปกติ)
3. **Kiosk API**: Python Client แนบ `X-Device-Id` และ `X-Device-Secret` เฉพาะคำขอ same-origin ไปยัง `/api/v1/scanner/kiosk/lookup`, `/check-in`, `/config`, `/register` และ `/staff-pin/verify`; server ตรวจ device และใช้ศูนย์ที่ผูกกับ device
4. **Check-in**: เจ้าหน้าที่เลือกสมาชิกที่มาถึง ระบบเปลี่ยนเฉพาะผู้ที่เลือกจาก `pre_registered` เป็น `arriving` และสร้าง QR แบบไม่มีข้อมูลส่วนบุคคล
5. **Wristband**: พิมพ์ label 1 ดวงต่อคนออกเครื่องพิมพ์ label ทันที (ไม่มี print dialog) และสั่งพิมพ์ซ้ำจากผลเดิมโดยไม่ส่ง check-in ซ้ำ — ดู [เครื่องพิมพ์ Label XP-365B](#-เครื่องพิมพ์-label-xp-365b-usb-label-printer)

ค่า `shelter_code` ใน URL เป็นข้อมูลแสดงผลเท่านั้น; server ใช้ shelter ที่ผูกกับ device หลังตรวจ `X-Device-Id`/`X-Device-Secret` ทุกคำขอ

Legacy `POST /api/v1/scanner/draft` ถูกปิดเพื่อไม่ให้ scanner สร้าง pre-registration จากการอ่านบัตรอีกต่อไป

### การยืนยันตัวตนเครื่อง Kiosk

อุปกรณ์ทุกเครื่องต้องได้รับ `DEVICE_ID` และ Scanner Key จาก System Management ก่อนใช้งาน:

1. ผู้ดูแลระบบที่มีสิทธิ์ `system_admin` เปิดเมนูจัดการเครื่องสแกนและสร้างอุปกรณ์ใหม่
2. คัดลอก `.env` snippet จากหน้าต่างที่แสดงหลังสร้างทันที — Scanner Key จะแสดงเป็น plaintext เพียงครั้งเดียว
3. บันทึกลง `scanner_client/.env` บนเครื่อง Kiosk แล้วจำกัดสิทธิ์ไฟล์เป็น `0600`
4. ตอนเริ่มโปรแกรม Scanner Client จะโหลด `.env` (process environment มีสิทธิ์ override), ตรวจ HTTPS/placeholder และเรียก
   `POST /api/v1/scanner/bootstrap` ก่อนเปิด Playwright หรือเริ่มเครื่องอ่านบัตร; credential จะไม่อยู่ใน URL หรือ JavaScript
5. เฉพาะ bootstrap ที่สำเร็จเท่านั้นจึงเปิดหน้า `/kiosk`

ห้ามกรอก Device ID หรือ Scanner Key บนหน้าจอที่ประชาชนใช้งาน และห้ามใส่ Scanner Key ใน URL, browser storage หรือ log

---

## 🔌 อุปกรณ์ฮาร์ดแวร์ที่แนะนำ (Hardware Requirements)

1. **บอร์ดคอมพิวเตอร์**:
   - Raspberry Pi 4 Model B (แนะนำ RAM 2GB / 4GB ขึ้นไป) หรือ Raspberry Pi 5
   - แนะนำระบบปฏิบัติการ: **Raspberry Pi OS (64-bit) Bookworm with Desktop**
2. **MicroSD Card**: ขนาด 16GB ขึ้นไป (Class 10 / A2 ขึ้นไป เพื่อความเร็วในการบูต)
3. **USB Smart Card Reader**: เครื่องอ่านบัตรที่รองรับมาตรฐาน USB CCID และ PC/SC เช่น:
   - Identiv SCR3310 / uTrust 2700R
   - ACS ACR39U / ACR38U
   - Zoweetek / Rocketek หรือเครื่องอ่านบัตรประชาชนมาตรฐานทั่วไป
4. **จอแสดงผล (Display)**:
   - จอ HDMI หรือ DSI Touchscreen (แนะนำความละเอียด 1080x1920 แนวตั้ง หรือ 1920x1080 แนวนอน)
5. **แหล่งจ่ายไฟ (Power Supply)**: อะแดปเตอร์มาตรฐาน Type-C 5V 3A (สำหรับ RPi 4) หรือ 5V 5A (สำหรับ RPi 5)
6. **เครื่องพิมพ์ Label**: **Xprinter XP-365B** (USB, direct thermal, label mode) + ม้วน label ความร้อนแบบมีช่องว่างระหว่างดวง (ค่าตั้งต้น 80×60 mm (กว้าง×สูง), gap 2 mm) — ดู [เครื่องพิมพ์ Label XP-365B](#-เครื่องพิมพ์-label-xp-365b-usb-label-printer)

---

## 🚀 ขั้นตอนการติดตั้งตั้งแต่เริ่มต้น (Step-by-Step Installation)

### Step 1: การเตรียมความพร้อมก่อนเริ่มต้น (Pre-Preparation & SSH Remote Access)

#### 1.1 เขียนระบบปฏิบัติการ (Flash OS)

1. ดาวน์โหลดและเปิดโปรแกรม [Raspberry Pi Imager](https://www.raspberrypi.com/software/) บนคอมพิวเตอร์ของคุณ
2. เลือก **OS**: `Raspberry Pi OS (64-bit)` (Debian Bookworm with Desktop)
3. กดรูปเฟือง (⚙️) หรือ Edit Settings เพื่อตั้งค่าล่วงหน้า:
   - กำหนด **Hostname** (เช่น `kiosk-pi`)
   - กำหนด **Username** และ **Password** (เช่น user: `pi`, pass: `yourpassword`)
   - ตั้งค่า **Wi-Fi SSID/Password** และ **Timezone** (`Asia/Bangkok`)
   - ติ๊กถูกเลือก **Enable SSH** (เลือก Use password authentication)
4. กด Write เพื่อเขียนระบบลงใน MicroSD Card แล้วนำไปเสียบเข้า Raspberry Pi เปิดเครื่องและเชื่อมต่อเครือข่าย

#### 1.2 วิธีเปิดใช้งาน SSH บนตัวเครื่อง Kiosk (เลือกวิธีใดวิธีหนึ่ง)

หากไม่ได้เปิด SSH ไว้ตั้งแต่ตอน Flash หรือต้องการเปิดใช้งานบนเครื่องโดยตรง:

- **วิธีที่ 1: สั่งผ่าน Terminal (เร็วที่สุด):**
  ```bash
  sudo systemctl enable --now ssh
  ```
- **วิธีที่ 2: ผ่านเมนูตั้งค่า `raspi-config`:**
  ```bash
  sudo raspi-config
  # เลือก 3. Interface Options -> I2. SSH -> เลือก <Yes> -> <Finish>
  ```
- **วิธีที่ 3: เปิดล่วงหน้าผ่านไฟล์บน MicroSD Card (Headless):**
  เสียบ MicroSD Card เข้าคอมพิวเตอร์ เปิดไดรฟ์ `boot` (หรือ `bootfs`) แล้วสร้างไฟล์เปล่าชื่อ `ssh` (ไม่มีนามสกุลไฟล์) วางไว้ที่ Root ของไดรฟ์ จากนั้นนำการ์ดไปเปิดเครื่อง

#### 1.3 วิธีดู IP Address และ Remote เข้าเครื่อง

1. ตรวจสอบ IP Address ของ Raspberry Pi:
   ```bash
   hostname -I
   ```
   _(จะได้ IP เช่น `192.168.1.105`)_
2. รีโมตจากคอมพิวเตอร์เครื่องอื่นผ่าน Terminal หรือ VS Code Remote SSH:
   ```bash
   ssh pi@192.168.1.105
   ```

#### 1.4 ทริกการสลับหน้าจอ Terminal ขณะโปรแกรม Kiosk รันเต็มจอ

หากต้องการสลับออกมาสั่งงาน Command Line ขณะที่หน้าจอ Kiosk เปิดค้างอยู่:

- กด **`Ctrl + Alt + T`** เพื่อเปิดหน้าต่าง Terminal
- กด **`Ctrl + Alt + F2`** เพื่อสลับเข้าหน้าจอ TTY Console (กด **`Ctrl + Alt + F1`** หรือ **`F7`** เพื่อกลับหน้าจอกราฟิก)
- กด **`Alt + F4`** เพื่อปิดโปรแกรม Kiosk ชั่วคราว

#### 1.5 อัปเดตแพ็กเกจระบบให้เป็นเวอร์ชันล่าสุด

```bash
sudo apt update && sudo apt full-upgrade -y
```

---

### Step 2: ติดตั้ง System Packages & Smart Card Driver

ติดตั้งไลบรารีพื้นฐานสำหรับการคอมไพล์ C-Extensions, ตัวจัดการ Smart Card (`pcscd`), และแพ็กเกจที่จำเป็นสำหรับ Python:

```bash
sudo apt install -y \
  pcscd \
  pcsc-tools \
  libpcsclite-dev \
  libpcsclite1 \
  libccid \
  python3 \
  python3-pip \
  python3-venv \
  python3-dev \
  build-essential \
  swig \
  libjpeg-dev \
  zlib1g-dev \
  chromium \
  git \
  curl
```

> **คำอธิบายแพ็กเกจสำคัญ:**
>
> - `pcscd` & `libccid`: Daemon ควบคุมเครื่องอ่านสมาร์ตการ์ดผ่านไดรเวอร์มาตรฐาน CCID
> - `libpcsclite-dev` & `swig`: Header และ Wrapper Compiler สำหรับคอมไพล์ไลบรารี `pyscard` ใน Python (จำเป็นอย่างยิ่งบน ARM)
> - `libjpeg-dev` & `zlib1g-dev`: สำหรับไลบรารี `Pillow` ในการถอดรหัสรูปถ่ายหน้าบัตรประชาชน
> - `chromium`: เว็บบราวเซอร์หลักของระบบที่ติดตั้งไว้ที่ `/usr/bin/chromium`

เปิดใช้งานและรัน Service `pcscd`:

```bash
sudo systemctl enable --now pcscd
```

ตรวจสอบว่า service ทำงานปกติ:

```bash
sudo systemctl status pcscd
```

---

### Step 3: ทดสอบการทำงานของเครื่องอ่านบัตร (Hardware Check)

1. เสียบสาย USB เครื่องอ่านบัตรเข้ากับพอร์ต USB ของ Raspberry Pi
2. ตรวจสอบว่าระบบมองเห็นอุปกรณ์ USB:

   ```bash
   lsusb
   ```

   _(จะพบชื่อผู้ผลิตเครื่องอ่านบัตร เช่น `Realtek Corp.`, `Identiv`, หรือ `Advanced Card Systems`)_

3. ทดสอบการตรวจจับบัตรด้วยคำสั่ง `pcsc_scan`:
   ```bash
   pcsc_scan
   ```
4. **ทดลองเสียบบัตรประชาชนไทยเข้าไปในเครื่องอ่าน**:
   - ระบบจะตรวจพบการ์ดและแสดงค่า ATR (Answer To Reset)
   - หากขึ้นข้อความระบุว่าพบ `Thai National ID Card` แสดงว่าฮาร์ดแวร์และไดรเวอร์ทำงานสมบูรณ์ 100%
   - กด `Ctrl + C` เพื่อออกจากโปรแกรมทดสอบ

---

### Step 4: Clone โปรเจกต์ & สร้าง Python Virtual Environment

1. ย้ายไปยังโฟลเดอร์ Home และดาวน์โหลดโค้ดโปรเจกต์:

   ```bash
   cd /home/pi
   git clone https://github.com/your-org/tent.git
   cd tent/scanner_client
   ```

2. สร้างและเปิดใช้งาน Python Virtual Environment (venv):

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. อัปเกรดเครื่องมือจัดการแพ็กเกจ Python:

   ```bash
   pip install --upgrade pip setuptools wheel
   ```

4. ติดตั้ง Python Dependencies จากไฟล์ `requirements.txt`:
   ```bash
   pip install -r requirements.txt
   ```

---

### Step 5: ติดตั้ง Playwright & Browser Dependencies

เนื่องจาก Raspberry Pi ทำงานบนสถาปัตยกรรม **ARM64 (aarch64)** วิธีที่เสถียรและเร็วที่สุดคือการใช้ **System Chromium** ที่ติดตั้งผ่าน `apt` หรือติดตั้งเบราว์เซอร์ของ Playwright:

#### วิธีที่ 1 (แนะนำสำหรับ Raspberry Pi): ใช้ System Chromium

ระบบได้ติดตั้ง `chromium` มาใน Step 2 แล้ว สามารถระบุ Path ใน `.env` ได้ทันที:

```env
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
```

#### วิธีที่ 2: ติดตั้ง Chromium Bundled ของ Playwright

```bash
playwright install chromium
playwright install-deps chromium
```

---

### Step 6: ตั้งค่า Configuration (.env)

คัดลอกไฟล์ตัวอย่าง `.env.example` มาสร้างเป็น `.env`:

```bash
cp .env.example .env
nano .env
```

แก้ไขข้อมูลการตั้งค่าให้ตรงกับการใช้งาน โดยคัดลอกค่าจริงจาก System Management เท่านั้น:

```env
# URL ของ Tent Server (ใช้ HTTPS เมื่อไม่ใช่ loopback development)
TENT_BASE_URL=https://tent.example.go.th

# ค่าที่แสดงครั้งเดียวจาก System Management scanner-create flow
DEVICE_ID=kiosk-sh001-01
DEVICE_SECRET=sk_scan_<one-time-generated-secret>

# กำหนด Path ของ Browser ในระบบ
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

# โหมดการแสดงผล (false = Kiosk Mode เต็มจอไม่มีแถบเครื่องมือ, true = หน้าต่างสำหรับทดสอบ)
DEBUG=false

# ขนาดหน้าจอแนวตั้ง (กรณีรันแบบ Windowed)
WINDOW_WIDTH=1080
WINDOW_HEIGHT=1920

# ความถี่ในการตรวจสอบสถานะบัตร (วินาที)
POLL_INTERVAL=0.5
```

จากนั้นล็อกสิทธิ์ไฟล์ credential:

```bash
chmod 600 .env
```

อย่า commit หรือส่งไฟล์นี้ให้ผู้อื่น และอย่าใช้ค่าใน `.env.example` เป็น credential จริง

---

### Step 7: ทดสอบรันระบบ

#### 1. ทดสอบอ่านข้อมูลบัตรผ่าน Terminal (CLI Smoke Test):

```bash
source .venv/bin/activate
python test_card.py
```

เมื่อเสียบบัตรประชาชน ระบบจะแสดงข้อมูลชื่อ, เลข 13 หลัก, ที่อยู่ และบันทึกรูปถ่ายหน้าบัตรเป็นไฟล์ `test_photo.jpg`

#### 2. เปิด Kiosk และทดสอบการลงทะเบียน (Playwright Kiosk):

```bash
python main.py
```

- หลังยืนยันอุปกรณ์กับ `POST /api/v1/scanner/bootstrap` สำเร็จ หน้าจอจะเปิด Kiosk ของศูนย์ที่ผูกกับเครื่อง
- ผู้ประสบภัยเลือกได้ทั้ง QR ลงทะเบียน, บัตรประชาชน หรือเบอร์โทรศัพท์ที่ใช้ลงทะเบียนล่วงหน้า — ช่องทางเบอร์โทรแสดงเฉพาะเมื่อเปิด「รับรายงานตัวด้วยเบอร์โทรที่ Kiosk」ในหน้าตั้งค่าศูนย์ (Backoffice → ศูนย์พักพิง → แก้ไข หรือ System Management → ศูนย์พักพิง → แก้ไข) หมวด「คุณสมบัติการปฏิบัติการ (Feature Flags)
- สำหรับ phone gate: แตะ **เบอร์โทรศัพท์**, กรอกเบอร์ แล้วแตะค้นหา; หากพบ 2–5 ครัวเรือนให้เลือกครัวเรือนที่ถูกต้องก่อน ถ้าพบมากกว่า 5 รายการ ให้ติดต่อเจ้าหน้าที่ประจำศูนย์
- ตรวจรายชื่อสมาชิกที่มาถึงและเลือกผู้ที่ต้องการรายงานตัว จากนั้นยืนยันเพื่อเปลี่ยนสถานะและแสดง QR สำหรับพิมพ์สายรัดข้อมือ; ครัวเรือนที่มีสมาชิกเกิน 20 คนจะยืนยันเป็นชุด ชุดละไม่เกิน 20 คน
- ชื่อใน phone flow ถูกปิดบางส่วนเพื่อความเป็นส่วนตัว รวมถึงนามสกุลบนสายรัดข้อมือ; รายการที่เจ้าของเลือกไม่ให้ค้นหาจะไม่ปรากฏในผลค้นหา
- เบอร์ที่กรอกใช้ค้นหารายการจองในศูนย์ของอุปกรณ์เท่านั้น ไม่อยู่ใน URL หรือ browser storage; เมื่อออกจากหน้า/หมดเวลา ระบบล้างช่องกรอก
- เครื่อง Client แนบ `X-Device-Id` และ `X-Device-Secret` ให้เฉพาะคำขอ `POST` same-origin ไปยัง `/api/v1/scanner/kiosk/lookup`, `/check-in`, `/config`, `/register` และ `/staff-pin/verify`; browser ไม่ได้รับค่า secret

การทดสอบ `python test_card.py` ในหัวข้อก่อนหน้านี้เป็นการตรวจฮาร์ดแวร์ในเครื่องและแสดงข้อมูลบัตร/บันทึกรูปถ่ายในเครื่องทดสอบเท่านั้น ไม่ใช่ flow ของ Kiosk สำหรับผู้ใช้งานจริง

---

## 🔄 การตั้งค่าให้รันอัตโนมัติเมื่อเปิดเครื่อง (Autostart on Boot)

เพื่อให้ Raspberry Pi ทำงานเป็น Kiosk Standalone เปิดเครื่องแล้วเข้าโปรแกรมสแกนบัตรทันที โดยแสดงผล**เต็มหน้าจอ (Fullscreen Kiosk)** และเริ่มบริการอ่านบัตรโดยอัตโนมัติ

---

### วิธีที่ 1 (แนะนำที่สุด): ติดตั้งด้วยคำสั่งเดียวผ่าน `setup_autostart.sh`

โปรเจกต์มีสคริปต์ `setup_autostart.sh` ที่ช่วยตรวจจับตำแหน่งไดเรกทอรีอัตโนมัติ (ไม่ต้องแก้ไข path ผู้ใช้เอง) และกำหนดค่า Autostart ให้รองรับทั้ง **Labwc** (Raspberry Pi OS Bookworm รุ่นล่าสุด), **Wayfire** และ **XDG Desktop Autostart (`.desktop`)** พร้อมทั้งเปิดใช้งาน service `pcscd`:

1. ย้ายเข้าสู่โฟลเดอร์ `scanner_client`:

   ```bash
   cd ~/tent/scanner_client
   ```

2. รันสคริปต์ติดตั้ง Autostart:

   ```bash
   ./setup_autostart.sh
   ```

   _สคริปต์จะทำการ:_
   - ตรวจจับโฟลเดอร์ปัจจุบันและตั้งสิทธิ์ executable ให้กับ `start_kiosk.sh`
   - สร้างไฟล์ `~/.config/autostart/smart-shelter-kiosk.desktop`
   - เพิ่มคำสั่งรันเข้าไปใน `~/.config/labwc/autostart` (สำหรับระบบที่ใช้ Labwc)
   - สั่งเปิด `pcscd.socket` เพื่อเตรียมพร้อมให้อ่าน Smart Card ทันทีเมื่อเปิดเครื่อง

3. ตรวจสอบสถานะการติดตั้งได้ตลอดเวลาด้วย:

   ```bash
   ./setup_autostart.sh --status
   ```

4. หากต้องการปิด Autostart ชั่วคราว (เช่น ต้องการใช้หน้าจอ Desktop ทั่วไปเพื่อบำรุงรักษา):
   ```bash
   ./setup_autostart.sh --disable
   ```

---

### วิธีที่ 2 (แบบ Manual): ตั้งค่าด้วยตนเอง

#### 2.1 ผ่าน Desktop Autostart (`.desktop`)

1. สร้างโฟลเดอร์ autostart ใน Home directory ของคุณ:
   ```bash
   mkdir -p ~/.config/autostart
   ```
2. คัดลอก template หรือสร้างไฟล์ `.desktop`:
   ```bash
   nano ~/.config/autostart/smart-shelter-kiosk.desktop
   ```
3. กำหนดค่าต่อไปนี้ _(แทนที่ `/path/to/tent/scanner_client` ด้วย path จริงในเครื่องของคุณ)_:
   ```ini
   [Desktop Entry]
   Type=Application
   Name=SmartShelter Kiosk
   Comment=Start SmartShelter Card Scanner Kiosk in Fullscreen
   Exec=sh -c 'cd /path/to/tent/scanner_client && exec ./start_kiosk.sh'
   Terminal=false
   Hidden=false
   X-GNOME-Autostart-enabled=true
   X-GNOME-Autostart-Delay=5
   Categories=Utility;
   ```

#### 2.2 สำหรับ Raspberry Pi OS Bookworm (Labwc / Wayland)

หากใช้ Raspberry Pi OS Bookworm ตัวล่าสุดที่ใช้ Labwc เป็น Window Manager:

1. สร้างหรือแก้ไขไฟล์ `~/.config/labwc/autostart`:
   ```bash
   mkdir -p ~/.config/labwc
   nano ~/.config/labwc/autostart
   ```
2. เพิ่มคำสั่งรัน Kiosk ต่อท้าย:
   ```bash
   sh -c 'cd /path/to/tent/scanner_client && exec ./start_kiosk.sh' &
   ```
3. กำหนดสิทธิ์ให้รันได้: `chmod +x ~/.config/labwc/autostart`

---

### 🖥️ คุณสมบัติการแสดงผลแบบเต็มจอ (Fullscreen Kiosk Mode)

- **Chromium Wayland Native:** ระบบส่ง Flag `--ozone-platform-hint=auto` เพื่อให้ Chromium รันแบบ Wayland แท้บน Labwc / Wayfire ไม่ติดปัญหา Window Border หรือ Taskbar บัง
- **Kiosk Enforced:** เมื่อโปรแกรมรันผ่าน `start_kiosk.sh` ระบบจะบังคับ `DEBUG=false` ให้เป็น Kiosk เต็มจออัตโนมัติ โดยไม่ถูกจำกัดขนาด Window Size
- **Auto Reconnect / Retry:** หากเปิดเครื่องแล้วระบบเครือข่าย (Wi-Fi หรือ LAN) ยังเชื่อมต่อไม่เสร็จ ตัวไคลเอนต์จะมี Retry loop คอยตรวจสอบและโหลดหน้าจอ `/kiosk` ทุก 3 วินาที ไม่ปล่อยให้ค้างที่หน้าจอ Error ของ Chromium
- **สลับโหมดทดสอบ (Windowed Debug):** หากต้องการเปิดเป็นหน้าต่างเพื่อ Debug สามารถสั่งผ่าน Terminal:
  ```bash
  DEBUG=true ./start_kiosk.sh
  ```

---

### 🔍 วิธีตรวจสอบ Log เมื่อ Autostart ไม่ทำงาน

หากบูตเครื่องใหม่แล้วโปรแกรมไม่เปิดขึ้นมา หรือค้างหน้าจอ สามารถตรวจสอบบันทึกการทำงานได้ที่:

```bash
cat /tmp/kiosk_autostart.log
```

หรือดูบันทึกแบบ Real-time:

```bash
tail -f /tmp/kiosk_autostart.log
```

---

## 🖥️ การตั้งค่าจอแสดงผลแนวตั้งและการป้องกันจอดับ (Display Optimization)

### 1. ป้องกันหน้าจอดับ (Disable Screen Blanking / Sleep)

1. เปิดเมนูตั้งค่า Raspberry Pi:
   ```bash
   sudo raspi-config
   ```
2. ไปที่ **Display Options** $\rightarrow$ **Screen Blanking** $\rightarrow$ เลือก **No** (Disable)
3. เลือก **Finish** และ Reboot เครื่อง

### 2. ตั้งค่าการหมุนหน้าจอเป็นแนวตั้ง (Portrait Mode)

- **บน Raspberry Pi OS (Wayland / Wayfire):**
  ไปที่เมนู **Raspberry Pi Menu** $\rightarrow$ **Preferences** $\rightarrow$ **Screen Configuration** $\rightarrow$ คลิกขวาที่หน้าจอ $\rightarrow$ **Orientation** $\rightarrow$ เลือก `Right (90°)` หรือ `Left (270°)` $\rightarrow$ กด Apply
- **ผ่านไฟล์ `/boot/firmware/cmdline.txt` (สำหรับ HDMI Display):**
  เพิ่มค่า `video=HDMI-A-1:1080x1920M@60,rotate=90` ต่อท้ายบรรทัด

---

## 🖥️ ตู้ใหญ่ kiosk3 (ESC/POS + เครื่องอ่าน QR + เครื่องอ่านบัตร RFpro)

ตู้ที่สั่งทำ (ELSKY M219FN-2C) ใช้ฮาร์ดแวร์ต่างจาก Raspberry Pi + XP-365B ตั้งค่าทั้งหมดใน `scanner_client/.env` ของเครื่องนั้น — **ตู้ที่ไม่ตั้งค่าเหล่านี้ทำงานเหมือนเดิมทุกอย่าง** (`PRINTER_BACKEND=cups` · `KIOSK_QR_INPUT=camera` · `CARD_READER=pcsc`)

### ตั้งค่าตู้ใหญ่ทั้งหมดด้วยคำสั่งเดียว

รันด้วย user ของ kiosk (**ไม่ต้องใส่ sudo** — script เรียก sudo เอง) · รันซ้ำได้ · แต่ละขั้นรายงาน ✅/⚠️/❌

```bash
cd ~/tent/scanner_client
./setup_big_kiosk.sh                 # ติดตั้ง/ตั้งค่าทั้งหมด
sudo reboot                          # ให้สิทธิ์ group lp / plugdev มีผล
./setup_big_kiosk.sh --status        # ตรวจอย่างเดียว ไม่แก้อะไร
./setup_big_kiosk.sh --status --test-print   # + พิมพ์หน้าทดสอบ
```

| ขั้น | ทำอะไร |
| --- | --- |
| 1 | ตรวจฮาร์ดแวร์: printer `28e9:5812`, QR `0461:4d81`, เครื่องอ่านบัตร `0483:4c43` |
| 2 | `apt install` แพ็กเกจระบบ (ข้ามได้ด้วย `--skip-apt`) |
| 3 | สร้าง `.venv` + `pip install -r requirements.txt` (ข้ามได้ด้วย `--skip-venv`) |
| 4 | `.env`: เพิ่มเฉพาะค่าฮาร์ดแวร์ที่ยังไม่มี + `chmod 600` · **ไม่เขียน `TENT_BASE_URL` / `DEVICE_ID` / `DEVICE_SECRET`** — แจ้งให้กรอกเองจาก System Management |
| 5 | เพิ่ม user เข้า group `lp` (printer) |
| 6 | `./setup_card_reader.sh` (udev rule + group `plugdev`) |
| 7 | ปิด `cups-browsed` (กัน printer ในเครือข่ายโผล่เข้ามาเอง) |
| 8 | `./setup_autostart.sh` |
| 9 | ปิด sleep/suspend ของระบบ · GNOME: ปิดจอดับ/ล็อกจอ · X11: `xset s off -dpms` ตอน login |

ไม่ทำ: `setup_printer.sh` (XP-365B เท่านั้น) และการตั้งค่าในตัว printer (โหมด black mark ทำให้ตัดกระดาษ ~17 ซม./ใบ — ต้องตั้งที่ printer ตามคู่มือผู้ขาย)

```env
PRINTER_BACKEND=escpos
PRINTER_USB_ID=28e9:5812
PRINTER_WIDTH_DOTS=576
KIOSK_QR_INPUT=reader          # camera | reader | both
# KIOSK_CAMERA_LABEL=JSK-RGB   # ใช้กับ camera/both: เลือกกล้องที่ชื่อมีข้อความนี้
CARD_READER=rfpro
CARD_READER_USB_ID=0483:4c43
```

ค่าผิดรูปแบบ (นอก enum, VID:PID ผิด, ความกว้างนอก 384–832 หรือหาร 8 ไม่ลงตัว) ทำให้ `scanner_client` หยุดตั้งแต่เริ่ม (exit 78) พร้อมบอกชื่อ key ที่ผิด

### ครั้งแรกของแต่ละเครื่อง (นอก `.env`)

```bash
# เครื่องพิมพ์: /dev/usb/lp* เป็น root:lp 0660
sudo usermod -aG lp kiosk
# เครื่องอ่านบัตร: /dev/hidraw* เป็น root 0600 → ให้ group plugdev อ่าน/เขียนเฉพาะโมดูลนี้
./setup_card_reader.sh            # udev rule + group plugdev + ตรวจสิทธิ์ (รันซ้ำได้)
./setup_card_reader.sh --status   # ตรวจอย่างเดียว ไม่แก้อะไร
# แล้ว logout/login ใหม่ → ทดสอบโดยไม่ใช้ sudo: python3 inspect_card_rfpro.py ping
```

### เครื่องพิมพ์ใบเสร็จ ESC/POS (ตู้ใหญ่)

| key | ค่า | default |
| :-- | :-- | :-- |
| `PRINTER_BACKEND` | `cups` \| `escpos` | `cups` |
| `PRINTER_USB_ID` | `VID:PID` (hex) — หา `/dev/usb/lpN` จาก sysfs **ทุกครั้งที่พิมพ์** เลยถอด-เสียบ USB แล้วเลข `lpN` เปลี่ยนก็พิมพ์ต่อได้ | — |
| `PRINTER_DEVICE` | path ตรง ๆ (ใช้แทน `PRINTER_USB_ID` ถ้าตั้ง) | — |
| `PRINTER_WIDTH_DOTS` | ความกว้างหัวพิมพ์ (80 มม. ≈ 576) | `576` |

- ใช้ label PNG ขนาดเดิม (80×60 มม.) — ตัดขอบขาว, ย่อให้พอดีหัวพิมพ์ (ไม่ขยาย) จัดกึ่งกลาง แล้วส่ง `GS v 0` + ตัด `ESC i` ทันที (ไม่เลื่อนกระดาษก่อนตัด) ตรงเข้า device (ไม่ใช้ `GS V` เพราะ printer ตู้ใหญ่ผูก `GS V` กับ black mark → เลื่อนกระดาษ ~17 ซม. ต่อดวงบนม้วนธรรมดา) (ไม่ผ่าน CUPS, ไม่เขียน label ลง disk)
- ความยาวต่อดวงและการรอระหว่างคนกำหนดเป็นค่าคงที่ในโค้ด (ไม่ต้องตั้งใน `.env`): ทุกดวงยาว 60 มม. จากรอยตัดถึงรอยตัด (`LABEL_LENGTH_MM` ใน `app/escpos.py` — เนื้อหาที่สูงเกินถูกย่อ, ที่สั้นกว่าเติมที่ว่างบน-ล่าง) · หักระยะที่ printer kiosk3 เลื่อนกระดาษเองตอนตัด 10 มม. (`CUT_SELF_FEED_MM`) จึงเหลือให้เนื้อหา 50 มม. · ถ้าใบมีดตัดโดนบรรทัดล่าง เพิ่ม `DEFAULT_CUT_FEED_MM` ใน `app/escpos.py` · วัดจากดวงที่ 2 เป็นต้นไป เพราะดวงแรกเริ่มจากรอยตัด/ฉีกครั้งก่อน · รอ 2 วินาทีระหว่างแต่ละคน (`ESCPOS_LABEL_PAUSE_SEC` ใน `app/manager.py`) ไม่เช่นนั้น printer ไม่ตัดดวงก่อน
- สติกเกอร์เส้นประ 60 มม. คร่อมเส้นประหลังใส่ม้วนใหม่ (เครื่องเลื่อน + ตัดเศษทิ้งเองตอนใส่): ฉีกปลายม้วนตรงเส้นประก่อนใส่ วัดความยาวเศษที่ถูกตัดทิ้ง แล้วรัน `venv/bin/python align_printer_paper.py --stub-mm <มม.>` หรือขีดมาร์คดำชิดเส้นประแล้วรัน `--mark` ให้เซนเซอร์ black mark หาเอง — รายละเอียดอยู่หัวไฟล์
- ไม่ตัด / ยาวผิดปกติ: รัน `python3 inspect_printer_cut.py` แล้วดูว่าคำสั่งตัดตัวไหนใช้ได้ และวัดระยะหัวพิมพ์ → ใบมีด (เทสต์ 0)
- เปิดสวิตช์เครื่องพิมพ์แยกต่างหากด้วย ไม่เช่นนั้นจะได้ `PRINT_FAILED` (log: `ESC/POS printer … not found`)
- log `No permission to open /dev/usb/lpN` = user ยังไม่อยู่ใน group `lp` (ดูคำสั่งด้านบน)
- ทดสอบพิมพ์/วัดความกว้างจริง: `sudo ./inspect_hardware.sh --test-printer`

### เครื่องอ่าน QR แบบ HID (CROWN) และกล้อง

| key | ค่า | default |
| :-- | :-- | :-- |
| `KIOSK_QR_INPUT` | `camera` (กล้องอย่างเดียว) \| `reader` (เครื่องอ่านอย่างเดียว ไม่ขอสิทธิ์กล้อง) \| `both` | `camera` |
| `KIOSK_CAMERA_LABEL` | ข้อความในชื่อกล้อง (ไม่สนตัวพิมพ์) เช่น `JSK-RGB`; ไม่เจอ → กล้องหลังตามเดิม | — |
| `KIOSK_QR_READER_MAX_GAP_MS` | ช่วงห่างสูงสุดระหว่างตัวอักษรที่นับว่าเป็นเครื่องอ่าน 10–100 ms (วัดด้วย `sudo ./inspect_hardware.sh --qr`; ใช้ค่าสูงสุด × 2) | `50` |

เครื่องอ่านต้องพิมพ์แบบ keyboard (US layout) และปิดท้ายด้วย Enter หน้า `/kiosk/qr` จะรับข้อความที่พิมพ์เร็วและยาวอย่างน้อย 8 ตัวอักษรเท่านั้น — แป้นพิมพ์ที่คนกดช้า ๆ ไม่ถูกนับเป็นการสแกน หน้าเว็บอ่านค่าเหล่านี้จาก `scanner_client` ในเครื่อง (`POST /api/v1/scanner/kiosk/hardware` ไม่ส่งต่อไป server และไม่มี credential)

### เครื่องอ่านบัตร RFpro (ตู้ใหญ่)

โมดูล HOUSESmart `0483:4c43` (firmware `C2-CEU-PRO V1.15.31.c`) เป็น HID แบบเฉพาะผู้ขาย **ไม่ใช่ PC/SC** (`pcscd`/`pyscard` มองไม่เห็น) — `app/rfpro.py` คุย protocol ของผู้ขายผ่าน `/dev/hidraw*` แล้วใช้ APDU ชุดเดียวกับ `app/scard.py` (flow lookup/ลงทะเบียนด้วยบัตรไม่เปลี่ยน)

- ตั้ง `CARD_READER=rfpro` (+ `CARD_READER_USB_ID` ถ้าไม่ใช่ `0483:4c43`) และรัน `./setup_card_reader.sh` ด้านบน
- เสียบบัตรให้ **ด้านชิปเข้าก่อนและสุดช่อง** — เสียบไม่สุด/กลับด้านจะได้ error "อ่านข้อมูลบัตรไม่สำเร็จ" เสียบใหม่แล้วอ่านได้
- ถอด USB ของโมดูล → log `Smart Card Reader disconnected; waiting for the hardware` เสียบกลับแล้วใช้ต่อได้โดยไม่ restart
- โมดูลตอบกลับเป็น input report ขนาด 32 ไบต์ ถ้าเฟรมคำตอบยาวกว่านั้นมันส่งมาแค่ report แรก และต้อง**ขอหน้าถัดไปทีละหน้าด้วยคำสั่ง `FE FF`** (`AA <INX เดิม> 00 04 00 00 FE FF <CHK>` — ไม่มีในเอกสารผู้ผลิต พบจากการจับทราฟฟิก USB ด้วย usbmon ของไลบรารีผู้ผลิต) `RfproTransport` ทำให้เองเมื่อเฟรมยังไม่ครบ จึงอ่านชื่อ/ที่อยู่/รูปได้ทีละ 255 ไบต์ (วัดบน kiosk3: Le 255 = 9 report, ข้อมูลตรง) — รูปจาก ~17 วินาทีเหลือ ~8 วินาที (เวลาส่วนใหญ่คือสายบัตร 9600 baud ~1.25 ms/ไบต์) ถ้าหน้าถัดไปไม่มา driver ถอยกลับไปอ่านชิ้นละ 20 ไบต์เองและ log `reading in 20-byte pieces` · `inspect_card_rfpro.py paged-reply` ตรวจการอ่านหลายหน้าที่ Le 20…255 · อ่านรูปเกิน 30 วินาทีจะข้ามรูปแล้วลงทะเบียนต่อโดยไม่มีรูป
- driver ส่งได้เฉพาะคำสั่งอ่านที่อยู่ใน allowlist (ไม่มี reboot / เขียน flash / เปลี่ยน baud) และไม่ log ข้อมูลบัตรทุกระดับ · ความเร็วสายโมดูล↔บัตรคงที่ 9600 — ลองแล้วบน kiosk3 (2026-10-03): `18 82` SET_BAUD 38400 ก่อน ATR ทำให้บัตรไม่ตอบรีเซ็ต (status `0xf8`), PPS (`18 83`) เร็วกว่า 9600 โมดูลรับคำสั่งแต่ APDU ถัดไปไม่ตอบ จึงเร่งสายบัตรไม่ได้ · อ่านรูปชิ้นละ 20 ไบต์ ≈ 66 ms/ชิ้น ≈ 17 วินาที
- ตรวจ/วัดเวลา (ต้อง `sudo`, รันในโฟลเดอร์ `scanner_client`):

```bash
sudo python3 inspect_card_rfpro.py ping            # version + สถานะบัตร (ไม่ต้องมีบัตร)
sudo python3 inspect_card_rfpro.py                 # ถึงอ่านเลขบัตร (ปิดบังกลางเลข; --show-cid เพื่อดูเต็ม)
sudo python3 inspect_card_rfpro.py --full          # อ่านทั้งใบ: แสดงเฉพาะความยาวแต่ละ field + เวลา
```

### ตรวจใบหน้าเทียบรูปในชิปบัตร (Face check)

> **สถานะ: ข้อเสนอ ยังไม่ได้รับอนุมัติ** รายละเอียดและเหตุผลอยู่ใน
> [`docs/plans/kiosk-face-verification-implementation-plan.md`](../docs/plans/kiosk-face-verification-implementation-plan.md)
> ปิดอยู่เป็นค่าเริ่มต้น (`KIOSK_FACE_CHECK=off`) ตู้ที่ไม่ตั้งค่าจะทำงานเหมือนเดิมทุกอย่าง

ตรวจว่าคนที่เสียบบัตรตรงกับรูปในชิปบัตรหรือไม่ ทำในเครื่องทั้งหมด (`app/face/`): YuNet หาใบหน้า,
SFace เทียบหน้า, MiniFASNet ตรวจว่าเป็นคนจริง ภาพจากกล้อง รูปในชิป และ embedding อยู่ใน RAM เท่านั้น
ไม่เขียนดิสก์ ไม่ log ไม่ส่งไป server เบราว์เซอร์ได้กลับมาแค่ผล (`match` / `not_confirmed` / `retry` / `skipped`)
หรือคำแนะนำ (เช่น `too_far`) ยกเว้นรูปจากชิปของการรายงานตัวที่ผลเป็น `match` ซึ่งส่งกลับให้หน้าเว็บครั้งเดียวเพื่อแนบไปกับ `/check-in`

เมื่อ `KIOSK_FACE_CHECK=on` ไปต่อเองได้เฉพาะผล `match` ผลอื่นทั้งหมด (`not_confirmed`, ข้าม, ไม่มีรูปในชิป, หมดเวลา,
กล้องหรือ scanner_client เสีย, ไม่ยินยอม) **ต้องให้เจ้าหน้าที่ใส่ PIN 6 หลักของเครื่อง** ก่อน kiosk จะลงทะเบียน (walk-in)
หรือแสดงรายชื่อสมาชิก (check-in) ระบบไม่ปฏิเสธใครถาวร แต่ให้เจ้าหน้าที่ตรวจบัตรด้วยตาแล้วยืนยันด้วย PIN
PIN ตั้ง/ดูได้ที่ `/system-management/scanners` (SA เท่านั้น) ตรวจผ่าน `/api/v1/scanner/kiosk/staff-pin/verify`
โดย scanner_client แนบ device credential ให้ ดู [draft-kiosk-staff-pin-face-bypass](../docs/changes/draft-kiosk-staff-pin-face-bypass.md)
**ก่อนตั้ง `on` ที่เครื่องใด ต้องให้เครื่องนั้นมี PIN แล้ว** ไม่งั้นจะข้ามด้วย PIN ไม่ได้ (`staff_pin_not_set`)
เครื่องที่สร้างใหม่ได้ default PIN ทันที ส่วนเครื่องเดิมที่ยังไม่มี PIN ให้ผู้ดูแลรัน `pnpm sync:central --write --confirm` (ใน `frontend/`)
เพื่อสร้าง default PIN ให้ แล้ว SA ใช้「ดู PIN」แจ้งเจ้าหน้าที่หน้างาน (`KIOSK_FACE_CHECK` ตั้งต่อเครื่อง ต้องตรวจทีละเครื่อง)

```bash
./models/download_models.sh        # ครั้งแรก (setup_big_kiosk.sh ทำให้ด้วย) ตรวจ sha256 ทุกไฟล์
# .env:  KIOSK_FACE_CHECK=on         # off | on   (ดู .env.example) — on เฉพาะตู้ทดสอบจนกว่าจะ calibrate
#        KIOSK_CAMERA_LABEL=JSK-RGB  # กล้องที่ใช้ถ่ายหน้า (ตัวเดียวกับสแกน QR)
```

- **ผลตรวจยังไม่ถูกส่งไป server** (มีแค่รูปจากชิปเมื่อ `match`): `/register` และ `/check-in` ใช้ schema แบบ `strict` จึงยังแนบ `identity_check` ไม่ได้
  จนกว่า Phase 3 (CR + schema) จะเสร็จ ตอนนี้ผลมีผลแค่ต่อหน้าจอ kiosk และบรรทัดสรุปใน log (`Face check finished: flow=… result=…`)
- **เกณฑ์ยังไม่ได้ calibrate** กับรูปบัตรจริง (`app/face/profiles.py`) ใช้ `./inspect_face.py` ทดสอบด้วยบัตรและหน้าของทีมเอง
  (`--card --show-scores`; ลองส่องบัตร รูปพิมพ์ หรือจอมือถือให้กล้องด้วย) อย่าใช้หน้าคนอื่นโดยไม่ได้รับความยินยอม
- **ทดสอบอ่านบัตรจริงพร้อมสแกนหน้าในหน้าต่าง OpenCV** (กล้องสด + รูปจากชิปบัตร + ผลตรงกัน/ไม่ตรง): `./card_face_demo.py`
  เสียบบัตรที่ตัวอ่าน USB ได้เลย (ตัวอ่านตาม `CARD_READER` ใน `.env` หรือ `--reader pcsc|rfpro`) กด `R` อ่านบัตรใหม่ `S` แสดงตัวเลข `Q` ออก
  ต้องใช้ OpenCV แบบมี GUI ซึ่ง `opencv-python-headless` ของ scanner_client ไม่มี ให้ใช้ venv แยก:
  `python3 -m venv .venv-gui && .venv-gui/bin/pip install opencv-python numpy pillow pyscard python-dotenv && .venv-gui/bin/python card_face_demo.py`
  ไม่บันทึกภาพ และแสดงเลขบัตรแค่ 4 ตัวท้าย (ใช้ `--show-data` ถ้าต้องการดูข้อมูลทั้งหมดใน terminal)
- เมื่อเปิด face check หรือสแกน QR ด้วยกล้อง (`KIOSK_QR_INPUT=camera|both`) `scanner_client` ให้สิทธิ์กล้องแก่ origin ของ kiosk อัตโนมัติ (ไม่มี prompt) เปิด `KIOSK_FACE_CHECK=on` จะมี log เตือนว่าเกณฑ์ยังไม่ได้ calibrate ให้คง `off` ไว้บนตู้ที่ให้บริการจริง
- ตรวจว่าสิทธิ์กล้องถูกให้โดยไม่มี prompt จริงบนเครื่อง (ไม่ใช่ CI): `./smoke_face_permissions.py` (เพิ่ม `--headed` เพื่อดูหน้าต่าง, `--live` เพื่อเปิดหน้า `/kiosk/register/face` จริง)
  เปิด Chromium profile ใหม่แบบเดียวกับ manager แล้วถามหน้าเว็บว่า permission เป็น `granted` หรือ `prompt`; ผ่านเมื่อ `granted` (exit 0)
- **ที่เก็บ model**: ค่าเริ่มต้นคือโฟลเดอร์ `models/` ข้างโค้ด (`scanner_client/models/`) ไม่ต้องตั้งอะไรใน `.env`
  ไฟล์ `.onnx` **ไม่ได้อยู่ใน git** (`models/.gitignore`) `git pull` จึงไม่ได้ model มาให้ ต้องรัน `./models/download_models.sh` บนเครื่องนั้นเอง
  ต้องมีครบ 4 ไฟล์: `face_detection_yunet_2023mar.onnx`, `face_recognition_sface_2021dec.onnx`, `MiniFASNetV2.onnx`, `MiniFASNetV1SE.onnx`
  ```bash
  ls -l models/*.onnx                # ต้องเห็น 4 ไฟล์
  ```
  ตั้ง `KIOSK_FACE_MODELS_DIR=/path/ไป/โฟลเดอร์` เฉพาะเมื่อเก็บ model ไว้นอก repo จริงๆ และต้องมีไฟล์ครบ 4 ไฟล์ในโฟลเดอร์นั้น
  **ถ้าไม่ได้ใช้ ให้ปล่อยบรรทัดนี้เป็นคอมเมนต์ หรือลบทิ้ง** (ค่า `/opt/tent/models` ใน `.env.example` เป็นแค่ตัวอย่าง ถ้าเปิดบรรทัดนี้โดยที่ไม่มีไฟล์อยู่ที่นั่น
  จะขึ้น `FACE_MODELS_MISSING` ทั้งที่ `models/` ข้างโค้ดมีไฟล์ครบ) แก้ `.env` แล้วต้อง restart `scanner_client`
- ถ้า model ไม่ครบ (หรือชี้โฟลเดอร์ผิด) เครื่องจะตอบ `FACE_MODELS_MISSING` และหน้า kiosk ถือเป็นผล `unavailable` (ยืนยันไม่ได้) ซึ่งเมื่อ `on` **ต้องให้เจ้าหน้าที่ใส่ PIN** ก่อนไปต่อ
  ใน log จะมีบรรทัด `Face check models are missing: … (run models/download_models.sh): <ชื่อไฟล์ที่หาย>` ดูด้วย `grep -i "models" /tmp/kiosk_autostart.log`
- model ทั้ง 4 ตัวและ license อยู่ใน [`models/MODELS.md`](models/MODELS.md)

### ล็อกไม่ให้ออกจากหน้า kiosk (ตู้ใหญ่)

ใน session GNOME ปกติ **ปัดจอแล้วออกจาก Chromium ได้** (เปิดหน้า Activities / top bar ของ GNOME) — `--kiosk` ของ Chromium กันไม่ได้เพราะท่าปัดเป็นของ GNOME Shell. `setup_kiosk_lockdown.sh` แก้ที่ต้นเหตุ: ตั้ง GDM ให้ **login อัตโนมัติ** เข้า session **GNOME Kiosk Script** (แพ็กเกจ `gnome-kiosk` + `gnome-kiosk-script-session`) ซึ่ง **ไม่มี GNOME Shell เลย** — ไม่มี overview / ท่าปัดจอ / top bar / dock บนจอมีแค่ Chromium ของ kiosk ถ้า Chromium ปิดจะเห็นจอดำ (ไม่ใช่ desktop) แล้วเปิดใหม่เอง

ใช้กับตู้ใหญ่ (Debian + GDM) เท่านั้น — ตู้ Raspberry Pi (labwc) ไม่ต้องใช้

อธิบายการทำงานของ script ทีละส่วน (autologin, session, ไฟล์ที่แตะ, ความปลอดภัย): [`kiosk_lockdown_autologin.md`](kiosk_lockdown_autologin.md)

#### ติดตั้ง (ครั้งแรก)

รันด้วย user ของ kiosk (**ไม่ต้องใส่ sudo**) หลัง `./setup_big_kiosk.sh` ทำงานได้แล้ว และควรทดสอบ kiosk ใน desktop ปกติให้ผ่านก่อน (อ่านบัตร / QR / พิมพ์)

```bash
cd ~/tent/scanner_client
./setup_kiosk_lockdown.sh --restart  # ติดตั้ง + ตั้งค่า → แสดง --status ให้เอง → restart gdm (จอดับแป๊บแล้วเข้า kiosk)
./setup_kiosk_lockdown.sh --status   # ตรวจซ้ำภายหลัง: ทุกบรรทัดต้องเป็น ✅
```

> ⚠️ `--restart` (= `sudo systemctl restart gdm`) จะปิด session ที่เปิดอยู่บนจอตู้ทันที — สั่งผ่าน SSH ได้ (SSH ไม่หลุด) · ไม่ใส่ `--restart` = มีผลตอน login/reboot ครั้งถัดไป · ระหว่างติดตั้ง script แสดงค่าเดิมของปุ่ม `Ctrl+Alt+F3` ให้ด้วย

ตรวจหลัง restart: เข้าหน้า `/kiosk` เองโดยไม่ต้องใส่รหัส · ปัดจอทุกทิศ/หลายนิ้วแล้วไม่ออก · จอยังเป็นแนวตั้ง · แตะปุ่มตรงจุด · อ่านบัตร/สแกน QR/พิมพ์ได้

#### script ทำอะไรกับเครื่อง

| ทำอะไร | ที่ไหน |
| --- | --- |
| `apt install gnome-kiosk gnome-kiosk-script-session` (ถ้ายังไม่มี) | ระบบ |
| เพิ่ม user เข้า group `input` + ให้รัน `chvt 1-6` ได้โดยไม่ต้องใส่รหัส (สำหรับ `Ctrl+Alt+F1..F6`) | ระบบ · `/etc/sudoers.d/tent-kiosk-chvt` |
| ให้หน้า login ของ TTY แสดง hostname + IP | `/etc/issue` (backup: `issue.tent-bak`) |
| เขียนแอปเดียวของ session: วนเปิด `start_kiosk.sh` (ถ้าหลุดจะเปิดใหม่ทุก 30 วินาที) + เปิด `maintenance_hotkey.py` (ตัวรับ `Ctrl+Alt+F1..F6`) ไว้เบื้องหลัง | `~/.local/bin/gnome-kiosk-script` |
| ข้ามหน้า Welcome ของ GNOME ใน session kiosk | `~/.config/gnome-initial-setup-done` |
| จำ session เดิม (เช่น `gnome`) ไว้ใช้ตอน `--disable` | `~/.config/tent-kiosk-lockdown.prev-session` |
| ตั้ง session ตอน login ของ user เป็น kiosk (ผ่าน AccountsService) | `/var/lib/AccountsService/users/<user>` |
| เปิด autologin (`AutomaticLoginEnable=true`, `AutomaticLogin=<user>`) + backup ครั้งแรก | `/etc/gdm3/daemon.conf` (backup: `daemon.conf.tent-bak`) |

ไม่แตะ: การหมุนจอ (`~/.config/monitors.xml` เดิมใช้ต่อ), `.env`, XDG autostart เดิม (ยังอยู่ — `flock` กันเปิดซ้อน)

#### Autologin ทำงานอย่างไร

GDM มี 2 ค่าที่แยกกัน — script ตั้งให้ทั้งคู่:

1. **login ให้ใคร** — `/etc/gdm3/daemon.conf` ใต้ `[daemon]` (ค่าเริ่มต้นของ Debian เป็น comment = ปิดอยู่). หน้า Settings → Users → Automatic Login ของ GNOME ก็เขียนไฟล์นี้
   ```ini
   [daemon]
   AutomaticLoginEnable=true
   AutomaticLogin=kiosk
   ```
2. **เข้า session ไหน** — GDM ใช้ session ล่าสุดที่จำไว้ให้ user (`Session=` ใน `/var/lib/AccountsService/users/kiosk`) ไม่ใช่ใน `daemon.conf`. เทียบได้กับกดรูปเฟือง ⚙ ที่หน้า login แล้วเลือก "Kiosk Script"

script เปลี่ยน session เป็น kiosk **ก่อน** เปิด autologin — ถ้าติดตั้งไม่สำเร็จครึ่งทาง เครื่องจะไม่ autologin เข้า desktop ที่ปัดออกได้

#### กลับเป็นหน้า desktop ปกติ (ซ่อมบำรุง)

**ทางที่ 1 — ผ่าน SSH (แนะนำ)**
```bash
cd ~/tent/scanner_client
./setup_kiosk_lockdown.sh --disable --restart  # จอตู้เข้า desktop GNOME ปกติ (kiosk ยังเปิดผ่าน XDG autostart)
# ... ซ่อม ...
./setup_kiosk_lockdown.sh --restart            # ล็อกกลับ
```

**ทางที่ 2 — ที่ตู้ ใช้คีย์บอร์ด USB (ไม่รู้ IP / SSH ไม่ได้)**: เสียบคีย์บอร์ด → **`Ctrl+Alt+F3`** → หน้า login ตัวอักษรแสดง hostname + IP (เอาไป SSH ต่อได้เลย) → login (ชื่อ + รหัสผ่าน) → รันคำสั่งชุดเดียวกับทางที่ 1 · กลับหน้า kiosk: `Ctrl+Alt+F1` หรือ `F2` (ดูหัวข้อถัดไป)

**ทางที่ 3 — ถ้า script ใช้ไม่ได้ (ทำมือ)**
```bash
sudo busctl call org.freedesktop.Accounts /org/freedesktop/Accounts/User$(id -u kiosk) \
  org.freedesktop.Accounts.User SetSession s gnome
sudo systemctl restart gdm
```

> ⚠️ ระหว่าง `--disable` autologin ยังเปิดอยู่ — **ใครเปิดเครื่องก็เข้า desktop ได้โดยไม่ต้องใส่รหัส** ซ่อมเสร็จต้องล็อกกลับทุกครั้ง (`./setup_kiosk_lockdown.sh --restart`) · ถ้ากดเลือก session "GNOME" เองที่หน้า login GDM จะจำค่านั้นไว้เหมือนกัน — ต้องล็อกกลับเช่นกัน

**ปิด autologin ด้วย** (ให้เครื่องขึ้นหน้า login ใส่รหัสทุกครั้ง): คืนไฟล์ backup
```bash
sudo cp /etc/gdm3/daemon.conf.tent-bak /etc/gdm3/daemon.conf
./setup_kiosk_lockdown.sh --disable --restart
```

#### เข้า TTY ในโหมดล็อก (`Ctrl+Alt+F3`)

ใน kiosk session shortcut ของ GNOME (`Ctrl+Alt+T`, `Alt+F2`, `Super`) ใช้ไม่ได้ เพราะโปรแกรมที่คอยฟังปุ่มเหล่านั้น (GNOME Shell / gnome-settings-daemon) ไม่ได้รัน — เหตุผลเดียวกับที่ปัดจอออกไม่ได้. `Ctrl+Alt+F1..F6` ก็เช่นกัน: บน Wayland kernel ไม่สลับ VT เอง และ gnome-kiosk ไม่ทำแทน (ยืนยันบน kiosk3: `sudo chvt 3` ได้ แต่ปุ่มไม่ได้) จึงมี `maintenance_hotkey.py` อ่านปุ่มจาก kernel แล้วสั่ง `sudo chvt N` ให้:

1. เสียบคีย์บอร์ด USB → `Ctrl+Alt+F3` (คีย์บอร์ดเล็ก/laptop อาจต้อง `Fn+Ctrl+Alt+F3`)
2. หน้าจอตัวอักษรแสดง `SmartShelter kiosk: <hostname>   IP: <ip>` — **ไม่ต้อง login ก็เห็น IP** → เอาไป SSH ต่อได้
3. login ด้วยชื่อ + รหัสผ่าน เพื่อใช้ shell ที่ตู้
4. กลับหน้า kiosk: `Ctrl+Alt+F1` หรือ `Ctrl+Alt+F2`

- ใช้ได้แม้จอดำ (bootstrap ล้ม / Chromium ไม่ขึ้น) เพราะไม่ได้ผ่าน Chromium
- ไม่ยึดคีย์บอร์ด (QR reader ใช้ได้ตามเดิม) และไม่ log ปุ่มที่กด · sudo อนุญาตแค่ `chvt 1`..`chvt 6`
- กดแล้วไม่มีอะไรเกิดขึ้น → ดู `/tmp/kiosk_maintenance_hotkey.log` ผ่าน SSH

รายละเอียด: [`kiosk_lockdown_autologin.md` §7.6](kiosk_lockdown_autologin.md#76-เข้า-tty-ในโหมดล็อก-ctrlaltf3)

#### ใช้กับ user อื่น (`--user`)

ถ้าแยก user ดูแลเครื่อง (มี sudo) กับ user ของ kiosk (ไม่มี sudo) — รันจาก user ดูแลเครื่อง:
```bash
./setup_kiosk_lockdown.sh --user kiosk
./setup_kiosk_lockdown.sh --user kiosk --status
./setup_kiosk_lockdown.sh --user kiosk --disable --restart
```
user ของ kiosk ต้องรัน `scanner_client/start_kiosk.sh` ได้ (script ตรวจให้ก่อนติดตั้ง)

#### แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| `--status`: `session ตอน login: gnome — ยังไม่ได้ล็อก kiosk` | ยังไม่ได้ติดตั้ง หรือมีคนเลือก session GNOME ที่หน้า login — รัน `./setup_kiosk_lockdown.sh --restart` |
| กด `Ctrl+Alt+F3` แล้วไม่มีอะไรเกิดขึ้น | ลอง `Fn+Ctrl+Alt+F3` · ผ่าน SSH: `cat /tmp/kiosk_maintenance_hotkey.log` — `not in the 'input' group` = ยังไม่ได้ restart gdm หลังติดตั้ง · `chvt 3 failed` = ไม่มี sudoers rule (รัน `./setup_kiosk_lockdown.sh --restart`) |
| `ไม่พบ session GNOME Kiosk Script` | แพ็กเกจไม่ครบ: `sudo apt install gnome-kiosk gnome-kiosk-script-session` แล้ว `ls /usr/share/wayland-sessions/` |
| `apt install ไม่สำเร็จ` | เน็ต PSU ต้อง login captive portal ก่อน |
| หลัง restart ขึ้นหน้า text editor แทน kiosk | `~/.local/bin/gnome-kiosk-script` หาย (gnome-kiosk สร้างตัวอย่างแทน) — รัน `./setup_kiosk_lockdown.sh` ใหม่ |
| จอดำค้าง ไม่ขึ้น kiosk | ดู `cat /tmp/kiosk_autostart.log` — exit 78/79 = `.env` ผิด/credential ใช้ไม่ได้ แก้ `.env` ผ่าน SSH แล้วรอ ≤ 30 วินาที (ไม่ต้อง reboot) |
| จอกลายเป็นแนวนอน / แตะไม่ตรงปุ่ม | session kiosk ใช้ `~/.config/monitors.xml` ของ user — ตั้งการหมุนจอใน desktop ปกติ (`--disable`) ที่ Settings → Displays แล้วล็อกกลับ |
| GDM ไม่ขึ้นเลยหลังติดตั้ง | SSH เข้ามา: `sudo cp /etc/gdm3/daemon.conf.tent-bak /etc/gdm3/daemon.conf && sudo systemctl restart gdm` |

---

## 🖨️ เครื่องพิมพ์ Label XP-365B (USB Label Printer)

ปุ่ม **"พิมพ์ QR Code"** บนหน้าผลรายงานตัวพิมพ์ label ออก **Xprinter XP-365B** ทันที 1 ดวงต่อคน โดยไม่มีหน้าต่าง print dialog:

```text
ปุ่ม "พิมพ์ QR Code" → Chromium (--kiosk-printing) → CUPS queue "tent_xprinter" → driver Xprinter (TSPL) → USB → XP-365B
```

- Scanner Client เปิด Chromium พร้อม `--kiosk-printing` เองในโหมด Kiosk (ควบคุมด้วย `KIOSK_SILENT_PRINT` ใน `.env`)
- Driver ของ Xprinter **จำเป็น** — ติดตั้งครั้งเดียวต่อเครื่อง (ไม่ใช่โปรแกรมที่รันค้าง; CUPS เรียกใช้เฉพาะตอนพิมพ์)
- ขนาด label ถูกกำหนดที่ `KIOSK_LABEL_MM` ใน `frontend/src/lib/features/kiosk/domain/print-label.ts` — queue ของเครื่องพิมพ์ **ต้องตั้งขนาดเท่ากัน** ไม่เช่นนั้นจะพิมพ์คร่อมหรือได้ label ว่าง

### 1. ติดตั้งครั้งแรก

ทำหลังติดตั้ง Scanner Client ตาม Step 1–6 แล้ว

1. **ต่อเครื่อง + ใส่ม้วน label:** ต่อ XP-365B เข้าพอร์ต USB ของ Pi แล้วเปิดเครื่อง → ใส่ม้วนให้ **ด้านเคลือบความร้อนหันขึ้นหาหัวพิมพ์** (ขูดด้วยเล็บต้องเกิดรอยดำ) → ปิดฝาจนล็อก
2. **ตรวจโหมด + calibrate:** พิมพ์ self-test (กดปุ่ม FEED ค้างขณะเปิดเครื่อง) → ต้องอยู่ **label mode** → calibrate gap sensor ตามคู่มือที่มากับเครื่อง → กด FEED 1 ครั้งต้องป้อนออก 1 ดวงพอดีรอยฉีก
3. **เตรียมไฟล์ driver:** ดาวน์โหลด `printer-driver-xprinter_3.13.55_all.deb` จาก [xprintertech.com](https://www.xprintertech.com/drivers-2.html) (ไฟล์ไม่อยู่ใน repo) แล้วคัดลอกไปที่ Pi และตรวจ checksum:
   ```bash
   sha256sum ~/printer-driver-xprinter_3.13.55_all.deb
   # ต้องได้ 2dc1d5d182ca7176c509ca07ce40040494d0c5c64eb646d2aa2dfee4c123e9ca
   ```
4. **ติดตั้งและตั้งค่า:**
   ```bash
   cd ~/tent/scanner_client
   ./setup_printer.sh ~/printer-driver-xprinter_3.13.55_all.deb --test
   ```
   - ม้วนไม่ใช่ 80×60 mm (กว้าง×สูง) → ใส่ `--label <กว้าง>x<สูง>` (mm, กว้างไม่เกิน 82) และแก้ `KIOSK_LABEL_MM` ให้ตรงกัน
   - gap ไม่ใช่ 2 mm → ใส่ `--gap <mm>`
   - `--test` พิมพ์ label ทดสอบ 1 ดวง (รันผ่าน SSH ได้) — ต้องออก 1 ดวงพอดี QR สแกนได้
5. **ตั้งค่า `.env`:**
   ```env
   PRINTER_NAME=tent_xprinter
   BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
   ```
   ไม่ต้องตั้ง `KIOSK_SILENT_PRINT` (โหมด Kiosk เปิด silent print ให้อยู่แล้ว)
6. **ทดสอบผ่าน Chromium (จาก terminal บนหน้าจอ Pi ไม่ใช่ SSH):**
   ```bash
   ./test_label_print.sh --cleanup
   ```
   ต้องออก label ทดสอบ 2 ดวงพอดีโดยไม่มี print dialog
7. **ตรวจสถานะ:** `./setup_printer.sh --status` → ทุกข้อต้องเป็น ✅
8. **Reboot** → Kiosk เปิดเอง → รายงานตัวผู้ทดสอบ → กด "พิมพ์ QR Code" → label ออกโดยไม่มี dialog

`setup_printer.sh` ทำให้อัตโนมัติ: ติดตั้ง CUPS + driver, เลือก filter ให้ตรงสถาปัตยกรรม, **ห่อ filter ให้ลบภาพ label ออกจาก `/tmp` หลังทุกงานพิมพ์**, ลบ cron `mvimg.sh` + `/var/log/prnlog` ที่ driver ติดตั้งมา (เก็บภาพชื่อผู้อพยพ), สร้าง queue `tent_xprinter` ขนาด label เป็น default และลบ queue `XP-365B` ที่ driver สร้างเอง, ปิดการเข้าถึง CUPS จากเครื่องอื่น, ติดตั้ง Chromium policy (ไม่มี header/footer, ปิด "Save as PDF")

> ⚠️ `setup_printer.sh` รันได้เฉพาะบน Raspberry Pi (แก้ค่าเครื่องพิมพ์ทั้งระบบ) — บนเครื่อง dev ใช้ `./test_label_print.sh --configure` แทน

### 2. ใช้งานประจำวัน (เจ้าหน้าที่หน้า Kiosk)

| สถานการณ์                          | ทำอย่างไร                                                                                   |
| :--------------------------------- | :------------------------------------------------------------------------------------------ |
| รายงานตัวสำเร็จ                    | กด **"พิมพ์ QR Code"** → ฉีก label ตามรอยทีละดวง → ติดสายรัดข้อมือให้ตรงคน (ดูชื่อบน label) |
| label ออกไม่ครบ / ต้องการพิมพ์ใหม่ | กด "พิมพ์ QR Code" ซ้ำบนหน้าผลเดิม — ไม่บันทึก check-in ซ้ำ                                 |
| กดแล้วไม่มี label ออก              | ตรวจไฟเครื่อง / ฝา / สาย USB → แก้แล้วกดพิมพ์ซ้ำ; ยังไม่ออก → แจ้งผู้ดูแล                   |
| label หมด                          | เปิดฝา → ใส่ม้วนใหม่ (ด้านเคลือบขึ้น) → ปิดฝา → กด FEED 1 ครั้ง → กด "พิมพ์ QR Code" ซ้ำ    |
| พิมพ์คร่อมรอยฉีก / มีดวงว่างแทรก   | กด FEED 1 ครั้งให้เครื่องจับ gap ใหม่ → พิมพ์ซ้ำ; ยังเป็นอยู่ → แจ้งผู้ดูแลให้ calibrate    |
| QR จาง / สแกนไม่ติด                | แจ้งผู้ดูแลให้เพิ่มความเข้ม                                                                 |

หน้าจอ Kiosk ยังไม่แสดงสถานะเครื่องพิมพ์ — ยืนยันผลด้วยการดู label ที่ออกมา

### 3. บำรุงรักษา

| เหตุการณ์                     | ขั้นตอน                                                                                                                                                                     |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| อัปเกรด / ติดตั้ง `.deb` ใหม่ | รัน `./setup_printer.sh <deb ใหม่>` ซ้ำ **ทุกครั้ง** — ตัวติดตั้งของ driver เขียนทับ wrapper และสร้าง cron + queue `XP-365B` กลับมา                                         |
| เปลี่ยนขนาดม้วน label         | (1) แก้ `KIOSK_LABEL_MM` + deploy frontend (2) รัน `./setup_printer.sh --label <W>x<H> --gap <N>` บน **ทุก** Pi (3) `./test_label_print.sh` — (1) กับ (2) ต้องเสร็จพร้อมกัน |
| เปลี่ยนเครื่องพิมพ์ตัวใหม่    | รัน `./setup_printer.sh` ซ้ำ (หา URI ใหม่ให้เอง)                                                                                                                            |
| QR จาง                        | `sudo lpadmin -p tent_xprinter -o Darkness=12` (สูงสุด 15) · ช้าลงให้คมขึ้น `-o PrintSpeed=2`                                                                               |

### 4. แก้ปัญหาเครื่องพิมพ์

| อาการ                                | ตรวจ / แก้                                                                                                                                         |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| ดูสถานะรวม                           | `./setup_printer.sh --status`                                                                                                                      |
| ไม่พบเครื่องบน USB                   | `lsusb` ต้องเห็น `1fc9:2016` (ชื่ออาจขึ้นเป็น "NXP Semiconductors Printer-80") · `lpinfo -v \| grep usb` · เปลี่ยนสาย/พอร์ต                        |
| กดพิมพ์แล้วไม่ออก / job ค้าง         | `lpstat -p tent_xprinter -o` · `cancel -a tent_xprinter` · `sudo cupsenable tent_xprinter`                                                         |
| label ว่างทั้งดวง (ไม่มีสี)          | ใส่ม้วนกลับด้าน หรือไม่ใช่กระดาษความร้อน (ขูดด้วยเล็บต้องเกิดรอยดำ) · ฝาปิดไม่สนิท                                                                 |
| พิมพ์คร่อม label / มี label ว่างแทรก | calibrate gap ใหม่ · ตรวจ `PageSize` ใน `--status` ให้เท่ากับ `KIOSK_LABEL_MM` · รัน setup ด้วย `--label`/`--gap` ให้ตรงม้วน                       |
| ยังมี print dialog ขึ้น              | ตรวจว่า Kiosk รันด้วย `/usr/bin/chromium` (`ps aux \| grep kiosk-printing`) และไม่ได้ตั้ง `KIOSK_SILENT_PRINT=false`                               |
| Filter error                         | `sudo cupsctl --debug-logging` → `sudo tail -f /var/log/cups/error_log` → รัน `./setup_printer.sh` ซ้ำ → ปิดด้วย `sudo cupsctl --no-debug-logging` |

---

## ❓ การแก้ไขปัญหาที่พบบ่อย (Troubleshooting & FAQ)

| ปัญหา                                                                     | สาเหตุที่เป็นไปได้                                          | แนวทางแก้ไข                                                                                                                                                                     |
| :------------------------------------------------------------------------ | :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`ImportError: No module named smartcard`** หรือ `pyscard` build ล้มเหลว | ขาดตัวคอมไพล์ C หรือ header ของ PC/SC                       | รัน `sudo apt install -y swig libpcsclite-dev build-essential` แล้วสั่ง `pip install --no-cache-dir pyscard` ใหม่                                                               |
| **`No readers found` / `SCardListReaders failed`**                        | Service `pcscd` ยังไม่เริ่มทำงาน หรือพอร์ต USB จ่ายไฟไม่พอ  | ตรวจสอบด้วย `sudo systemctl status pcscd` หากหยุดทำงานให้รัน `sudo systemctl restart pcscd` และเสียบสาย USB ให้แน่น                                                             |
| **`Reader is busy` / `Sharing violation`**                                | มีโปรเซสอื่นแย่งจองเครื่องอ่านบัตร                          | ปิดโปรแกรมหรือคำสั่ง `pcsc_scan` หรือ Python script อื่นที่รันค้างอยู่                                                                                                          |
| **Playwright Browser Crash บน ARM**                                       | ขาด shared libraries ของ Chromium                           | ใช้ System Chromium โดยกำหนด `BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser` ใน `.env`                                                                                      |
| **`Missing X server or $DISPLAY`** เมื่อรันผ่าน SSH                       | เซสชัน SSH ไม่ได้รับค่าตัวแปรการแสดงผลกราฟิก                | สั่งรันด้วย `DISPLAY=:0 python main.py` (หรือ `WAYLAND_DISPLAY=wayland-0 DISPLAY=:0 python main.py`) หรือตั้งค่า `HEADLESS=true` ใน `.env` หากต้องการทดสอบโดยไม่เปิดหน้าต่าง UI |
| **Bootstrap ตอบกลับ 401 Unauthorized**                                    | `DEVICE_ID` หรือ Scanner Key ไม่ตรง/อุปกรณ์ inactive        | ตรวจสอบค่าที่คัดลอกจาก System Management และตรวจว่า device ยัง active อยู่                                                                                                      |
| **Bootstrap ตอบกลับ 503 หรือเชื่อมต่อไม่ได้**                             | Tent Server หรือ CouchDB credential service ยังไม่พร้อม     | ตรวจสอบเครือข่ายและสถานะ service; client จะ retry แบบจำกัดจำนวนครั้งและ backoff ก่อนหยุด                                                                                        |
| **โปรแกรมหยุดทันทีด้วย configuration/authentication failure**             | ค่าใน `.env` หาย, เป็น placeholder หรือไม่ผ่าน HTTPS policy | ตรวจสอบ `TENT_BASE_URL`, `DEVICE_ID`, `DEVICE_SECRET` และสิทธิ์ไฟล์ด้วย `chmod 600 .env`                                                                                        |
| **อ่านบัตรแล้วรูปถ่ายไม่ขึ้น**                                            | ขาดไลบรารีประมวลผลรูปภาพ `libjpeg`                          | รัน `sudo apt install -y libjpeg-dev zlib1g-dev` แล้วติดตั้ง `Pillow` ใหม่: `pip install --upgrade --force-reinstall pillow`                                                    |
