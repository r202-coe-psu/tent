# Setup Edge — ฝั่ง @ศูนย์ ที่ sync กับ central

คู่มือนี้ใช้กับ **เครื่อง edge เท่านั้น** (mini PC ที่ศูนย์) ทำตามลำดับ และตรวจให้ผ่านก่อนไปขั้นถัดไป
ฝั่ง central ต้อง **พร้อมก่อน** — ทำ [SETUP-CENTRAL.md](SETUP-CENTRAL.md) ให้ถึงขั้น 5 แล้วค่อยเริ่มที่นี่ ·
หลักการและเหตุผลของการออกแบบอยู่ที่ [README.md §2](README.md)

> **ติดตั้งศูนย์ใหม่ตั้งแต่ต้น?** อ่าน [Runbook ด้านล่าง](#runbook-ติดตั้ง-edge-ให้ศูนย์-x-ตั้งแต่ต้นจนใช้งานได้) ก่อน — สรุปว่าใครทำอะไร ที่ไหน ตามลำดับ แล้วลิงก์ไปขั้นละเอียด

> **edge ทำอะไร:** เป็น CouchDB + แอป staff (SPA) ที่ศูนย์ ถือสำเนาข้อมูลของศูนย์ตัวเอง
> **เป็นฝ่ายเปิด connection ไปหา central** แล้วดึง/ส่งข้อมูลด้วย job ใน `_replicator` — ตอน WAN ขาด staff ยังใช้งานบน LAN ได้
> ไม่มี FastAPI / MongoDB / worker (public plane อยู่ที่ central เท่านั้น — CR-064 OD-1)

## Runbook: ติดตั้ง edge ให้ศูนย์ X ตั้งแต่ต้นจนใช้งานได้

ตัวอย่างใช้ศูนย์ `SH001` (DB `shelter_sh001`) — **เปลี่ยนเป็นรหัสศูนย์จริงได้ทุกจุด** (`SHELTER_CODE` เขียนตัวใหญ่ เช่น `SH001` · ชื่อ DB / job เป็นตัวเล็ก เช่น `shelter_sh001`, `sh001_pull`)
ทำตามลำดับ **C1 → C7 ที่ central ก่อน แล้วค่อย E1 → E7 ที่เครื่อง edge** — ขั้นที่รายละเอียดยาวจะลิงก์ไปหัวข้อเดิม ไม่เขียนซ้ำ

| #   | ใครทำ                  | ที่ไหน         | ทำอะไร / คำสั่ง                                                                                                                                                                                    | ตรวจว่าสำเร็จอย่างไร                                                                                                                                         |
| --- | ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | ผู้ดูแล central        | central        | ศูนย์เปิด/seed แล้ว: มี `registry`, `catalog`, `shelter_sh001` และมี staff ที่ role `shelter:SH001` — `curl -s $C/_all_dbs`                                                                        | เห็นครบ 3 DB (SETUP-CENTRAL ขั้น 2)                                                                                                                          |
| C2  | ผู้ดูแล central        | central        | backfill `edge_shelters` (CR-171): `cd frontend && pnpm backfill:edge-shelters` (dry-run) แล้ว `pnpm backfill:edge-shelters --write` · **ทำก่อน C3**                                               | รันซ้ำแล้วไม่มี doc เปลี่ยน                                                                                                                                  |
| C3  | ผู้ดูแล central        | central        | เปิด service คัดลอก user: `docker compose up -d edge-users-copy`                                                                                                                                   | `docker compose logs edge-users-copy` ไม่มี error                                                                                                            |
| C4  | ผู้ดูแล central        | central        | deploy VDU / `_design` ของ CR-247 — Jenkins รัน `pnpm db:sync` ให้ · เครื่องที่ไม่ผ่าน Jenkins: `cd frontend && pnpm sync:central --write --confirm` แล้ว `pnpm redeploy:access --write --confirm` | รันสำเร็จ ไม่มี error (ดูหมายเหตุท้ายตาราง)                                                                                                                  |
| C5  | ผู้ดูแล central        | central        | เปิดทางให้ edge เข้า central: lab = port `5984` (SETUP-CENTRAL ขั้น 4A) · จริง = `https://<domain>/sync` (ขั้น 4B) · เรื่อง DNS / cutover อยู่นอกขอบเขตเอกสารนี้ — ดู "ตอน cutover / cutback"      | `curl -s $SYNC_URL/_up` จากเครื่อง edge ได้ `"status":"ok"` (SETUP-CENTRAL ขั้น 5)                                                                           |
| C6  | ผู้ดูแล central        | central        | สร้าง replication user ของศูนย์: `scripts/central-repl-user.sh SH001`                                                                                                                              | ท้ายผลลัพธ์ขึ้น `Credentials for the edge of SH001 (shown once ...)` พร้อม `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` และทุกบรรทัด `verifying as ...` เป็น `ok` |
| C7  | ผู้ดูแล central        | central        | ตรวจสถานะ: `scripts/central-repl-user.sh SH001 --status`                                                                                                                                           | exit 0 · `backfill SH001: เสร็จแล้ว` (ถ้ายังไม่เสร็จรอ ~1 นาทีแล้วรันใหม่) · ยังไม่มี edge ต่อ = `edge ยังไม่เคยต่อเข้ามา` ปกติ                              |
| E1  | ผู้ติดตั้ง edge        | เครื่อง edge   | clone โค้ด (ขั้น 2) · สร้าง `couchdb-edge.ini` **ก่อน `up`** (ขั้น 3): `cp couchdb-edge-example.ini couchdb-edge.ini` แล้วตั้ง `secret`                                                            | มีไฟล์ `couchdb-edge.ini` (เป็นไฟล์ ไม่ใช่โฟลเดอร์)                                                                                                          |
| E2  | ผู้ติดตั้ง edge        | เครื่อง edge   | สร้าง `.env`: `cp .env.edge.example .env` แล้วแก้ค่า (ขั้น 4) — ดูรายการตัวแปรด้านล่าง · ตั้งเวลาเครื่อง `sudo timedatectl set-ntp true`                                                           | `timedatectl` ขึ้น `System clock synchronized: yes`                                                                                                          |
| E3  | ผู้ติดตั้ง edge        | เครื่อง edge   | ตรวจว่าต่อ central ได้ก่อนติดตั้ง (ขั้น 1): `curl -s $SYNC_URL/_up` และ `curl -s -u '<EDGE_REPL_USER>:<EDGE_REPL_PASSWORD>' $SYNC_URL/shelter_sh001`                                               | `{"seeds":{},"status":"ok"}` และ JSON ข้อมูล DB (ไม่ใช่ HTML / `unauthorized`)                                                                               |
| E4  | ผู้ติดตั้ง edge        | เครื่อง edge   | เปิด stack: `docker compose -f docker-compose.edge.yml up -d --build` (build ครั้งแรกหลายนาที)                                                                                                     | `docker compose -f docker-compose.edge.yml ps` ไม่มี container ที่ restart วน                                                                                |
| E5  | ผู้ติดตั้ง edge        | เครื่อง edge   | ดูผล provisioning: `docker logs tent-edge-init-edge`                                                                                                                                               | ทุกบรรทัดเป็น `ok` หรือ `exists` ไม่มี `FAILED` (อ่านความหมายด้านล่าง)                                                                                       |
| E6  | ผู้ติดตั้ง edge        | เครื่อง edge   | รอ ~30 วินาที แล้วตรวจ job ทั้ง 5 และทดสอบ sync (ขั้น 6)                                                                                                                                           | job ทั้ง 5 `running` · ทดสอบ 2–5 ในตาราง ขั้น 6 ผ่าน                                                                                                         |
| E7  | ผู้ดูแล central + edge | central / edge | ปิดงาน: ตรวจ `--status` ที่ central อีกครั้ง · ศูนย์จริงทำ checklist ขั้น 6B ก่อนเปิดใช้                                                                                                           | `edge ดึงข้อมูลล่าสุดเมื่อ: <เวลาล่าสุด>` และ exit 0                                                                                                         |

**หมายเหตุ C2–C4:** C2 ต้องเสร็จก่อนเปิด `edge-users-copy` (C3) ไม่งั้น user ที่ไม่มี `edge_shelters` แล้วถูกถอด role จะไม่ถูกส่งไป edge (CR-247 Migration) ·
C4: ตัว CR-247 Migration ระบุเฉพาะ C2 — ส่วน `pnpm sync:central --write --confirm` / `pnpm redeploy:access` มาจาก "อัปเกรดเป็น CR-171" ด้านล่างและสคริปต์ `db:sync` ใน `frontend/package.json` · VDU ที่ central ต้องเป็นรุ่นที่ให้ role `repl:<CODE>` เขียน `shelter_<code>` ได้ ไม่งั้น `sh001_push` จะขึ้น `doc_write_failures`

### C6 — สิ่งที่สคริปต์แสดง (ครั้งเดียว)

```
Credentials for the edge of SH001 (shown once — store the password now). Put them into the edge .env:

  EDGE_REPL_USER=repl_sh001_<8 ตัว hex>
  EDGE_REPL_PASSWORD=<รหัสสุ่ม 32 ตัว hex>
```

**จดทันที** แล้วส่งให้คนติดตั้ง edge ผ่านช่องทางที่ปลอดภัย — รันซ้ำโดยไม่ใส่ `--rotate` จะขึ้น `Nothing printed for the password` และรหัสไม่แสดงอีก (ลืมแล้วต้อง `--rotate` ซึ่งได้รหัสใหม่) ·
ศูนย์ละ 1 บัญชี · **ห้ามส่งรหัส central admin ให้ edge**

### E2 — ตัวแปรใน `.env` ที่ต้องแก้ (ไฟล์ตัวอย่าง [`.env.edge.example`](../../.env.edge.example) · ตารางเต็มที่ ขั้น 4)

| ตัวแปร                                  | ใส่อะไร                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `COUCHDB_USER` / `COUCHDB_PASSWORD`     | admin ของ CouchDB **ที่ edge** — ตั้งเอง **คนละรหัสกับ central** (`openssl rand -hex 24`)                      |
| `SHELTER_CODE`                          | รหัสศูนย์ **ตัวใหญ่** เช่น `SH001` — ต้องตรงกับศูนย์ที่ได้ `EDGE_REPL_USER` มา (ไม่ตรง = `edge-init` `FAILED`) |
| `SYNC_URL`                              | ที่อยู่ central: lab `http://<IP central>:5984` · จริง `https://<domain>/sync`                                 |
| `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` | ค่าที่ได้จาก C6 (ห้ามใส่ central admin) · ลบ `CENTRAL_REPL_*` เดิมออกถ้ามี                                     |
| `PUBLIC_ORIGIN`                         | URL ที่ browser เปิด (lab: `http://<IP ของ edge>`) · ฝังตอน build                                              |
| `EDGE_LAN_IP` / `EDGE_HTTP_PORT`        | IP ของ edge ใน LAN ที่ nginx รับ / port (default `80`)                                                         |

### E5 — อ่านผล `edge-init`

| บรรทัด   | ความหมาย                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`     | สร้างใหม่สำเร็จ                                                                                                                                                        |
| `exists` | มีอยู่แล้ว ข้ามไป (รันซ้ำได้)                                                                                                                                          |
| `stale`  | job เดิมไม่ตรงกับ `.env` ปัจจุบัน → ลบแล้วสร้างใหม่ให้                                                                                                                 |
| `FAILED` | หยุดทันที exit 1 — ดูข้อความหลัง `FAILED` แล้วใช้หัวข้อ "ถ้าติดปัญหา" ด้านล่าง · แก้ `.env` แล้วรัน `docker compose -f docker-compose.edge.yml run --rm edge-init` ซ้ำ |

`edge-init` ตรวจ 2 อย่างก่อนสร้าง job (`ok central uuid ... ≠ edge uuid ...` และ `ok central session: EDGE_REPL_USER มี role repl:SH001 และไม่ใช่ admin`) แล้วสร้าง **5 job** ใน `_replicator`:
`registry_pull`, `catalog_pull`, `sh001_pull`, `sh001_push`, `users_sh001_pull` (ทิศทางและหน้าที่ของแต่ละตัวดูตาราง "replication job 5 ตัว" ด้านล่าง)

### E6 — เช็กลิสต์ตรวจก่อนบอกว่า "ใช้งานได้" (แบบย่อของ AC-7 ใน ขั้น 6B)

- [ ] **job ทั้ง 5 `running`** — คำสั่ง `curl -s $E/_scheduler/docs/_replicator ...` ใน ขั้น 6 (รอ ~30 วินาทีหลัง `up`; รายการว่างตอนแรกเป็นเรื่องปกติ)
- [ ] **staff login ที่ edge ได้** — `POST $EDGE/couch/_session` ได้ `{"ok":true,...}` (ขั้น 6 ข้อ 5) · ใช้ staff ที่ activate ที่ central แล้ว (ดู "บัญชีสำรอง" ด้านล่าง)
- [ ] **central → edge** — เขียน doc ที่ central แล้วอ่านที่ edge ได้ `200` (ขั้น 6 ข้อ 2)
- [ ] **edge → central** — เขียนที่ edge ผ่าน nginx แล้วอ่านที่ central ได้ `200` (ขั้น 6 ข้อ 3)
- [ ] **ไม่มี user ศูนย์อื่นที่ edge** — `404` (ขั้น 6 ข้อ 4)
- [ ] **`--status` ที่ central** แสดง `edge ดึงข้อมูลล่าสุดเมื่อ: ...` (ไม่ใช่ `edge ยังไม่เคยต่อเข้ามา`) และ exit 0
- [ ] ศูนย์จริง: ทำ AC-1..AC-8 ใน ขั้น 6B ครบ (แอปผ่าน browser และการต่อข้ามเครื่องจริงยัง **ไม่เคยทดสอบ** ตามหมายเหตุ ขั้น 6)

### ถ้าติดปัญหา — 5 อาการที่เจอบ่อย (ตารางเต็มที่ "แก้ปัญหา (ฝั่ง edge)")

| อาการ                                                                                                           | สาเหตุ                                                                                                                                        | แก้                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `edge-init` `FAILED  EDGE_REPL_USER มี role _admin` / `ไม่มี role repl:<CODE>` / `GET .../_session ... ไม่ผ่าน` | ใส่ central admin, บัญชีผิดศูนย์, `SHELTER_CODE` ไม่ตรง หรือรหัสผิด                                                                           | ใช้ค่าจาก `central-repl-user.sh <CODE>` ของศูนย์นี้ · เช็ก `SHELTER_CODE` ตัวใหญ่ · รัน `edge-init` ซ้ำ                     |
| job `crashing` + `unauthorized` (401)                                                                           | `EDGE_REPL_*` ผิด หรือผู้ดูแล central สั่ง `--rotate` / `--remove` ของศูนย์นี้แล้ว                                                            | ขอชุดล่าสุดจาก central (`--rotate` ได้รหัสใหม่) ใส่ `.env` แล้วรัน `edge-init`                                              |
| job `crashing` + `forbidden` (403) ทั้งที่รหัสถูก                                                               | ถูกล็อกเอาต์ (รหัสผิดเกิน 5 ครั้ง) — ล็อกเฉพาะศูนย์นี้                                                                                        | แก้รหัสให้ถูก แล้วรอ **5 นาที** · อย่าลบ/สร้าง job ซ้ำระหว่างรอ                                                             |
| job `crashing` + `nxdomain` / `econnrefused` / timeout / certificate / ได้ HTML แทน JSON                        | `SYNC_URL` ผิด, central ปิด, `location /sync/` ยังไม่มี, นาฬิกาเพี้ยน, หรือ LAN DNS ยังชี้ domain แอปมาที่ edge                               | ทำ E3 ซ้ำ · NTP (E2) · SETUP-CENTRAL ขั้น 4B · DNS ดู "ตอน cutover / cutback"                                               |
| staff login ที่ edge ไม่ได้                                                                                     | `users_sh001_pull` ไม่ `running`, `edge-users-copy` หยุด, staff ไม่มี role `shelter:<CODE>` / `edge_shelters`, ยังไม่เคย activate ที่ central | `central-repl-user.sh SH001 --status` ที่ central · `docker compose logs edge-users-copy` · activate staff ที่ central ก่อน |

### งานประจำหลังติดตั้ง

| งาน                                                       | ที่ไหน         | คำสั่ง / วิธี                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ตรวจ `--status` ทุกวัน                                    | central        | `scripts/central-repl-user.sh SH001 --status` (หรือ loop ทุกศูนย์ — SETUP-CENTRAL "ตรวจ `--status` ทุกวัน") · exit ≠ 0 = `edge-users-copy` มี `last_error` หรือตามหลัง `_users` เกิน 5 นาที → `docker compose logs edge-users-copy`           |
| หมุนรหัสของศูนย์นี้                                       | central → edge | central: `scripts/central-repl-user.sh SH001 --rotate` (แสดงรหัสใหม่ครั้งเดียว) · edge: แก้ `EDGE_REPL_PASSWORD` ใน `.env` แล้วรัน `docker compose -f docker-compose.edge.yml run --rm edge-init` **ทันที** (ศูนย์อื่นไม่กระทบ)               |
| เครื่อง edge หาย / ถูกขโมย (FR-21)                        | central        | ทำตามลำดับใน SETUP-CENTRAL "เครื่อง edge หาย": `--remove` ทันที → reset password staff ทุกคนของศูนย์ → ตรวจ revision ที่ขึ้นมาใหม่ → ติดตั้งเครื่องใหม่ด้วย `central-repl-user.sh SH001` (credential ใหม่) แล้วทำ runbook นี้ตั้งแต่ E1       |
| ปิดศูนย์ (FR-21a)                                         | central + edge | ปิดศูนย์ในแอป (`operation_status: closed`) → central: `scripts/central-repl-user.sh SH001 --remove` → ล้างเครื่อง edge ทั้งเครื่อง (ดู "ถอดออก" ด้านล่าง) · ศูนย์ `cancelled` ไม่ต้องทำ — SETUP-CENTRAL "ปิดศูนย์ที่มี edge"                  |
| ลบ user ตรงใน CouchDB (hard delete) แล้วเหลือค้างที่ edge | central        | `scripts/edge-users-clean.sh SH001` (dry-run พิมพ์ `<db> <id>` ของ orphan) → ตรวจรายการ → `scripts/edge-users-clean.sh SH001 --apply` · edge ได้รับการลบในรอบ pull ถัดไป · แอปใช้ soft delete อยู่แล้ว จึงต้องทำเฉพาะเมื่อมีคนลบตรงใน CouchDB |
| job ค้างหลัง WAN กลับ                                     | edge           | ปกติ `edge-watchdog` เตะให้เอง · เตะเองด้วย `kick` ใน "งานประจำ" ด้านล่าง                                                                                                                                                                     |

---

## 0. ต้องมีก่อนเริ่ม

| สิ่งที่ต้องมี                                                                                | ได้จาก / ตรวจยังไง                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docker + Docker Compose, git, curl, python3                                                  | `docker compose version`                                                                                                                                                                                                 |
| internet (build frontend ครั้งแรก + pull image)                                              | —                                                                                                                                                                                                                        |
| port `80` ว่างบนเครื่อง (หรือเลือก port อื่นใน `EDGE_HTTP_PORT`)                             | `ss -ltn \| grep ':80 '`                                                                                                                                                                                                 |
| นาฬิกาตรง (NTP เปิด)                                                                         | `timedatectl` — นาฬิกาเพี้ยนทำให้ TLS ล้มตอนต่อ `https://` · วิธีตั้งท้ายขั้น 4                                                                                                                                          |
| ค่าจาก central 3 กลุ่ม (`SYNC_URL`, `SHELTER_CODE`, `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD`) | ตาราง "ค่าที่ต้องส่งให้ฝั่ง edge" ท้าย [SETUP-CENTRAL.md](SETUP-CENTRAL.md) · `EDGE_REPL_*` = ผลของ `scripts/central-repl-user.sh <CODE>` ที่ central (แสดงครั้งเดียว — ผู้ดูแล central ส่งให้) **ไม่ใช่ central admin** |

เลือกแบบเหมือนที่เลือกฝั่ง central: **Lab** (`http://<IP central>:5984`, ไม่มี cert) หรือ **จริง** (`https://<domain>/sync` — path บน domain ของแอป)

---

## ขั้น 1 — ตรวจว่า edge ต่อ central ได้ (ก่อนติดตั้งอะไร)

**ทำไม:** ถ้าต่อไม่ติดตั้งแต่ตรงนี้ job ทุกตัวจะ `crashing` และหาสาเหตุยากกว่ามาก

```bash
SYNC_URL=http://<IP ของ central>:5984        # จริง: https://<domain>/sync
curl -s $SYNC_URL/_up                        # {"seeds":{},"status":"ok"}
curl -s -u '<EDGE_REPL_USER>:<EDGE_REPL_PASSWORD>' $SYNC_URL/shelter_sh001     # JSON ข้อมูล DB
```

ไม่ผ่าน → กลับไปแก้ฝั่ง central (ขั้น 4–5 ของ SETUP-CENTRAL.md) ยังไม่ต้องทำขั้นต่อไป

---

## ขั้น 2 — เอาโค้ดมาไว้บน edge

```bash
git clone -b feat/edge-couch-replication git@github.com:r202-coe-psu/tent.git
cd tent
```

ไฟล์ที่ edge ใช้ (อยู่ที่ root ของ repo):

| ไฟล์                                                         | หน้าที่                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`docker-compose.edge.yml`](../../docker-compose.edge.yml)   | stack ของ edge: `couchdb`, `couchdb-init`, `edge-init`, `frontend`, `nginx` |
| [`nginx-edge/default.conf`](../../nginx-edge/default.conf)   | nginx ของ edge: `/couch` + SPA                                              |
| [`couchdb-edge-example.ini`](../../couchdb-edge-example.ini) | config CouchDB ของ edge (copy เป็น `couchdb-edge.ini`)                      |
| [`.env.edge.example`](../../.env.edge.example)               | ตัวอย่าง env (copy เป็น `.env`)                                             |
| [`scripts/edge-init.sh`](../../scripts/edge-init.sh)         | สร้าง DB, `_security`, guard และ replication job                            |

