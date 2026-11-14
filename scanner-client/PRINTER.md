# ติดตั้ง printer ฉลาก XP-365B (Windows / Linux)

ตั้ง printer ฉลาก Xprinter **XP-365B** (USB) บนเครื่องลงทะเบียนที่รัน scanner-client ให้พิมพ์ฉลาก QR ขนาด
**80 × 60 มม.** (gap 2 มม.) ได้ ทำครั้งเดียวต่อเครื่อง **ต้องใช้สิทธิ์ admin / sudo** (ติดตั้ง driver)
ทำเฉพาะเครื่องที่ต้องพิมพ์ฉลาก — เครื่องที่ไม่มี printer ใช้อ่านบัตรได้ตามปกติ

## scanner-client ใช้ printer อย่างไร
- หน้าเว็บส่งรูปฉลาก (PNG) มาที่ scanner-client → scanner-client พิมพ์ลง printer USB ของเครื่องนี้เอง
  **ไม่ผ่าน server และไม่ต้องลงทะเบียนเครื่องพิมพ์ในหลังบ้าน**
- หา printer จาก**ชื่อ** = `PRINTER_NAME` ใน `.env` — ไม่ตั้งไว้ใช้ค่าเริ่มต้น:

  | ระบบ | ชื่อ printer เริ่มต้น | ตั้งตามข้อ |
  | --- | --- | --- |
  | Windows | `XP-365B` | [Windows](#windows) |
  | Linux | `tent_xprinter` (คิว CUPS) | [Linux](#linux) |

- ขนาดฉลาก/gap **ตั้งที่ printer** (Windows: Printing Defaults · Linux: คิว CUPS) — โปรแกรมไม่ได้ส่งขนาดไปเอง
- ไม่มี printer ชื่อนั้นในเครื่อง → หน้าเว็บไม่มีตัวเลือกพิมพ์ในเครื่อง (ปุ่มเลือก "printer ที่ต่อกับเครื่องนี้"
  ในหน้าเว็บยังอยู่ระหว่างพัฒนา — ทดสอบตอนนี้ได้ตาม[ทดสอบผ่าน scanner-client](#ทดสอบผ่าน-scanner-client))
- รูปฉลากมีชื่อผู้อพยพ: โปรแกรมส่งจากหน่วยความจำตรงไป printer ไม่เขียนลงดิสก์ ไม่เขียนลง log

---

## Windows

### สรุปค่าที่ต้องตั้ง

| ค่า | ตั้งเป็น |
| --- | --- |
| Driver | Seagull Printer Drivers (`ExpressDelivery_11.5.0.exe`) รุ่น **XP-D365B** |
| ชื่อ printer | **`XP-365B`** (ตัวใหญ่ มีขีด ไม่มีช่องว่าง) |
| Port | `USB00x` — Virtual printer port for USB |
| Default printer | **ไม่ตั้ง** (ถ้าเครื่องมี printer A4 ด้วย) |
| ขนาดฉลาก | **80 × 60 มม.** ทั้งใน Printing preferences และ **Printing Defaults** |
| ชนิดกระดาษ | Labels With Gaps · gap **2 มม.** · Thermal Direct |
| Keep printed documents | **ปิด** (ไม่เก็บสำเนางานพิมพ์ที่มีชื่อคน) |

### W1. ดาวน์โหลด driver
ใช้ **`ExpressDelivery_11.5.0.exe`** (Seagull Printer Drivers, ~89 MB) ไฟล์เดียวกันทุกเครื่อง — ขอจากทีม
(Drive ของทีม) · ต้นทาง: <https://www.xprintertech.com/all-products/driver-xprinter-xp-365b> → Windows driver
(เว็บนั้นต้องกดดาวน์โหลดในเบราว์เซอร์ และเวอร์ชันอาจไม่ตรงกับของทีม)

- ไฟล์มีลายเซ็นดิจิทัลของ **Seagull Software, LLC** (DigiCert EV) → ติดตั้งได้แม้เปิด Smart App Control
  ตรวจได้: คลิกขวาไฟล์ → Properties → Digital Signatures ต้องเห็น Seagull Software, LLC
- ในชุดมี driver Xprinter (`Xprinter.inf`) ที่พิมพ์ภาษา TSPL แบบเดียวกับ XP-365B

### W2. เสียบ printer และเช็กว่า Windows เห็น
1. เปิด printer ใส่ม้วนฉลาก เสียบ USB **ตรงเข้าเครื่อง** (ไม่ผ่าน hub)
2. คลิกขวาปุ่ม Start → **Device Manager** → **Universal Serial Bus controllers** ต้องมีรายการ **Xprinter**
   (หรือ **USB Printing Support**)
3. เช็กให้ชัวร์ (ถ้าข้อ W3 หา port ไม่เจอ): คลิกขวารายการนั้น → Properties
   - แท็บ **Driver** → Driver Provider ต้องเป็น **Microsoft**
   - แท็บ **Details** → Property **Compatible Ids** ต้องมี **`USB\Class_07&SubClass_01&Prot_02`** และ
     `USB\Class_07&SubClass_01` (07 = printer มาตรฐาน)

### W3. หา port ของ printer
1. Settings → Bluetooth & devices → **Printers & scanners** → เลื่อนล่างสุด → **Print server properties**
2. แท็บ **Ports** → หา `USB001` / `USB002` … ที่คำอธิบายเป็น **Virtual printer port for USB**
3. มีหลายตัว: ถอด printer แล้วเปิดหน้านี้ใหม่ — ตัวที่หายไป (หรือตัวที่มีชื่อ Xprinter) คือของ XP-365B
   จดเลข port ไว้

### W4. ติดตั้ง driver
1. ดับเบิลคลิก `ExpressDelivery_11.5.0.exe` → ติดตั้งชุด Seagull Printer Drivers
2. ตัวช่วยติดตั้ง printer: เลือก **Install printer drivers**
3. **ตัวติดตั้งสแกนหา printer USB ไม่เจอ — ปกติ** (มันหาเฉพาะ printer ที่ Windows ติดตั้งไว้แล้ว)
   ให้เลือกเชื่อมต่อแบบ **Other** แทนการสแกน USB
4. รุ่น: เลือก **Xprinter XP-D365B** (ในรายการไม่มี XP-365B ตรงตัว — D365B ใช้ภาษา TSPL2 และ 203 dpi เหมือนกัน
   ต่างแค่รองรับฉลากกว้างกว่า จึงต้องตั้งขนาดฉลากเองในข้อ W5)
5. Port: เลือก `USB00x` ที่จดไว้จากข้อ W3
6. ชื่อ printer: ตัวติดตั้งเสนอ `XP-D365B` → **แก้เป็น `XP-365B`**
   (ตั้งชื่ออื่นได้ แต่ต้องใส่ `PRINTER_NAME=<ชื่อนั้น>` ใน `.env` ของ scanner-client)
7. **ไม่ต้อง**ติ๊ก "ตั้งเป็น default printer" (ถ้าเครื่องมี printer A4 — ไม่งั้นงานพิมพ์อื่นจะออกที่ printer ฉลาก)
8. ไม่ต้องแชร์ printer

### W5. ตั้งขนาดฉลาก
คลิกขวา printer **XP-365B** → **Printing preferences** (ชื่อแท็บอาจต่างเล็กน้อยตามเวอร์ชัน driver)
1. **Page Setup** → **Stock** → **New…**
   - ชื่อ `tent 80x60` · กว้าง **80 mm** · สูง **60 mm** → OK แล้วเลือก stock นี้
2. **Stock / Media Handling**
   - Media type: **Labels With Gaps**
   - Gap height: **2 mm**
   - Method: **Thermal Direct** (ฉลากความร้อน ไม่ใช้ริบบอน)
3. Darkness / Speed: ปล่อยค่าเดิมก่อน — พิมพ์จางค่อยเพิ่ม Darkness
4. **Apply** → OK

**ต้องทำต่อ:** Printer properties → แท็บ **Advanced**
- **Printing Defaults…** → ตั้งค่า**ชุดเดียวกัน**อีกรอบ — scanner-client พิมพ์ด้วย Printing Defaults
  ไม่ใช่ค่าใน Printing preferences
- เอาติ๊ก **Keep printed documents** ออก

> อย่าใช้ขนาดเริ่มต้นของ driver (3×5 นิ้ว) — driver D365B ยอมให้ตั้งฉลากกว้างกว่าที่หัวพิมพ์ XP-365B พิมพ์ได้จริง
> (สูงสุด ~82 มม.) ขอบฉลากจะหาย

### W6. ให้ printer วัดตำแหน่งฉลาก (calibrate)
- Printing preferences → แท็บ **Tools** → **Calibrate** (ถ้ามี)
- หรือที่ตัวเครื่อง: ปิดเครื่อง → กดปุ่ม **FEED** ค้างไว้แล้วเปิดเครื่อง → ปล่อยเมื่อเครื่องเริ่มเดินฉลาก
  (เดิน 2–3 ดวงเพื่อวัด gap)

ทำซ้ำทุกครั้งที่เปลี่ยนม้วนฉลากเป็นขนาดอื่น

### W7. ทดสอบด้วย Windows
1. Printer properties → **Print Test Page**
2. พิมพ์รูป: เปิด PNG ในแอป **Photos** → Print → printer **XP-365B** · ขนาด **tent 80x60** · ย่อขยายแบบ **Fit**

แล้วทดสอบกับโปรแกรมจริงตาม[ทดสอบผ่าน scanner-client](#ทดสอบผ่าน-scanner-client)

---

## Linux
ใช้ script ของ repo `kiosk/setup_printer.sh` (ตัวเดียวกับตู้ kiosk) ติดตั้ง driver ทางการของ Xprinter + ตั้งคิว CUPS
`tent_xprinter` ขนาด 80×60 มม. gap 2 มม. ให้ครบ (Debian / Ubuntu / Raspberry Pi OS — script ใช้ `apt`)

### L1. เตรียม
- repo `tent` ทั้งก้อน (ชุดเดียวกับที่ใช้ `run-linux.sh`)
- driver Linux ของ Xprinter: **`printer-driver-xprinter_3.13.55_all.deb`** — ขอจากทีม หรือโหลดจากหน้าเว็บเดียวกับ
  Windows → Linux driver (ใช้ `.deb` ไม่ใช่ `.rpm`; `printer-driver-pos-*.rpm` คือชุดเดียวกันแบบไม่มียี่ห้อสำหรับ Fedora)
- เปิด printer ใส่ม้วนฉลาก เสียบ USB · เช็ก: `lsusb` ต้องเห็น `1fc9:2016`

### L2. ติดตั้ง + ตั้งคิว
```bash
cd tent/kiosk
./setup_printer.sh ~/Downloads/printer-driver-xprinter_3.13.55_all.deb --force --test
```
- `--force` จำเป็นบนเครื่องที่ไม่ใช่ Raspberry Pi — script นี้แก้ค่าทั้งระบบ:
  - ลบคิว CUPS อื่นที่ชี้ไป XP-365B (เช่นคิว `XP-365B` ที่ driver สร้างเอง) เหลือ `tent_xprinter` คิวเดียว
  - ตั้ง `tent_xprinter` เป็น default printer และติดตั้ง Chromium policy (`/etc/chromium/policies/managed/`)
  - เหมาะกับเครื่องลงทะเบียนที่ใช้งานอย่างเดียว — เครื่องส่วนตัวที่มีคิว XP-365B ใช้อยู่ให้ระวัง
- script ปิดช่องเก็บข้อมูลส่วนตัวของ driver ให้ด้วย: driver ทางการเก็บภาพงานพิมพ์ (ชื่อ + QR) ไว้ใน `/tmp` และ
  ตั้ง cron คัดลอกไป `/var/log/prnlog` — script ห่อ filter ให้ลบภาพหลังพิมพ์ ลบ cron และ `/var/log/prnlog`
  และตั้ง CUPS ไม่เก็บสำเนางาน (`PreserveJobFiles=No`) — **อย่าติดตั้ง `.deb` เองด้วย `apt`/`dpkg` โดยไม่รัน script**
- `--test` พิมพ์ฉลาก QR ทดสอบ 1 ดวง (ไม่ใช่ข้อมูลจริง) — ต้องออก 1 ดวงพอดี ไม่คร่อมรอยฉีก
- Debian/Pi OS Trixie: ถ้า apt แจ้งหา `libcupsimage2` ไม่พบ → `sudo apt-get install -y libcupsimage2t64` แล้วรันใหม่
- รันซ้ำได้ — ต้องรันใหม่เมื่ออัปเกรด `.deb`, เปลี่ยนรุ่นเครื่อง หรือเปลี่ยนขนาดม้วน (`--label WxH --gap N`)

### L3. ตรวจ
```bash
./setup_printer.sh --status
```
ต้องเห็นคิว `tent_xprinter` เปิดใช้งาน (enabled) · PageSize `Custom.80x60mm` · มีคิวของ XP-365B คิวเดียว

scanner-client ใช้ `tent_xprinter` เป็นค่าเริ่มต้นอยู่แล้ว — ไม่ต้องแก้ `.env` (ตั้งชื่อคิวอื่นด้วย `--queue NAME`
→ ใส่ `PRINTER_NAME=NAME` ใน `scanner-client/.env`)

---

## ทดสอบผ่าน scanner-client
ใช้ได้ทั้ง Windows และ Linux — ยืนยันว่าโปรแกรมเจอ printer และพิมพ์ได้จริง (ก่อนหน้าเว็บมีปุ่มพิมพ์ในเครื่อง)
1. เปิด scanner-client → ใส่ URL ศูนย์ → ล็อกอิน
2. กด **F12** → แท็บ **Console** → วางโค้ดนี้แล้ว Enter (พิมพ์ฉลาก 80×60 มีกรอบ + คำว่า TEST 1 ดวง)
   ```js
   const c = Object.assign(document.createElement('canvas'), { width: 639, height: 479 });
   const g = c.getContext('2d');
   g.fillStyle = '#fff'; g.fillRect(0, 0, 639, 479);
   g.lineWidth = 6; g.strokeRect(8, 8, 623, 463);
   g.fillStyle = '#000'; g.font = 'bold 120px sans-serif'; g.fillText('TEST', 170, 280);
   const png = c.toDataURL('image/png').split(',')[1];
   await fetch('/api/v1/kiosk/local-printer', { method: 'POST' }).then(r => r.json()).then(console.log);
   await fetch('/api/v1/kiosk/print', {
     method: 'POST', headers: { 'content-type': 'application/json' },
     body: JSON.stringify({ labels: [png] })
   }).then(r => r.json()).then(console.log);
   ```
3. ผลที่ควรได้
   - บรรทัดแรก `{available: true, name: "XP-365B"}` (Linux: `"tent_xprinter"`)
   - บรรทัดที่สอง `{printed: 1}` และได้ฉลาก 1 ดวง กรอบชิดขอบพอดี ไม่ล้นไปดวงที่สอง

ผลอื่น:
| ผล | ความหมาย |
| --- | --- |
| `available: false` | ไม่มี printer ชื่อนั้นในเครื่อง — เช็กชื่อ (W4 ข้อ 6 / L3) หรือ `PRINTER_NAME` ใน `.env` |
| `PRINTER_NOT_FOUND` | เหมือนข้างบน |
| `PRINT_FAILED` | ส่งงานไม่สำเร็จ — ดู log ของ scanner-client และคิวงานพิมพ์ของระบบ |
| `PRINT_TIMEOUT` | printer/spooler ตอบช้าเกิน 25 วินาที |
| HTTP 404 | ไม่ได้เปิดผ่าน scanner-client (เบราว์เซอร์ธรรมดา) หรือ scanner-client เวอร์ชันเก่า |

## แก้ปัญหา

| อาการ | ทำ |
| --- | --- |
| Windows: ตัวติดตั้งสแกนไม่เจอ printer | ปกติ — เลือก **Other** แล้วเลือก port `USB00x` เอง (W4) |
| Windows: ไม่มี `USB00x` ใน Ports | ถอด USB รอ 10 วินาที เสียบใหม่ · เปลี่ยนสาย/พอร์ต · เช็ก Device Manager (W2) |
| Windows: Driver Provider **ไม่ใช่ Microsoft** แต่มี `USB\Class_07` | คลิกขวา → Update driver → Browse my computer → Let me pick → **USB Printing Support** → ถอด-เสียบใหม่ |
| Windows: Compatible Ids **ไม่มี** `USB\Class_07` (มีแต่ `Class_FF`) | driver Seagull ใช้ไม่ได้ — ใช้ driver Windows ของ Xprinter เอง (เว็บ xprintertech) |
| Windows: Photos พิมพ์ถูก แต่ scanner-client พิมพ์ผิดขนาด | ยังไม่ได้ตั้ง **Printing Defaults** (W5) |
| ฉลากล้นไปดวงที่สอง / มีดวงเปล่า | ขนาดไม่ใช่ 80×60 หรือยังไม่ calibrate (W5–W6 · Linux: รัน L2 ใหม่) |
| ขอบขวาหาย | ขนาดฉลากกว้างเกิน 80 มม. |
| พิมพ์จาง | Windows: เพิ่ม Darkness ทีละ 1–2 ขั้น · Linux: `sudo lpadmin -p tent_xprinter -o Darkness=12` |
| Windows: งานพิมพ์อื่นไปออกที่ printer ฉลาก | XP-365B ถูกตั้งเป็น default — ตั้ง printer A4 เป็น default แทน · ปิด "Let Windows manage my default printer" ใน Printers & scanners |
| Linux: `{printed: 1}` แต่ไม่มีฉลากออก | คิวถูก disable (เช่นถอดสาย/กระดาษหมด) งานค้างในคิว — `lpstat -p tent_xprinter` · เสียบให้เรียบร้อยแล้ว `sudo cupsenable tent_xprinter` |
| Linux: `setup_printer.sh` บอกไม่ใช่ Raspberry Pi | ใส่ `--force` (อ่านผลข้างเคียงใน L2 ก่อน) |
| Linux: ไม่พบ XP-365B บน USB | `lsusb` ต้องเห็น `1fc9:2016` · ตรวจสาย/ไฟ/ปุ่มเปิดเครื่อง |
