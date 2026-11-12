# Setup Central — ฝั่งที่ edge มา sync ด้วย

คู่มือนี้ใช้กับ **เครื่อง central เท่านั้น** (เครื่องที่รัน CouchDB หลักของระบบ) ทำตามลำดับ และตรวจให้ผ่านก่อนไปขั้นถัดไป
ฝั่ง edge อยู่ที่ [SETUP-EDGE.md](SETUP-EDGE.md) (ขั้นติดตั้งบนเครื่อง edge) · หลักการและเหตุผลของการออกแบบอยู่ที่ [README.md §2](README.md)

> **หลักการข้อเดียวที่ต้องจำ:** edge เป็นฝ่ายเปิด connection หา central เสมอ (edge อยู่หลัง NAT ของศูนย์)
> job replication ของ edge อยู่ที่ edge ทั้งหมด — หน้าที่ของ central มี 4 อย่าง:
> **(1) มีข้อมูลศูนย์ให้ดึง (2) สร้าง replication user ของศูนย์นั้น (ไม่ใช่ admin) (3) คัดลอก user ของศูนย์ไปไว้ใน DB `edge_users_<code>` ให้ edge ดึง (service `edge-users-copy`) (4) เปิดทางให้ edge เข้ามาถึง CouchDB**
>
> **รหัส central admin อยู่ที่ central เท่านั้น ไม่ส่งให้ edge** (ตาม [CR-247](../changes/01-core/CR-247-edge-per-shelter-repl-user.md) ที่แทน OD-6 เดิม)
> script `scripts/central-repl-user.sh <CODE>` สร้างบัญชี + DB `edge_users_<code>` (ข้อ 2 และที่เก็บของข้อ 3) · ส่วน**คัดลอก user** เข้า DB นั้นทำโดย service `edge-users-copy` ที่รันค้างบน central (ขั้น 3.4) — ไม่ใช่ job ใน `_replicator`

## 0. เลือกแบบที่จะทำ

|                         | **Lab** (ทดลอง ไม่มี cert)                                         | **จริง** (staging / production)                                             |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| central คือ             | laptop / mini PC ที่รัน dev stack (`docker-compose.yml`)           | server ที่ deploy ด้วย `docker-compose.{staging,production}[.no-nginx].yml` |
| edge เข้าถึงด้วย        | `http://<IP ของ central>:5984` ตรง ๆ                               | `https://<domain>/sync` ผ่าน nginx เดิมของแอป                               |
| ต้องมี DNS / cert เพิ่ม | ไม่ต้อง                                                            | ไม่ต้อง (ใช้ domain และ cert ของแอปที่มีอยู่)                               |
| ต้องทำขั้น              | 1 → 2 → 3 → 4A → 5                                                 | 1 → 2 → 3 → 4B → 5                                                          |
| ความเสี่ยง              | รหัสผ่านและข้อมูลวิ่งแบบไม่เข้ารหัส ใช้ได้เฉพาะ LAN ที่เชื่อถือได้ | —                                                                           |

ค่าตัวอย่างในคู่มือ: ศูนย์ `SH001` (DB `shelter_sh001`) · เปลี่ยนเป็นศูนย์ที่ใช้จริงได้

---

## ขั้น 1 — เปิด CouchDB ของ central

**Lab** (จาก root ของ repo):

```bash
docker compose up -d couchdb couchdb-init
```

**จริง:** deploy ตามปกติของโปรเจกต์ (Jenkins) เช่น `docker compose -f docker-compose.staging.no-nginx.yml up -d --build`
ต้องเตรียม `.env`, `couchdb-session.ini` (copy จาก `couchdb-session-example.ini` แล้วตั้ง `secret`) และโฟลเดอร์ data ก่อน — ดู [README root](../../README.md) "Staging / production deploy"

**ตรวจ:**

```bash
export C=http://admin:<COUCHDB_PASSWORD ใน .env>@localhost:5984
curl -s $C/_up                      # {"seeds":{},"status":"ok"}
```

> `COUCHDB_PASSWORD` อยู่ใน `.env` ของ central — ถ้ายังเป็น `password` (ค่า default) ให้เปลี่ยนก่อนเปิดให้เครื่องอื่นเข้า (ขั้น 4)

---

## ขั้น 2 — ข้อมูลศูนย์และ staff ที่จะ sync

**ทำไม:** edge sync เฉพาะศูนย์ของตัวเอง ต้องมี DB `shelter_sh001` และ user ที่มี role `shelter:SH001` อยู่ที่ central ก่อน
(user เหล่านี้จะถูกคัดลอกไป `edge_users_sh001` แล้ว edge ดึงลง `_users` ของตัวเอง เพื่อให้ staff login ที่ edge ได้ตอน WAN ขาด — ขั้น 3)

**ตรวจ:**

```bash
curl -s $C/_all_dbs
# ต้องมี: registry, catalog, shelter_sh001

curl -s "$C/_users/_find" -H 'Content-Type: application/json' \
  -d '{"selector":{"roles":{"$elemMatch":{"$eq":"shelter:SH001"}}},"fields":["name","roles"],"limit":5}'
# ต้องมี staff อย่างน้อย 1 คน (ใช้ทดสอบ login ที่ edge)
```

ถ้ายังไม่มี: seed ข้อมูลทดลอง (`cd frontend && pnpm seed` หรือ `docker compose -f docker-compose.yml -f docker-compose.seed.yml run --rm seed`)
หรือเปิดศูนย์ผ่านแอป — ข้อมูลที่ seed ไว้แล้วบน dev stack ของ repo นี้มี SH001 ถึง SH004 พร้อม staff