---

## ขั้น 3 — สร้าง config CouchDB ของ edge

```bash
cp couchdb-edge-example.ini couchdb-edge.ini
sed -i "s/change-me-edge-secret/$(openssl rand -hex 16)/" couchdb-edge.ini
```

**ต้องสร้างก่อน `up`** — compose mount ไฟล์นี้เข้า CouchDB ถ้าไม่มีไฟล์ Docker จะสร้างเป็น _โฟลเดอร์_ แล้ว CouchDB start ไม่ขึ้น

| ค่าในไฟล์                                                | ทำไม                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret` ของ edge เอง                                    | ใช้เซ็น cookie `AuthSession` — **ต้องต่างจาก central** ทำให้ cookie ข้ามฝั่งไม่ได้ staff ต้อง login ใหม่ตอน cutover (OD-3 — ทดสอบแล้วว่าเป็นแบบนั้น) · BFF ของ edge อ่านค่านี้ผ่าน admin API เพื่อ mint session                                         |
| ไม่มี `[admins]`                                         | admin ของ edge มาจาก `COUCHDB_USER` / `COUCHDB_PASSWORD` ใน `.env` คนละรหัสกับ central — **ห้ามใช้ `couchdb-session.ini` ของ central** เพราะฝัง hash ของ admin และ secret ของ central ไว้                                                               |
| `[replicator] auth_plugins = couch_replicator_auth_noop` | **จำเป็นเมื่อ `SYNC_URL` มี path (`/sync`)**: replicator ปกติขอ session ที่ `<host>/_session` โดยตัด path ทิ้ง คำขอไปตกที่เว็บแอปแทน CouchDB แล้ว job ล้มด้วย `session_unexpected_result` ค่านี้ให้ส่ง Basic auth ตรง ๆ · ไม่มีผลกับ `http://<IP>:5984` |
| `[replicator] verify_ssl_certificates`                   | default = `true` · lab ที่ใช้ self-signed ค่อยปิดเอง (`false`) แล้ว restart CouchDB · มีผลเฉพาะตอนต่อ `https://`                                                                                                                                        |
| `ssl_trusted_certificates_file`                          | CA bundle ที่มีอยู่ใน image แล้ว                                                                                                                                                                                                                        |

