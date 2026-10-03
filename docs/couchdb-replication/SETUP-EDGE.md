# Setup Edge — ฝั่ง @ศูนย์ ที่ sync กับ central

คู่มือนี้ใช้กับ **เครื่อง edge เท่านั้น** (mini PC ที่ศูนย์) ทำตามลำดับ และตรวจให้ผ่านก่อนไปขั้นถัดไป
ฝั่ง central ต้อง **พร้อมก่อน** — ทำ [SETUP-CENTRAL.md](SETUP-CENTRAL.md) ให้ถึงขั้น 5 แล้วค่อยเริ่มที่นี่ ·
หลักการและเหตุผลของการออกแบบอยู่ที่ [README.md §2](README.md)

> **edge ทำอะไร:** เป็น CouchDB + แอป staff (SPA) ที่ศูนย์ ถือสำเนาข้อมูลของศูนย์ตัวเอง
> **เป็นฝ่ายเปิด connection ไปหา central** แล้วดึง/ส่งข้อมูลด้วย job ใน `_replicator` — ตอน WAN ขาด staff ยังใช้งานบน LAN ได้
> ไม่มี FastAPI / MongoDB / worker (public plane อยู่ที่ central เท่านั้น — CR-064 OD-1)

## 0. ต้องมีก่อนเริ่ม

| สิ่งที่ต้องมี | ได้จาก / ตรวจยังไง |
| --- | --- |
| Docker + Docker Compose, git, curl, python3 | `docker compose version` |
| internet (build frontend ครั้งแรก + pull image) | — |
| port `80` ว่างบนเครื่อง (หรือเลือก port อื่นใน `EDGE_HTTP_PORT`) | `ss -ltn \| grep ':80 '` |
| นาฬิกาตรง (NTP เปิด) | `timedatectl` — นาฬิกาเพี้ยนทำให้ TLS ล้มตอนต่อ `https://` |
| ค่าจาก central 4 กลุ่ม | ตาราง "ค่าที่ต้องส่งให้ฝั่ง edge" ท้าย [SETUP-CENTRAL.md](SETUP-CENTRAL.md) |

เลือกแบบเหมือนที่เลือกฝั่ง central: **Lab** (`http://<IP central>:5984`, ไม่มี cert) หรือ **จริง** (`https://<domain>/sync` — path บน domain ของแอป)

---

## ขั้น 1 — ตรวจว่า edge ต่อ central ได้ (ก่อนติดตั้งอะไร)

**ทำไม:** ถ้าต่อไม่ติดตั้งแต่ตรงนี้ job ทุกตัวจะ `crashing` และหาสาเหตุยากกว่ามาก

```bash
SYNC_URL=http://<IP ของ central>:5984        # จริง: https://<domain>/sync
curl -s $SYNC_URL/_up                        # {"seeds":{},"status":"ok"}
curl -s -u repl_sh001:'<รหัสผ่าน>' $SYNC_URL/shelter_sh001     # JSON ข้อมูล DB
```

ไม่ผ่าน → กลับไปแก้ฝั่ง central (ขั้น 4–5 ของ SETUP-CENTRAL.md) ยังไม่ต้องทำขั้นต่อไป

---

## ขั้น 2 — เอาโค้ดมาไว้บน edge

```bash
git clone -b feat/edge-couch-replication git@github.com:r202-coe-psu/tent.git
cd tent
```

ไฟล์ที่ edge ใช้ (อยู่ที่ root ของ repo):

| ไฟล์ | หน้าที่ |
| --- | --- |
| [`docker-compose.edge.yml`](../../docker-compose.edge.yml) | stack ของ edge: `couchdb`, `couchdb-init`, `edge-init`, `frontend`, `nginx` |
| [`nginx-edge/default.conf`](../../nginx-edge/default.conf) | nginx ของ edge: `/couch` + SPA |
| [`couchdb-edge-example.ini`](../../couchdb-edge-example.ini) | config CouchDB ของ edge (copy เป็น `couchdb-edge.ini`) |
| [`.env.edge.example`](../../.env.edge.example) | ตัวอย่าง env (copy เป็น `.env`) |
| [`scripts/edge-init.sh`](../../scripts/edge-init.sh) | สร้าง DB, `_security`, guard และ replication job |