---

## ขั้น 3 — สร้าง replication user ของศูนย์ (`central-repl-user.sh`)

edge **ไม่ใช้ central admin** แต่ใช้บัญชีที่สร้างให้เฉพาะศูนย์นั้น ([CR-247](../changes/01-core/CR-247-edge-per-shelter-repl-user.md) แทน OD-6 เดิมใน
[edge-disaster-continuity-idea.md](../features/edge-disaster-continuity-idea.md) §6) ทำที่ central ครั้งเดียวต่อศูนย์ที่มี edge

### 3.1 สร้าง (provision)

รันที่ central จาก root ของ repo — สคริปต์ใช้ admin จาก `COUCHDB_USER` / `COUCHDB_PASSWORD` (env หรือ `.env` ของ central) ในเครื่องนี้เท่านั้น:

```bash
scripts/central-repl-user.sh SH001
```

สคริปต์สร้างให้ครบในครั้งเดียว:

| สร้าง                              | รายละเอียด                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user `repl_sh001_<8 ตัว hex สุ่ม>` | role `repl:SH001` เท่านั้น · รหัสผ่านสุ่ม · **ชื่อเดายาก** (กันคนนอกลองล็อกเอาต์ทีละศูนย์) · ไม่มี `edge_shelters`                                                                                      |
| สิทธิ์อ่าน/เขียน DB                | เพิ่ม role `repl:SH001` ใน `_security` ของ `registry`, `catalog`, `shelter_sh001` (ไม่เพิ่มใน `shelter_<ศูนย์อื่น>`) · registry/catalog ที่ edge อ่านได้อย่างเดียว (central ปฏิเสธการเขียนของ `repl:*`) |
| DB `edge_users_sh001`              | member มีแค่ `repl:SH001` · เขียนได้เฉพาะ `_admin` (`_design/readonly`) · เก็บสำเนา user ของศูนย์นี้ (มี password hash)                                                                                 |
| (ไม่สร้าง job ใน `_replicator`)    | การคัดลอก user ไป `edge_users_sh001` ทำโดย service `edge-users-copy` ของ central (ขั้น 3.4) — เมื่อเห็น DB ใหม่จะ backfill user เดิมของศูนย์ให้เองภายใน 1 นาที                                          |

**username + password แสดงครั้งเดียว** ตอนสร้าง (หรือ `--rotate`) — จดทันที แล้วใส่ใน `.env` ของ edge เป็น `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD`
([SETUP-EDGE ขั้น 4](SETUP-EDGE.md)) · รันซ้ำโดยไม่ใส่ `--rotate` จะคงรหัสเดิมและไม่แสดงรหัสอีก · หนึ่งศูนย์มีบัญชีได้ **1 บัญชี**

> ถ้าสคริปต์แจ้งว่าเจอบัญชีแบบเก่า `repl_<code>` (ไม่มี suffix) ให้รัน `--remove` ก่อนแล้วสร้างใหม่
> บัญชี `repl_*` **ไม่โผล่ในหน้าจัดการผู้ใช้ของแอป** และแก้ผ่านแอปไม่ได้ — จัดการด้วยสคริปต์นี้เท่านั้น

### 3.2 ตัวเลือก

| คำสั่ง                                        | ทำอะไร                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/central-repl-user.sh SH001`          | สร้าง (ถ้ามีแล้วคงรหัสเดิม)                                                                                                                                                                                                                                                                                                           |
| `scripts/central-repl-user.sh SH001 --rotate` | ตั้งรหัสใหม่ แสดงครั้งเดียว · ต้องแก้ `.env` ของ edge ศูนย์นั้นแล้วรัน `edge-init` ใหม่ (**ศูนย์อื่นไม่กระทบ**)                                                                                                                                                                                                                       |
| `scripts/central-repl-user.sh SH001 --remove` | ลบบัญชี · ถอด role ออกจาก `_security` ของ registry/catalog/`shelter_sh001` · **ลบ DB `edge_users_sh001` ทั้ง DB** (ห้ามแค่ถอด role — `members` ว่างแล้ว DB เปิดสาธารณะ) · รันซ้ำได้ ไม่แตะศูนย์อื่น                                                                                                                                   |
| `scripts/central-repl-user.sh SH001 --status` | อ่านสถานะของ `edge-users-copy` จาก `_users/_local/edge_users_copy` เทียบกับ `update_seq` ของ `_users` · สถานะ backfill ของศูนย์ · **"edge ดึงข้อมูลล่าสุดเมื่อ"** (จาก checkpoint ของ edge ใน `edge_users_sh001`; ไม่มี = "edge ยังไม่เคยต่อเข้ามา") · **exit ≠ 0 เมื่อมี `last_error` หรือ service ตามหลัง `_users` นานเกิน 5 นาที** |
| `--url <URL>`                                 | URL ที่สคริปต์ใช้ต่อ CouchDB ของ central (default `$COUCHDB_URL` หรือ `http://localhost:5984`)                                                                                                                                                                                                                                        |

