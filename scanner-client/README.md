# Scanner Client — โปรแกรมอ่านบัตรประชาชนสำหรับหน้าลงทะเบียน

เปิดเว็บศูนย์พักพิงใน Microsoft Edge แล้วส่งข้อมูลจากบัตรประชาชน (เสียบเครื่องอ่านบัตร) เข้าหน้าลงทะเบียน walk-in
อัตโนมัติ ใช้บน Windows 10/11 ไม่ต้องติดตั้ง Python ไม่ต้องใช้สิทธิ์ admin

## ดาวน์โหลด
ตอนนี้ยังไม่มีหน้าดาวน์โหลดกลาง — ขอไฟล์จากทีมพัฒนา (ทีมส่งให้ทาง Drive/LINE หรือแฟลชไดรฟ์)
- **`scanner-client-setup.exe`** — ตัวติดตั้ง (ใช้ไฟล์นี้ ถ้าเครื่องไม่ได้เปิด Smart App Control)
- **`tent-win64.zip`** — แบบไม่ต้องติดตั้ง สำหรับเครื่องที่**เปิด Smart App Control** (ไม่ต้องปิด ดูข้อ 2)
- `scanner-client-win64.zip` — แบบไม่ต้องติดตั้ง (สำรอง · เป็น `.exe` ที่ไม่มีลายเซ็น Smart App Control บล็อกแน่นอน)
- `scanner-client-debug-win64.zip` — ไว้ดู error ตอนแก้ปัญหาเท่านั้น

ถ้าโหลดผ่าน Edge/Chrome แล้วขึ้น "isn't commonly downloaded" / "could harm your device" ให้กด **⋯ → Keep →
Keep anyway** (เพราะไฟล์ยังไม่มีลายเซ็นดิจิทัล) · ขอไฟล์จากทีมโดยตรงเท่านั้น อย่าใช้ไฟล์ชื่อเดียวกันจากแหล่งอื่น

ทีมพัฒนา: ได้ไฟล์ทั้งหมดจาก `build.bat` ในโฟลเดอร์ `dist\` (ดู "สำหรับนักพัฒนา" ด้านล่าง)

## ติดตั้ง
### 0. Smart App Control (Windows 11)
Smart App Control บล็อกไฟล์ `.exe` ที่ไม่มีลายเซ็นดิจิทัล — ไม่มีปุ่ม "Run anyway" และยกเว้นเฉพาะโปรแกรมนี้ไม่ได้
ดูว่าเปิดอยู่ไหม: Start → พิมพ์ **Smart App Control** → **Smart App Control settings**
(หรือ Windows Security → App & browser control → Smart App Control settings)

- **Off** หรือ Windows 10 (ไม่มี Smart App Control) → ใช้ตัวติดตั้ง (ข้อ 1)
- **On** → ใช้ `tent-win64.zip` (ข้อ 2) ไม่ต้องปิด หรือถ้าอยากใช้ตัวติดตั้ง: เลือก **Off** → ติดตั้ง (ข้อ 1)
  → กลับมาเลือก **On** ได้ (ทดสอบแล้ว: เปิด On + restart แล้วโปรแกรมเปิดและอ่านบัตรได้) · ติดตั้งเวอร์ชันใหม่ทับ
  ต้องปิดก่อนทุกครั้ง · Windows บางรุ่นเปิด On กลับไม่ได้จนกว่าจะ reset เครื่อง — ถ้าไม่แน่ใจใช้ข้อ 2

### 1. ติดตั้ง (แนะนำ)
1. ดับเบิลคลิก `scanner-client-setup.exe` (ไม่ต้องใช้ admin)
2. ถ้าขึ้น SmartScreen ("Windows protected your PC") ให้กด **More info → Run anyway**
3. ใส่ **SHELTER_URL** = ที่อยู่เว็บศูนย์ฯ เช่น `https://shelter.example.org`
   (ใส่แค่ `https://ชื่อเว็บ` ไม่ต้องมี path · เครื่อง edge ในวง LAN ใช้ `http://` ได้เฉพาะเมื่อใส่เป็น IP
   วงภายใน เช่น `http://192.168.1.10` — ชื่อโฮสต์หรือ IP สาธารณะต้องเป็น `https://`)
4. กด Next จนจบ → ได้ไอคอน **tent** บน Desktop และใน Start Menu