---

## ขั้น 3 — สร้าง config CouchDB ของ edge

```bash
cp couchdb-edge-example.ini couchdb-edge.ini
sed -i "s/change-me-edge-secret/$(openssl rand -hex 16)/" couchdb-edge.ini
```

**ต้องสร้างก่อน `up`** — compose mount ไฟล์นี้เข้า CouchDB ถ้าไม่มีไฟล์ Docker จะสร้างเป็น *โฟลเดอร์* แล้ว CouchDB start ไม่ขึ้น

| ค่าในไฟล์ | ทำไม |
| --- | --- |
| `secret` ของ edge เอง | ใช้เซ็น cookie `AuthSession` — **ต้องต่างจาก central** ทำให้ cookie ข้ามฝั่งไม่ได้ staff ต้อง login ใหม่ตอน cutover (OD-3 — ทดสอบแล้วว่าเป็นแบบนั้น) · BFF ของ edge อ่านค่านี้ผ่าน admin API เพื่อ mint session |
| ไม่มี `[admins]` | admin ของ edge มาจาก `COUCHDB_USER` / `COUCHDB_PASSWORD` ใน `.env` คนละรหัสกับ central — **ห้ามใช้ `couchdb-session.ini` ของ central** เพราะฝัง hash ของ admin และ secret ของ central ไว้ |
| `[replicator] auth_plugins = couch_replicator_auth_noop` | **จำเป็นเมื่อ `SYNC_URL` มี path (`/sync`)**: replicator ปกติขอ session ที่ `<host>/_session` โดยตัด path ทิ้ง คำขอไปตกที่เว็บแอปแทน CouchDB แล้ว job ล้มด้วย `session_unexpected_result` ค่านี้ให้ส่ง Basic auth ตรง ๆ · ไม่มีผลกับ `http://<IP>:5984` |
| `[replicator] verify_ssl_certificates` | ไฟล์ตัวอย่างตั้งเป็น `false` (ใช้กับ Lab) · **แบบจริง (`https://`) ต้องเปลี่ยนเป็น `true`** แล้ว restart CouchDB ไม่งั้นไม่ตรวจ cert ของ central เลย · มีผลเฉพาะตอนต่อ `https://` |
| `ssl_trusted_certificates_file` | CA bundle ที่มีอยู่ใน image แล้ว |

ถ้าต่อ `https://` ด้วย self-signed cert ใน lab ให้คง `verify_ssl_certificates = false` — อย่าปิดบน edge จริง

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

| ตัวแปร | Lab (ตัวอย่าง) | จริง | ใช้ทำอะไร |
| --- | --- | --- | --- |
| `COUCHDB_USER` / `COUCHDB_PASSWORD` | `admin` / รหัสใหม่ | เหมือนกัน | admin ของ CouchDB ที่ edge — **คนละรหัสกับ central** |
| `SHELTER_CODE` | `SH001` | รหัสศูนย์นี้ | กำหนด DB `shelter_<code>`, role `shelter:<CODE>`, ชื่อ job |
| `SYNC_URL` | `http://172.30.91.220:5984` | `https://<domain>/sync` | ที่อยู่ central · แบบจริงเป็น path บน domain ของแอป ตอน cutover (LAN DNS ชี้ domain แอปมาที่ edge) job จะล้มจนกว่า cutback ดู "ตอน cutover / cutback" |
| `CENTRAL_REPL_USER` / `_PASSWORD` | `repl_sh001` / รหัสที่ `scripts/central-repl-user.sh` พิมพ์ให้ (SETUP-CENTRAL ขั้น 3) | เหมือนกัน | ใช้กับ `registry`, `catalog`, `shelter_*` · **ต้องเป็น `repl_<code>` ไม่ใช่บัญชีล็อกอินแอปอย่าง `sh1-admin`** (central ตอบ 403 และ role ไม่ตรงกับ `_security`) |
| `CENTRAL_USERS_REPL_USER` / `_PASSWORD` | `admin` / รหัส admin ของ central | เหมือนกัน | ใช้กับ job `_users` · **เว้นว่าง = ไม่สร้าง job นี้ staff จะ login ที่ edge ไม่ได้** |
| `PUBLIC_ORIGIN` | `http://<IP ของ edge>` | domain แอป (เหมือน central) | URL ที่ browser เปิด · ฝังตอน build frontend |
| `EDGE_LAN_IP` | `<IP ของ edge ใน LAN>` | เหมือนกัน | IP ที่ nginx ของ edge รับ — ไม่ใช้ `0.0.0.0` เพื่อไม่เปิดออก WAN |
| `EDGE_HTTP_PORT` | `80` | `80` | port ของ nginx |
| `EDGE_COUCHDB_PORT` | (ไม่ต้องใส่ = 5984) | เหมือนกัน | admin port ของ CouchDB — bind `127.0.0.1` เท่านั้น |
| `FRONTEND_IMAGE` | (ว่าง = build เอง) | ถ้ามี image แล้วใส่ชื่อ | ข้ามการ build frontend |

