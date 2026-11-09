# Setup Central — ฝั่งที่ edge มา sync ด้วย

คู่มือนี้ใช้กับ **เครื่อง central เท่านั้น** (เครื่องที่รัน CouchDB หลักของระบบ) ทำตามลำดับ และตรวจให้ผ่านก่อนไปขั้นถัดไป
ฝั่ง edge อยู่ที่ [SETUP-EDGE.md](SETUP-EDGE.md) · หลักการและเหตุผลของการออกแบบอยู่ที่ [README.md §2](README.md)

> **หลักการข้อเดียวที่ต้องจำ:** edge เป็นฝ่ายเปิด connection หา central เสมอ (edge อยู่หลัง NAT ของศูนย์)
> job replication ของ edge อยู่ที่ edge ทั้งหมด — หน้าที่ของ central มี 4 อย่าง:
> **(1) มีข้อมูลศูนย์ให้ดึง (2) สร้าง replication user ของศูนย์นั้น (ไม่ใช่ admin) (3) คัดลอก user ของศูนย์ไปไว้ใน DB `edge_users_<code>` ให้ edge ดึง (4) เปิดทางให้ edge เข้ามาถึง CouchDB**
>
> **รหัส central admin อยู่ที่ central เท่านั้น ไม่ส่งให้ edge** (ตาม [CR ร่าง #1298](../changes/draft-edge-per-shelter-repl-user.md) ที่แทน OD-6 เดิม)
> script `scripts/central-repl-user.sh <CODE>` ทำข้อ (2) และ (3) ให้ในคำสั่งเดียว

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

edge **ไม่ใช้ central admin** แต่ใช้บัญชีที่สร้างให้เฉพาะศูนย์นั้น ([CR ร่าง #1298](../changes/draft-edge-per-shelter-repl-user.md) แทน OD-6 เดิมใน
[edge-disaster-continuity-idea.md](../features/edge-disaster-continuity-idea.md) §6) ทำที่ central ครั้งเดียวต่อศูนย์ที่มี edge

### 3.1 สร้าง (provision)

รันที่ central จาก root ของ repo — สคริปต์ใช้ admin จาก `COUCHDB_USER` / `COUCHDB_PASSWORD` (env หรือ `.env` ของ central) ในเครื่องนี้เท่านั้น:

```bash
scripts/central-repl-user.sh SH001
```

สคริปต์สร้างให้ครบในครั้งเดียว:

| สร้าง                                                   | รายละเอียด                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user `repl_sh001_<8 ตัว hex สุ่ม>`                      | role `repl:SH001` เท่านั้น · รหัสผ่านสุ่ม · **ชื่อเดายาก** (กันคนนอกลองล็อกเอาต์ทีละศูนย์) · ไม่มี `edge_shelters`                                                                                      |
| สิทธิ์อ่าน/เขียน DB                                     | เพิ่ม role `repl:SH001` ใน `_security` ของ `registry`, `catalog`, `shelter_sh001` (ไม่เพิ่มใน `shelter_<ศูนย์อื่น>`) · registry/catalog ที่ edge อ่านได้อย่างเดียว (central ปฏิเสธการเขียนของ `repl:*`) |
| DB `edge_users_sh001`                                   | member มีแค่ `repl:SH001` · เขียนได้เฉพาะ `_admin` (`_design/readonly`) · เก็บสำเนา user ของศูนย์นี้ (มี password hash)                                                                                 |
| job `edge_users_sh001` ใน `_replicator` **ของ central** | คัดลอก user ของศูนย์จาก `_users` ไป `edge_users_sh001` แบบ continuous ด้วย admin ของ central ที่เครื่องนี้เอง · กรองด้วย `edge_shelters` มี `SH001` หรือ `roles` มี `shelter:SH001` (กฎเดียวกับ CR-171) |

**username + password แสดงครั้งเดียว** ตอนสร้าง (หรือ `--rotate`) — จดทันที แล้วใส่ใน `.env` ของ edge เป็น `EDGE_REPL_USER` / `EDGE_REPL_PASSWORD`
([SETUP-EDGE ขั้น 4](SETUP-EDGE.md)) · รันซ้ำโดยไม่ใส่ `--rotate` จะคงรหัสเดิมและไม่แสดงรหัสอีก · หนึ่งศูนย์มีบัญชีได้ **1 บัญชี**

> ถ้าสคริปต์แจ้งว่าเจอบัญชีแบบเก่า `repl_<code>` (ไม่มี suffix) ให้รัน `--remove` ก่อนแล้วสร้างใหม่
> บัญชี `repl_*` **ไม่โผล่ในหน้าจัดการผู้ใช้ของแอป** และแก้ผ่านแอปไม่ได้ — จัดการด้วยสคริปต์นี้เท่านั้น

### 3.2 ตัวเลือก

| คำสั่ง                                        | ทำอะไร                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/central-repl-user.sh SH001`          | สร้าง (ถ้ามีแล้วคงรหัสเดิม)                                                                                                                       |
| `scripts/central-repl-user.sh SH001 --rotate` | ตั้งรหัสใหม่ แสดงครั้งเดียว · ต้องแก้ `.env` ของ edge ศูนย์นั้นแล้วรัน `edge-init` ใหม่ (**ศูนย์อื่นไม่กระทบ**)                                   |
| `scripts/central-repl-user.sh SH001 --remove` | ลบบัญชี · ถอด role ออกจาก `_security` ของ registry/catalog/`shelter_sh001` · ลบ job คัดลอก · ลบ DB `edge_users_sh001` · รันซ้ำได้ ไม่แตะศูนย์อื่น |
| `scripts/central-repl-user.sh SH001 --status` | แสดงสถานะ job คัดลอก (`state`, `error_count`, `last_updated`) · **exit ≠ 0 ถ้า state ไม่ใช่ `running` / `pending`**                               |
| `--repl-url <URL>`                            | URL ที่ CouchDB ของ central ใช้เรียกตัวเอง (ค่า default `http://127.0.0.1:5984`) · เปลี่ยนเมื่อ CouchDB ไม่ได้ฟัง 5984 ในตัวมันเอง                |
| `--url <URL>`                                 | URL ที่สคริปต์ใช้ต่อ CouchDB ของ central (default `$COUCHDB_URL` หรือ `http://localhost:5984`)                                                    |

ทุกครั้งที่รัน (ทุกคำสั่ง) สคริปต์ตรวจ `_security` ของ DB `edge_users_*` **ทุกตัว** บน central ถ้า `members` ว่าง (= เปิดสาธารณะ) หรือมีอะไรนอกจาก `repl:<CODE>` ของศูนย์นั้น
จะ **หยุดพร้อมแจ้งชื่อ DB** — เพราะ DB นี้มี password hash ของ staff ตั้งพลาดแล้วรั่วหนักกว่าเดิม · เจอแล้วต้องแก้ `_security` ก่อนทำอะไรต่อ

### 3.3 สิ่งที่ต้องรู้

| เรื่อง                                  | ผล                                                                                                                                                                                                         | ต้องทำ                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| เครื่อง edge หลุด / ถูกขโมย             | ผู้ถือเครื่องได้ **ข้อมูล `shelter_<code>` ของศูนย์นั้น + password hash ของ staff ศูนย์นั้น** และเขียน `shelter_<code>` ของศูนย์นั้นได้จนกว่าจะ `--remove` · **ไม่ได้ central admin** และไม่กระทบศูนย์อื่น | ทำตาม "เครื่อง edge หาย" ด้านล่าง                                                                                                                        |
| `SHELTER_CODE` ผิด                      | `edge-init` ตรวจ `_session` ด้วย `EDGE_REPL_*` ต้องมี `repl:<SHELTER_CODE>` และไม่เป็น `_admin` — ไม่ผ่านจะ `FAILED` (ใส่ central admin มาก็ไม่ผ่าน) · central ปฏิเสธการอ่าน DB ศูนย์อื่น (401/403)        | ตรวจ `SHELTER_CODE` ก่อน `up` (SETUP-EDGE ขั้น 4)                                                                                                        |
| `_design/*`                             | `repl:*` เขียน design doc ของ `shelter_<code>` ไม่ได้ (CouchDB ให้เฉพาะ db admin) · job `<code>_push` ยังกรอง `_design/*` ออกอยู่ (กันอุบัติเหตุ)                                                          | อย่าสร้าง design doc ใน `shelter_<code>` ที่ edge                                                                                                        |
| lockout (รหัสผิด 5 ครั้ง)               | CouchDB นับต่อ (user, IP) — **แต่ละศูนย์มีชื่อของตัวเอง** จึงหยุดแค่ศูนย์ที่รหัสผิด ศูนย์อื่นยัง sync                                                                                                      | แก้ `.env` ของ edge ศูนย์นั้นให้ตรงรหัสล่าสุด แล้วรอ 5 นาที                                                                                              |
| หมุนรหัส central admin                  | **edge ไม่ต้องแก้อะไร** (ไม่ถือ admin) · แต่ job คัดลอก `edge_users_<code>` ใช้ admin เดิมอยู่                                                                                                             | รัน `central-repl-user.sh <CODE>` ซ้ำทุกศูนย์ที่มี edge (ดู "หลัง deploy" ด้านล่าง) และอัปเดต service ของ central ที่ใช้ admin (`COUCHDB_ADMIN_URL` ฯลฯ) |
| job คัดลอก `edge_users_<code>` หยุด     | user ที่ถูกถอดสิทธิ์ / soft delete ยัง login ที่ edge ได้ เพราะ edge ไม่ได้รับ revision ใหม่                                                                                                               | ตรวจ `--status` ทุกวัน (ด้านล่าง)                                                                                                                        |
| รหัส admin ใน `_replicator` ของ central | job คัดลอกเก็บรหัส central admin เป็น plaintext ใน doc ของ `_replicator` **ของ central** (เครื่องที่ถือ admin อยู่แล้ว)                                                                                    | ดูแล central ตามปกติ · ห้ามให้ edge เข้า `_replicator` ของ central                                                                                       |

**ตรวจหลังสร้าง** (แทน `<REPL_USER>` / `<REPL_PW>` ด้วยค่าที่สคริปต์แสดง · `$C` คือ admin ของ central จากขั้น 1):

```bash
scripts/central-repl-user.sh SH001 --status                                    # exit 0, state running/pending

curl -s -o /dev/null -w '%{http_code}\n' -u <REPL_USER>:<REPL_PW> http://localhost:5984/edge_users_sh001   # 200
curl -s -o /dev/null -w '%{http_code}\n' -u <REPL_USER>:<REPL_PW> http://localhost:5984/shelter_sh002      # 401/403 (ศูนย์อื่น)
curl -s -o /dev/null -w '%{http_code}\n' -u <REPL_USER>:<REPL_PW> http://localhost:5984/_users/_changes    # 401/403
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -u <REPL_USER>:<REPL_PW> http://localhost:5984/registry/x -d '{}'   # 403 (registry เขียนไม่ได้)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5984/edge_users_sh001                            # 401 (ไม่ login)
curl -s $C/edge_users_sh001 | python3 -c 'import sys,json;print(json.load(sys.stdin)["doc_count"])'          # > 0 (มี staff ของศูนย์ถูกคัดลอกแล้ว)
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

job คัดลอก `edge_users_<code>` คือสิ่งที่ทำให้ user ที่ถูกถอดสิทธิ์ / soft delete หมดสิทธิ์ที่ edge ด้วย — ถ้า job หยุด edge จะเก็บสิทธิ์เก่าไว้โดยไม่มีใครรู้

```bash
# ทุกศูนย์ที่มี edge (ทุกวัน หรือใส่ cron / monitoring แล้ว alert เมื่อ exit ≠ 0)
for code in SH001 SH002; do
  scripts/central-repl-user.sh "$code" --status || echo "!! $code: job คัดลอก user ไม่ทำงาน"
done
```

`state` ต้องเป็น `running` หรือ `pending` · `error_count` สูงขึ้นเรื่อย ๆ หรือ `last_updated` เก่ามาก = ไปดูสาเหตุ (ตาราง "แก้ปัญหา")

---

## เครื่อง edge หาย (ถูกขโมย / สูญหาย / ถูกยึด)

ทำที่ **central ทั้งหมด** ตามลำดับ — เครื่องที่หายไม่มี central admin แต่ยังมี **ข้อมูลของศูนย์นั้น และ password hash ของ staff ศูนย์นั้น**
(ศูนย์อื่นไม่กระทบ ไม่ต้องแก้ edge เครื่องอื่น) · ตัวอย่างใช้ศูนย์ `SH001`

**1) ตัดเครื่องที่หายออกจาก central ทันที**

```bash
scripts/central-repl-user.sh SH001 --remove
```

ลบบัญชี `repl_sh001_*`, ถอดสิทธิ์จาก `registry` / `catalog` / `shelter_sh001`, ลบ job และ DB `edge_users_sh001` — เครื่องที่หายเข้า central ไม่ได้อีก (401)

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

---

## หลัง deploy CR #1298 — หมุนรหัส central admin (ครั้งเดียว)

edge ที่ติดตั้ง**ก่อน** CR นี้ยังมีรหัส central admin ค้างอยู่ใน `.env` และใน `_replicator` ของ edge — ต้องหมุนรหัสทิ้ง ลำดับ:

1. ทุก edge ที่ติดตั้งไว้แล้ว เปลี่ยนไปใช้ `EDGE_REPL_*` ให้ครบก่อน (SETUP-EDGE "edge ที่ติดตั้งก่อน CR #1298") — edge ที่ยังใช้ admin เก่าจะพังทันทีที่หมุนรหัส
2. **หมุนรหัส central admin** (`COUCHDB_PASSWORD` ใน `.env` ของ central + service ที่ใช้ admin เช่น `COUCHDB_ADMIN_URL` แล้ว restart) — edge ไม่ต้องแก้อะไร เพราะไม่ถือ admin แล้ว
3. **รัน `scripts/central-repl-user.sh <CODE>` ซ้ำสำหรับทุกศูนย์ที่มี edge** เพื่อให้ job คัดลอก `edge_users_<code>` ใช้รหัส admin ใหม่ (รหัส repl เดิมไม่เปลี่ยน ไม่ต้องแก้ edge) แล้วตรวจ `--status` ทุกศูนย์

```bash
# หลังหมุนรหัสแล้ว (COUCHDB_PASSWORD ใหม่อยู่ใน env / .env)
for code in SH001 SH002; do
  scripts/central-repl-user.sh "$code"
  scripts/central-repl-user.sh "$code" --status
done
```

ข้ามข้อ 3 = job คัดลอกล้ม (401) แล้ว user ใหม่ / การถอดสิทธิ์ไม่ถึง edge โดยไม่มี error ในแอป · ข้ามข้อ 2 = รหัส admin เก่าที่ค้างบน edge ยังใช้เข้า central ได้ต่อไป

---

## สิ่งที่ **ไม่ต้อง** แก้ที่ central

| ส่วน                             | ทำไมไม่ต้องแก้                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| service `couchdb` ใน compose     | ไม่ต้องเปิด port เพิ่ม (จริง: เข้าทาง nginx · lab: dev stack เปิดอยู่แล้ว)                                                  |
| `couchdb-session.ini` / `secret` | edge ใช้ `secret` ของตัวเอง → cookie ข้ามฝั่งไม่ได้ ต้อง login ใหม่ตอน cutover (OD-3)                                       |
| `/couch` ของแอป                  | แอปใช้ตามเดิม ไม่เกี่ยวกับ `/sync`                                                                                          |
| frontend / fastapi / worker      | replication คือ CouchDB คุยกับ CouchDB แอปไม่เกี่ยว                                                                         |
| job replication ของ edge         | อยู่ที่ edge ทั้งหมด (ที่ central มีแค่ job คัดลอก `edge_users_<code>` ที่ `central-repl-user.sh` สร้างให้ ไม่ต้องสร้างเอง) |
| staff user                       | user ที่มี role `shelter:SH001` (หรือ `edge_shelters` มี SH001) ถูกคัดลอกไป `edge_users_sh001` แล้ว edge ดึงลง `_users` เอง |

---

## แก้ปัญหา (ฝั่ง central)

| อาการ                                                    | สาเหตุ                                                                                                                                    | แก้                                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| edge ต่อ `SYNC_URL` ไม่ติด (timeout / refused)           | firewall, IP เปลี่ยน, port ไม่ได้ publish                                                                                                 | ขั้น 4A / ตรวจ `ss -ltn \| grep 5984`                                                                                                       |
| ได้ HTML ของ SPA แทน JSON                                | host nginx ไม่ส่ง `Host` หรือ `server_name` ไม่ตรง → ตกไป block ของแอป                                                                    | ขั้น 4B ข้อ (1), (5)                                                                                                                        |
| `unauthorized` / `403` ทั้งที่รหัสถูก                    | `EDGE_REPL_*` ใน `.env` ของ edge ไม่ตรงกับที่สร้างไว้ (เช่นหลัง `--rotate`) หรือโดนล็อกเอาต์จากการ retry ด้วยรหัสผิด (ล็อกเฉพาะศูนย์นั้น) | ขั้น 3.2 `--rotate` แล้วใส่รหัสใหม่ · รอ 5 นาทีหลังแก้รหัส                                                                                  |
| `central-repl-user.sh` หยุดแจ้ง `edge_users_*`           | `_security` ของ `edge_users_<code>` ว่างหรือมีสิ่งอื่นนอกจาก `repl:<CODE>` (เสี่ยงรั่ว hash)                                              | แก้ `_security` ของ DB ที่แจ้งให้ `members.roles` = `["repl:<CODE>"]` พอดี `members.names` ว่าง แล้วรันใหม่                                 |
| `--status` exit ≠ 0                                      | job `edge_users_<code>` ไม่ `running` / `pending` (`crashing`, `failed` หรือไม่มี job)                                                    | ดู `error` ในผล · มักเป็นรหัส admin เปลี่ยนแล้วยังไม่ได้รันสคริปต์ซ้ำ → `central-repl-user.sh <CODE>` (ขั้น 3 ข้อ "หมุนรหัส central admin") |
| `central-repl-user.sh` แจ้งเจอบัญชีแบบเก่า `repl_<code>` | บัญชีที่สร้างด้วยสคริปต์รุ่นก่อน (ไม่มี suffix)                                                                                           | `--remove` แล้วสร้างใหม่                                                                                                                    |
| staff ใหม่ / เปลี่ยน role แล้วไม่ถึง edge                | job คัดลอกหยุด หรือ staff ไม่มี `edge_shelters` / `shelter:<CODE>` ของศูนย์นี้                                                            | `--status` · ตรวจ field ของ user ที่ central                                                                                                |
| job ของ edge ได้ `413`                                   | `client_max_body_size` ชั้นใดชั้นหนึ่งเล็กไป                                                                                              | ขั้น 4B ข้อ (2) ทุกชั้น                                                                                                                     |
| sync ช้าเป็นนาที                                         | nginx buffer `_changes`                                                                                                                   | `proxy_buffering off` ทุกชั้น                                                                                                               |

---

## ถอดออกหลังทดสอบ

จริง: ลบ `location /sync/` ใน host nginx แล้ว reload · Lab: ปิด firewall rule
ลบบัญชีและ job ของศูนย์ทดสอบด้วย `scripts/central-repl-user.sh <CODE> --remove`
(edge ที่ติดตั้งก่อน [CR ร่าง #1298](../changes/draft-edge-per-shelter-repl-user.md) และเคยถือ central admin ให้ทำ "หลัง deploy" ด้านล่าง — หมุนรหัส admin)

---

## อ้างอิง

| เอกสาร                                                                                                                                                    | ใช้ดูอะไร                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/data/data-model.md` §1, §6](../data/data-model.md)                                                                                                 | topology และ `_security` / `_users`                     |
| [`docs/changes/01-core/CR-064-edge-disaster-continuity.md`](../changes/01-core/CR-064-edge-disaster-continuity.md)                                        | OD-1..OD-5 (OD-6 ถูกแทนแล้ว)                            |
| [`docs/changes/draft-edge-per-shelter-repl-user.md`](../changes/draft-edge-per-shelter-repl-user.md)                                                      | replication user ต่อศูนย์ + `edge_users_<code>` (#1298) |
| [`nginx/nginx.conf`](../../nginx/nginx.conf)                                                                                                              | nginx ของ compose stack (`location /sync/`)             |
| [Replication intro](https://docs.couchdb.org/en/stable/replication/intro.html) · [protocol](https://docs.couchdb.org/en/stable/replication/protocol.html) | หลักการ `_changes` / `_revs_diff` / `_bulk_docs`        |
| [`/{db}/_security`](https://docs.couchdb.org/en/stable/api/database/security.html)                                                                        | สิทธิ์ของ DB                                            |
| [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html)                                                                                    | secret และ cookie                                       |