ติดตั้งไว้ที่ `%LocalAppData%\Programs\tent-scanner-client` · ติดตั้งเวอร์ชันใหม่ทับได้เลย (ไม่ถาม URL ซ้ำ ใช้ `.env` เดิม)
· URL เปลี่ยนได้ทุกครั้งที่เปิดโปรแกรม (ดู "ใช้งาน") · แก้ค่าอื่นใน `.env` ที่โฟลเดอร์นั้นได้ (ดู `.env.example`) · ไอคอน **tent** เรียก
`python\pythonw.exe -m scanner_client.main` ในโฟลเดอร์นั้น (ไม่มี `scanner-client.exe` ในแบบติดตั้ง)

### 2. แบบ zip `tent-win64.zip` (เครื่องที่เปิด Smart App Control)
ไม่มีไฟล์ `.exe` ของทีมเลย: `tent.exe` คือ `pythonw.exe` ทางการจาก python.org (มีลายเซ็นดิจิทัล) ที่เปลี่ยนชื่อ
ตัวไฟล์ `tent.exe` จึงเป็นรูปงูของ Python แต่ shortcut ที่โปรแกรมสร้างใช้ไอคอน **tent**
1. คลิกขวา `tent-win64.zip` → **Extract All…** → เลือกที่เก็บถาวร เช่น `C:\Users\<ชื่อ>\AppData\Local\Programs`
   (ไม่ใช่ Downloads) ได้โฟลเดอร์ `tent`
2. ดับเบิลคลิก `tent.exe` ในโฟลเดอร์ `tent` (ไฟล์ของโปรแกรมอยู่ในโฟลเดอร์ย่อย `lib` ไม่ต้องเปิด)
   → โปรแกรมเปิดหน้าถาม URL (ดู "ใช้งาน")
   และสร้าง shortcut **tent** บน Desktop และใน Start Menu ให้เอง (ครั้งแรกเท่านั้น)
3. ครั้งต่อไปเปิดจากไอคอน **tent** บน Desktop ได้เลย

ลบ shortcut ทิ้งแล้วโปรแกรมจะไม่สร้างกลับมาเอง · ย้ายโฟลเดอร์ `tent` แล้วเปิด `tent.exe` ที่ใหม่หนึ่งครั้ง
shortcut จะชี้ไปที่ใหม่ · ถ้าไม่มีไอคอนขึ้น สร้างเองได้: คลิกขวา `tent.exe` → Show more options
→ **Send to → Desktop (create shortcut)**

ค่าที่ตั้ง (`.env`) อยู่ในโฟลเดอร์ `tent` · อัปเดต: ปิดโปรแกรม แล้วแตกไฟล์ zip ใหม่ทับโฟลเดอร์เดิม
· ถอนการติดตั้ง: ลบโฟลเดอร์ `tent` และ shortcut

### ติดตั้งแบบ zip เดิม (สำรอง · Smart App Control บล็อก)
1. แตกไฟล์ `scanner-client-win64.zip` ไว้ที่ไหนก็ได้ (เช่น `C:\Tools`) ได้โฟลเดอร์ `scanner-client`
2. (ไม่บังคับ) ตั้งค่าอื่นได้โดยคัดลอก `.env.example` เป็น `.env` ข้าง `scanner-client.exe` — URL ไม่ต้องใส่
   โปรแกรมถามตอนเปิด
3. ดับเบิลคลิก `install-shortcut.bat` → ได้ไอคอน **tent** บน Desktop และใน Start Menu
   (ถ้าย้ายโฟลเดอร์ `scanner-client` ไปที่อื่น ให้ดับเบิลคลิกไฟล์นี้ใหม่)

**ห้ามใส่รหัสผ่านหรือ secret ใด ๆ ใน `.env`** — ไฟล์นี้มีแต่ค่าตั้งต้นที่เปิดเผยได้ เจ้าหน้าที่ล็อกอินในหน้าเว็บเองตามปกติ

### เปลี่ยน SHELTER_URL ภายหลัง
ปิดโปรแกรมแล้วเปิดไอคอน **tent** ใหม่ → ในหน้า "ที่อยู่เว็บศูนย์พักพิง" กด **เปลี่ยน domain** → กรอก URL ใหม่ → Enter
→ ถ้าไม่ใช่ `https://shelter.psu.ac.th` จะขึ้นกล่องเตือนสีแดง ให้ตรวจชื่อเว็บแล้วติ๊ก **ตรวจแล้ว … เป็นเว็บของศูนย์พักพิงจริง**
→ Enter อีกครั้ง (โปรแกรมบันทึกลง `.env` ให้เอง ครั้งหน้าเติมค่านี้ไว้ให้ และขึ้นกล่องเตือนให้ติ๊กทุกครั้งที่เปิด)
· ถ้าตั้ง `SHELTER_URL` เป็น environment variable ของ Windows ไว้ ค่านั้นจะถูกเติมแทน `.env` เสมอ