- ห้ามใช้ `"` หรือ `\` ในรหัสผ่านทุกตัว เพราะ `edge-init.sh` ประกอบ JSON เอง
- `.env` และ `couchdb-edge.ini` อยู่ใน `.gitignore` แล้ว — อย่า commit
- `PUBLIC_ORIGIN` ฝังตอน build ถ้าเปลี่ยนภายหลังต้อง build frontend ใหม่

---

## ขั้น 5 — เปิด stack

```bash
docker compose -f docker-compose.edge.yml up -d --build
```

build frontend ครั้งแรกใช้เวลาหลายนาที จากนั้นดูผลของ provisioning:

```bash
docker logs couch-edge-provision
```

ผลที่ควรเห็น (`ok` = สร้างใหม่ · `exists` = มีอยู่แล้ว รันซ้ำได้):

```
== edge-init: SH001 ← <SYNC_URL>
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

`FAILED` ขึ้นบรรทัดไหน → ดูตารางแก้ปัญหาท้ายไฟล์

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

| ตรวจ | คำสั่ง | ต้องได้ |
| --- | --- | --- |
| 2 sync central → edge | เขียน doc ที่ central: `curl -X PUT $C/shelter_sh001/evacuee:01EDGETEST0000000000001 -d '{"type":"evacuee"}'` แล้ว `curl -s -o /dev/null -w '%{http_code}\n' $E/shelter_sh001/evacuee:01EDGETEST0000000000001` | `200` ภายในไม่กี่วินาที |
| 3 sync edge → central | เขียนที่ edge ผ่าน nginx: `curl -X PUT -u <staff>:<pw> $EDGE/couch/shelter_sh001/evacuee:01EDGETEST0000000000002 -d '{"type":"evacuee"}'` แล้วอ่านจาก central | `200` ที่ central |
| 4 filtered `_users` | `curl -s -o /dev/null -w '%{http_code}\n' $E/_users/org.couchdb.user:<staff ของศูนย์อื่น>` | `404` (ไม่ถูกส่งมา) |
| 5 login ที่ edge | `curl -s -X POST $EDGE/couch/_session -H 'Content-Type: application/json' -d '{"name":"<staff>","password":"<pw>"}'` | `{"ok":true,...}` |
| 6 guard read-only | `curl -s -X PUT -u <staff>:<pw> $EDGE/couch/registry/x -d '{}'` | `forbidden` / `read-only replica on edge` |
| 7 public plane ปิด | `curl -s $EDGE/external/v1/x` และ `curl -s $EDGE/api/health` | `503` edge-only mode · `{"ok":true,"service":"frontend"}` |

`<staff>` = staff ของศูนย์นี้ที่มีอยู่แล้วที่ central (เช่น `staff01` ใน dev seed) ซึ่งถูก sync ลงมาตาม job `_users`

เกณฑ์ผ่าน: ข้อ 1–7 ผ่านครบ · **ยังไม่ได้ทดสอบ:** เปิดหน้าแอปผ่าน browser ที่ `$EDGE` (curl เท่านั้น)
และการต่อข้ามเครื่องจริงผ่าน LAN — ผลที่ผ่านมาทดสอบแบบจำลองบนเครื่องเดียวด้วยไฟล์ชุดนี้

