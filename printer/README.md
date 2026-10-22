# tent-printer (Phase 0 PoC)

Print agent ของ Raspberry Pi / เครื่อง kiosk: ดึงงานพิมพ์จาก BFF (long-poll) แล้วสั่ง CUPS พิมพ์ label PNG ไปที่ Xprinter XP-365B
แผนทั้งหมด: [`docs/plans/print-server-implementation-plan.md`](../docs/plans/print-server-implementation-plan.md)

> **นี่คือ PoC (Phase 0)** ใช้ยืนยัน latency/ความนิ่ง/พฤติกรรม CUPS บนฮาร์ดแวร์จริงเท่านั้น
> การติดตั้งจริง (user `tent-printer`, `/opt/tent/printer`, `setup_printer_server.sh`, runbook) อยู่ใน **Phase 5**
> `scripts/provision_poc.py` และ `scripts/enqueue.py` ใช้ admin credential ของ CouchDB — รันบนเครื่อง dev เท่านั้น ห้ามวางบน Pi

## Quickstart

ใช้ Python ≥ 3.11 + `pip` อย่างเดียว (dependency มีแค่ `httpx` ใน [`requirements.txt`](requirements.txt))
ติดตั้งครั้งเดียวต่อเครื่อง ทั้งเครื่อง dev และ Pi/kiosk:

```bash
cd printer
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 1. บนเครื่อง dev (มี CouchDB + BFF)

```bash
export COUCHDB_ADMIN_URL=http://<user>:<pass>@<couchdb-host>:5984   # ตัวแปรเดียวกับที่ frontend ใช้

# สร้าง DB `printing` (+ _security, _revs_limit, index) และ print_device ทดสอบ — รันซ้ำได้
.venv/bin/python scripts/provision_poc.py --device-id printer-poc-1 --name "PoC printer" \
    --shelter-code SH001 --host-kind standalone
```

สคริปต์พิมพ์ `DEVICE_SECRET` **ครั้งเดียว** (เก็บแค่ hash) ถ้าหายให้ออกใหม่ด้วย `--rotate`
ถ้า device มีอยู่แล้วและไม่ใส่ `--rotate` สคริปต์จะไม่เขียนทับ

เปิด BFF (`cd frontend && pnpm dev`) ให้ Pi เข้าถึงได้ (`:5173` หรือ host จริง)

### 2. บน Pi (หรือเครื่อง kiosk)

ต้องมี CUPS queue ที่ใช้งานได้แล้ว (`kiosk/setup_printer.sh --queue tent_xprinter`)

```bash
cd printer
cp .env.example .env && chmod 600 .env   # แก้ค่าตามที่สคริปต์ provision พิมพ์ให้
.venv/bin/python -m printer              # รันจากโฟลเดอร์ printer/ (อ่าน .env ในโฟลเดอร์นี้) · Ctrl+C เพื่อหยุด
```

หรือใช้ `./run.sh` แทนบรรทัดสุดท้าย (สร้าง `.venv` + `pip install -r requirements.txt` ให้เองถ้ายังไม่มี · `./run.sh --setup` = ติดตั้งอย่างเดียว)

agent อ่าน `.env` ในโฟลเดอร์ที่รันเอง (ค่าใน environment จริงชนะค่าในไฟล์) · คอมเมนต์ใน `.env` ต้องอยู่บรรทัดของตัวเอง เพราะ systemd `EnvironmentFile` ไม่รองรับคอมเมนต์ท้ายบรรทัด

ตัวแปรใน `.env`: ดู [`.env.example`](.env.example) · `TENT_BASE_URL` ต้องเป็น `https://` ยกเว้น `http://` ไปยัง localhost/LAN (เช่น `http://172.20.10.2:5173`)

**เปิดเองหลัง boot (แบบ `kiosk/setup_autostart.sh`):** รัน `./run.sh` จากโฟลเดอร์นี้ผ่าน systemd ด้วย user ปัจจุบัน ไม่ต้องมีจอหรือ login และ restart เองถ้า agent ล้ม

```bash
./setup_autostart.sh             # ติดตั้ง + เปิดทันที (เรียก sudo เอง)
./setup_autostart.sh --status    # สถานะ + log ล่าสุด · journalctl -u tent-printer-autostart -f
./setup_autostart.sh --disable   # ปิด — ต้องปิดก่อนรัน ./run.sh เอง ไม่งั้นมี agent สองตัว
```

