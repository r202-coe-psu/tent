# tent-printer

agent สำหรับ Raspberry Pi (หรือเครื่อง kiosk) ที่ต่อเครื่องพิมพ์ label Xprinter XP-365B ทาง USB
ทำหน้าที่ long-poll งานพิมพ์จากระบบ (BFF `/api/v1/printer/*`) แล้วสั่งพิมพ์ผ่าน CUPS ทำให้ tablet ไม่ต้องลง driver

```
tablet ──สั่งพิมพ์──▶ BFF (SvelteKit) ──▶ CouchDB printing_{code}
                          ▲
                          │ https long-poll (DEVICE_ID / DEVICE_SECRET)
Raspberry Pi: tent-printer agent ──▶ CUPS queue tent_xprinter ──USB──▶ XP-365B
```

Pi เชื่อมต่อออกไปหา server เพียงทางเดียว ไม่ต้องเปิด port ขาเข้า และไม่ได้ต่อ CouchDB โดยตรง

## สรุปขั้นตอน

| # | ทำที่ไหน | ขั้นตอน | ทำบ่อยแค่ไหน |
|---|---|---|---|
| 0 | server | ตั้งค่า env ของ print server แล้วสร้าง user `printing_service` | ครั้งเดียวต่อ deployment |
| 1 | back-office | ลงทะเบียนเครื่องพิมพ์ แล้วจด `DEVICE_ID` กับ `DEVICE_SECRET` | ครั้งเดียวต่อ Pi |
| 2 | Pi | ติดตั้ง OS, แพ็กเกจ และดึงโค้ด | ครั้งเดียวต่อ Pi |
| 3 | Pi | สร้าง CUPS queue `tent_xprinter` | ครั้งเดียวต่อ Pi (ทำใหม่เมื่อเปลี่ยนม้วนหรือเครื่องพิมพ์) |
| 4 | Pi | เขียนไฟล์ `.env` ของ agent | ครั้งเดียวต่อ Pi |
| 5 | Pi | ติดตั้ง agent เป็น systemd service | ครั้งเดียว และรันซ้ำทุกครั้งที่อัปเดต |
| 6 | Pi + back-office | ตรวจว่าใช้งานได้จริง | หลังติดตั้งหรืออัปเดต |

---

## 0. ฝั่ง server (ทำครั้งเดียวต่อ deployment)

ข้ามขั้นนี้ได้ถ้า deployment ที่จะใช้ตั้งค่าไว้แล้ว ตรวจได้จากหน้า back-office → **จัดการเครื่องพิมพ์** ถ้าหน้านั้นเปิดได้และไม่ขึ้น 503 แสดงว่าตั้งค่าแล้ว

Pi ไม่ได้ใช้ค่าในขั้นนี้เลย ค่าที่ Pi ใช้มีแค่ `DEVICE_ID` / `DEVICE_SECRET` จากขั้นที่ 1

### 0.1 staging / production (docker compose)

**ใส่เองใน `.env` ที่ root ของ repo บนเครื่อง server** ทุกค่าต้องสุ่มเอง ห้ามใช้ `change-me-in-staging` จาก `.env.example` และ staging กับ prod ควรใช้คนละชุด

```bash
COUCHDB_PRINTING_SERVICE_USER=printing_service
COUCHDB_PRINTING_SERVICE_PASSWORD=<openssl rand -hex 24>
PRINT_HOUSEKEEPING_TOKEN=<openssl rand -hex 32>
```

ถ้าไม่ใส่ `COUCHDB_PRINTING_SERVICE_PASSWORD` หรือ `PRINT_HOUSEKEEPING_TOKEN` compose จะไม่ยอมขึ้น (`... is required`)

**ไม่ต้องใส่เอง** compose ประกอบให้จากค่าข้างบน:

| ตัวแปร | service | ค่า |
|---|---|---|
| `COUCHDB_PRINTING_SERVICE_URL` | `frontend` | `http://printing_service:<รหัส>@couchdb:5984` (ใช้ `couchdb` ไม่ใช่ `localhost` และเป็น `http://` เพราะคุยกันใน docker network) |
| `PRINT_HOUSEKEEPING_TOKEN` | `frontend`, `worker` | ส่งต่อจาก root `.env` (frontend ตรวจ, worker ส่งเป็น Bearer) |
| `PRINT_HOUSEKEEPING_URL` | `worker` | `http://frontend:3000` |
| `PRINT_HOUSEKEEPING_INTERVAL_MS` | `worker` | ไม่ต้องตั้ง (ค่าเริ่มต้น 30 000 · ถ้าตั้งต้องไม่เกิน 120 000 ไม่งั้น healthcheck จะ unhealthy ตลอด) |