ทุกครั้งที่รัน (ทุกคำสั่ง) สคริปต์ตรวจ `_security` ของ DB `edge_users_*` **ทุกตัว** บน central ถ้า `members` ว่าง (= เปิดสาธารณะ) หรือมีอะไรนอกจาก `repl:<CODE>` ของศูนย์นั้น
จะ **หยุดพร้อมแจ้งชื่อ DB** — เพราะ DB นี้มี password hash ของ staff ตั้งพลาดแล้วรั่วหนักกว่าเดิม · เจอแล้วต้องแก้ `_security` ก่อนทำอะไรต่อ

### 3.3 สิ่งที่ต้องรู้

| เรื่อง                         | ผล                                                                                                                                                                                                         | ต้องทำ                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| เครื่อง edge หลุด / ถูกขโมย    | ผู้ถือเครื่องได้ **ข้อมูล `shelter_<code>` ของศูนย์นั้น + password hash ของ staff ศูนย์นั้น** และเขียน `shelter_<code>` ของศูนย์นั้นได้จนกว่าจะ `--remove` · **ไม่ได้ central admin** และไม่กระทบศูนย์อื่น | ทำตาม "เครื่อง edge หาย" ด้านล่าง                                                                   |
| `SHELTER_CODE` ผิด             | `edge-init` ตรวจ `_session` ด้วย `EDGE_REPL_*` ต้องมี `repl:<SHELTER_CODE>` และไม่เป็น `_admin` — ไม่ผ่านจะ `FAILED` (ใส่ central admin มาก็ไม่ผ่าน) · central ปฏิเสธการอ่าน DB ศูนย์อื่น (401/403)        | ตรวจ `SHELTER_CODE` ก่อน `up` (SETUP-EDGE ขั้น 4)                                                   |
| `_design/*`                    | `repl:*` เขียน design doc ของ `shelter_<code>` ไม่ได้ (CouchDB ให้เฉพาะ db admin) · job `<code>_push` ยังกรอง `_design/*` ออกอยู่ (กันอุบัติเหตุ)                                                          | อย่าสร้าง design doc ใน `shelter_<code>` ที่ edge                                                   |
| lockout (รหัสผิด 5 ครั้ง)      | CouchDB นับต่อ (user, IP) — **แต่ละศูนย์มีชื่อของตัวเอง** จึงหยุดแค่ศูนย์ที่รหัสผิด ศูนย์อื่นยัง sync                                                                                                      | แก้ `.env` ของ edge ศูนย์นั้นให้ตรงรหัสล่าสุด แล้วรอ 5 นาที                                         |
| หมุนรหัส central admin         | **edge ไม่ต้องแก้อะไร** (ไม่ถือ admin) · แต่ `edge-users-copy` และ sync-worker ใช้ admin เดิมอยู่ → ได้ 401 ถ้าไม่อัปเดต                                                                                   | อัปเดต `COUCHDB_PASSWORD` ของ**ทุก service** ที่ใช้รหัสนี้ แล้ว restart (ดู "หลัง deploy" ด้านล่าง) |
| `edge-users-copy` หยุด / error | user ที่ถูกถอดสิทธิ์ / soft delete ยัง login ที่ edge ได้ เพราะ edge ไม่ได้รับ revision ใหม่                                                                                                               | ตรวจ `--status` ทุกวัน (ด้านล่าง)                                                                   |
| hard delete ใน `_users`        | tombstone ไม่ถูกคัดลอกไป `edge_users_<code>` — บัญชีที่ hard delete ยังอยู่ที่ edge (นอกขอบเขต CR-247 · ติดตามที่ #1331)                                                                                   | ใช้ soft delete (แอปทำแบบนี้อยู่แล้ว)                                                               |

### 3.4 service `edge-users-copy` (คัดลอก user ไป `edge_users_<code>`)

service แยกบน central (ใน compose ของ central — build จาก `worker/Dockerfile` ตัวเดียวกับ sync-worker แต่เป็น container ของตัวเอง) ใช้ admin จาก `COUCHDB_USER` / `COUCHDB_PASSWORD` · **ต่อ CouchDB อย่างเดียว ไม่ต่อ MongoDB** จึงไม่ติดไปกับ sync-worker (MongoDB ล่มก็ไม่กระทบการถอดสิทธิ์ที่ edge)

| เรื่อง     | พฤติกรรม                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| การทำงาน   | อ่าน `_changes` ของ `_users` feed เดียว ข้าม `_design/*` · ปลายทาง = ศูนย์ใน `edge_shelters` ∪ ศูนย์จาก role `shelter:<CODE>` · เขียนเฉพาะศูนย์ที่มี DB `edge_users_<code>` อยู่ (ด้วย `new_edits: false`)                     |
| checkpoint | `_users/_local/edge_users_copy` บน central (`last_seq`, `last_error`, `updated_at`) · restart แล้วอ่านต่อจากจุดเดิม · doc `_local` ไม่ถูก replicate                                                                            |
| backfill   | เช็กรายชื่อ `edge_users_*` ทุก 30 วินาที · DB ที่ยังไม่มี `_local/backfill_done` = ศูนย์ใหม่ → คัดลอก user เดิมทีละหน้า แล้วเขียน `_local/backfill_done` ใน DB นั้น · `--remove` แล้วสร้างใหม่ DB ใหม่จึง backfill ใหม่เองเสมอ |
| เปิด / ปิด | `docker compose up -d edge-users-copy` · logs: `docker compose logs -f edge-users-copy` · คำสั่งตรงของโค้ด: `uv run --project worker edge-users-copy`                                                                          |

> **Migration prerequisite (ก่อนเปิด service ครั้งแรก):** ต้อง backfill `edge_shelters` ของ CR-171 ที่ central ให้เสร็จก่อน
> (SETUP-EDGE "อัปเกรดเป็น CR-171" ข้อ 2 — `pnpm backfill:edge-shelters --write` รันซ้ำแล้วต้องไม่มี doc เปลี่ยน)
> user ที่ไม่มี `edge_shelters` แล้วถูกถอด role จะไม่ถูกส่งไป edge

**ตรวจหลังสร้าง** (แทน `<REPL_USER>` / `<REPL_PW>` ด้วยค่าที่สคริปต์แสดง · `$C` คือ admin ของ central จากขั้น 1):

```bash
scripts/central-repl-user.sh SH001 --status                                    # exit 0 (service ตามทัน _users · backfill เสร็จ)

curl -s -o /dev/null -w '%{http_code}\n' -u <REPL_USER>:<REPL_PW> http://localhost:5984/edge_users_sh001   # 200
curl -s -o /dev/null -w '%{http_code}\n' -u <REPL_USER>:<REPL_PW> http://localhost:5984/shelter_sh002      # 401/403 (ศูนย์อื่น)
curl -s -o /dev/null -w '%{http_code}\n' -u <REPL_USER>:<REPL_PW> http://localhost:5984/_users/_changes    # 401/403
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -u <REPL_USER>:<REPL_PW> http://localhost:5984/registry/x -d '{}'   # 403 (registry เขียนไม่ได้)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5984/edge_users_sh001                            # 401 (ไม่ login)
curl -s $C/edge_users_sh001 | python3 -c 'import sys,json;print(json.load(sys.stdin)["doc_count"])'          # > 0 (มี staff ของศูนย์ถูกคัดลอกแล้ว — ภายใน 1 นาทีหลังสร้าง)
```

📖 [`_users` และการ auth](https://docs.couchdb.org/en/stable/intro/security.html) ·
[`/{db}/_security`](https://docs.couchdb.org/en/stable/api/database/security.html) ·
[Replicator database](https://docs.couchdb.org/en/stable/replication/replicator.html)

---

## ขั้น 4A — Lab: เปิดให้ edge เข้า CouchDB ตรง ๆ

dev stack เปิด port `5984` ให้เครื่องอื่นในเครือข่ายเข้าได้อยู่แล้ว (bind `0.0.0.0`) ไม่ต้องแก้ compose

**1) หา IP ของ central** (ใช้ IP ของ wifi / lan ไม่ใช่ `172.17–172.20.x.x` ซึ่งเป็นวงภายในของ Docker):

```bash
ip -4 -o addr show scope global | awk '{print $2, $4}'
```

**2) เปิด firewall** ถ้ามี (เฉพาะ IP ของ edge):

```bash
sudo ufw status
sudo ufw allow from <IP ของ edge> to any port 5984 proto tcp
```

**3) ค่าที่ edge จะใช้:** `SYNC_URL=http://<IP ของ central>:5984` — ไม่มี path, ไม่มี hostname พิเศษ

> ⚠️ CouchDB ของ dev stack เปิดให้ทั้ง LAN เข้าด้วย admin ที่มีรหัสผ่านใน `.env` และรหัสผ่านวิ่งแบบ `http://`
> ใช้ได้เฉพาะ lab ปิด ห้ามข้ามอินเทอร์เน็ต · IP จาก DHCP อาจเปลี่ยน ถ้า edge sync ไม่ได้หลังเปิดเครื่องใหม่ให้เช็ก IP ก่อน

## ขั้น 4B — จริง: เปิดทางผ่าน `https://<domain>/sync` (nginx เดิมของแอป)

edge ยิงหา central ที่ path `/sync` บน domain เดียวกับแอป จึง**ไม่ต้องขอ DNS หรือ cert เพิ่ม** — แค่เพิ่ม `location` เดียวใน server block ของแอป

**ข้อควรรู้ตอน cutover (ข้อเสียของการใช้ domain เดียวกับแอป):** ตอน WAN ขาด ผู้ดูแลศูนย์สลับ LAN DNS ให้ domain แอปชี้ไป edge (CR-064 OD-2)
ช่วงนั้น job ของ edge ยิง `https://<domain>/sync` เข้า edge ตัวเอง (nginx ของ edge ฟังแค่ :80 จึง TLS ล้ม) job จึง `crashing` โดยไม่มีข้อมูลเสียหาย
ตอน WAN กลับ **sync จะกลับมาหลังผู้ดูแล cutback (คืน DNS)** เท่านั้น แล้ว `edge-watchdog` เตะ job ให้ภายใน `WATCHDOG_INTERVAL` ([SETUP-EDGE.md](SETUP-EDGE.md) หัวข้อ Watchdog)
ดังนั้น runbook ของศูนย์ต้องมีขั้น cutback ที่ทำทันทีที่ WAN กลับ · แยก rate limit / firewall เฉพาะ sync ทำยากกว่าแบบ subdomain เพราะอยู่ใน server block เดียวกับแอป

**1) ใส่ `location` ใน server block ของแอป** — ขึ้นกับว่า stack ที่ deploy มี nginx ใน compose หรือไม่:

