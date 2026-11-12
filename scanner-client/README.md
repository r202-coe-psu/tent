# Scanner Client — โปรแกรมอ่านบัตรประชาชนสำหรับหน้าลงทะเบียน

เปิดเว็บศูนย์พักพิงใน Microsoft Edge แล้วส่งข้อมูลจากบัตรประชาชน (เสียบเครื่องอ่านบัตร) เข้าหน้าลงทะเบียน walk-in
อัตโนมัติ ใช้บน Windows 10/11 ไม่ต้องติดตั้ง Python ไม่ต้องใช้สิทธิ์ admin

## ติดตั้ง
1. แตกไฟล์ `scanner-client-win64.zip` ไว้ที่ไหนก็ได้ (เช่น `C:\Tools`) ได้โฟลเดอร์ `scanner-client`
2. ในโฟลเดอร์ `scanner-client` คัดลอก `.env.example` เป็นไฟล์ชื่อ `.env` (อยู่ข้าง `scanner-client.exe`)
3. เปิด `.env` ด้วย Notepad แล้วแก้ `SHELTER_URL=` เป็นที่อยู่เว็บศูนย์ฯ เช่น `https://shelter.example.org`
   (ใส่แค่ `https://ชื่อเว็บ` ไม่ต้องมี path)
4. ดับเบิลคลิก `install-shortcut.bat` → ได้ไอคอน **tent** บน Desktop และใน Start Menu
   (ไม่ต้องใช้ admin · ถ้าย้ายโฟลเดอร์ `scanner-client` ไปที่อื่น ให้ดับเบิลคลิกไฟล์นี้ใหม่)

**ห้ามใส่รหัสผ่านหรือ secret ใด ๆ ใน `.env`** — ไฟล์นี้มีแต่ค่าตั้งต้นที่เปิดเผยได้ เจ้าหน้าที่ล็อกอินในหน้าเว็บเองตามปกติ

## ใช้งานครั้งแรก
1. เสียบเครื่องอ่านบัตร แล้วดับเบิลคลิกไอคอน **tent** (หรือ `scanner-client.exe`)
2. ถ้า Windows ขึ้น SmartScreen ("Windows protected your PC") ให้กด **More info → Run anyway**
   (โปรแกรมยังไม่ได้ลงลายเซ็นดิจิทัล แจ้งครั้งเดียวต่อเครื่อง/ไฟล์ใหม่)
3. หน้าต่าง Edge เปิดที่เว็บศูนย์ฯ → ล็อกอิน → เข้าหน้าลงทะเบียน walk-in → เสียบบัตร ข้อมูลจะเติมในฟอร์ม
4. ปิดโปรแกรมโดยปิดหน้าต่าง Edge ที่โปรแกรมเปิดขึ้น

## ไฟล์ log
`%LocalAppData%\ScannerClient\logs\scanner-client.log` (วางใน Explorer ได้เลย) — log ไม่เก็บข้อมูลบนบัตร
ถอนการติดตั้ง: ลบโฟลเดอร์ `scanner-client` และ `%LocalAppData%\ScannerClient`

## แก้ปัญหาเบื้องต้น
| อาการ | วิธีแก้ |
| --- | --- |
| โปรแกรมปิดทันที / ไม่มีหน้าต่าง | ดู log; ถ้าขึ้น `SHELTER_URL is required` แปลว่ายังไม่ได้สร้าง/แก้ `.env` (ต้องอยู่ข้าง `.exe`) |
| อ่านบัตรไม่ได้ / ไม่เจอเครื่องอ่าน | เสียบเครื่องอ่านใหม่ รอ Windows ติดตั้ง driver เสร็จ แล้วเปิดโปรแกรมใหม่ |
| เลือกเครื่องอ่านผิด (เช่น Windows Hello / virtual smart card) | ตั้ง `CARD_READER_NAME=` เป็นส่วนหนึ่งของชื่อเครื่องอ่านจริง เช่น `ACS` |
| Edge ถูกบล็อกด้วยนโยบายองค์กร | ตั้ง `BROWSER_CHANNEL=chromium` — **ต้องใช้ build ที่ bundle Chromium** (build มาตรฐานนี้ไม่มี) หรือลอง `chrome` |
| ต้องล็อกอินใหม่ทุกครั้ง | ตั้ง `KEEP_LOGIN=true` (เก็บโปรไฟล์ใน `%LocalAppData%\ScannerClient\profile`) |
| ต้องดูข้อความ error สด ๆ | ใช้ `scanner-client-debug.exe` (เปิดพร้อมหน้าต่าง console) จาก `scanner-client-debug-win64.zip` |

ตัวแปรอื่น ๆ (`START_PATH` หน้าแรกที่เปิด ค่าเริ่มต้น `/admin-login`, `WALK_IN_PATH`, `POLL_INTERVAL`) ดูคำอธิบายใน `.env.example`

---

## สำหรับนักพัฒนา
- ต้องมี repo ครบ: โปรแกรมใช้ `../kiosk/app/scard.py` ร่วมกับตู้ kiosk (ไม่ได้ copy)
- รันจาก source: `uv sync` แล้ว `uv run scanner-client` (อ่าน `scanner-client/.env`)
- ใช้ Edge ที่ติดตั้งในเครื่อง (`channel="msedge"`) จึง**ไม่ต้อง**รัน `playwright install` — ตามเอกสาร Playwright
  ต้องสั่ง `uv run playwright install msedge` เฉพาะเครื่องที่ยังไม่มี Edge; ถ้าใช้ `BROWSER_CHANNEL=chromium` ต้อง
  `uv run playwright install chromium`
- Linux (Debian/Ubuntu) รันทีเดียวจบ: `./run-linux.sh` — ติดตั้ง `pcscd`/`libccid` (sudo), uv, deps, Chromium,
  สร้าง `.env` (ถาม `SHELTER_URL` ครั้งแรก), สร้าง shortcut **tent** ในเมนูแอป + Desktop
  แล้วเปิดโปรแกรม · รันซ้ำได้ ข้ามขั้นที่ทำแล้ว · ครั้งต่อไปเปิดจาก shortcut ได้เลย
- test: `uv run pytest`
- build exe (ต้องทำบน Windows ที่ต่อเน็ตได้ ไม่ต้องลง Python/uv เอง): ดับเบิลคลิก `build.bat`
  (หรือ `powershell -ExecutionPolicy Bypass -File .\build.ps1`) — ถ้าไม่มี `uv` ใน PATH สคริปต์จะโหลด uv ไว้ใน
  `.tools\` แล้ว uv โหลด Python ให้เอง → `dist\scanner-client-win64.zip`
  และ `dist\scanner-client-debug-win64.zip` (spec: `scanner-client.spec`, onedir, ไม่ bundle browser)
