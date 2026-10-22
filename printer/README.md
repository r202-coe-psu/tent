# tent-printer

agent สำหรับ Raspberry Pi หรือเครื่อง kiosk ที่ต่อ Xprinter XP-365B ทาง USB
ดึงงานพิมพ์ label จากระบบ (long-poll ไปที่ BFF) แล้วสั่งพิมพ์ผ่าน CUPS — tablet ไม่ต้องลง driver

## ติดตั้ง

### 0. เตรียมเครื่องเปล่า

**OS:** Raspberry Pi OS (64-bit) **Bookworm** ขึ้นไป (มากับ Python 3.11)
Bullseye มากับ Python 3.9 — agent รันไม่ได้ (`TypeError: unsupported operand type(s) for |`) ตรวจด้วย `python3 --version` ต้อง ≥ 3.11

**แพ็กเกจพื้นฐาน + โค้ด:**

```bash
sudo apt update
sudo apt install -y git python3-venv
git clone https://github.com/r202-coe-psu/tent.git ~/tent    # repo private: ใช้ token หรือ SSH key ของคุณ
cd ~/tent && git checkout poc-print-server
```

**เครื่องพิมพ์:** ต่อ XP-365B ทาง USB เปิดเครื่อง ใส่ม้วน label 80×60 mm ให้อยู่ label mode และ calibrate gap แล้ว
(ขั้นตอนละเอียด: [`kiosk/README.md`](../kiosk/README.md) หัวข้อ "เครื่องพิมพ์ Label XP-365B" ข้อ 1–2)