| stack                                                           | nginx ที่ต้องแก้                                                                                                                                                       | proxy_pass ไปที่         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `*.no-nginx.yml` (Jenkins ใช้)                                  | **host nginx** (นอก repo — ใส่เองบน server ใน server block ของ domain แอป)                                                                                             | `http://127.0.0.1:5984/` |
| `docker-compose.{staging,production}.yml` (มี nginx ใน compose) | [`nginx/nginx.conf`](../../nginx/nginx.conf) มี `location /sync/` อยู่แล้ว ไม่ต้องทำอะไร (ถ้ามี host nginx อยู่หน้า ให้ส่งต่อ `/sync/` ไปที่ nginx ใน compose ตามปกติ) | `couchdb:5984/`          |

ที่ host nginx ใส่ใน server block ของ domain แอป (ที่มี `listen 443 ssl` และ cert ของแอปอยู่แล้ว):

```nginx
    location ^~ /sync/_utils { return 404; }                                # (3)

    location /sync/ {
        client_max_body_size 64M;                                           # (1)
        proxy_pass http://127.0.0.1:5984/;                                  # (2)
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;                                                # (4)
        proxy_read_timeout 300s;                                            # (5)
        proxy_send_timeout 300s;
    }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

| #   | บรรทัด                               | ทำไม / ถ้าไม่ใส่จะเกิดอะไร                                                                                                                |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `client_max_body_size 64M`           | replicator ส่ง `_bulk_docs` ทีละ 500 doc ค่าที่เล็กไป → `413` แล้ว job `crashing` (ค่า 10M ของแอปไม่พอ จึงตั้งเฉพาะ location นี้)         |
| 2   | `proxy_pass …:5984/` **มี `/` ท้าย** | ตัด prefix `/sync` ออกก่อนส่งให้ CouchDB (เหมือน `/couch/` ของแอป) ทดสอบแล้วว่า doc id ที่มี `/` (`a%2Fb`) และ `_design/…` replicate ผ่าน |
| 3   | ปิด `/sync/_utils`                   | replication ไม่ใช้ Fauxton ไม่ต้องเปิดเป็นช่องทางเพิ่ม                                                                                    |
| 4   | `proxy_buffering off`                | `_changes` แบบ continuous ต้องส่งต่อทันที ถ้า buffer ข้อมูลจะมาช้าหรือค้าง                                                                |
| 5   | `proxy_read_timeout 300s`            | default 60s สั้นไปสำหรับ request ที่ค้างรอ `_changes`                                                                                     |

ค่า 1, 4, 5 ต้องตั้ง **ทุกชั้นที่ผ่าน** (host nginx และ nginx ใน compose ถ้ามีทั้งคู่) ชั้นไหนเล็กกว่าจะเป็นตัวจำกัด

> **ฝั่ง edge ต้องตั้ง `auth_plugins = couch_replicator_auth_noop`** (อยู่ใน `couchdb-edge-example.ini` แล้ว): replicator ปกติขอ session ที่ `<host>/_session`
> โดย**ตัด path `/sync` ทิ้ง** คำขอนั้นจึงไปตกที่เว็บแอปแทน CouchDB แล้ว job ล้มด้วย `session_unexpected_result` — ตั้งค่านี้ให้ใช้ Basic auth ตรง ๆ แทน

**2) ค่าที่ edge จะใช้:** `SYNC_URL=https://<domain>/sync`