ติดตั้งจริง (user แยก, `/opt/tent/printer`) ดู Phase 5 ด้านล่าง

### 3. สั่งพิมพ์ (จำลอง tablet) จากเครื่อง dev

```bash
.venv/bin/python scripts/enqueue.py --device-id printer-poc-1 --count 3 --wait         # 1 งาน 3 ใบ
.venv/bin/python scripts/enqueue.py --device-id printer-poc-1 --jobs 5 --wait          # P2: 5 งานติดกัน
.venv/bin/python scripts/enqueue.py --device-id printer-poc-1 --wait --repeat 20       # P1: median/p95
.venv/bin/python scripts/enqueue.py --device-id printer-poc-1 --png a.png --png b.png  # ใช้ PNG จริง
```

`--help` ของสคริปต์อธิบายตัวเลือกทั้งหมด

- `created_at`/`expires_at` ใช้นาฬิกา UTC ของเครื่องที่รัน `enqueue.py` (ไม่มีนาฬิกา CouchDB ให้ใช้) — ให้เครื่อง dev ตั้งเวลาตรงกับ BFF
- ตาราง `--wait`: `claim_s` = enqueue → งานถูกจอง, `total_s` = enqueue → สถานะสุดท้าย (รวมเวลาที่ CUPS พิมพ์เสร็จ จึงเป็นค่าสูงสุดของ P1)
- label ที่สร้างเอง: 640×480 1-bit (80×60 mm ที่ 203 dpi) เลขใหญ่ = ลำดับใบในงาน, เลขเล็กมุมซ้ายบน = ลำดับงาน (ใช้ตรวจลำดับ P2)

## P-tests ที่รันด้วยสคริปต์ชุดนี้

| # | ทดสอบ | วิธี |
|---|---|---|
| P1 | latency 1 ใบ | `enqueue.py --device-id … --wait --repeat 20` |
| P2 | 5 งานติดกัน | `--jobs 5 --wait` ตรวจเลขมุมซ้ายบนเรียง 1..5 ไม่ซ้ำ |
| P3 | ถอด LAN 1 นาที | `enqueue.py` ระหว่างถอด (`--ttl-sec 180`) แล้วเสียบคืน |
| P4 | ปิด Pi 3 นาที | `enqueue.py` (ttl 120 ค่าเริ่มต้น) → เปิด Pi หลังเกิน TTL → ต้องเป็น `expired` |
| P5 | restart ระหว่างพิมพ์ | `--count 10` แล้ว `systemctl restart tent-printer` → `failed (agent_restart)` |
| P6 | agent 2 ตัว device เดียวกัน | รัน `python -m printer` สองที่ + `--jobs 5` |
| P7, P9 | ปิด printer / ถอดกระดาษ | enqueue ขณะปิด/ถอด → ต้อง `failed` ภายใน `PRINT_JOB_TIMEOUT_SEC` |
| P8 | บนเครื่อง kiosk | provision ด้วย `--host-kind kiosk` แล้ว enqueue พร้อมกดพิมพ์ที่ตู้ |
| P10 | restart BFF ระหว่าง long-poll | restart `pnpm dev` ระหว่างที่ agent รออยู่ |
| P11 | secret ผิด | แก้ `DEVICE_SECRET` ใน `.env` → 401, backoff, log ไม่มี secret |

บันทึกผลลง `docs/plans/print-server-poc-results.md`

## ติดตั้งจริง (Phase 5)

`setup_printer_server.sh` ติดตั้ง agent เป็น systemd service (`tent-printer`, user `tent-printer`, โค้ดที่ `/opt/tent/printer`)
`scripts/` (provision/enqueue ที่ใช้ admin credential) **ไม่ถูกคัดลอก**ไปเครื่องปลายทาง

ก่อนเริ่มต้องมี: CUPS queue ที่ใช้ได้ (`kiosk/setup_printer.sh --queue tent_xprinter`), `uv`, `rsync`, Python 3.11+ ของระบบ
และไฟล์ `.env` ของเครื่องนี้ (ดู [`.env.example`](.env.example)) ที่ได้ `DEVICE_ID`/`DEVICE_SECRET` จากการลงทะเบียนเครื่อง

```bash
sudo ./setup_printer_server.sh --env-file ./printer.env --host-kind standalone --dry-run   # ดูแผนก่อน
sudo ./setup_printer_server.sh --env-file ./printer.env --host-kind standalone
sudo ./setup_printer_server.sh --status
```