## ใช้งาน
1. เสียบเครื่องอ่านบัตร แล้วดับเบิลคลิกไอคอน **tent** (แบบ `tent-win64.zip`: `tent.exe` · แบบ zip เดิม:
   `scanner-client.exe`)
2. ถ้า Windows ขึ้น SmartScreen ("Windows protected your PC") ให้กด **More info → Run anyway**
   (แจ้งครั้งเดียวต่อเครื่อง/ไฟล์ใหม่) · ถ้าขึ้นว่า **Smart App Control blocked** ให้ทำข้อ 0 ด้านบน
3. หน้าต่าง Edge เปิดหน้า **ที่อยู่เว็บศูนย์พักพิง** ทุกครั้งที่เปิดโปรแกรม บอกว่าจะเปิดเว็บไหน (URL ที่ใช้ครั้งก่อน
   ถ้ายังไม่เคยตั้ง = `https://shelter.psu.ac.th`) → กด **Enter** เพื่อเปิด หรือกด **เปลี่ยน domain** แล้วกรอก URL ใหม่
   แล้วกด Enter — URL ผิดรูปแบบจะขึ้นข้อความสีแดงให้แก้ (ระหว่างนี้ยังไม่อ่านบัตร)
   · ถ้าเว็บที่จะเปิดไม่ใช่ `https://shelter.psu.ac.th` จะมีกล่องเตือนสีแดง ต้องติ๊กยืนยันก่อนถึงจะเปิดได้
   **ถ้าไม่ได้ตั้งเว็บนั้นเองหรือชื่อดูแปลก (เช่น `shelter-psu.example`) อย่าติ๊ก แจ้งผู้ดูแลระบบ** — ข้อมูลบัตรทุกใบที่เสียบจะถูกส่งไปเว็บนั้น
   · กด Enter โดยยังไม่ติ๊กจะขึ้นข้อความ "ติ๊กช่องด้านบนก่อนกด Enter"
4. เว็บศูนย์ฯ เปิดขึ้น → ล็อกอิน → เข้าหน้าลงทะเบียน walk-in → เสียบบัตร ข้อมูลจะเติมในฟอร์ม
5. หน้าต่างเปลี่ยนเป็นเต็มจอ (เหมือนกด F11) ตอนเปิดเว็บศูนย์ฯ (หน้าใส่ URL ไม่เต็มจอ) — กด **F11** เพื่อกลับเป็นหน้าต่างปกติ
   · กล่องยืนยันของเว็บ (เช่น "ออกจากหน้านี้? ข้อมูลที่ยังไม่บันทึกจะหาย") ขึ้นให้กดเองตามปกติ
6. ปิดโปรแกรมโดยปิดหน้าต่าง Edge ที่โปรแกรมเปิดขึ้น (กด **Alt+F4** ได้เลยขณะเต็มจอ)

## ไฟล์ log
`%LocalAppData%\ScannerClient\logs\scanner-client.log` (วางใน Explorer ได้เลย) — log ไม่เก็บข้อมูลบนบัตร
ถอนการติดตั้ง: Settings → Apps → Installed apps → **tent scanner client** → Uninstall
(แบบ zip: ลบโฟลเดอร์ `scanner-client`) แล้วลบ `%LocalAppData%\ScannerClient` ถ้าต้องการล้าง log/โปรไฟล์ด้วย