**ไฟล์ driver:** ดาวน์โหลด `printer-driver-xprinter_3.13.55_all.deb` จาก [xprintertech.com](https://www.xprintertech.com/drivers-2.html) (ไม่อยู่ใน repo) คัดลอกไปไว้ที่ home ของ Pi แล้วตรวจ checksum:

```bash
scp printer-driver-xprinter_3.13.55_all.deb <user>@<pi-ip>:~/     # จากเครื่องที่ดาวน์โหลด
sha256sum ~/printer-driver-xprinter_3.13.55_all.deb
# ต้องได้ 2dc1d5d182ca7176c509ca07ce40040494d0c5c64eb646d2aa2dfee4c123e9ca
```

**ลงทะเบียนเครื่อง:** back-office → **จัดการเครื่องพิมพ์** → เพิ่มเครื่อง แล้วจด `DEVICE_ID` / `DEVICE_SECRET` (secret แสดงครั้งเดียว)

**เครือข่าย:** Pi ต้องเข้าถึง URL ของระบบได้ — ระหว่างทดสอบกับ dev server ใช้ IP วง LAN/Wi-Fi ของเครื่อง dev (เช่น `http://192.168.1.42:5173`)
ไม่ใช่ IP ของ docker bridge (`172.17.x` / `172.18.x`) ตรวจจาก Pi ด้วย `curl -I <URL>`

### 1. ตั้ง CUPS queue ของ XP-365B

ใช้สคริปต์ของ kiosk (ลง CUPS + driver ทางการของ Xprinter + สร้าง queue `tent_xprinter` ขนาด 80×60 mm):

```bash
sudo usermod -aG lpadmin "$USER"     # ครั้งแรก แล้ว logout/login ใหม่ (สคริปต์ต้องใช้ lpinfo หาเครื่องบน USB)
cd ~/tent/kiosk
./setup_printer.sh ~/printer-driver-xprinter_*.deb --queue tent_xprinter --test
```

`--test` พิมพ์ label ทดสอบ 1 ใบ — ถ้าออก แปลว่า CUPS พร้อม
ถ้าขึ้น `ไม่พบ XP-365B บน USB`: ตรวจสาย/ไฟ, `lsusb | grep 1fc9` ต้องเห็น `1fc9:2016`

### 2. ติดตั้ง agent

```bash
cd ~/tent/printer
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # dependency มีแค่ httpx
cp .env.example .env && chmod 600 .env
```

แก้ `.env`:

| ตัวแปร | ค่า |
|---|---|
| `TENT_BASE_URL` | URL ของระบบ — ต้องเป็น `https://` ยกเว้น `http://` ไปยัง localhost/LAN |
| `DEVICE_ID` / `DEVICE_SECRET` | จาก back-office |
| `PRINTER_NAME` | ชื่อ CUPS queue จากขั้นที่ 1 (`tent_xprinter`) |
| `BOOT_SLIP` | `1` = พิมพ์สลิป (ชื่อเครื่อง, device, shelter, IP) ทุกครั้งที่ agent เริ่ม · `0` = ปิด |

ตัวเลือกอื่นดูใน [`.env.example`](.env.example) · คอมเมนต์ต้องอยู่บรรทัดของตัวเอง (ห้ามต่อท้ายค่า)

### 3. ลองรัน

```bash
./run.sh          # Ctrl+C เพื่อหยุด · ./run.sh --setup = ติดตั้ง dependency อย่างเดียว
```

ถ้าถูกต้อง: log ไม่มี error และพิมพ์บูตสลิปออก 1 ใบ จากนั้นกดพิมพ์จาก tablet ได้เลย

### 4. ให้เปิดเองหลัง boot

```bash
./setup_autostart.sh             # ติดตั้ง systemd service tent-printer-autostart + เปิดทันที (เรียก sudo เอง)
./setup_autostart.sh --disable   # ปิด/ถอนออก
```

service รัน `./run.sh` จากโฟลเดอร์นี้ด้วย user ปัจจุบัน ไม่ต้องมีจอหรือ login และ restart เองใน 5 วินาทีถ้า agent ล้ม
**อย่ารัน `./run.sh` เองขณะ service ทำงานอยู่** — จะมี agent สองตัวแย่งงานกัน (`--disable` ก่อน)

### Restart

```bash
sudo systemctl restart tent-printer-autostart
```

ต้อง restart ทุกครั้งที่: อัปเดตโค้ด (`git pull`), แก้ `.env` (เช่นใส่ `DEVICE_SECRET` ใหม่), หรือรัน `kiosk/setup_printer.sh` ใหม่
หยุดชั่วคราว: `sudo systemctl stop tent-printer-autostart` · เริ่มใหม่: `sudo systemctl start tent-printer-autostart` (หลัง reboot service ขึ้นเองอยู่แล้ว)

## ดูสถานะ

| ดูอะไร | คำสั่ง |
|---|---|
| service ทำงานอยู่ไหม + log ล่าสุด | `./setup_autostart.sh --status` |
| log สด | `journalctl -u tent-printer-autostart -f` |
| CUPS queue | `LC_ALL=C lpstat -p tent_xprinter` → ต้องเป็น `idle` / `enabled` |
| งานที่ค้างใน CUPS | `lpstat -W not-completed -o tent_xprinter` |
| ภาพรวมการตั้งค่าเครื่องพิมพ์ | `~/tent/kiosk/setup_printer.sh --status` |
| จากฝั่งระบบ | back-office → **จัดการเครื่องพิมพ์**: ออนไลน์/ออฟไลน์, สถานะคิวพิมพ์, IP ของเครื่อง |

ระบบนับว่าเครื่อง **ออนไลน์** เมื่อ agent ติดต่อเข้ามาภายใน 90 วินาทีล่าสุด และ CUPS queue พร้อม (`ready`)

log มี job id / จำนวน label / error code แต่ไม่มี secret และไม่มีข้อมูลบน label

### อาการที่พบบ่อย

| log / อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `device auth failed` / 401 ซ้ำ ๆ | `DEVICE_ID`/`DEVICE_SECRET` ผิด หรือ secret ถูกออกใหม่ — ใส่ค่าล่าสุดใน `.env` แล้ว `sudo systemctl restart tent-printer-autostart` |
| `printer queue … is missing` | ชื่อ `PRINTER_NAME` ไม่ตรงกับ `lpstat -p` หรือยังไม่ได้ทำขั้นที่ 1 |
| `printer queue … is disabled` | CUPS ปิด queue (มักหลังกระดาษหมด/ปิดเครื่อง): `sudo cupsenable tent_xprinter` แล้วตรวจกระดาษ/ไฟ |
| `boot slip not printed: lp failed` | ส่งงานเข้า CUPS ไม่ได้ — ลอง `echo test \| lp -d tent_xprinter -` เพื่อดู error จริง |
| `hello failed: …` / `poll failed: …` | `TENT_BASE_URL` ผิด หรือเครื่องอยู่คนละวงแลน — `curl -I <TENT_BASE_URL>` จากเครื่องนี้ |
| งานขึ้น `printer_timeout` | เครื่องพิมพ์ไม่ตอบใน `PRINT_JOB_TIMEOUT_SEC` — ปิดอยู่/กระดาษหมด ดู `lpstat -p` |
| label ขนาดเพี้ยน | `PRINT_PPI` ต้องเป็น 203 และม้วนจริงเป็น 80×60 mm (รัน `setup_printer.sh` ใหม่ถ้าเปลี่ยนม้วน) |
| service ล้มวนซ้ำ ๆ ทันทีหลังเริ่ม | ดู `journalctl -u tent-printer-autostart -n 50` — มักเป็น `.env` ผิด หรือ Python ต่ำกว่า 3.11 |