📖 [Certbot nginx](https://eff-certbot.readthedocs.io/en/stable/using.html#nginx) ·
[nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) ·
[nginx เลือก server block จาก Host](https://nginx.org/en/docs/http/request_processing.html) ·
[CouchDB reverse proxies](https://docs.couchdb.org/en/stable/best-practices/reverse-proxies.html)

---

## ขั้น 5 — ตรวจจากเครื่อง edge ว่าเข้า central ได้

รันจาก **เครื่อง edge** (ก่อนเปิด stack ของ edge) แทน `<SYNC_URL>` ด้วยค่าจากขั้น 4:

```bash
curl -s <SYNC_URL>/_up
# {"seeds":{},"status":"ok"}   — ถ้าเป็น HTML = location /sync/ ยังไม่มี/ไม่ถูกโหลด หรือ proxy_pass ไม่มี / ท้าย (ขั้น 4B)

curl -s -u '<EDGE_REPL_USER>:<EDGE_REPL_PASSWORD>' <SYNC_URL>/shelter_sh001
# JSON ข้อมูล DB (doc_count ฯลฯ)  — ถ้า unauthorized = รหัสผิด (ใช้ค่าจาก central-repl-user.sh ไม่ใช่ admin)

curl -s -u '<EDGE_REPL_USER>:<EDGE_REPL_PASSWORD>' <SYNC_URL>/edge_users_sh001
# JSON ข้อมูล DB ของสำเนา user — ถ้า 401/403 = ยังไม่ได้รัน central-repl-user.sh หรือ role ไม่ตรงศูนย์
```

ผ่านทั้ง 3 ข้อ = central พร้อม

---

## ค่าที่ต้องส่งให้ฝั่ง edge

| ค่า                                                  | ได้จาก                                                          | ใส่ใน `.env` ของ edge                   |
| ---------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| URL ของ central                                      | ขั้น 4                                                          | `SYNC_URL`                              |
| รหัสศูนย์                                            | ขั้น 2                                                          | `SHELTER_CODE` (เช่น `SH001`)           |
| replication user ของศูนย์ + password (ใช้กับทุก job) | `scripts/central-repl-user.sh <CODE>` (ขั้น 3 — แสดงครั้งเดียว) | `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD` |

**ห้ามส่ง central admin ให้ edge** — `edge-init` จะปฏิเสธ (`FAILED`) ถ้า credential เป็น admin

---

## งานประจำของ central — ตรวจ `--status` ทุกวัน

`edge-users-copy` คือสิ่งที่ทำให้ user ที่ถูกถอดสิทธิ์ / soft delete หมดสิทธิ์ที่ edge ด้วย — ถ้า service หยุด edge จะเก็บสิทธิ์เก่าไว้โดยไม่มีใครรู้

```bash
# ทุกศูนย์ที่มี edge (ทุกวัน หรือใส่ cron / monitoring แล้ว alert เมื่อ exit ≠ 0)
for code in SH001 SH002; do
  scripts/central-repl-user.sh "$code" --status || echo "!! $code: edge-users-copy ไม่ทำงาน / ตามหลัง"
done
```

`--status` แสดง checkpoint ของ service เทียบ `update_seq` ของ `_users`, สถานะ backfill ของศูนย์, และ "edge ดึงข้อมูลล่าสุดเมื่อ" · **exit ≠ 0** เมื่อมี `last_error` หรือ service ตามหลัง `_users` นานเกิน 5 นาที → ดู `docker compose logs edge-users-copy` และตาราง "แก้ปัญหา"

### ล้าง user ค้างใน `edge_users_<code>` — `scripts/edge-users-clean.sh`

**ทำอะไร:** ลบ doc ใน `edge_users_<code>` ที่ user ถูก **hard delete** จาก `_users` ของ central ไปแล้ว (doc และ hash รหัสผ่านของ user จะค้างอยู่ในทุก `edge_users_*` เพราะ `edge-users-copy` ไม่ลบตาม) ·
รันที่ central ด้วยรหัส central admin (`COUCHDB_USER` / `COUCHDB_PASSWORD` จาก env หรือ `.env` ที่ root ของ repo)

```bash
scripts/edge-users-clean.sh                 # dry-run ทุกศูนย์ — พิมพ์ "<db> <id>" ของ orphan แต่ละตัว ยังไม่ลบ
scripts/edge-users-clean.sh SH001 SH002     # dry-run เฉพาะบางศูนย์
scripts/edge-users-clean.sh SH001 --apply   # ลบจริง
```

**เพื่ออะไร:** แอปใช้ soft delete (doc ยังอยู่ ตั้ง `deleted_at`) จึงไม่มี orphan จากการใช้งานปกติ — orphan เกิดเฉพาะตอนมีคนลบ user ตรงใน CouchDB (Fauxton / admin API) ·
edge ได้รับการลบในรอบ pull ถัดไปของ `users_<code>_pull` · script ไม่แตะ `_design/*` และเช็กซ้ำกับ `_users` ของ central ก่อนลบทุกตัว (user ที่เพิ่งสร้างระหว่างรันจะไม่ถูกลบ) ·
ถ้า `_users` ของ central ว่างทั้งหมด script จะปฏิเสธ (ไม่งั้นทุก doc เป็น orphan) เว้นแต่ใส่ `--allow-empty`

**ตรวจว่าผ่าน:** ดู dry-run ก่อน (บรรทัดท้าย `orphans found: N ... (dry-run, nothing deleted; use --apply to delete)`) → ตรวจรายการ → รันด้วย `--apply` ·
รันซ้ำอีกครั้งต้องได้ `orphans found: 0` · exit ≠ 0 = มีบางตัวลบไม่สำเร็จ ดูข้อความ `FAIL` ที่ stderr

---

## เครื่อง edge หาย (ถูกขโมย / สูญหาย / ถูกยึด)

ทำที่ **central ทั้งหมด** ตามลำดับ — เครื่องที่หายไม่มี central admin แต่ยังมี **ข้อมูลของศูนย์นั้น และ password hash ของ staff ศูนย์นั้น**
(ศูนย์อื่นไม่กระทบ ไม่ต้องแก้ edge เครื่องอื่น) · ตัวอย่างใช้ศูนย์ `SH001`

**1) ตัดเครื่องที่หายออกจาก central ทันที**

```bash
scripts/central-repl-user.sh SH001 --remove
```

ลบบัญชี `repl_sh001_*`, ถอดสิทธิ์จาก `registry` / `catalog` / `shelter_sh001`, ลบ DB `edge_users_sh001` ทั้ง DB — เครื่องที่หายเข้า central ไม่ได้อีก (401)

**2) reset password ของ staff ทุกคนที่ศูนย์นี้**

ทุกคนที่ `edge_shelters` มี `SH001` (รวมคนที่ออกจากศูนย์ไปแล้ว เพราะ hash ของเขายังอยู่ในเครื่องที่หาย) · ดูรายชื่อ:

```bash
curl -s "$C/_users/_find" -H 'Content-Type: application/json' \
  -d '{"selector":{"edge_shelters":{"$elemMatch":{"$eq":"SH001"}}},"fields":["name"],"limit":1000}'
```

แล้วใช้ **reset password ที่มีอยู่ในแอป** (หน้าจัดการผู้ใช้ → รีเซ็ตรหัสผ่าน — `user-service`) กับทุกคน ให้เปลี่ยนเป็นรหัสชั่วคราวทันที
แล้วแจ้งรหัสใหม่ให้เจ้าของบัญชี

> **ห้าม** ตั้งแค่ `must_change_password` — รหัสเดิมยัง login ได้ ผู้ถือเครื่องที่หายถอดรหัสจาก hash ได้ แล้วเอาไปใช้ที่ central
> ต้อง **เปลี่ยนรหัสจริง** เท่านั้น hash เดิมถึงใช้ไม่ได้

**3) ตรวจ revision ใน `shelter_sh001` ที่ sync ขึ้นมาหลังเวลาที่เครื่องหาย**