ไฟล์ตัวอย่างตั้ง `verify_ssl_certificates = true` — ถ้าต่อ `https://` ด้วย self-signed cert ใน lab ให้เปลี่ยนเป็น `false` เอง · **ห้ามปิดบน edge จริง** (ปิดแล้วไม่ตรวจ cert ของ central เลย) · เปิดไว้แล้วนาฬิกาเครื่องต้องตรง ดู "ตั้งเวลาเครื่อง (NTP)" ท้ายขั้น 4

ค่าเสริมใน `[replicator]` เมื่อ WAN ของศูนย์ช้า: `connection_timeout` (30000 ms), `retries_per_request` (5),
`worker_batch_size` (500 — ลดแล้ว body เล็กลง checkpoint ถี่ขึ้น), `checkpoint_interval` (30000 ms)

📖 [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html) ·
[`[replicator]`](https://docs.couchdb.org/en/stable/config/replicator.html)

---

## ขั้น 4 — ตั้ง `.env`

```bash
cp .env.edge.example .env
```

แก้ค่าตามตาราง:

| ตัวแปร                                  | Lab (ตัวอย่าง)                                | จริง                        | ใช้ทำอะไร                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COUCHDB_USER` / `COUCHDB_PASSWORD`     | `admin` / รหัสใหม่                            | เหมือนกัน                   | admin ของ CouchDB ที่ edge — **คนละรหัสกับ central**                                                                                                                                                                                                                                                                                                                                                              |
| `SHELTER_CODE`                          | `SH001`                                       | รหัสศูนย์นี้                | กำหนด DB `shelter_<code>`, role `shelter:<CODE>`, ชื่อ job · **ตรวจให้ถูก** ต้องตรงกับศูนย์ที่ `EDGE_REPL_USER` ถูกสร้างให้ (role `repl:<CODE>`) — ไม่ตรง `edge-init` จะ `FAILED`                                                                                                                                                                                                                                 |
| `SYNC_URL`                              | `http://172.30.91.220:5984`                   | `https://<domain>/sync`     | ที่อยู่ central · แบบจริงเป็น path บน domain ของแอป ตอน cutover (LAN DNS ชี้ domain แอปมาที่ edge) job จะล้มจนกว่า cutback ดู "ตอน cutover / cutback"                                                                                                                                                                                                                                                             |
| `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` | `repl_sh001_<8 ตัว hex>` / รหัสที่สคริปต์แสดง | เหมือนกัน                   | ใช้กับ**ทุก job** ฝั่ง central (`registry`, `catalog`, `shelter_*`, `edge_users_<code>`) · ได้จาก `scripts/central-repl-user.sh <CODE>` ที่ central ([SETUP-CENTRAL ขั้น 3](SETUP-CENTRAL.md)) · **ห้ามใส่ central admin และห้ามใส่บัญชีล็อกอินแอป** (`edge-init` เช็ก `_session`: ต้องมี role `repl:<CODE>` และไม่เป็น `_admin` ไม่ผ่าน = `FAILED`) · ตัวแปรเดิม `CENTRAL_REPL_*` เลิกใช้แล้ว ให้ลบออกจาก `.env` |
| `PUBLIC_ORIGIN`                         | `http://<IP ของ edge>`                        | domain แอป (เหมือน central) | URL ที่ browser เปิด · ฝังตอน build frontend                                                                                                                                                                                                                                                                                                                                                                      |
| `EDGE_LAN_IP`                           | `<IP ของ edge ใน LAN>`                        | เหมือนกัน                   | IP ที่ nginx ของ edge รับ — ไม่ใช้ `0.0.0.0` เพื่อไม่เปิดออก WAN                                                                                                                                                                                                                                                                                                                                                  |
| `EDGE_HTTP_PORT`                        | `80`                                          | `80`                        | port ของ nginx                                                                                                                                                                                                                                                                                                                                                                                                    |
| `EDGE_COUCHDB_PORT`                     | (ไม่ต้องใส่ = 5984)                           | เหมือนกัน                   | admin port ของ CouchDB — bind `127.0.0.1` เท่านั้น                                                                                                                                                                                                                                                                                                                                                                |
| `FRONTEND_IMAGE`                        | (ว่าง = build เอง)                            | ถ้ามี image แล้วใส่ชื่อ     | ข้ามการ build frontend                                                                                                                                                                                                                                                                                                                                                                                            |

- รหัสผ่านที่ตั้งเอง (`COUCHDB_PASSWORD`) **ห้ามมี** `"` `\` `@` `:` `/` `#` `%` `?` หรือช่องว่าง เพราะถูกใส่ลงใน URL และ JSON ตรง ๆ (`edge-init.sh` ประกอบเอง) · แนะนำสร้างด้วย `openssl rand -hex 24` · `EDGE_REPL_PASSWORD` สคริปต์ที่ central สร้างให้ (hex) ใช้ได้เลย
- `.env` และ `couchdb-edge.ini` อยู่ใน `.gitignore` แล้ว — อย่า commit
- `PUBLIC_ORIGIN` ฝังตอน build ถ้าเปลี่ยนภายหลังต้อง build frontend ใหม่

**ตั้งเวลาเครื่อง (NTP) — ทำก่อนขั้น 5**

```bash
sudo timedatectl set-ntp true
timedatectl    # ต้องเห็น System clock synchronized: yes และ NTP service: active
```

ทำไม: `verify_ssl_certificates = true` (ขั้น 3) — ถ้านาฬิกา edge เพี้ยน การตรวจ cert ของ central ล้ม (cert "ยังไม่เริ่ม/หมดอายุ") ทุก job จะ `crashing` (ดู [README T10b](README.md)) ·
ถ้า LAN ของศูนย์ไม่มี internet NTP ให้ชี้ `chrony` / `systemd-timesyncd` ไปที่ NTP server ในเครือข่ายเอง

---

## ขั้น 5 — เปิด stack

```bash
docker compose -f docker-compose.edge.yml up -d --build
```

build frontend ครั้งแรกใช้เวลาหลายนาที จากนั้นดูผลของ provisioning:

```bash
docker logs tent-edge-init-edge
```

ผลที่ควรเห็น (`ok` = สร้างใหม่ · `exists` = มีอยู่แล้ว รันซ้ำได้):

```
== edge-init: SH001 ← <SYNC_URL>
ok      central session: EDGE_REPL_USER มี role repl:SH001 และไม่ใช่ admin
ok      registry
ok      registry/_security
ok      catalog
ok      catalog/_security
ok      shelter_sh001
ok      shelter_sh001/_security
ok      registry/_design/edge_readonly
ok      catalog/_design/edge_readonly
ok      _replicator/registry_pull
ok      _replicator/catalog_pull
ok      _replicator/sh001_pull
ok      _replicator/sh001_push
ok      _replicator/users_sh001_pull
```

`FAILED` ขึ้นบรรทัดไหน → ดูตารางแก้ปัญหาท้ายไฟล์ (ส่วนใหญ่คือ `EDGE_REPL_*` ผิดหรือเป็น admin)

---

## ขั้น 6 — ตรวจว่า sync ทำงาน

หลัง `up` ครั้งแรก **รอ ~30 วินาที** (replicator ยังไม่หยิบ job ช่วงแรก รายการจะว่าง)

```bash
export E=http://admin:<COUCHDB_PASSWORD ของ edge>@localhost:5984     # EDGE_COUCHDB_PORT
EDGE=http://<EDGE_LAN_IP>                                           # + :<EDGE_HTTP_PORT> ถ้าไม่ใช่ 80

# 1) job ทั้ง 5 ต้อง running
curl -s $E/_scheduler/docs/_replicator \
  | python3 -c 'import sys,json; [print(d["doc_id"], d["state"], (d.get("info") or {}).get("error","")) for d in json.load(sys.stdin)["docs"]]'
```

| ตรวจ                  | คำสั่ง                                                                                                                                                                                                         | ต้องได้                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2 sync central → edge | เขียน doc ที่ central: `curl -X PUT $C/shelter_sh001/evacuee:01EDGETEST0000000000001 -d '{"type":"evacuee"}'` แล้ว `curl -s -o /dev/null -w '%{http_code}\n' $E/shelter_sh001/evacuee:01EDGETEST0000000000001` | `200` ภายในไม่กี่วินาที                                   |
| 3 sync edge → central | เขียนที่ edge ผ่าน nginx: `curl -X PUT -u <staff>:<pw> $EDGE/couch/shelter_sh001/evacuee:01EDGETEST0000000000002 -d '{"type":"evacuee"}'` แล้วอ่านจาก central                                                  | `200` ที่ central                                         |
| 4 filtered `_users`   | `curl -s -o /dev/null -w '%{http_code}\n' $E/_users/org.couchdb.user:<staff ของศูนย์อื่น>`                                                                                                                     | `404` (ไม่ถูกส่งมา)                                       |
| 5 login ที่ edge      | `curl -s -X POST $EDGE/couch/_session -H 'Content-Type: application/json' -d '{"name":"<staff>","password":"<pw>"}'`                                                                                           | `{"ok":true,...}`                                         |
| 6 guard read-only     | `curl -s -X PUT -u <staff>:<pw> $EDGE/couch/registry/x -d '{}'`                                                                                                                                                | `forbidden` / `read-only replica on edge`                 |
| 7 public plane ปิด    | `curl -s $EDGE/external/v1/x` และ `curl -s $EDGE/api/health`                                                                                                                                                   | `503` edge-only mode · `{"ok":true,"service":"frontend"}` |

`<staff>` = staff ของศูนย์นี้ที่มีอยู่แล้วที่ central (เช่น `staff01` ใน dev seed) ซึ่งถูก sync ลงมาตาม job `_users`

เกณฑ์ผ่านของขั้นนี้: ข้อ 1–7 ผ่านครบ · **ก่อนเปิดศูนย์ให้ทำ checklist ด้านล่าง (ขั้น 6B) ด้วย** · **ยังไม่ได้ทดสอบ:** เปิดหน้าแอปผ่าน browser ที่ `$EDGE` (curl เท่านั้น)
และการต่อข้ามเครื่องจริงผ่าน LAN — ผลที่ผ่านมาทดสอบแบบจำลองบนเครื่องเดียวด้วยไฟล์ชุดนี้

📖 [`/_scheduler/docs`](https://docs.couchdb.org/en/stable/api/server/common.html#scheduler-docs) ·
[`/_session`](https://docs.couchdb.org/en/stable/api/server/authn.html#cookie-authentication)

---

## ขั้น 6B — checklist ทดสอบก่อนเปิดศูนย์ (AC-1 ถึง AC-8 ของ [CR-247](../changes/01-core/CR-247-edge-per-shelter-repl-user.md))

ทำกับ **ศูนย์ทดสอบ** ที่มีศูนย์อื่นให้เทียบ (เช่น SH001 = ศูนย์ที่ทดสอบ, SH002 = ศูนย์อื่นใน dev seed) · `$CEN` = `SYNC_URL` · `<R>` = `EDGE_REPL_USER:EDGE_REPL_PASSWORD`

| AC                                                    | ทดสอบ                                                                                                                                                                                                                                                                                                                          | ต้องได้                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 ไม่มีรหัส admin บน edge                          | `grep -E 'CENTRAL_REPL' .env` และพิมพ์ username ของทุก job: `curl -s "$E/_replicator/_all_docs?include_docs=true" \| python3 -c 'import sys,json; [print(r["id"], (r["doc"].get("source") or {}).get("auth",{}).get("basic",{}).get("username")) for r in json.load(sys.stdin)["rows"] if not r["id"].startswith("_design")]'` | `.env` ไม่เจอ `CENTRAL_REPL_*` และไม่มีรหัส admin · ทุก job ฝั่ง source เป็น `repl_sh001_*` ไม่มี `admin` (job `sh001_push` ให้ดู `target.auth` แทน) |
| AC-2 อ่านนอกศูนย์ตัวเองไม่ได้                         | `curl -s -o /dev/null -w '%{http_code}\n' -u <R> $CEN/shelter_sh002` · `$CEN/_users/_changes` · `$CEN/edge_users_sh002`                                                                                                                                                                                                        | `401` / `403` ทั้ง 3                                                                                                                                 |
| AC-3 เขียน registry / catalog / edge_users ไม่ได้     | `curl -s -o /dev/null -w '%{http_code}\n' -X PUT -u <R> $CEN/registry/x -d '{}'` (ทำซ้ำกับ `catalog/x` และ `edge_users_sh001/x`)                                                                                                                                                                                               | `403` ทั้ง 3                                                                                                                                         |
| AC-4 `edge_users_sh001` ไม่เปิดให้คนอื่น              | `curl -s -o /dev/null -w '%{http_code}\n' $CEN/edge_users_sh001` (ไม่ login) แล้วอีกครั้งด้วย `-u <staff ของ SH001>:<pw>`                                                                                                                                                                                                      | `401` / `403` ทั้งสองครั้ง                                                                                                                           |
| AC-5 lockout หยุดแค่ศูนย์เดียว                        | **ทดสอบกับศูนย์ทดสอบเท่านั้น** ยิงรหัสผิดด้วยชื่อ `repl_sh001_*` 6 ครั้ง (`-u <ชื่อ>:wrong`) ให้ถูกล็อก (403) แล้วดู job ของ SH002                                                                                                                                                                                             | SH002 ยัง `running` และ sync ต่อ                                                                                                                     |
| AC-6 ปิดศูนย์เดียว                                    | ที่ central: `scripts/central-repl-user.sh SH001 --remove` แล้วดู job ของ SH001 บน edge                                                                                                                                                                                                                                        | job SH001 ล้ม (`401`/`unauthorized`) · SH002 ยัง sync (**จบแล้วสร้างใหม่ด้วย `central-repl-user.sh SH001` และตั้ง `EDGE_REPL_*` ใหม่**)              |
| AC-7a sync สองทางครบทุกชนิด doc                       | ดู "AC-7a" ด้านล่าง                                                                                                                                                                                                                                                                                                            | doc ทุกชนิดไปถึงอีกฝั่ง ไม่มี `doc_write_failures`                                                                                                   |
| AC-7b login ที่ edge ตอน WAN ล่ม                      | ดู "AC-7b" ด้านล่าง                                                                                                                                                                                                                                                                                                            | login ได้ที่ edge ทั้งที่ central ต่อไม่ได้                                                                                                          |
| AC-8 ถอด role / soft delete แล้วใช้งานที่ edge ไม่ได้ | ดู "AC-8" ด้านล่าง                                                                                                                                                                                                                                                                                                             | soft delete: login ไม่ได้ · ถอด role: roles ว่าง อ่าน `shelter_<code>` = 403                                                                         |
| AC-10 ใส่ admin ผิดตัว                                | ตั้ง `EDGE_REPL_USER=admin` (central admin) ใน `.env` แล้วรัน `docker compose -f docker-compose.edge.yml run --rm edge-init`                                                                                                                                                                                                   | `FAILED` exit 1 — **แล้วใส่ `EDGE_REPL_*` ที่ถูกกลับคืน**                                                                                            |

**AC-7a — sync สองทางของ `shelter_<code>`**

ดำเนินการผ่านแอป (ไม่ใช่ curl เขียน doc ตรง ๆ) เพราะ VDU ตรวจผู้เขียนและ role ของ staff จริง:

1. **central → edge:** ที่ central (ผ่านแอป ด้วย staff ของศูนย์) สร้าง doc หลายชนิด แล้วดูที่ edge ภายในไม่กี่วินาที
2. **edge → central:** ที่ edge เปิดแอปที่ `$EDGE` login ด้วย staff ของศูนย์ แล้วทำครบนี้ → ดูที่ central ว่ามาถึง
   - เขียน doc ที่มี `created_by` (เช่น ลงทะเบียนผู้อพยพ / บันทึกประจำวัน) — ต้องผ่านแม้ตอน push `userCtx.name` คือบัญชี `repl_*` ไม่ใช่ staff
   - **`evacuee_qr`** — พิมพ์/สร้าง QR ผู้อพยพที่ edge: `curl -s -u <R> "$CEN/shelter_sh001/_all_docs?startkey=%22evacuee_qr:%22&endkey=%22evacuee_qr:%EF%BF%B0%22"` ต้องเห็น doc (server ของ edge เขียน แล้ว push ขึ้น central — ผ่านได้เพราะ `repl:<CODE>` ได้สิทธิ์เท่า admin ตาม VDU)
   - **`daily_sop_role_assessment` ข้ามวัน** — สร้างที่ edge ขณะ WAN ล่ม แล้วรอข้ามเที่ยงคืน (เวลา Bangkok) ค่อยต่อ WAN กลับ → ต้องไม่ถูกปฏิเสธเพราะ `assessment_date` ย้อนหลัง
3. ที่ edge ดู `curl -s $E/_active_tasks` ว่า `doc_write_failures` ไม่เพิ่มของ job `sh001_push`

**AC-7b — login ที่ edge ตอน WAN ล่ม**

1. รอให้ `users_<code>_pull` ส่ง staff ถึง edge แล้ว (`curl -s -o /dev/null -w '%{http_code}\n' $E/_users/org.couchdb.user:<staff>` = `200`)
2. ตัด WAN (ขั้น 7: `docker compose stop couchdb` ที่ central หรือถอดสาย)
3. login ที่ edge: `curl -s -X POST $EDGE/couch/_session -H 'Content-Type: application/json' -d '{"name":"<staff>","password":"<pw>"}'` และเปิดแอปที่ `$EDGE` ด้วย browser → `{"ok":true,...}` และเข้าแอปได้

**AC-8 — user ที่ถูกถอดสิทธิ์ใช้งานที่ edge ไม่ได้**

1. ที่ central ถอด role `shelter:<CODE>` ของ staff ทดสอบ (หรือ soft delete) ผ่านแอป
2. รอเวลา sync ปกติ (`edge-users-copy` ที่ central + `users_<code>_pull` ที่ edge — ราว 1 นาที) · ถ้ารอนานให้ตรวจ `scripts/central-repl-user.sh <CODE> --status` ที่ central ก่อน
3. ที่ edge ด้วย staff คนนั้น:
   - **soft delete** → login ไม่ผ่าน (`401`) เพราะ soft delete เปลี่ยนรหัสผ่านด้วย
   - **ถอด role อย่างเดียว** → `POST /_session` ยังได้ `200` แต่ `roles` ว่าง และอ่าน `shelter_<code>` ได้ `403`
   - ถ้ายังเห็น role เดิม / ยัง login ได้หลัง soft delete = job คัดลอกหยุด (ดู SETUP-CENTRAL "ตรวจ `--status` ทุกวัน")

---

## ขั้น 7 — ทดสอบตอน central ล่ม (ทางเลือก)

จำลองว่า WAN/central ขาด แล้วดูว่า edge ยังใช้งานได้และ backlog ไหลกลับ

```bash
# บน central: ปิด CouchDB    →  docker compose stop couchdb
# บน edge: เขียนระหว่าง central ล่ม (ยังเขียนได้ ผ่าน nginx ของ edge)
curl -s -X PUT -u <staff>:<pw> $EDGE/couch/shelter_sh001/evacuee:01OUTAGE0000000000001 -d '{"type":"evacuee"}'
# บน edge: job ต้องเป็น crashing (ต่อ central ไม่ได้)
# บน central: เปิดกลับ       →  docker compose start couchdb
# รอ job กลับมา แล้วอ่านจาก central: curl -s $C/shelter_sh001/evacuee:01OUTAGE0000000000001
```

ถ้ารอนานแล้ว backlog ยังไม่มา แปลว่า job อยู่ในช่วง backoff — `edge-watchdog` จะเตะให้ภายในไม่กี่สิบวินาที (ดู "Watchdog") หรือ "เตะ" เอง (ดู "งานประจำ") ·
เคสละเอียด (ตัด WAN นาน ๆ, conflict, backlog ใหญ่, นาฬิกาเพี้ยน) อยู่ใน [README §4–§5](README.md) T4–T11

---

## edge stack ประกอบด้วยอะไร และทำไมไม่เหมือน stack ของ central

ตั้งต้นจาก `docker-compose.production.yml` แล้วตัดส่วนที่ edge ไม่มีออกตาม OD-1

| service                                     | ทำไม                                                                                                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `couchdb` (`tent-couchdb-edge`)             | ตัวเก็บข้อมูลที่ศูนย์ + ที่อยู่ของ replication job · port bind `127.0.0.1` เท่านั้น staff เข้าผ่าน nginx                                                                                                                                                 |
| `couchdb-init`                              | สร้าง `_users`, `_replicator` (single node) — เหมือน production                                                                                                                                                                                          |
| `edge-init`                                 | **เพิ่มใหม่** รัน `scripts/edge-init.sh` (ด้านล่าง)                                                                                                                                                                                                      |
| `frontend`                                  | แอป staff ให้ใช้บน LAN ตอน WAN ขาด · ไม่ตั้ง `FASTAPI_INTERNAL_URL`, `EXTERNAL_API_SECRET`, `COUCHDB_PUBLIC_WRITER_URL`, import worker token, OAuth — route ของ public plane จะ fail ตามโหมด degraded แต่แอปยัง start ได้                                |
| `nginx`                                     | `/couch` + SPA ให้ browser ในศูนย์ · ใช้ `nginx-edge/` แทน `nginx/` เพราะ `nginx/nginx.conf` proxy `/external/` ไป `fastapi:9000` ซึ่งไม่มีที่ edge → nginx **start ไม่ขึ้นทั้งตัว** (`host not found in upstream`) · edge ตอบ `/external/` ด้วย 503 แทน |
| `edge-watchdog`                             | **เพิ่มใหม่** ตรวจ job ทุก 60 วินาที ถ้า job ค้างอยู่ใน backoff ทั้งที่ central กลับมาแล้ว จะเตะให้เอง (หัวข้อ "Watchdog" ด้านล่าง)                                                                                                                      |
| ~~mongodb, worker, fastapi, import-worker~~ | ตัดออก — public plane และ import เป็นงานของ central                                                                                                                                                                                                      |

### `edge-init.sh` ทำ 3 อย่าง (หลังตรวจ credential)

0. **ตรวจ credential** (`_session` ของ `EDGE_REPL_*` — ดูด้านล่าง)
1. **สร้าง DB + `_security`** (`registry`, `catalog`, `shelter_<code>`: `members.roles=["shelter:<CODE>"]`, `admins.roles=["system_admin"]`)
   — `_security` **ไม่ถูก replicate** ถ้าปล่อยให้ job สร้าง DB เอง (`create_target`) DB จะไม่มี `_security` และ staff ทุกศูนย์เข้าได้
2. **`_design/edge_readonly` บน `registry` / `catalog`** — `validate_doc_update` ที่ยอมให้เขียนเฉพาะ `_admin`
   เพราะ 2 DB นี้เป็นทางเดียว (central → edge) ถ้า staff เขียนที่ edge ได้ ข้อมูลจะไม่กลับ central และไม่มีใครรู้ · ยอม `_admin` เพราะ replicator ฝั่ง edge เขียนด้วย admin
3. **replication job 5 ตัวใน `_replicator`** (`continuous: true` — อยู่รอดหลัง restart)

| job                | ทิศทาง         | credential ฝั่ง central                       | ใช้ทำอะไร                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `registry_pull`    | central → edge | `EDGE_REPL_USER` (`repl:<CODE>` ไม่ใช่ admin) | master data ให้อ่านตอน WAN ขาด                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `catalog_pull`     | central → edge | `EDGE_REPL_USER`                              | catalog                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sh001_pull`       | central → edge | `EDGE_REPL_USER`                              | ข้อมูลศูนย์ที่เขียนที่ central                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sh001_push`       | edge → central | `EDGE_REPL_USER`                              | ข้อมูลที่เขียนที่ edge ตอน WAN ขาด (backlog) · `selector` กรอง `_design/*` ออก (decision sync 2026-10-18)                                                                                                                                                                                                                                                                                                                                        |
| `users_sh001_pull` | central → edge | `EDGE_REPL_USER`                              | ให้ staff ของศูนย์นี้ login ที่ edge ได้ · source คือ DB `edge_users_sh001` ที่ central · selector กรองแค่ `_design/*` — การกรอง user (`edge_shelters` มี `<CODE>` **หรือ** `roles` มี `shelter:<CODE>` — [CR-171](../changes/01-core/CR-171-users-edge-shelters-soft-delete.md)) ทำที่ central โดย service `edge-users-copy` ตอนคัดลอก `_users` → `edge_users_sh001` จึงไม่มี user ศูนย์อื่น และ revision ที่ถอด role / soft delete ยังถึง edge |

- URL ฝั่ง edge ใน job คือ `http://127.0.0.1:5984` เพราะ job รัน **ภายใน container CouchDB** เอง
- job แต่ละตัวเก็บ `edge_init_hash` (fingerprint ของ URL + credential + selector) — รันซ้ำแล้ว config ตรงกับ `.env` = `exists` (ข้าม) · ไม่ตรง เช่นแก้ `SYNC_URL` / รหัส / `SHELTER_CODE` = `stale` แล้วลบและสร้างใหม่ให้เอง (job ที่สร้างก่อนมี fingerprint ถูกสร้างใหม่หนึ่งครั้ง)
- **เช็ก credential ก่อนสร้าง job:** `edge-init` เรียก `GET <SYNC_URL>/_session` ด้วย `EDGE_REPL_*` — ต้องได้ 200, `userCtx.roles` ต้องมี `repl:<SHELTER_CODE>` และ **ไม่มี `_admin`** ไม่ผ่านข้อใดข้อหนึ่ง = `FAILED` exit 1 (กันเอา central admin หรือบัญชีของศูนย์อื่นมาใส่)
- **เช็ก uuid ก่อนสร้าง job:** `edge-init` เรียก `GET /` ของ central (ด้วย `EDGE_REPL_USER`) และของ edge เทียบ `uuid` — ถ้าตรงกัน แปลว่า `SYNC_URL` ชี้กลับมาที่ edge ตัวเอง (เช่น LAN DNS ยังชี้ domain มาที่ edge) จะขึ้น `FAILED` แล้ว exit 1 · อ่าน `GET /` ของ central ไม่ได้ก็ `FAILED` เช่นกัน · ถ้าไม่เช็ก job จะขึ้น `running` `error_count 0` ทั้งที่ replicate เข้าตัวเอง
- รหัสผ่านใน doc ของ `_replicator` เป็น **plaintext** (admin ของ edge อ่านกลับก็เห็น) ถือเป็นความลับของเครื่อง edge · แต่รหัสนี้เป็นของ `repl:<CODE>` ที่เข้าได้แค่ DB ของศูนย์นี้ — เครื่องหายก็ปิดได้ที่ central ทีละศูนย์ (SETUP-CENTRAL "เครื่อง edge หาย") ไม่มีรหัส central admin อยู่บน edge

### `EDGE_MODE` — edge แก้บัญชีไม่ได้ (CR-171 FR-13–FR-17)

`_users` ไหล central → edge ทางเดียว ถ้าแก้ที่ edge doc จะ conflict กับ revision ที่ pull มาทีหลัง แล้ว user คนนั้น login ไม่ได้
`docker-compose.edge.yml` จึงตั้ง `EDGE_MODE=true` ให้ frontend ของ edge (central ไม่ตั้ง = ปิด · ไม่ต้องใส่ใน `.env`) เมื่อเปิด:

- **ปฏิเสธ** (403 "แก้ไขบัญชีได้เฉพาะที่ระบบกลาง" และไม่เขียน doc): users CRUD / reset password / rotate staff card, `PATCH auth/me`,
  forgot-password, force-setup, link/unlink Google·ThaID, volunteer-access — รายการเต็มที่ [CR-171 FR-15](../changes/01-core/CR-171-users-edge-shelters-soft-delete.md)
- **ทำงานปกติ:** login (ชื่อ/เบอร์/OAuth), `GET auth/me`, mfa clear/skip, อ่านทุกอย่าง · OAuth login ข้ามการเขียน `verified_at` (FR-14)
- `EDGE_MODE` ตั้งใน compose แล้ว แต่ guard เป็นโค้ดใหม่ ต้อง **build image frontend ใหม่** หลัง `git pull` (`docker compose -f docker-compose.edge.yml up -d --build frontend` · ถ้าใช้ `FRONTEND_IMAGE` ให้ pull image ที่ build จากโค้ดนี้) ไม่งั้นยังรันโค้ดเก่าที่ไม่มี guard · ตรวจ: แก้ profile ที่ edge ต้องถูกปฏิเสธ

#### บัญชีสำรอง (ต้องเตรียมก่อนเปิดศูนย์)

ที่ edge ตั้ง/รีเซ็ตรหัสไม่ได้ ถ้าผู้ใช้ลืมรหัสหรือยังไม่เคย login ครั้งแรก (`must_change_password` → force-setup) จะเข้าไม่ได้จนกว่า WAN กลับ ดังนั้น:

1. **provision และ activate ที่ central ก่อนเปิดศูนย์** — ให้ทุกบัญชีที่จะใช้ที่ edge login สำเร็จที่ central อย่างน้อยหนึ่งครั้ง (ผ่าน force-setup แล้ว) และรอให้ `users_<code>_pull` ส่งถึง edge
2. เตรียม **บัญชีสำรอง** (เช่น shelter_manager / ผู้ดูแลเพิ่ม) ที่ activate แล้ว ไว้ใช้เมื่อมีคนลืมรหัสระหว่าง WAN ล่ม
3. **จำนวนบัญชีสำรองให้ผู้จัดการศูนย์ประเมิน** (A4) ตามจำนวนคนและกะของศูนย์ — ไม่มีค่าตายตัว

เขียน `_users` ตรงที่ edge (Fauxton / admin API / `ensurePublicWriter` / `ensurePrintingService` / seed) ยังข้าม guard ได้ — **ห้ามทำ** (FR-17)

---

### อัปเกรดเป็น CR-171 (`_users.edge_shelters` + soft delete)

selector ของ `users_<code>_pull` เปลี่ยน (hash ของ job เปลี่ยน → `edge-init` สร้างใหม่เอง, checkpoint เริ่มใหม่ครั้งเดียว) ลำดับ:

1. **central:** deploy frontend ก่อน — writer เริ่มเขียน `edge_shelters` · deploy `_users/_design/tent_guard` v2 (guard `edge_shelters` / `deleted_at` / `deleted_by`) — Jenkins deploy ของ staging / prod รัน `pnpm db:sync` ซึ่งรวม step นี้ให้แล้ว (ตรวจว่า `_users/_design/tent_guard` เป็น version 2 หลัง deploy ครั้งแรก) · central ที่ไม่ได้ deploy ผ่าน Jenkins ให้รัน `cd frontend && pnpm sync:central --write --confirm` เอง (รัน step 1-8 ไม่ใช่แค่ step 8) ถ้าข้ามไป non-admin แก้ field เหล่านี้บน doc ตัวเองได้
2. **central:** `cd frontend && pnpm backfill:edge-shelters` (dry-run) → ตรวจ → `pnpm backfill:edge-shelters --write` (รันซ้ำได้ รอบสองต้องไม่มี doc เปลี่ยน)
3. **edge แต่ละเครื่อง:** `git pull` แล้ว `docker compose -f docker-compose.edge.yml run --rm edge-init` — ขึ้น `stale  _replicator/users_<code>_pull` แล้วสร้างใหม่

ทำข้อ 3 ก่อนข้อ 2 ได้ ไม่ทำให้ user หายจาก edge (selector มี `$or` กับ `roles`) · user ที่ถูก `DELETE` ก่อน CR-171 (tombstone) ไม่ถูกแก้ย้อนหลัง — ลบที่ edge ด้วยมือ หรือ wipe edge · ห้ามลบ/แก้ `_users` ตรงผ่าน Fauxton / admin API (ข้ามกฎนี้)

📖 [Replicator database](https://docs.couchdb.org/en/stable/replication/replicator.html) ·
[Selector objects](https://docs.couchdb.org/en/stable/replication/replicator.html#selectorobj) ·
[Validate document update](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions)

---

### edge ที่ติดตั้งก่อน CR-247 (เปลี่ยนจาก central admin เป็น replication user ต่อศูนย์)

edge ที่ติดตั้งไว้แล้วใช้ `CENTRAL_REPL_*` = central admin ลำดับย้าย (ทำทีละศูนย์ได้ ไม่ต้องพร้อมกัน):

1. **central (ผู้ดูแล central):** `scripts/central-repl-user.sh <CODE>` — ได้ `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` (แสดงครั้งเดียว) และ DB `edge_users_<code>` ถูกสร้าง · service `edge-users-copy` (ต้องเปิดอยู่แล้ว — SETUP-CENTRAL ขั้น 3.4) backfill user ของศูนย์ให้ภายใน 1 นาที · ตรวจ `--status` ให้ exit 0 และรอให้ DB `edge_users_<code>` มี user ครบก่อน
2. **edge:** `git pull` · แก้ `.env` — **ลบ** `CENTRAL_REPL_USER` / `CENTRAL_REPL_PASSWORD` แล้วใส่ `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` ตามที่ได้ (ดู `.env.edge.example`)
3. **edge:** `docker compose -f docker-compose.edge.yml run --rm edge-init` — hash ของ job เปลี่ยน (credential และ source ของ `users_<code>_pull` เปลี่ยน) จึงขึ้น `stale` แล้วสร้างใหม่ทุก job · `users_<code>_pull` ชี้ `edge_users_<code>` แทน `_users` ของ central โดย**ไม่มี conflict ใน `_users` ของ edge** (revision tree เดียวกัน — AC-9) · แล้ว `docker compose -f docker-compose.edge.yml up -d` เพื่อให้ `edge-watchdog` ได้ env ใหม่
4. **ตรวจ:** job ทั้ง 5 `running` (ขั้น 6) · `_users` ของ edge ไม่มี conflict (`curl -s "$E/_users/_all_docs?conflicts=true&include_docs=true"` ต้องไม่มี `_conflicts` ใน doc ใด) · login ที่ edge ได้ · ทำ checklist ขั้น 6B
5. **หลังทุก edge ย้ายครบ:** ผู้ดูแล central หมุนรหัส central admin (SETUP-CENTRAL "หลัง deploy CR-247") — รหัส admin เก่าที่เคยอยู่ใน `.env` และ `_replicator` ของ edge จะใช้ไม่ได้อีก

ลบรหัส admin เก่าออกจาก backup / ประวัติของ `.env` ด้วยถ้ามี · edge ที่ยังไม่ย้ายใช้ได้ตามเดิมจนกว่า central จะหมุนรหัส admin

---

## งานประจำ

```bash
curl -s $E/_scheduler/jobs            # job + history (error ล่าสุด)
curl -s $E/_active_tasks              # docs_read / docs_written / changes_pending
docker logs tent-couchdb-edge 2>&1 | grep -i replicat
```

**"เตะ" job** — เริ่มทันทีโดยข้าม backoff: ลบ doc แล้วรัน `edge-init` ใหม่ (เปลี่ยน URL / credential ใน `.env` ไม่ต้องเตะ — รัน `edge-init` อย่างเดียว job ที่ไม่ตรงจะถูกสร้างใหม่เอง)
(checkpoint ยังอยู่ใน `_local/*` จึงไม่ไล่ใหม่ทั้งหมด)

```bash
kick() { # kick <doc-id>   เช่น kick sh001_push
  local rev=$(curl -s "$E/_replicator/$1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_rev"])')
  curl -s -X DELETE "$E/_replicator/$1?rev=$rev"; echo
}
kick users_sh001_pull
docker compose -f docker-compose.edge.yml run --rm edge-init
```

---

## Watchdog — เตะ job ที่ค้างหลัง WAN/central ขาดนาน

**ปัญหาที่พบจริงใน lab (2026-10-01):** ช่วงที่ edge ติดต่อ central ไม่ได้ (~1.5 ชั่วโมง) job ฝั่งดึง 4 ตัวล้มติดกัน 8 ครั้ง
(`error_count=8`) CouchDB เพิ่มเวลารอก่อนลองใหม่เป็นเท่าตัวทุกครั้งที่ล้ม จึงยังเป็น `crashing` ต่อไปอีกนาน **แม้เครือข่ายกลับมาแล้ว**
ผลคือ edge ส่งข้อมูลขึ้น central ได้ (`push` ถูกกระตุ้นด้วยการเขียนใหม่) แต่ **ไม่ได้รับข้อมูลใหม่จาก central** โดยไม่มี error ให้เห็นในแอป
ตามหลักการ edge ที่ไม่มีคนดูแลต้องหายเองได้ จึงมี service `edge-watchdog` ใน [`docker-compose.edge.yml`](../../docker-compose.edge.yml)

สคริปต์: [`scripts/edge-watchdog.sh`](../../scripts/edge-watchdog.sh) · ทุก `WATCHDOG_INTERVAL` วินาทีดู `_scheduler/docs/_replicator`
และ "เตะ" job (ลบ doc แล้วรัน `edge-init.sh` สร้างใหม่ — checkpoint ยังอยู่ ไม่ไล่ใหม่ทั้งหมด) เมื่อ **ครบทุกข้อ**:

| เงื่อนไข                                                                                                                                                                                                                                                                                  | ทำไม                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| state `crashing` และ `error_count` ≥ `WATCHDOG_MIN_ERRORS` (3)                                                                                                                                                                                                                            | ไม่ยุ่งกับการล้มชั่วคราวครั้งสองครั้ง                                                                                                                              |
| error **ไม่ใช่** central ปฏิเสธรหัสผ่าน — สคริปต์จับคำว่า `unauthorized` / `forbidden` (ไม่สนตัวพิมพ์) ซึ่งครอบทั้ง `auth_noop` ของ setup จริง (`unauthorized: ...` 401 / `forbidden: ...` 403) และ session plugin แบบ lab (`session_request_unauthorized` / `session_request_forbidden`) | เตะไม่ช่วยอะไร และทุกครั้งที่ลองใหม่นับเข้าระบบล็อกเอาต์ของ CouchDB (รหัสผิดเกิน 5 ครั้ง → 403 นาน 5 นาที) ต้องแก้ `.env` เอง                                      |
| `GET <SYNC_URL>/_up` ตอบเป็น JSON ของ CouchDB (`"status":"ok"`)                                                                                                                                                                                                                           | ถ้า central ยังไม่กลับ เตะไปก็ล้มซ้ำ · ตรวจเนื้อหา ไม่ใช่แค่ HTTP 200 เพราะถ้า LAN DNS ยังชี้ domain แอปมาที่ edge คำขอจะตกไปที่เว็บแอปของ edge ซึ่งตอบ 200 (HTML) |
| job นั้นไม่ได้ถูกเตะภายใน `WATCHDOG_COOLDOWN` (300 วินาที)                                                                                                                                                                                                                                | กันเตะวน                                                                                                                                                           |

หมายเหตุ: CouchDB ห่อ error ของการต่อ central ไม่ได้ (`nxdomain`, `conn_failed`, `connection closed`) ไว้ใน `replication_auth_error` ด้วย
(`session_request_failed`) สคริปต์จึงแยกตามสาเหตุจริงด้านบน ไม่ใช่ดูแค่ชื่อ `replication_auth_error`

```bash
docker logs -f tent-edge-watchdog-edge          # ดูการทำงาน
```

ตัวอย่าง log: `sh001_pull stuck (errors=2) while central is up — deleted, will be recreated` →
`edge-init re-run ok: 4 job(s) recreated` · หรือ `registry_pull crashing: central REJECTED the credentials ... not restarting`

| ตัวแปรใน `.env`       | default | ใช้ทำอะไร                                 |
| --------------------- | ------- | ----------------------------------------- |
| `WATCHDOG_INTERVAL`   | 60      | ตรวจทุกกี่วินาที                          |
| `WATCHDOG_MIN_ERRORS` | 3       | ล้มติดกันกี่ครั้งจึงถือว่าค้าง            |
| `WATCHDOG_COOLDOWN`   | 300     | เว้นอย่างน้อยกี่วินาทีก่อนเตะ job เดิมอีก |
| `WATCHDOG_DRY_RUN`    | 0       | `1` = บันทึก log อย่างเดียว ไม่เตะ        |

**ทดสอบแล้ว** (central จำลองเป็น CouchDB ชั่วคราว + edge stack จริง ตั้ง interval 5 วินาที):

| สถานการณ์      | ผล                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ปกติ           | เงียบ ไม่ทำอะไร                                                                                                                   |
| central ล่ม    | job `crashing` → watchdog ขึ้นว่า "central ... is not answering — leaving them" ไม่แตะ                                            |
| central กลับมา | เตะ 4 job ภายใน **1 วินาที** หลัง `/_up` ตอบ · doc ที่เขียนที่ central ระหว่างนั้นมาถึง edge ภายใน **5 วินาที** โดยไม่มีใครแตะมือ |

**ทดสอบซ้ำกรณีรหัสผิดด้วย setup จริง** (2026-10-16 · CouchDB 3.5.2 ทั้งสองฝั่ง · central หลัง nginx TLS `location /sync/` (self-signed) ·
edge ใช้ `couchdb-edge-example.ini` (`auth_noop`, ปิด `verify_ssl_certificates` เพราะ self-signed) · `SYNC_URL=https://central.test/sync` · watchdog `WATCHDOG_ONCE=1 WATCHDOG_DRY_RUN=1`):

| ช่วง                                           | error ใน `_scheduler/docs` (`info.error`)                                                                             | watchdog regex เดิม          | watchdog regex ใหม่                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| รหัสผิด ก่อนล็อก (central ตอบ 401)             | `unauthorized: unauthorized to access or create database https://central.test/sync/shelter_sh001/`                    | ❌ "would restart" — **เตะ** | ✅ "central REJECTED the credentials" ไม่เตะ |
| ถูกล็อก (รหัสผิดครบ 5 ครั้ง, central ตอบ 403)  | `forbidden: https://central.test/sync/_users/` · log ของ central: `Authentication rejected for locked-out user admin` | ❌ เตะ                       | ✅ ไม่เตะ                                    |
| เทียบ: lab `http://<IP>:5984` + session plugin | `{replication_auth_error,{session_request_unauthorized,"http://central:5984/_session","admin"}}`                      | ✅ ไม่เตะ                    | ✅ ไม่เตะ                                    |
| central ล่ม (`auth_noop`, nginx ตอบ 502)       | `{http_error_code,502,<<"GET https://central.test/sync/shelter_sh001/">>}`                                            | ไม่ตรง → รอ `/_up`           | ไม่ตรง → รอ `/_up`                           |
| central ล่ม (session plugin, nxdomain)         | `{replication_auth_error,{session_request_failed,...,{conn_failed,{error,nxdomain}}}}`                                | ไม่ตรง → รอ `/_up`           | ไม่ตรง → รอ `/_up`                           |

ผลเดิม "ไม่เตะ 0 ครั้ง" มาจาก setup lab (`http://<IP>:5984` + session plugin) — กับ setup จริง (`auth_noop`) regex เดิมจับไม่ได้
จึงจะลบ/สร้าง job ใหม่ทุก `WATCHDOG_COOLDOWN` และทำให้ lockout ของ central ไม่หมด · แก้แล้วเป็น `grep -i -E 'unauthorized|forbidden'` ·
ยังไม่ได้ทดสอบ: 403 ที่มาจาก proxy / WAF หน้า central (ไม่ใช่ CouchDB) — regex ใหม่จะนับเป็นรหัสผิดและไม่เตะ (ปลอดภัยฝั่งไม่วนล็อก แต่ต้องดู log เอง)

**ยังไม่ได้ทดสอบ:** ช่วงขาดนานกว่าหลายนาทีแบบควบคุมเวลา (1 นาที / 10 นาที / 1 ชั่วโมง ตาม README T4), และบน mini PC จริง
(ตอนนี้ mini PC ใช้ stack เดิมที่ยังไม่มี `edge-watchdog` — `git pull` แล้ว `docker compose -f docker-compose.edge.yml up -d` จะเพิ่มให้)

---

## แก้ปัญหา (ฝั่ง edge)

| อาการ                                                                                                                           | สาเหตุ                                                                                                                                                                                                                                                                                                                                | แก้                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crashing` + `unauthorized` (401)                                                                                               | `EDGE_REPL_*` ผิด · **ผู้ดูแล central สั่ง `--rotate` หรือ `--remove` ของศูนย์นี้แล้ว** รหัสใน `.env` จึงใช้ไม่ได้                                                                                                                                                                                                                    | ขอ `EDGE_REPL_*` ชุดล่าสุดจาก central (`central-repl-user.sh <CODE>`) ใส่ `.env` แล้วรัน `edge-init` ใหม่ · SETUP-CENTRAL ขั้น 3                                                                        |
| `crashing` + `forbidden: ...` (`auth_noop`) หรือ `session_request_forbidden` (session plugin) — 403 ทั้งที่รหัสน่าจะถูก         | **ถูกล็อกเอาต์**: CouchDB 3.5 นับรหัสผิดต่อ (user, IP) ถ้าเกิน 5 ครั้งจะตอบ 403 ต่อไปแม้รหัสถูกแล้ว (`chttpd_auth_lockout` default `enforce`) · job ที่ retry ด้วยรหัสผิดเองก็ทำให้เกิดได้ เห็นใน log ของ central ว่า `Authentication rejected for locked-out user` · **ล็อกเฉพาะชื่อ `repl_<code>_*` ของศูนย์นี้** ศูนย์อื่นไม่กระทบ | แก้รหัสให้ถูกก่อน แล้วรอ **5 นาที** นับจากความผิดพลาดครั้งแรก (`max_lifetime`) หรือ restart CouchDB ของ central เพื่อล้างตาราง · อย่าลบ/สร้าง job ซ้ำ ๆ ระหว่างรอ เพราะ job ที่รหัสยังผิดจะทำให้ล็อกต่อ |
| `crashing` + `nxdomain` / `econnrefused` / timeout                                                                              | `SYNC_URL` ผิด, central ปิด, firewall                                                                                                                                                                                                                                                                                                 | ขั้น 1                                                                                                                                                                                                  |
| `crashing` + error certificate                                                                                                  | cert ยังไม่ออก / self-signed / นาฬิกา edge เพี้ยน                                                                                                                                                                                                                                                                                     | ขั้น 3 (`verify_ssl_certificates`) · NTP                                                                                                                                                                |
| ได้ HTML แทน JSON                                                                                                               | `location /sync/` ยังไม่มีบน central, `proxy_pass` ไม่มี `/` ท้าย หรือ LAN DNS ยังชี้ domain แอปมาที่ edge (cutover ยังไม่ cutback)                                                                                                                                                                                                   | SETUP-CENTRAL ขั้น 4B · ตรวจว่า `<domain>` resolve ได้ IP ของ central                                                                                                                                   |
| `413` ใน history ของ job                                                                                                        | `client_max_body_size` ที่ central เล็กไป                                                                                                                                                                                                                                                                                             | SETUP-CENTRAL ขั้น 4B ข้อ (2) หรือลด `worker_batch_size`                                                                                                                                                |
| job ฝั่งดึงเป็น `crashing` `error_count` สูงอยู่นาน ทั้งที่ central กลับมาแล้ว (central → edge ไม่ sync, edge → central ยังได้) | CouchDB เพิ่มเวลารอเป็นเท่าตัวทุกครั้งที่ล้ม                                                                                                                                                                                                                                                                                          | `edge-watchdog` เตะให้เอง · ทำเองได้ด้วย `kick` ด้านบน · ดู "Watchdog"                                                                                                                                  |
| `crashing` + `session_unexpected_result` ... `/_session`                                                                        | ไม่ได้ตั้ง `auth_plugins = couch_replicator_auth_noop` ใน `couchdb-edge.ini` ทั้งที่ `SYNC_URL` มี path                                                                                                                                                                                                                               | ขั้น 3 แล้ว restart CouchDB ของ edge · เตะ job                                                                                                                                                          |
| `crashing` หลัง WAN กลับ ทั้งที่ central ปกติ                                                                                   | LAN DNS ยังชี้ domain แอปมาที่ edge (ยังไม่ cutback) job ยิงเข้า edge ตัวเอง ([README T9](README.md))                                                                                                                                                                                                                                 | cutback คืน DNS แล้ว `edge-watchdog` เตะให้เอง                                                                                                                                                          |
| staff login ที่ edge ไม่ได้                                                                                                     | job `users_<code>_pull` ไม่ `running` (รหัส `EDGE_REPL_*` ผิด), service `edge-users-copy` ที่ central หยุด, staff ไม่มี role `shelter:<CODE>` / `edge_shelters` ที่ central, ยังไม่เคย activate ที่ central (`must_change_password`) หรือ CouchDB คนละ version                                                                        | ขั้น 4 · ให้ผู้ดูแล central รัน `central-repl-user.sh <CODE> --status` · ใช้ `couchdb:3.5` ทั้งสองฝั่ง                                                                                                  |
| login ที่ edge ได้ทั้งที่ถอดสิทธิ์ / soft delete ที่ central แล้ว                                                               | service `edge-users-copy` ที่ central หยุด หรือ `users_<code>_pull` ที่ edge ค้าง                                                                                                                                                                                                                                                     | ให้ผู้ดูแล central ตรวจ `--status` · เตะ `users_<code>_pull` ที่ edge (`kick`)                                                                                                                          |
| `edge-init` ขึ้น `FAILED  EDGE_REPL_USER มี role _admin` / `ไม่มี role repl:<CODE>` / `GET .../_session ... ไม่ผ่าน`            | ใส่ central admin หรือบัญชีผิดศูนย์ (หรือรหัสผิด) ใน `EDGE_REPL_*`                                                                                                                                                                                                                                                                    | ใช้ค่าที่ `scripts/central-repl-user.sh <CODE>` ที่ central แสดง (ศูนย์นี้) แล้วรัน `edge-init` ซ้ำ                                                                                                     |
| `edge-init` ขึ้น `FAILED ... (HTTP 4xx/5xx)`                                                                                    | ดูข้อความหลัง `FAILED` — ส่วนใหญ่ central ต่อไม่ได้ หรือ JSON เพี้ยนเพราะรหัสผ่านมี `"` / `\`                                                                                                                                                                                                                                         | แก้ `.env` แล้วรัน `edge-init` ซ้ำ (รันซ้ำได้)                                                                                                                                                          |
| `edge-init` ขึ้น `FAILED  SYNC_URL (...) ชี้กลับมาที่ edge ตัวเอง (uuid ตรงกัน ...)`                                            | `SYNC_URL` resolve มาที่ edge เอง — LAN DNS ยังชี้ domain central มาที่ edge (cutover ยังไม่ cutback) หรือใส่ URL ผิด                                                                                                                                                                                                                 | แก้ `SYNC_URL` / คืน DNS ให้ชี้ central แล้วรัน `edge-init` ซ้ำ                                                                                                                                         |
| `edge-init` ขึ้น `FAILED  อ่าน GET / ของ central ... ไม่ได้`                                                                    | ต่อ central ไม่ได้, `SYNC_URL` ผิด หรือ `EDGE_REPL_*` ผิด / ถูกล็อกเอาต์                                                                                                                                                                                                                                                              | ขั้น 1 · `.env` ขั้น 4 · แก้แล้วรัน `edge-init` ซ้ำ                                                                                                                                                     |
| list job ว่างหลัง `up`                                                                                                          | replicator ยังไม่หยิบ job                                                                                                                                                                                                                                                                                                             | รอ ~30 วินาที                                                                                                                                                                                           |
| CouchDB ไม่ start / mount error                                                                                                 | ไม่มีไฟล์ `couchdb-edge.ini` (Docker สร้างเป็นโฟลเดอร์)                                                                                                                                                                                                                                                                               | ขั้น 3 แล้ว `docker compose -f docker-compose.edge.yml up -d --force-recreate`                                                                                                                          |
| nginx edge ไม่ start: `host not found in upstream "fastapi"`                                                                    | mount `nginx/` ของ central แทน `nginx-edge/`                                                                                                                                                                                                                                                                                          | ใช้ `docker-compose.edge.yml` ตัวจริง                                                                                                                                                                   |
| `doc_write_failures` เพิ่มใน `_active_tasks`                                                                                    | VDU ฝั่ง target ปฏิเสธ (`edge_readonly` กัน user ที่ไม่ใช่ admin)                                                                                                                                                                                                                                                                     | ตรวจว่า `COUCHDB_USER` เป็น admin                                                                                                                                                                       |

📖 [Replication states](https://docs.couchdb.org/en/stable/replication/replicator.html#replication-states) ·
[`/_scheduler/*`, `/_active_tasks`](https://docs.couchdb.org/en/stable/api/server/common.html)

---

> **หมุนรหัส / ปิด edge — ทำที่ central เป็นรายศูนย์ ไม่กระทบศูนย์อื่น:** edge ไม่ถือ central admin แล้ว จึงไม่ต้องแก้ edge ทุกเครื่องตอนหมุนรหัส admin ของ central
> (ผู้ดูแล central รันสคริปต์ซ้ำเพื่อให้ job คัดลอก `_users` ใช้รหัสใหม่ — SETUP-CENTRAL "หลัง deploy")
> CouchDB ล็อกเอาต์ตาม (ชื่อ, IP) และแต่ละศูนย์มีชื่อ `repl_<code>_<suffix>` ของตัวเอง รหัสผิดที่ edge หนึ่งเครื่องจึงล็อกแค่ศูนย์นั้น
> `--rotate` ของศูนย์ไหน → แก้ `EDGE_REPL_PASSWORD` ใน `.env` ของ edge ศูนย์นั้นแล้วรัน `edge-init` **ทันที** อย่าปล่อยให้ job ที่ถือรหัสเก่า retry ต่อ

## ตอน cutover / cutback (แบบ path `/sync`)

`SYNC_URL=https://<domain>/sync` ใช้ชื่อเดียวกับแอป จึงมีผลตามนี้:

| ช่วง                           | LAN DNS ของ `<domain>` | job ของ edge                                                                            |
| ------------------------------ | ---------------------- | --------------------------------------------------------------------------------------- |
| ปกติ                           | central                | `running`                                                                               |
| WAN ขาด ก่อน cutover           | central (แต่ต่อไม่ได้) | `crashing` (เข้า central ไม่ได้) — ปกติ                                                 |
| cutover                        | **edge**               | `crashing` — ยิงเข้า edge ตัวเอง (nginx edge ฟังแค่ :80 จึง TLS ล้ม) ไม่มีข้อมูลเสียหาย |
| WAN กลับแต่ **ยังไม่ cutback** | **edge**               | ยัง `crashing` — **sync ยังไม่กลับ**                                                    |
| cutback (คืน DNS)              | central                | watchdog เตะ job ภายใน `WATCHDOG_INTERVAL` แล้ว sync ต่อจาก checkpoint เดิม             |

ข้อสรุปสำหรับ runbook ของศูนย์: **cutback ต้องทำทันทีที่ WAN กลับ** เพราะเป็นขั้นที่ทำให้ sync กลับมา
(ข้อมูลที่เขียนที่ edge ระหว่างนั้นไม่หาย — ขึ้น central หลัง cutback) · ยังไม่ได้ทดสอบกับ DNS ศูนย์จริง (README T9)

---

## ถอดออก

```bash
docker compose -f docker-compose.edge.yml down
# ล้างข้อมูลด้วย (ไฟล์เป็นของ uid 5984 ต้อง sudo):
sudo rm -rf ../deployment/tent-edge
```

ปิดศูนย์จริงต้อง wipe เครื่อง edge ทั้งเครื่อง (data-model §7) — ไม่ใช่แค่ `down`

---

## อ้างอิง

| เอกสาร                                                                                                                                                            | ใช้ดูอะไร                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`docs/changes/01-core/CR-064-edge-disaster-continuity.md`](../changes/01-core/CR-064-edge-disaster-continuity.md)                                                | OD-1 (edge ไม่มี FastAPI/Mongo), OD-2 (cutover ที่ DNS), OD-3 (login ใหม่) |
| [`docs/data/data-model.md` §1, §5, §6, §7](../data/data-model.md)                                                                                                 | topology, conflict, `_security` / VDU, การ wipe edge                       |
| [`docs/features/edge-disaster-continuity-idea.md` §7](../features/edge-disaster-continuity-idea.md)                                                               | gap checklist                                                              |
| [README.md](README.md)                                                                                                                                            | test T1–T11 (WAN ขาด, conflict, backlog, นาฬิกา)                           |
| [Replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html) · [Conflicts](https://docs.couchdb.org/en/stable/replication/conflicts.html) | หลักการ replication และ conflict                                           |
| [`[replicator]`](https://docs.couchdb.org/en/stable/config/replicator.html) · [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html)              | config ใน `couchdb-edge.ini`                                               |