| โหมด | ใช้เมื่อ | พฤติกรรมเฉพาะ |
|---|---|---|
| `--host-kind standalone` | Pi แยกที่ต่อ XP-365B ตัวเดียวและไม่มี kiosk | ตั้ง `printer-error-policy=abort-job` ให้ queue (งานที่ error หลุดทันที ไม่ค้างจนหยุดคิว) |
| `--host-kind kiosk` | ติดตั้งบนเครื่อง kiosk ที่ใช้ queue ร่วมกัน | **ไม่แตะ error policy** (ใช้ร่วมกับ kiosk — ต้องตกลงกับฝั่ง kiosk) และเตือนถ้า `kiosk/.env` ตั้ง `PRINTER_BACKEND=escpos` (ต้องเป็น `cups` ไม่งั้นแย่ง `/dev/usb/lpN`) |

ตัวเลือกอื่น: `--queue NAME` (ไม่ใส่จะอ่าน `PRINTER_NAME` จาก `--env-file` แล้วใช้ `tent_xprinter`), `--prefix DIR` (ค่าเริ่มต้น `/opt/tent/printer`),
`--kiosk-env FILE` (ค่าเริ่มต้น `/home/*/tent/kiosk/.env`), `--allow-cupsenable` (เพิ่ม `tent-printer` เข้ากลุ่ม `lpadmin` ให้ agent สั่ง `cupsenable` เองได้ — O-5 ยังไม่ตัดสินใจ จึงปิดไว้โดยปริยาย),
`--dry-run` (พิมพ์คำสั่งแทนการรัน ไม่ต้องใช้ root) · รันซ้ำได้: โค้ดถูก sync ใหม่ และถ้า agent ทำงานอยู่จะถูก restart

`.env` ถูกวางที่ `<prefix>/.env` เจ้าของ `tent-printer` โหมด 600 สคริปต์ไม่พิมพ์เนื้อหาไฟล์นี้ออกมา

**บูตสลิป:** เมื่อ agent เริ่มและ hello สำเร็จ จะพิมพ์สลิปข้อความล้วน 1 ใบ (ชื่อเครื่อง, `device_id`, shelter, เวอร์ชัน, IP ของเครื่อง)
ใช้ดู IP ตอนติดตั้งหน้างาน ปิดได้ด้วย `BOOT_SLIP=0` ใน `.env` (พิมพ์ไม่ออกจะแค่ log เตือน ไม่หยุด agent)

**หมุน secret:** ตอนนี้ใช้ `scripts/provision_poc.py --device-id <id> --rotate` บนเครื่อง dev (ได้ secret ใหม่ครั้งเดียว) → แก้ `DEVICE_SECRET` ใน `<prefix>/.env`
แล้ว `sudo systemctl restart tent-printer` (ภายหลังจะทำจาก back-office)

**ดู log:** `journalctl -u tent-printer -f` (log มี job id / จำนวน label / error code แต่ไม่มี secret และไม่มีข้อมูล label)

**อาการที่พบบ่อย**

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| log ขึ้น `device auth failed` / 401 ซ้ำ ๆ | `DEVICE_ID`/`DEVICE_SECRET` ผิดหรือถูกหมุนไปแล้ว — ใส่ secret ล่าสุดแล้ว restart |
| `queue_state=disabled` / `missing` | queue ถูกปิดหรือไม่มี: `sudo cupsenable <queue>` / รัน `kiosk/setup_printer.sh` ใหม่ (หรือใช้ `--allow-cupsenable` ให้ agent เปิดเอง) · `--status` ดูสถานะ queue |
| label ขนาดเพี้ยน / พิมพ์เล็กหรือใหญ่ผิดปกติ | `PRINT_PPI` ต้องตรงกับ `KIOSK_PRINT_PPI` (203) และ PageSize ของ queue ตรงกับม้วนจริง |
| งานค้างหรือ `printer_timeout` | ปิดเครื่อง/กระดาษหมด — ดู `lpstat -p`; `--status` แสดง log 5 บรรทัดล่าสุด |

## ทดสอบโค้ด agent

```bash
.venv/bin/pip install pytest ruff   # ครั้งแรก
.venv/bin/python -m pytest -q
.venv/bin/ruff check printer tests scripts
```