เครื่องที่หายเขียน `shelter_sh001` ของศูนย์นี้ได้จนถึงขั้น 1 — ดู doc ที่ถูกสร้าง/แก้หลังเวลาที่เครื่องหาย (เทียบ `updated_at` กับเวลาที่สูญหาย) ว่าผิดปกติหรือไม่:

```bash
curl -s "$C/shelter_sh001/_changes?descending=true&limit=200&include_docs=true" \
  | python3 -c 'import sys,json; [print(r["id"], r["doc"].get("updated_at","")) for r in json.load(sys.stdin)["results"]]'
```

(ยังไม่มีเครื่องมือตรวจตามช่วงเวลาให้ — ตรวจด้วยตาตามนี้ · ถ้าพบ doc น่าสงสัย ให้แก้/ย้อน revision ที่ central ตามปกติ)

**4) ติดตั้ง edge เครื่องใหม่ด้วย credential ใหม่**

```bash
scripts/central-repl-user.sh SH001      # ได้ user + password ชุดใหม่ (suffix ใหม่) — แสดงครั้งเดียว
```

แล้วทำ [SETUP-EDGE.md](SETUP-EDGE.md) ตั้งแต่ขั้น 1 บนเครื่องใหม่ (ใส่ `EDGE_REPL_*` ชุดใหม่) · ล้างเครื่องเก่าถ้าได้คืนมา (SETUP-EDGE "ถอดออก")
`edge-users-copy` เห็น DB `edge_users_sh001` ใหม่แล้ว backfill user เดิมให้ภายใน 1 นาที — ตรวจด้วย `--status SH001`