`frontend/.env` ไม่ถูกใช้ใน container ของ staging / prod

**สร้าง user `printing_service` ใน CouchDB:** pipeline deploy (`Jenkinsfile.staging`, `Jenkinsfile.prod`) รัน `pnpm db:sync` ใน container `frontend` ซึ่งรวม `redeploy:access --write --confirm` อยู่แล้ว deploy ครั้งแรกหลังใส่ `.env` จึงสร้าง user ให้เอง
ถ้าต้องรันเอง (เช่น deploy ไปก่อนใส่ `.env`):

```bash
# prod ใช้ docker-compose.production.no-nginx.yml
docker compose -f docker-compose.staging.no-nginx.yml run --rm frontend pnpm redeploy:access                    # dry-run: ต้องเห็น would create _users "printing_service"
docker compose -f docker-compose.staging.no-nginx.yml run --rm frontend pnpm redeploy:access --write --confirm  # สร้างจริง
```

**nginx** มีใน repo แล้ว ไม่ต้องตั้งเพิ่ม: `/api/internal/printers/` ถูกปิดจากภายนอก (404) และ `/api/v1/printer/*` จำกัด 2 connection ต่อเครื่อง
ควรมี HTTPS อยู่หน้า server เพราะ Pi ต่อแค่ `https://` เป็นค่าเริ่มต้น (ถ้าไม่มี ดู `TENT_ALLOW_HTTP` ในขั้นที่ตั้ง `.env`)

**ตรวจหลัง deploy:**

1. container `worker` ขึ้น `healthy` (healthcheck ดูว่า housekeeping เรียกสำเร็จภายใน 2 นาที — ถ้า unhealthy ดู log ของ `worker` หา `print housekeeping`)
2. back-office → **จัดการเครื่องพิมพ์** เปิดได้และไม่ขึ้น 503
3. ลงทะเบียนเครื่อง (ขั้นที่ 1) แล้วกด **พิมพ์ทดสอบ** ด้วย user ที่มี `system_admin` หรือ `shelter:{CODE}` + `{CODE}:shelter_manager`
   (`admin` ของ CouchDB มีแค่ role `_admin` ซึ่งพิมพ์ไม่ได้ และจะขึ้น "คุณไม่มีสิทธิ์ในการทำรายการนี้")

### 0.2 dev (`pnpm dev` นอก docker)

ใส่ใน `frontend/.env` (ใช้ `localhost` เพราะรันนอก docker):

```bash
COUCHDB_PRINTING_SERVICE_URL=http://printing_service:<รหัส>@localhost:5984
PRINT_HOUSEKEEPING_TOKEN=<openssl rand -hex 32>
```

ถ้าไม่ตั้ง `COUCHDB_PRINTING_SERVICE_URL` สคริปต์จะข้ามการสร้าง user ไป (ขึ้นแค่ `⚠️ COUCHDB_PRINTING_SERVICE_URL unset — skipping user`)

```bash
cd frontend
pnpm redeploy:access                    # dry-run: ต้องเห็น would create _users "printing_service"
pnpm redeploy:access --write --confirm  # สร้างจริง
```

### ข้อควรรู้

- ห้ามใช้ `pnpm seed` บน deployment จริง เพราะจะใส่ mock data (~1k people) ลงไปด้วย
- user `printing_service` ถูกสร้างแบบไม่มี role ส่วนสิทธิ์ admin ของ DB `printing_devices` และ `printing_{code}` server ใส่ให้เองตอนสร้าง DB
- ถ้าจะเปลี่ยนรหัสทีหลัง ต้องแก้ทั้ง `.env` และรหัสของ user ใน CouchDB ให้ตรงกัน เพราะสคริปต์จะข้าม user ที่มีอยู่แล้ว ไม่ทับรหัสเดิม
- ถ้าไม่ได้ตั้ง env นอก dev ระบบจะตอบ 503 และไม่ fallback ไปใช้ admin

## 1. ลงทะเบียนเครื่องพิมพ์ใน back-office