## แก้ปัญหาเบื้องต้น
| อาการ | วิธีแก้ |
| --- | --- |
| ขึ้น "Smart App Control blocked" / เปิดไม่ขึ้นเลย | ใช้ `tent-win64.zip` (ข้อ 2) หรือปิด Smart App Control ตามข้อ 0 |
| โปรแกรมปิดทันที / ไม่มีหน้าต่าง | ดู log; `invalid configuration` = ค่าอื่นใน `.env` ผิด (เช่น `POLL_INTERVAL`) แก้ตามข้อความใน log |
| อ่านบัตรไม่ได้ / ไม่เจอเครื่องอ่าน | เสียบเครื่องอ่านใหม่ รอ Windows ติดตั้ง driver เสร็จ แล้วเปิดโปรแกรมใหม่ |
| เลือกเครื่องอ่านผิด (เช่น Windows Hello / virtual smart card) | ตั้ง `CARD_READER_NAME=` เป็นส่วนหนึ่งของชื่อเครื่องอ่านจริง เช่น `ACS` |
| Edge ถูกบล็อกด้วยนโยบายองค์กร | ตั้ง `BROWSER_CHANNEL=chromium` — **ต้องใช้ build ที่ bundle Chromium** (build มาตรฐานนี้ไม่มี) หรือลอง `chrome` |
| เสียบบัตรแล้วไม่ไปหน้า walk-in | ต้องล็อกอินก่อน (บัตรที่เสียบค้างไว้ก่อนล็อกอินจะถูกข้าม: ดึงออกแล้วเสียบใหม่) · ถ้าหน้าที่เปิดอยู่มีข้อมูลยังไม่บันทึกแล้วกด "อยู่หน้านี้" บัตรจะถูกข้ามเช่นกัน บันทึกหรือออกจากหน้านั้นก่อนแล้วเสียบใหม่ |
| ต้องล็อกอินใหม่ทุกครั้ง | ตั้ง `KEEP_LOGIN=true` (เก็บโปรไฟล์ใน `%LocalAppData%\ScannerClient\profile`) — **เฉพาะเครื่องที่เจ้าหน้าที่ใช้คนเดียว** ห้ามเปิดบนเครื่องที่ใช้ร่วมกัน (ดู "ความปลอดภัย") |
| ต้องดูข้อความ error สด ๆ | แบบติดตั้ง: เปิด Command Prompt แล้ว `cd /d %LocalAppData%\Programs\tent-scanner-client` → `python\python.exe -m scanner_client.main` · แบบ `tent-win64.zip`: ในโฟลเดอร์ `tent` สั่ง `python.exe -m scanner_client.main` · แบบ zip เดิม: `scanner-client-debug.exe` จาก `scanner-client-debug-win64.zip` |

ตัวแปรอื่น ๆ (`START_PATH` หน้าแรกที่เปิด ค่าเริ่มต้น `/admin-login`, `WALK_IN_PATH`, `POLL_INTERVAL`) ดูคำอธิบายใน `.env.example`

## ความปลอดภัย (ความเสี่ยงที่รับไว้)
- **เว็บที่เปิดคือที่รับข้อมูลบัตร** — เลขบัตร ชื่อ ที่อยู่ และรูป ถูกส่งให้เว็บที่ตั้งไว้ใน `SHELTER_URL` เท่านั้น
  เว็บอื่นนอกจาก `https://shelter.psu.ac.th` ตั้งได้ (ศูนย์ที่ใช้ domain ของตัวเอง หรือเครื่อง edge ในวง LAN)
  แต่ต้องติ๊กยืนยันทุกครั้งที่เปิดโปรแกรม เพราะใครก็ตามที่เข้าถึงเครื่องได้ครู่เดียวแก้ `.env` เป็นเว็บหน้าตาเหมือนกันได้
  ไม่มี allowlist ของ domain
- **`http://` ในวง LAN ส่งข้อมูลแบบไม่เข้ารหัส** — เมื่อ `SHELTER_URL` เป็น IP วงภายใน (เครื่อง edge ใช้ http :80)
  เลขบัตร รูป รหัสผ่านเจ้าหน้าที่ และ cookie `_session` วิ่งบน LAN ของศูนย์ (มักเป็น Wi-Fi) เป็น plaintext
  ใครอยู่ในวงเดียวกันดักอ่านได้ — ใช้ Wi-Fi ที่มีรหัสผ่านและไม่เปิดให้ผู้ประสบภัยใช้ร่วม จนกว่า edge จะเปิด TLS
- **ช่องทาง event `scanner:*` ไม่ยืนยันตัวผู้ส่ง** — สคริปต์ใด ๆ ที่รันใน origin ของเว็บศูนย์ฯ ส่ง `scanner:card-read`
  ปลอมหรือดักฟังข้อมูลบัตรได้ ยอมรับได้เพราะสคริปต์ใน origin เดียวกันอ่านทุกอย่างในหน้าได้อยู่แล้ว และเจ้าหน้าที่ต้องตรวจ
  ฟอร์มก่อนกดบันทึกเสมอ — **ห้ามใส่สคริปต์ third-party (analytics, chat widget ฯลฯ) ในหน้า walk-in**
  (`/onsite/people/new`) · client ส่งเฉพาะเมื่อแท็บอยู่ที่ origin + path ของหน้า walk-in (ตรวจซ้ำในหน้าเว็บตอนส่ง)
  และไม่ส่งเมื่ออยู่หน้าล็อกอิน