---

## ปิดศูนย์ที่มี edge

แอปไม่สั่ง `--remove` เอง — ปิด / ยกเลิกศูนย์ในแอปเปลี่ยนแค่ `operation_status` ใน `registry` ไม่แตะ `_security` / `_users` ผู้ดูแล central ต้องทำเอง:

1. ปิดศูนย์ในแอป (`operation_status: closed`)
2. ที่ central: `scripts/central-repl-user.sh <CODE> --remove`
3. ล้างเครื่อง edge ทั้งเครื่อง ([SETUP-EDGE.md](SETUP-EDGE.md) "ถอดออก" · [data-model §7](../data/data-model.md))

ศูนย์ที่ **ยกเลิก (`cancelled`)** ไม่ต้องทำ เพราะกลับสถานะได้ และศูนย์ที่ไม่เคยเปิดใช้มักไม่มี edge

---

## หลัง deploy CR-247 — หมุนรหัส central admin (ครั้งเดียว)

edge ที่ติดตั้ง**ก่อน** CR นี้ยังมีรหัส central admin ค้างอยู่ใน `.env` และใน `_replicator` ของ edge — ต้องหมุนรหัสทิ้ง ลำดับ:

1. ทุก edge ที่ติดตั้งไว้แล้ว เปลี่ยนไปใช้ `EDGE_REPL_*` ให้ครบก่อน (SETUP-EDGE "edge ที่ติดตั้งก่อน CR-247") — edge ที่ยังใช้ admin เก่าจะพังทันทีที่หมุนรหัส
2. **หมุนรหัส central admin** แล้วอัปเดต `COUCHDB_PASSWORD` ของ**ทุก service ที่ central ที่ใช้รหัสนี้** — อย่างน้อย **`edge-users-copy` และ sync-worker (`worker`)** (รวมถึง `COUCHDB_ADMIN_URL` ของ frontend ถ้ามี) แล้ว **restart ทั้งหมด**
3. ตรวจ `--status` ทุกศูนย์ที่มี edge — ต้อง exit 0 (รหัส `repl_*` เดิมไม่เปลี่ยน ไม่ต้องแก้ edge)

```bash
# หลัง restart (COUCHDB_PASSWORD ใหม่อยู่ใน env / .env)
docker compose up -d --force-recreate edge-users-copy worker
for code in SH001 SH002; do
  scripts/central-repl-user.sh "$code" --status
done
```

ลืม `edge-users-copy` = คัดลอก user ไม่ได้ (401) การถอดสิทธิ์ไม่ถึง edge โดยไม่มี error ในแอป (`--status` จะเตือน) · ลืม sync-worker = projection ไป MongoDB หยุด · ข้ามข้อ 2 ทั้งข้อ = รหัส admin เก่าที่ค้างบน edge ยังใช้เข้า central ได้ต่อไป

---

## สิ่งที่ **ไม่ต้อง** แก้ที่ central

| ส่วน                             | ทำไมไม่ต้องแก้                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| service `couchdb` ใน compose     | ไม่ต้องเปิด port เพิ่ม (จริง: เข้าทาง nginx · lab: dev stack เปิดอยู่แล้ว)                                                                     |
| `couchdb-session.ini` / `secret` | edge ใช้ `secret` ของตัวเอง → cookie ข้ามฝั่งไม่ได้ ต้อง login ใหม่ตอน cutover (OD-3)                                                          |
| `/couch` ของแอป                  | แอปใช้ตามเดิม ไม่เกี่ยวกับ `/sync`                                                                                                             |
| frontend / fastapi / sync-worker | replication คือ CouchDB คุยกับ CouchDB แอปไม่เกี่ยว (ยกเว้น service `edge-users-copy` ที่เพิ่มบน central — ขั้น 3.4)                           |
| job replication ของ edge         | อยู่ที่ edge ทั้งหมด (ที่ central มีแค่ service `edge-users-copy` กับ DB `edge_users_<code>` ที่ `central-repl-user.sh` สร้างให้)              |
| staff user                       | user ที่มี role `shelter:SH001` (หรือ `edge_shelters` มี SH001) ถูก `edge-users-copy` คัดลอกไป `edge_users_sh001` แล้ว edge ดึงลง `_users` เอง |