1. เข้า back-office → **จัดการเครื่องพิมพ์** (`/back-office/printers`) ด้วยบัญชีที่มีสิทธิ์จัดการเครื่องพิมพ์
2. กด **เพิ่มเครื่อง** แล้วเลือกศูนย์ (shelter) ที่ Pi เครื่องนี้ประจำอยู่
3. จด `DEVICE_ID` และ `DEVICE_SECRET` ไว้ **secret แสดงแค่ครั้งเดียว** ถ้าทำหายให้กด rotate secret เพื่อออกใหม่ (ค่าเก่าจะใช้ไม่ได้ทันที)

`DEVICE_ID` / `DEVICE_SECRET` ออกได้จากหน้านี้ทางเดียว ไม่มีสคริปต์ provision บน Pi

## 2. เตรียม Raspberry Pi

**OS:** Raspberry Pi OS (64-bit) **Bookworm** ขึ้นไป ซึ่งมากับ Python 3.11
Bullseye มากับ Python 3.9 และ agent รันบนนั้นไม่ได้ (`TypeError: unsupported operand type(s) for |`) ตรวจด้วย `python3 --version` ต้องได้ ≥ 3.11

**แพ็กเกจ + uv + โค้ด:**

```bash
sudo apt update
sudo apt install -y git rsync curl python3-venv fonts-thai-tlwg   # fonts-thai-tlwg ใช้วาดชื่อไทยบนบูตสลิป (สคริปต์ติดตั้งจะลงให้เองถ้ายังไม่มี)
# ติดตั้ง uv ไว้ที่ /usr/local/bin เพื่อให้ sudo มองเห็น (ถ้าลงไว้ที่ ~/.local/bin สคริปต์ติดตั้งที่รันด้วย sudo จะหาไม่เจอ)
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh
uv --version

git clone https://github.com/r202-coe-psu/tent.git ~/tent    # repo เป็น private ต้องใช้ token หรือ SSH key
cd ~/tent && git checkout poc-print-server
```

**เครือข่าย:** Pi ต้องเข้า URL ของระบบได้ เช่น `https://tent.example.org` ตรวจจาก Pi ด้วย `curl -I <URL>`
ค่าเริ่มต้น agent รับเฉพาะ `https://` (และ `http://` ไปยัง loopback)
ถ้า server ไม่มี HTTPS เช่น edge ในวง LAN (`http://192.168.1.10:3000`) หรือ domain ที่ไม่มี cert ให้ตั้ง `TENT_ALLOW_HTTP=1` ใน `.env`
เมื่อใช้ `http://` ตัว `DEVICE_SECRET` กับข้อมูลบน label จะวิ่งในเครือข่ายแบบไม่เข้ารหัส จึงควรใช้เฉพาะใน LAN ที่ควบคุมได้ และ agent จะ log เตือนทุกครั้งที่เริ่มทำงาน

**ตั้งเวลาให้ถูก:** การยืนยันตัวตนและ lease ของงานพิมพ์อิงเวลา ตรวจว่า `timedatectl` ขึ้น `System clock synchronized: yes`

## 3. ตั้งเครื่องพิมพ์และ CUPS queue

**เครื่องพิมพ์:** ต่อ XP-365B ทาง USB เปิดเครื่อง ใส่ม้วน label 80×60 mm ตั้งเป็น label mode และ calibrate gap
(ขั้นตอนละเอียดอยู่ใน [`kiosk/README.md`](../kiosk/README.md) หัวข้อ "เครื่องพิมพ์ Label XP-365B" ข้อ 1–2)