- **`KEEP_LOGIN=true` เก็บ cookie `_session` และรหัสผ่านที่ Edge จำไว้** ใน `%LocalAppData%\ScannerClient\profile`
  ใครเปิดโปรแกรมบนเครื่องนั้นต่อก็เข้าระบบในชื่อเจ้าหน้าที่คนเดิมได้ — ค่าเริ่มต้น `false` ห้ามเปิดบนเครื่องที่ใช้ร่วมกัน
- **reCAPTCHA** — โปรแกรมเปิด Edge แบบไม่มีเครื่องหมาย automation (`--disable-blink-features=AutomationControlled`)
  เพราะ reCAPTCHA หน้าล็อกอินให้คะแนนเป็น bot ถ้าวันหนึ่ง reCAPTCHA เข้มขึ้น ล็อกอินผ่านโปรแกรมนี้จะไม่ผ่าน
  (หน้าเว็บขึ้น error ล็อกอินตามปกติ) ทางสำรองคือ site key / allowlist แยกสำหรับ client นี้ ซึ่งยังไม่ได้ทำ
- log ไม่เก็บข้อมูลบนบัตร · `.env` ไม่มี secret · installer ติดตั้งแบบ per-user ไม่ใช้สิทธิ์ admin
  · ตอน build installer (`scanner-client-setup.exe`) กับ `tent-win64.zip` แพ็กเกจ Python ถูกตรวจ hash ตาม `uv.lock`
  (`--require-hashes`) และ Python embeddable / Inno Setup ตรวจ SHA256 — **ไม่รวม** `scanner-client-win64.zip` /
  `scanner-client-debug-win64.zip` (PyInstaller) และ `run-linux.sh` ที่ติดตั้งด้วย `uv sync` ไม่ได้สั่ง `--require-hashes`
- `SHELTER_URL` รับเฉพาะชื่อ host ที่เป็นตัวอักษร ASCII — ชื่อที่มีตัวอักษรหน้าตาเหมือนกัน (เช่น `е` ภาษารัสเซียแทน `e`)
  เปิดไม่ได้ เพราะกล่องเตือนจะแสดงชื่อที่ดูเหมือนเว็บหลักทุกตัวอักษร · domain ภาษาไทย/IDN ให้ใส่แบบ punycode (`xn--…`)

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
- event contract กับหน้า walk-in (#1326): `scanner:card-reading` → `scanner:card-read` → `scanner:card-photo`
  (หรือ `scanner:card-error`) · หน้าเว็บตอบรับด้วย `preventDefault()` · client ส่งซ้ำทุก 0.5 วินาทีจนหน้าเว็บตอบรับ
  แล้วทิ้ง event หลัง 15 วินาที (`ACK_TIMEOUT_S` ใน `card_session.py`) — popup "กำลังอ่านบัตร" ฝั่งเว็บ
  (`SCANNER_READING_MAX_MS` = 20 วินาที) ต้องนานกว่าค่านี้เสมอ
- client ส่งบัตรไปหน้า walk-in ด้วย router ของแอปเท่านั้น ไม่ reload หน้า ถ้าหน้าที่เปิดอยู่ไม่ยอมเปลี่ยน
  (เจ้าหน้าที่เลือกอยู่หน้าเดิมตอนถามเรื่องข้อมูลที่ยังไม่บันทึก) บัตรจะถูกข้ามและบันทึกใน log
- build exe (ต้องทำบน Windows ที่ต่อเน็ตได้ ไม่ต้องลง Python/uv เอง): ดับเบิลคลิก `build.bat`
  (หรือ `powershell -ExecutionPolicy Bypass -File .\build.ps1`) — ถ้าไม่มี `uv` ใน PATH สคริปต์จะโหลด uv ไว้ใน
  `.tools\` แล้ว uv โหลด Python ให้เอง (Inno Setup ก็เช่นกัน โหลดไว้ใน `.tools\inno`)
  → `dist\scanner-client-setup.exe` (installer จาก `installer.iss` · payload คือ `build\embed\` = Python embeddable
  จาก python.org + deps จาก `uv.lock` + โค้ดเป็น `.py` ไม่ใช่ PyInstaller เพื่อให้ผ่าน Smart App Control),
  `dist\tent-win64.zip` (`build\zip\tent\`: runtime เดียวกับ installer แต่ `pythonw.exe` เปลี่ยนชื่อเป็น
  `tent.exe` + `zip\sitecustomize.py` เปิดโปรแกรมเมื่อเปิด `tent.exe` แบบไม่มี argument — ดู
  `scanner_client/launcher.py`), `dist\scanner-client-win64.zip`
  และ `dist\scanner-client-debug-win64.zip` (spec: `scanner-client.spec`, onedir, ไม่ bundle browser)