---

## แก้ปัญหา (ฝั่ง central)

| อาการ                                                    | สาเหตุ                                                                                                                                    | แก้                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| edge ต่อ `SYNC_URL` ไม่ติด (timeout / refused)           | firewall, IP เปลี่ยน, port ไม่ได้ publish                                                                                                 | ขั้น 4A / ตรวจ `ss -ltn \| grep 5984`                                                                                                                 |
| ได้ HTML ของ SPA แทน JSON                                | host nginx ไม่ส่ง `Host` หรือ `server_name` ไม่ตรง → ตกไป block ของแอป                                                                    | ขั้น 4B ข้อ (1), (5)                                                                                                                                  |
| `unauthorized` / `403` ทั้งที่รหัสถูก                    | `EDGE_REPL_*` ใน `.env` ของ edge ไม่ตรงกับที่สร้างไว้ (เช่นหลัง `--rotate`) หรือโดนล็อกเอาต์จากการ retry ด้วยรหัสผิด (ล็อกเฉพาะศูนย์นั้น) | ขั้น 3.2 `--rotate` แล้วใส่รหัสใหม่ · รอ 5 นาทีหลังแก้รหัส                                                                                            |
| `central-repl-user.sh` หยุดแจ้ง `edge_users_*`           | `_security` ของ `edge_users_<code>` ว่างหรือมีสิ่งอื่นนอกจาก `repl:<CODE>` (เสี่ยงรั่ว hash)                                              | แก้ `_security` ของ DB ที่แจ้งให้ `members.roles` = `["repl:<CODE>"]` พอดี `members.names` ว่าง แล้วรันใหม่                                           |
| `--status` exit ≠ 0                                      | `edge-users-copy` มี `last_error` หรือตามหลัง `_users` เกิน 5 นาที (service หยุด / 401 หลังหมุนรหัส admin)                                | `docker compose logs edge-users-copy` · มักเป็นรหัส admin เปลี่ยนแล้วยังไม่อัปเดต `COUCHDB_PASSWORD` ของ service → อัปเดตแล้ว restart ("หลัง deploy") |
| `central-repl-user.sh` แจ้งเจอบัญชีแบบเก่า `repl_<code>` | บัญชีที่สร้างด้วยสคริปต์รุ่นก่อน (ไม่มี suffix)                                                                                           | `--remove` แล้วสร้างใหม่                                                                                                                              |
| staff ใหม่ / เปลี่ยน role แล้วไม่ถึง edge                | `edge-users-copy` หยุด หรือ staff ไม่มี `edge_shelters` / `shelter:<CODE>` ของศูนย์นี้                                                    | `--status` · ตรวจ field ของ user ที่ central                                                                                                          |
| job ของ edge ได้ `413`                                   | `client_max_body_size` ชั้นใดชั้นหนึ่งเล็กไป                                                                                              | ขั้น 4B ข้อ (2) ทุกชั้น                                                                                                                               |
| sync ช้าเป็นนาที                                         | nginx buffer `_changes`                                                                                                                   | `proxy_buffering off` ทุกชั้น                                                                                                                         |

---

## ถอดออกหลังทดสอบ

จริง: ลบ `location /sync/` ใน host nginx แล้ว reload · Lab: ปิด firewall rule
ลบบัญชีและ DB `edge_users_<code>` ของศูนย์ทดสอบด้วย `scripts/central-repl-user.sh <CODE> --remove`
(edge ที่ติดตั้งก่อน [CR-247](../changes/01-core/CR-247-edge-per-shelter-repl-user.md) และเคยถือ central admin ให้ทำ "หลัง deploy CR-247" ด้านบน — หมุนรหัส admin)

---

## อ้างอิง

| เอกสาร                                                                                                                                                    | ใช้ดูอะไร                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/data/data-model.md` §1, §6](../data/data-model.md)                                                                                                 | topology และ `_security` / `_users`                     |
| [`docs/changes/01-core/CR-064-edge-disaster-continuity.md`](../changes/01-core/CR-064-edge-disaster-continuity.md)                                        | OD-1..OD-5 (OD-6 ถูกแทนแล้ว)                            |
| [`docs/changes/01-core/CR-247-edge-per-shelter-repl-user.md`](../changes/01-core/CR-247-edge-per-shelter-repl-user.md)                                    | replication user ต่อศูนย์ + `edge_users_<code>` (#1298) |
| [`nginx/nginx.conf`](../../nginx/nginx.conf)                                                                                                              | nginx ของ compose stack (`location /sync/`)             |
| [Replication intro](https://docs.couchdb.org/en/stable/replication/intro.html) · [protocol](https://docs.couchdb.org/en/stable/replication/protocol.html) | หลักการ `_changes` / `_revs_diff` / `_bulk_docs`        |
| [`/{db}/_security`](https://docs.couchdb.org/en/stable/api/database/security.html)                                                                        | สิทธิ์ของ DB                                            |
| [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html)                                                                                    | secret และ cookie                                       |