**ไฟล์ driver:** ดาวน์โหลด `printer-driver-xprinter_3.13.55_all.deb` จาก [xprintertech.com](https://www.xprintertech.com/drivers-2.html) (ไฟล์นี้ไม่ได้อยู่ใน repo) คัดลอกไปไว้ที่ home ของ Pi แล้วตรวจ checksum:

```bash
scp printer-driver-xprinter_3.13.55_all.deb <user>@<pi-ip>:~/     # รันจากเครื่องที่ดาวน์โหลดไฟล์
sha256sum ~/printer-driver-xprinter_3.13.55_all.deb
# ต้องได้ 2dc1d5d182ca7176c509ca07ce40040494d0c5c64eb646d2aa2dfee4c123e9ca
```

**สร้าง queue:** ใช้สคริปต์ของ kiosk ซึ่งจะลง CUPS กับ driver ทางการของ Xprinter และสร้าง queue `tent_xprinter` ขนาด 80×60 mm ให้

```bash
sudo apt install -y cups             # กลุ่ม lpadmin มากับแพ็กเกจ cups ต้องลงก่อน ไม่งั้น usermod ขึ้น group 'lpadmin' does not exist
sudo usermod -aG lpadmin "$USER"     # ให้ user ที่ใช้ตั้งค่า (คนนี้ ไม่ใช่ agent) ใช้ lpinfo ได้ ทำครั้งแรกครั้งเดียว
# logout/login ใหม่ (หรือ reboot) แล้วตรวจว่า `id -nG` มี lpadmin ก่อนรันขั้นต่อไป
cd ~/tent/kiosk
./setup_printer.sh ~/printer-driver-xprinter_*.deb --queue tent_xprinter --test
```

ถ้า `--test` พิมพ์ label ทดสอบออกมา 1 ใบ แปลว่า CUPS พร้อมแล้ว
ถ้าขึ้น `ไม่พบ XP-365B บน USB` ให้ตรวจสายและไฟ แล้วดูว่า `lsusb | grep 1fc9` เห็น `1fc9:2016` หรือไม่

## 4. เขียน `.env` ของ agent

```bash
cd ~/tent/printer
cp .env.example .env && chmod 600 .env     # .env ถูก gitignore ไว้แล้ว
nano .env
```

| ตัวแปร | ค่า |
|---|---|
| `TENT_BASE_URL` | URL ของระบบ เป็น `https://` (`http://` ใช้ได้กับ `localhost`, `127.0.0.0/8`, `::1` หรือกับ host ไหนก็ได้เมื่อตั้ง `TENT_ALLOW_HTTP=1`) |
| `TENT_ALLOW_HTTP` | `1` = ยอม `http://` ไป IP/domain ไหนก็ได้ (edge ที่ไม่มี HTTPS) · ค่าเริ่มต้น `0` |
| `DEVICE_ID` / `DEVICE_SECRET` | จากขั้นที่ 1 |
| `PRINTER_NAME` | ชื่อ CUPS queue จากขั้นที่ 3 (`tent_xprinter`) ใช้ได้เฉพาะ `A-Z a-z 0-9 _ -` ยาวไม่เกิน 127 ตัว และห้ามขึ้นต้นด้วย `-` ถ้าผิดรูปแบบ agent จะไม่ยอมเริ่มทำงาน |
| `BOOT_SLIP` | `1` = พิมพ์สลิป (ชื่อเครื่อง, device, shelter, IP) ทุกครั้งที่ agent เริ่ม เป็นรูปขนาด 1 label 80×60 mm · `0` = ไม่พิมพ์ |

ตัวเลือกอื่น (`PRINT_PPI`, `PRINT_JOB_TIMEOUT_SEC`, backoff) ดูใน [`.env.example`](.env.example)
คอมเมนต์ต้องอยู่บรรทัดของตัวเอง ห้ามเขียนต่อท้ายค่า เพราะ `EnvironmentFile` ของ systemd จะถือว่าเป็นส่วนหนึ่งของค่า

## 5. ติดตั้งเป็น service (`setup_printer_server.sh`)

สคริปต์จะติดตั้ง agent ไว้ที่ `/opt/tent/printer` และรันด้วย system user `tent-printer` (ไม่มี login/home, อยู่ group `lp`) ผ่าน systemd unit `tent-printer`
โค้ดกับ `.venv` เป็นของ root ทำให้ agent แก้โค้ดตัวเองไม่ได้ ส่วน `.env` ถูกคัดลอกไปเป็น mode 600 owner `tent-printer`

```bash
cd ~/tent/printer
sudo ./setup_printer_server.sh --env-file .env --dry-run   # ดูแผนก่อน ยังไม่แก้อะไร
sudo ./setup_printer_server.sh --env-file .env
rm .env             # ติดตั้งแล้ว ค่าจริงอยู่ที่ /opt/tent/printer/.env ไม่ต้องเก็บสำเนา secret ไว้ใน repo
```

| ตัวเลือก | ความหมาย |
|---|---|
| `--env-file FILE` | `.env` ของ agent ถูกคัดลอกไปเป็น `<prefix>/.env` · บังคับตอนติดตั้งครั้งแรก ครั้งต่อไปไม่ใส่ก็ได้ จะใช้ `<prefix>/.env` เดิม |
| `--queue NAME` | ชื่อ CUPS queue (default: `PRINTER_NAME` ใน `--env-file`) |
| `--prefix DIR` | ที่ติดตั้ง (default `/opt/tent/printer`) |
| `--dry-run` | พิมพ์คำสั่งที่จะรัน ไม่เขียนอะไร และไม่ต้องเป็น root |
| `--status` | ดูสถานะ unit / queue / log 5 บรรทัดล่าสุด แล้วออก ไม่แก้อะไร |

สคริปต์ไม่ให้สิทธิ์ `lpadmin` กับ `tent-printer` ถ้า queue ถูก disable ต้องเปิดคืนเอง ดู [สิทธิ์เปิด queue](#สิทธิ์เปิด-queue-queue-enable-rights)

## 6. ตรวจว่าใช้งานได้

1. `sudo ./setup_printer_server.sh --status` ต้องเห็น `tent-printer: active` และ queue พร้อม
2. ถ้าตั้ง `BOOT_SLIP=1` จะได้บูตสลิปออกมา 1 ใบ
3. back-office → **จัดการเครื่องพิมพ์** เครื่องนี้ต้องขึ้น **ออนไลน์** และสถานะคิวเป็น `ready`
   ระบบนับว่าออนไลน์เมื่อ agent ติดต่อเข้ามาภายใน 90 วินาทีล่าสุดและ CUPS queue พร้อม
4. กดพิมพ์ label จาก tablet ของศูนย์เดียวกัน แล้วดูว่า label ออก

---

## อัปเดตโค้ด / เปลี่ยน secret

```bash
cd ~/tent && git pull
cd printer && sudo ./setup_printer_server.sh
```

สคริปต์รันซ้ำได้ ใช้ `.env` เดิมที่ `/opt/tent/printer/.env` แล้วลงฟอนต์ไทย / dependency ใหม่และ restart service ให้เอง
ถ้าเพิ่ง rotate secret ใน back-office ให้แก้ `DEVICE_SECRET` ด้วย `sudo nano /opt/tent/printer/.env` แล้ว `sudo systemctl restart tent-printer`

ถ้ารัน `kiosk/setup_printer.sh` ใหม่ (เช่นเปลี่ยนม้วน) ให้ `sudo systemctl restart tent-printer` ด้วย

## ดูสถานะ

| ดูอะไร | คำสั่ง |
|---|---|
| service + queue + log ล่าสุด | `sudo ~/tent/printer/setup_printer_server.sh --status` |
| log สด | `journalctl -u tent-printer -f` |
| CUPS queue | `LC_ALL=C lpstat -p tent_xprinter` ต้องเป็น `idle` / `enabled` |
| งานที่ค้างใน CUPS | `lpstat -W not-completed -o tent_xprinter` |
| ภาพรวมการตั้งค่าเครื่องพิมพ์ | `~/tent/kiosk/setup_printer.sh --status` |
| จากฝั่งระบบ | back-office → **จัดการเครื่องพิมพ์**: ออนไลน์/ออฟไลน์, สถานะคิว, IP ของเครื่อง |

log มี job id / จำนวน label / error code แต่ไม่มี secret และไม่มีข้อมูลบน label

### อาการที่พบบ่อย

| log / อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `device auth failed` / 401 ซ้ำ ๆ | `DEVICE_ID`/`DEVICE_SECRET` ผิด, secret ถูก rotate, หรือเครื่องถูกตั้งเป็น inactive ใน back-office (server ตอบ 401 เหมือนกันทุกกรณี) ตรวจสถานะเครื่องใน back-office แล้วใส่ค่าล่าสุดใน `/opt/tent/printer/.env` แล้ว `sudo systemctl restart tent-printer` |
| 429 ซ้ำ ๆ | มี agent มากกว่าหนึ่งตัวใช้ `DEVICE_ID` เดียวกัน (nginx ให้ไม่เกิน 2 connection ต่อเครื่อง) ดูข้อ "agent สองตัว" ด้านล่าง |
| `printer queue … is missing` | `PRINTER_NAME` ไม่ตรงกับ `lpstat -p` หรือยังไม่ได้ทำขั้นที่ 3 |
| `printer queue … is disabled` | CUPS ปิด queue (มักเกิดหลังกระดาษหมดหรือปิดเครื่อง) ตรวจกระดาษ/ไฟ แล้วดู [สิทธิ์เปิด queue](#สิทธิ์เปิด-queue-queue-enable-rights) |
| ชื่อภาษาไทยบนบูตสลิปเป็นสี่เหลี่ยม / log `boot slip as plain text: no Thai font` | Pi ไม่มีฟอนต์ไทย agent เลยพิมพ์เป็นข้อความธรรมดาแทน ติดตั้ง `sudo apt install -y fonts-thai-tlwg` แล้ว restart agent ตรวจด้วย `fc-list :lang=th` ต้องมีรายการ |
| `boot slip not printed: lp failed` | ส่งงานเข้า CUPS ไม่ได้ ลอง `echo test \| lp -d tent_xprinter -` เพื่อดู error จริง |
| `hello failed: …` / `poll failed: …` | `TENT_BASE_URL` ผิด หรือ Pi ออกเน็ตไม่ได้ ลอง `curl -I <TENT_BASE_URL>` จาก Pi |
| งานขึ้น `printer_timeout` | เครื่องพิมพ์ไม่ตอบภายใน `PRINT_JOB_TIMEOUT_SEC` อาจปิดอยู่หรือกระดาษหมด ดู `lpstat -p` |
| label ขนาดเพี้ยน | `PRINT_PPI` ต้องเป็น 203 และม้วนจริงต้องเป็น 80×60 mm (รัน `setup_printer.sh` ใหม่ถ้าเปลี่ยนม้วน) |
| `ไม่พบ uv` ตอนรันสคริปต์ | uv อยู่ใน `~/.local/bin` ที่ sudo มองไม่เห็น ติดตั้งใหม่ตามขั้นที่ 2 |
| service ล้มวนซ้ำ ๆ ทันทีหลังเริ่ม | ดู `journalctl -u tent-printer -n 50` มักเป็นเพราะ `.env` ผิด หรือ Python ต่ำกว่า 3.11 |
| agent สองตัวแย่งงานกัน | เปิด `tent-printer` คู่กับ `tent-printer-autostart` หรือกับ `./run.sh` ให้ปิดตัวอื่นเหลือ `tent-printer` ตัวเดียว (`./setup_autostart.sh --disable`) |

## สิทธิ์เปิด queue (Queue-enable rights)

agent **ไม่ได้รับสิทธิ์ `lpadmin`** (`lpadmin` แก้หรือลบ queue ได้ทั้งหมด ไม่ใช่แค่ enable) และสคริปต์ติดตั้งก็ไม่มีตัวเลือกให้สิทธิ์นี้แล้ว
เมื่อ CUPS ปิด queue agent จะรายงานสถานะ `disabled` ไปที่ back-office แล้วรอ ผู้ดูแลต้องตรวจกระดาษ/ไฟ แล้วเปิด queue เองด้วยบัญชีที่มีสิทธิ์:

```bash
sudo cupsenable tent_xprinter
```

การให้ agent เปิด queue เองรอผลทดสอบบนเครื่องจริง: ถอดกระดาษให้ queue ถูก disable
แล้วดูว่าสิทธิ์ที่แคบกว่า `lpadmin` เช่น group `lp` หรือ policy ใน `cupsd.conf` พอให้ agent เปิดคืนได้หรือไม่ (sudoers ใช้ไม่ได้ เพราะ unit ตั้ง `NoNewPrivileges`)

## ทางเลือกสำหรับ dev / ลองเครื่อง

ไม่ใช้กับเครื่องจริง ใช้ตอนลองหรือ debug เท่านั้น และ **ห้ามเปิดพร้อมกับ service `tent-printer`**

```bash
cd ~/tent/printer
cp .env.example .env && chmod 600 .env && nano .env
./run.sh                         # รันในหน้าจอ Ctrl+C เพื่อหยุด · ./run.sh --setup = ติดตั้ง dependency อย่างเดียว
./setup_autostart.sh             # หรือให้รัน ./run.sh เองหลัง boot ด้วย user ปัจจุบัน (unit tent-printer-autostart)
                                 # รันซ้ำหลัง git pull ได้เลย: ลงฟอนต์ไทย / dependency ใหม่แล้ว restart agent ให้
./setup_autostart.sh --disable   # ปิด/ถอนออก
```
