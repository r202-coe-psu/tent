# Scanner Client — โปรแกรมอ่านบัตรประชาชนสำหรับหน้าลงทะเบียน

เปิดเว็บศูนย์พักพิงใน Microsoft Edge แล้วส่งข้อมูลจากบัตรประชาชน (เสียบเครื่องอ่านบัตร) เข้าหน้าลงทะเบียน walk-in
อัตโนมัติ ใช้บน Windows 10/11 ไม่ต้องติดตั้ง Python ไม่ต้องใช้สิทธิ์ admin

## ดาวน์โหลด
ตอนนี้ยังไม่มีหน้าดาวน์โหลดกลาง — ขอไฟล์จากทีมพัฒนา (ทีมส่งให้ทาง Drive/LINE หรือแฟลชไดรฟ์)
- **`scanner-client-setup.exe`** — ตัวติดตั้ง (ใช้ไฟล์นี้)
- `scanner-client-win64.zip` — แบบไม่ต้องติดตั้ง (สำรอง)
- `scanner-client-debug-win64.zip` — ไว้ดู error ตอนแก้ปัญหาเท่านั้น

ถ้าโหลดผ่าน Edge/Chrome แล้วขึ้น "isn't commonly downloaded" / "could harm your device" ให้กด **⋯ → Keep →
Keep anyway** (เพราะไฟล์ยังไม่มีลายเซ็นดิจิทัล) · ขอไฟล์จากทีมโดยตรงเท่านั้น อย่าใช้ไฟล์ชื่อเดียวกันจากแหล่งอื่น

ทีมพัฒนา: ได้ไฟล์ทั้งสามจาก `build.bat` ในโฟลเดอร์ `dist\` (ดู "สำหรับนักพัฒนา" ด้านล่าง)

## ติดตั้ง
### 0. ปิด Smart App Control (Windows 11 เท่านั้น ทำครั้งเดียวต่อเครื่อง)
โปรแกรมนี้ยังไม่มีลายเซ็นดิจิทัล (code signing) ถ้าเครื่องเปิด **Smart App Control** ไว้ Windows จะบล็อกตัวติดตั้ง
และตัวโปรแกรมทันที โดย**ไม่มี**ปุ่ม "Run anyway" และเลือกยกเว้นเฉพาะโปรแกรมนี้ไม่ได้
1. Start → พิมพ์ **Smart App Control** → เปิด **Smart App Control settings**
   (หรือ Windows Security → App & browser control → Smart App Control settings)
2. ถ้าขึ้น **On** หรือ **Evaluation** ให้เลือก **Off**
3. ⚠️ Windows บางรุ่นเปิด Smart App Control กลับไม่ได้จนกว่าจะ reset/ติดตั้ง Windows ใหม่ — ใช้กับเครื่องลงทะเบียนของศูนย์ฯ
   เท่านั้น การปิดนี้ไม่ได้ปิด Microsoft Defender Antivirus (ยังสแกนไวรัสตามปกติ)

Windows 10 ไม่มี Smart App Control ข้ามขั้นนี้ได้

### 1. ติดตั้ง (แนะนำ)
1. ดับเบิลคลิก `scanner-client-setup.exe` (ไม่ต้องใช้ admin)
2. ถ้าขึ้น SmartScreen ("Windows protected your PC") ให้กด **More info → Run anyway**
3. ใส่ **SHELTER_URL** = ที่อยู่เว็บศูนย์ฯ เช่น `https://shelter.example.org`
   (ใส่แค่ `https://ชื่อเว็บ` ไม่ต้องมี path · เครื่อง edge ในวง LAN ใช้ `http://` ได้เฉพาะเมื่อใส่เป็น IP
   วงภายใน เช่น `http://192.168.1.10` — ชื่อโฮสต์หรือ IP สาธารณะต้องเป็น `https://`)
4. กด Next จนจบ → ได้ไอคอน **tent** บน Desktop และใน Start Menu

ติดตั้งไว้ที่ `%LocalAppData%\Programs\tent-scanner-client` · ติดตั้งเวอร์ชันใหม่ทับได้เลย (ไม่ถาม URL ซ้ำ ใช้ `.env` เดิม)
· แก้ค่าอื่นใน `.env` ที่โฟลเดอร์นั้นได้ (ดู `.env.example`)

### ติดตั้งแบบ zip (สำรอง)
1. แตกไฟล์ `scanner-client-win64.zip` ไว้ที่ไหนก็ได้ (เช่น `C:\Tools`) ได้โฟลเดอร์ `scanner-client`
2. ในโฟลเดอร์ `scanner-client` คัดลอก `.env.example` เป็นไฟล์ชื่อ `.env` (อยู่ข้าง `scanner-client.exe`)
   แล้วแก้ `SHELTER_URL=` ตามข้อ 3 ด้านบน
3. ดับเบิลคลิก `install-shortcut.bat` → ได้ไอคอน **tent** บน Desktop และใน Start Menu
   (ถ้าย้ายโฟลเดอร์ `scanner-client` ไปที่อื่น ให้ดับเบิลคลิกไฟล์นี้ใหม่)

**ห้ามใส่รหัสผ่านหรือ secret ใด ๆ ใน `.env`** — ไฟล์นี้มีแต่ค่าตั้งต้นที่เปิดเผยได้ เจ้าหน้าที่ล็อกอินในหน้าเว็บเองตามปกติ

## ใช้งานครั้งแรก
1. เสียบเครื่องอ่านบัตร แล้วดับเบิลคลิกไอคอน **tent** (หรือ `scanner-client.exe`)
2. ถ้า Windows ขึ้น SmartScreen ("Windows protected your PC") ให้กด **More info → Run anyway**
   (แจ้งครั้งเดียวต่อเครื่อง/ไฟล์ใหม่) · ถ้าขึ้นว่า **Smart App Control blocked** ให้ทำข้อ 0 ด้านบน
3. หน้าต่าง Edge เปิดที่เว็บศูนย์ฯ → ล็อกอิน → เข้าหน้าลงทะเบียน walk-in → เสียบบัตร ข้อมูลจะเติมในฟอร์ม
4. หน้าต่างเปิดแบบเต็มจอ (เหมือนกด F11) — กด **F11** เพื่อกลับเป็นหน้าต่างปกติ
5. ปิดโปรแกรมโดยปิดหน้าต่าง Edge ที่โปรแกรมเปิดขึ้น (กด **Alt+F4** ได้เลยขณะเต็มจอ)

## ไฟล์ log
`%LocalAppData%\ScannerClient\logs\scanner-client.log` (วางใน Explorer ได้เลย) — log ไม่เก็บข้อมูลบนบัตร
ถอนการติดตั้ง: Settings → Apps → Installed apps → **tent scanner client** → Uninstall
(แบบ zip: ลบโฟลเดอร์ `scanner-client`) แล้วลบ `%LocalAppData%\ScannerClient` ถ้าต้องการล้าง log/โปรไฟล์ด้วย

## แก้ปัญหาเบื้องต้น
| อาการ | วิธีแก้ |
| --- | --- |
| ขึ้น "Smart App Control blocked" / เปิดไม่ขึ้นเลย | ปิด Smart App Control ตามข้อ 0 |
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
  `.tools\` แล้ว uv โหลด Python ให้เอง (Inno Setup ก็เช่นกัน โหลดไว้ใน `.tools\inno`)
  → `dist\scanner-client-setup.exe` (installer จาก `installer.iss`), `dist\scanner-client-win64.zip`
  และ `dist\scanner-client-debug-win64.zip` (spec: `scanner-client.spec`, onedir, ไม่ bundle browser)