📖 [`/_scheduler/docs`](https://docs.couchdb.org/en/stable/api/server/common.html#scheduler-docs) ·
[`/_session`](https://docs.couchdb.org/en/stable/api/server/authn.html#cookie-authentication)

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

| service | ทำไม |
| --- | --- |
| `couchdb` (`couch-edge`) | ตัวเก็บข้อมูลที่ศูนย์ + ที่อยู่ของ replication job · port bind `127.0.0.1` เท่านั้น staff เข้าผ่าน nginx |
| `couchdb-init` | สร้าง `_users`, `_replicator` (single node) — เหมือน production |
| `edge-init` | **เพิ่มใหม่** รัน `scripts/edge-init.sh` (ด้านล่าง) |
| `frontend` | แอป staff ให้ใช้บน LAN ตอน WAN ขาด · ไม่ตั้ง `FASTAPI_INTERNAL_URL`, `EXTERNAL_API_SECRET`, `COUCHDB_PUBLIC_WRITER_URL`, import worker token, OAuth — route ของ public plane จะ fail ตามโหมด degraded แต่แอปยัง start ได้ |
| `nginx` | `/couch` + SPA ให้ browser ในศูนย์ · ใช้ `nginx-edge/` แทน `nginx/` เพราะ `nginx/nginx.conf` proxy `/external/` ไป `fastapi:9000` ซึ่งไม่มีที่ edge → nginx **start ไม่ขึ้นทั้งตัว** (`host not found in upstream`) · edge ตอบ `/external/` ด้วย 503 แทน |
| `edge-watchdog` | **เพิ่มใหม่** ตรวจ job ทุก 60 วินาที ถ้า job ค้างอยู่ใน backoff ทั้งที่ central กลับมาแล้ว จะเตะให้เอง (หัวข้อ "Watchdog" ด้านล่าง) |
| ~~mongodb, worker, fastapi, import-worker~~ | ตัดออก — public plane และ import เป็นงานของ central |

### `edge-init.sh` ทำ 3 อย่าง

1. **สร้าง DB + `_security`** (`registry`, `catalog`, `shelter_<code>`: `members.roles=["shelter:<CODE>"]`, `admins.roles=["system_admin"]`)
   — `_security` **ไม่ถูก replicate** ถ้าปล่อยให้ job สร้าง DB เอง (`create_target`) DB จะไม่มี `_security` และ staff ทุกศูนย์เข้าได้
2. **`_design/edge_readonly` บน `registry` / `catalog`** — `validate_doc_update` ที่ยอมให้เขียนเฉพาะ `_admin`
   เพราะ 2 DB นี้เป็นทางเดียว (central → edge) ถ้า staff เขียนที่ edge ได้ ข้อมูลจะไม่กลับ central และไม่มีใครรู้ · ยอม `_admin` เพราะ replicator ฝั่ง edge เขียนด้วย admin
3. **replication job 5 ตัวใน `_replicator`** (`continuous: true` — อยู่รอดหลัง restart)

| job | ทิศทาง | credential ฝั่ง central | ใช้ทำอะไร |
| --- | --- | --- | --- |
| `registry_pull` | central → edge | `CENTRAL_REPL_USER` | master data ให้อ่านตอน WAN ขาด |
| `catalog_pull` | central → edge | `CENTRAL_REPL_USER` | catalog |
| `sh001_pull` | central → edge | `CENTRAL_REPL_USER` | ข้อมูลศูนย์ที่เขียนที่ central |
| `sh001_push` | edge → central | `CENTRAL_REPL_USER` | ข้อมูลที่เขียนที่ edge ตอน WAN ขาด (backlog) |
| `users_sh001_pull` | central → edge | `CENTRAL_USERS_REPL_USER` | ให้ staff ของศูนย์นี้ login ที่ edge ได้ · `selector` role `shelter:<CODE>` กรองที่ central จึงไม่ส่ง user ศูนย์อื่นมา |

- URL ฝั่ง edge ใน job คือ `http://127.0.0.1:5984` เพราะ job รัน **ภายใน container CouchDB** เอง
- script ข้าม doc ที่มีอยู่แล้ว — ถ้าจะเปลี่ยน credential ของ job ต้องลบ doc ใน `_replicator` ก่อน (ดูด้านล่าง)
- รหัสผ่านใน doc ของ `_replicator` เป็น **plaintext** (admin อ่านกลับก็เห็น) ถือเป็นความลับของเครื่อง edge

📖 [Replicator database](https://docs.couchdb.org/en/stable/replication/replicator.html) ·
[Selector objects](https://docs.couchdb.org/en/stable/replication/replicator.html#selectorobj) ·
[Validate document update](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions)

---

## งานประจำ

```bash
curl -s $E/_scheduler/jobs            # job + history (error ล่าสุด)
curl -s $E/_active_tasks              # docs_read / docs_written / changes_pending
docker logs couch-edge 2>&1 | grep -i replicat
```

**"เตะ" job** — เริ่มทันทีโดยข้าม backoff หรือเปลี่ยน credential: ลบ doc แล้วรัน `edge-init` ใหม่
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

| เงื่อนไข | ทำไม |
| --- | --- |
| state `crashing` และ `error_count` ≥ `WATCHDOG_MIN_ERRORS` (3) | ไม่ยุ่งกับการล้มชั่วคราวครั้งสองครั้ง |
| error **ไม่ใช่** central ปฏิเสธรหัสผ่าน (`session_request_unauthorized` 401 / `session_request_forbidden` 403) | เตะไม่ช่วยอะไร และทุกครั้งที่ลองใหม่นับเข้าระบบล็อกเอาต์ของ CouchDB (รหัสผิดเกิน 5 ครั้ง → 403 นาน 5 นาที) ต้องแก้ `.env` เอง |
| `GET <SYNC_URL>/_up` ตอบเป็น JSON ของ CouchDB (`"status":"ok"`) | ถ้า central ยังไม่กลับ เตะไปก็ล้มซ้ำ · ตรวจเนื้อหา ไม่ใช่แค่ HTTP 200 เพราะถ้า LAN DNS ยังชี้ domain แอปมาที่ edge คำขอจะตกไปที่เว็บแอปของ edge ซึ่งตอบ 200 (HTML) |
| job นั้นไม่ได้ถูกเตะภายใน `WATCHDOG_COOLDOWN` (300 วินาที) | กันเตะวน |

หมายเหตุ: CouchDB ห่อ error ของการต่อ central ไม่ได้ (`nxdomain`, `conn_failed`, `connection closed`) ไว้ใน `replication_auth_error` ด้วย
(`session_request_failed`) สคริปต์จึงแยกตามสาเหตุจริงด้านบน ไม่ใช่ดูแค่ชื่อ `replication_auth_error`

```bash
docker logs -f couch-edge-watchdog          # ดูการทำงาน
```

ตัวอย่าง log: `sh001_pull stuck (errors=2) while central is up — deleted, will be recreated` →
`edge-init re-run ok: 4 job(s) recreated` · หรือ `registry_pull crashing: central REJECTED the credentials ... not restarting`

| ตัวแปรใน `.env` | default | ใช้ทำอะไร |
| --- | --- | --- |
| `WATCHDOG_INTERVAL` | 60 | ตรวจทุกกี่วินาที |
| `WATCHDOG_MIN_ERRORS` | 3 | ล้มติดกันกี่ครั้งจึงถือว่าค้าง |
| `WATCHDOG_COOLDOWN` | 300 | เว้นอย่างน้อยกี่วินาทีก่อนเตะ job เดิมอีก |
| `WATCHDOG_DRY_RUN` | 0 | `1` = บันทึก log อย่างเดียว ไม่เตะ |

**ทดสอบแล้ว** (central จำลองเป็น CouchDB ชั่วคราว + edge stack จริง ตั้ง interval 5 วินาที):

| สถานการณ์ | ผล |
| --- | --- |
| ปกติ | เงียบ ไม่ทำอะไร |
| central ล่ม | job `crashing` → watchdog ขึ้นว่า "central ... is not answering — leaving them" ไม่แตะ |
| central กลับมา | เตะ 4 job ภายใน **1 วินาที** หลัง `/_up` ตอบ · doc ที่เขียนที่ central ระหว่างนั้นมาถึง edge ภายใน **5 วินาที** โดยไม่มีใครแตะมือ |
| หมุนรหัสที่ central แต่ `.env` ของ edge ยังเป็นรหัสเก่า | job ล้มด้วย `session_request_unauthorized` → watchdog ขึ้น "central REJECTED the credentials" และ **ไม่เตะ** (0 ครั้ง) |

**ยังไม่ได้ทดสอบ:** ช่วงขาดนานกว่าหลายนาทีแบบควบคุมเวลา (1 นาที / 10 นาที / 1 ชั่วโมง ตาม README T4), และบน mini PC จริง
(ตอนนี้ mini PC ใช้ stack เดิมที่ยังไม่มี `edge-watchdog` — `git pull` แล้ว `docker compose -f docker-compose.edge.yml up -d` จะเพิ่มให้)

---

## แก้ปัญหา (ฝั่ง edge)

| อาการ | สาเหตุ | แก้ |
| --- | --- | --- |
| `crashing` + `unauthorized` (401) | credential ผิด / user ไม่ได้เป็น member ของ DB ที่ central · **หมุนรหัสที่ central (`--rotate`) แล้วไม่ได้อัปเดต `.env` ของ edge** | `.env` ขั้น 4 · SETUP-CENTRAL ขั้น 3 |
| `crashing` + `session_request_forbidden` (403) ทั้งที่รหัสน่าจะถูก | **ถูกล็อกเอาต์**: CouchDB 3.5 นับรหัสผิดต่อ (user, IP) ถ้าเกิน 5 ครั้งจะตอบ 403 ต่อไปแม้รหัสถูกแล้ว (`chttpd_auth_lockout` default `enforce`) · job ที่ retry ด้วยรหัสผิดเองก็ทำให้เกิดได้ เห็นใน log ของ central ว่า `Authentication rejected for locked-out user` | แก้รหัสให้ถูกก่อน แล้วรอ **5 นาที** นับจากความผิดพลาดครั้งแรก (`max_lifetime`) หรือ restart CouchDB ของ central เพื่อล้างตาราง · อย่าลบ/สร้าง job ซ้ำ ๆ ระหว่างรอ เพราะ job ที่รหัสยังผิดจะทำให้ล็อกต่อ |
| `crashing` + `nxdomain` / `econnrefused` / timeout | `SYNC_URL` ผิด, central ปิด, firewall | ขั้น 1 |
| `crashing` + error certificate | cert ยังไม่ออก / self-signed / นาฬิกา edge เพี้ยน | ขั้น 3 (`verify_ssl_certificates`) · NTP |
| ได้ HTML แทน JSON | `location /sync/` ยังไม่มีบน central, `proxy_pass` ไม่มี `/` ท้าย หรือ LAN DNS ยังชี้ domain แอปมาที่ edge (cutover ยังไม่ cutback) | SETUP-CENTRAL ขั้น 4B · ตรวจว่า `<domain>` resolve ได้ IP ของ central |
| `413` ใน history ของ job | `client_max_body_size` ที่ central เล็กไป | SETUP-CENTRAL ขั้น 4B ข้อ (2) หรือลด `worker_batch_size` |
| job ฝั่งดึงเป็น `crashing` `error_count` สูงอยู่นาน ทั้งที่ central กลับมาแล้ว (central → edge ไม่ sync, edge → central ยังได้) | CouchDB เพิ่มเวลารอเป็นเท่าตัวทุกครั้งที่ล้ม | `edge-watchdog` เตะให้เอง · ทำเองได้ด้วย `kick` ด้านบน · ดู "Watchdog" |
| `crashing` + `session_unexpected_result` ... `/_session` | ไม่ได้ตั้ง `auth_plugins = couch_replicator_auth_noop` ใน `couchdb-edge.ini` ทั้งที่ `SYNC_URL` มี path | ขั้น 3 แล้ว restart CouchDB ของ edge · เตะ job |
| `crashing` หลัง WAN กลับ ทั้งที่ central ปกติ | LAN DNS ยังชี้ domain แอปมาที่ edge (ยังไม่ cutback) job ยิงเข้า edge ตัวเอง ([README T9](README.md)) | cutback คืน DNS แล้ว `edge-watchdog` เตะให้เอง |
| staff login ที่ edge ไม่ได้ | ไม่ได้ตั้ง `CENTRAL_USERS_REPL_*` หรือไม่ใช่ admin, หรือ CouchDB คนละ version | ขั้น 4 · ใช้ `couchdb:3.5` ทั้งสองฝั่ง |
| `edge-init` ขึ้น `FAILED ... (HTTP 4xx/5xx)` | ดูข้อความหลัง `FAILED` — ส่วนใหญ่ central ต่อไม่ได้ หรือ JSON เพี้ยนเพราะรหัสผ่านมี `"` / `\` | แก้ `.env` แล้วรัน `edge-init` ซ้ำ (รันซ้ำได้) |
| list job ว่างหลัง `up` | replicator ยังไม่หยิบ job | รอ ~30 วินาที |
| CouchDB ไม่ start / mount error | ไม่มีไฟล์ `couchdb-edge.ini` (Docker สร้างเป็นโฟลเดอร์) | ขั้น 3 แล้ว `docker compose -f docker-compose.edge.yml up -d --force-recreate` |
| nginx edge ไม่ start: `host not found in upstream "fastapi"` | mount `nginx/` ของ central แทน `nginx-edge/` | ใช้ `docker-compose.edge.yml` ตัวจริง |
| `doc_write_failures` เพิ่มใน `_active_tasks` | VDU ฝั่ง target ปฏิเสธ (`edge_readonly` กัน user ที่ไม่ใช่ admin) | ตรวจว่า `COUCHDB_USER` เป็น admin |

📖 [Replication states](https://docs.couchdb.org/en/stable/replication/replicator.html#replication-states) ·
[`/_scheduler/*`, `/_active_tasks`](https://docs.couchdb.org/en/stable/api/server/common.html)

---

## ตอน cutover / cutback (แบบ path `/sync`)

`SYNC_URL=https://<domain>/sync` ใช้ชื่อเดียวกับแอป จึงมีผลตามนี้:

| ช่วง | LAN DNS ของ `<domain>` | job ของ edge |
| --- | --- | --- |
| ปกติ | central | `running` |
| WAN ขาด ก่อน cutover | central (แต่ต่อไม่ได้) | `crashing` (เข้า central ไม่ได้) — ปกติ |
| cutover | **edge** | `crashing` — ยิงเข้า edge ตัวเอง (nginx edge ฟังแค่ :80 จึง TLS ล้ม) ไม่มีข้อมูลเสียหาย |
| WAN กลับแต่ **ยังไม่ cutback** | **edge** | ยัง `crashing` — **sync ยังไม่กลับ** |
| cutback (คืน DNS) | central | watchdog เตะ job ภายใน `WATCHDOG_INTERVAL` แล้ว sync ต่อจาก checkpoint เดิม |

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

| เอกสาร | ใช้ดูอะไร |
| --- | --- |
| [`docs/changes/CR-064-edge-disaster-continuity.md`](../changes/CR-064-edge-disaster-continuity.md) | OD-1 (edge ไม่มี FastAPI/Mongo), OD-2 (cutover ที่ DNS), OD-3 (login ใหม่) |
| [`docs/data/data-model.md` §1, §5, §6, §7](../data/data-model.md) | topology, conflict, `_security` / VDU, การ wipe edge |
| [`docs/features/edge-disaster-continuity-idea.md` §7](../features/edge-disaster-continuity-idea.md) | gap checklist |
| [README.md](README.md) | test T1–T11 (WAN ขาด, conflict, backlog, นาฬิกา) |
| [Replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html) · [Conflicts](https://docs.couchdb.org/en/stable/replication/conflicts.html) | หลักการ replication และ conflict |
| [`[replicator]`](https://docs.couchdb.org/en/stable/config/replicator.html) · [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html) | config ใน `couchdb-edge.ini` |
