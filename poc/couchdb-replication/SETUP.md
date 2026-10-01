# Setup — central ⇄ edge บนระบบจริง

คู่มือนี้อธิบายว่าจะให้ CouchDB ของ **central** (stack เดิมของแอป) sync กับ **edge @ศูนย์** ได้
ต้อง **เพิ่มอะไร ตรงไหน เพราะอะไร** และแต่ละส่วนทำหน้าที่อะไร ตาม
[`data-model.md` §1](../../docs/data/data-model.md) และ [CR-064](../../docs/changes/CR-064-edge-disaster-continuity.md)

- ไฟล์จริงอยู่ใน repo แล้ว (ตาราง §2) — คู่มือนี้อธิบายว่าแต่ละส่วนมีไว้ทำไม · สรุปสั้นอยู่ที่ [README root "Edge @ศูนย์"](../../README.md)
- การทดลองบนเครื่องเดียว (container เปล่า 2 ตัว) อยู่ใน [README §3–§4](README.md)
- `sync.example.com`, `app.example.com`, `SH001` เป็นค่าตัวอย่าง ให้เปลี่ยนเป็นค่าจริง

---

## 1. ภาพรวม: ทำไมต้องเพิ่มของพวกนี้

```
 server A — central (Jenkins: docker-compose.{staging,production}.no-nginx.yml)
┌───────────────────────────────────────────────────────────────────┐
│ host nginx :443 (TLS)                                             │
│  ├─ app.example.com  ─▶ 127.0.0.1:3000 / :5984 (/couch) / :9000   (มีอยู่แล้ว)
│  └─ sync.example.com ─▶ 127.0.0.1:5984 (CouchDB)                  ← เพิ่ม (§3)
└───────────────────────────────────────────────────────────────────┘
               ▲ HTTPS — edge เป็นฝ่ายเปิด connection เสมอ
 server B — edge @ศูนย์ (หลัง NAT)                                     ← เพิ่มทั้งเครื่อง (§4)
┌───────────────────────────────────────────────────────────────────┐
│ couchdb  ─ _replicator: job ดึง/ส่งข้อมูลกับ central                  │
│ nginx (LAN) ─▶ frontend, /couch     (ไม่มี FastAPI / Mongo — OD-1)  │
└───────────────────────────────────────────────────────────────────┘
```

หลักการที่ทำให้ต้องตั้งค่าแบบนี้:

| หลักการ | ผลต่อการ setup |
| --- | --- |
| **edge เป็นฝ่ายเปิด connection** — edge อยู่หลัง NAT ของศูนย์ central เรียกเข้าไม่ได้ | job replication ทุกตัวอยู่ใน `_replicator` ของ **edge** · central แค่ต้องเปิด HTTPS ให้ edge เรียกเข้ามา |
| **replication คือ HTTP ปกติ** (`_changes`, `_revs_diff`, `_bulk_get`, `_bulk_docs`) | วิ่งผ่าน nginx เดิมได้ แต่ต้องปรับ nginx ให้รองรับ (ไม่ buffer, body ใหญ่, timeout ยาว) |
| **job ใช้สิทธิ์ของ user ที่ใส่ไว้** เหมือน client ทั่วไป | ต้องมี replication user ที่เป็น member ของ DB ที่ central |
| **`_security` ไม่ถูก replicate** | edge ต้องตั้ง `_security` ของตัวเอง |
| **cutover ทำที่ DNS ของ LAN** (OD-2) — domain แอปจะชี้มาที่ edge ตอน WAN ขาด | replication ต้องใช้ hostname อื่นที่ไม่ถูก override ไม่อย่างนั้น edge จะ replicate วนเข้าตัวเอง (README T9) |
| **checkpoint** เก็บใน `_local/*` ทั้งสองฝั่ง | WAN กลับมาแล้ว job ไล่ต่อจากจุดเดิมเอง ไม่ต้องสั่งอะไร |

📖 [Replication intro](https://docs.couchdb.org/en/stable/replication/intro.html) ·
[Replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)

---

## 2. สรุปสิ่งที่ต้องเพิ่ม

| # | ที่ไหน | เพิ่มอะไร | ใช้ทำอะไร | ตัวอย่าง |
| --- | --- | --- | --- | --- |
| C1 | DNS + server A | `sync.example.com` + cert | ช่องทางเฉพาะ replication แยกจาก domain แอป | §3.1 |
| C2 | host nginx (server A) | server block `sync.example.com` | รับ TLS แล้วส่งต่อไป CouchDB ด้วยค่าที่ replication ต้องการ | [README root "Edge @ศูนย์"](../../README.md) (อยู่นอก repo — ต้องใส่เองบน server) |
| C3 | compose nginx (เฉพาะ stack ที่ไม่ใช่ `*.no-nginx.yml`) | `nginx/sync.conf` | รับ `sync.*` แล้วส่งไป CouchDB | [`nginx/sync.conf`](../../nginx/sync.conf) (อยู่ใน repo แล้ว) |
| C4 | CouchDB central | user `repl_sh001` + role ใน `_security` | credential ที่ edge ใช้ ซึ่งไม่ใช่ admin | §3.4 |
| E1 | server B | compose ของ edge | CouchDB + SPA + nginx ที่ศูนย์ | [`docker-compose.edge.yml`](../../docker-compose.edge.yml) |
| E2 | server B | nginx ของ edge | `/couch` + SPA บน LAN โดยไม่มี FastAPI | [`nginx-edge/default.conf`](../../nginx-edge/default.conf) |
| E3 | server B | config CouchDB ของ edge | secret ของตัวเอง + ตรวจ cert ของ central | [`couchdb-edge-example.ini`](../../couchdb-edge-example.ini) |
| E4 | server B | `.env` ของ edge | รหัสศูนย์, URL sync, credential | [`.env.edge.example`](../../.env.edge.example) |
| E5 | CouchDB edge | DB + `_security` + guard + replication job | สิ่งที่ replicate มาเองไม่ได้ และตัว job | [`scripts/edge-init.sh`](../../scripts/edge-init.sh) |

---

## 3. Central (server A) — เพิ่มเข้า stack เดิม

### 3.1 C1 — hostname สำหรับ sync

**เพิ่ม:** DNS A record `sync.example.com` → public IP ของ server A แล้วออก cert

```bash
sudo certbot certonly --nginx -d sync.example.com
```

**ทำไมไม่ใช้ `https://app.example.com/couch/` ที่มีอยู่แล้ว:** ตอน WAN ขาด DNS ของ LAN ในศูนย์จะชี้ `app.example.com`
มาที่ edge (OD-2) container ของ edge ใช้ DNS เดียวกัน job จะวิ่งเข้า `/couch` ของ edge เอง แล้ว replicate
วนเข้า DB ตัวเองโดย **ไม่มี error ให้เห็น** — hostname `sync.*` ต้องเป็นชื่อที่ LAN DNS ไม่ override

📖 [Certbot nginx](https://eff-certbot.readthedocs.io/en/stable/using.html#nginx) ·
[Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)

### 3.2 C2 — host nginx: server block ของ `sync.example.com`

staging / production (Jenkins) deploy ด้วย `*.no-nginx.yml` — ไม่มี compose nginx, **host nginx** ถือ TLS และ proxy
ตรงไปที่ port ของ container (CouchDB bind `COUCHDB_BIND_IP:COUCHDB_PORT` = `127.0.0.1:5984`)
จึงเพิ่ม server block ที่ host nginx — ตัวเต็มอยู่ใน [README root "Edge @ศูนย์"](../../README.md)

```nginx
server {
    listen 443 ssl;
    server_name sync.example.com;                                         # (1)
    ssl_certificate     /etc/letsencrypt/live/sync.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.example.com/privkey.pem;
    client_max_body_size 64M;                                             # (2)

    location /_utils { return 404; }                                      # (3)

    location / {
        proxy_pass http://127.0.0.1:5984;                                 # (4)
        proxy_set_header Host $host;                                      # (5)
        proxy_buffering off;                                              # (6)
        proxy_read_timeout 300s;                                          # (7)
    }
}
```

| # | บรรทัด | ใช้ทำอะไร / ถ้าไม่ใส่จะเกิดอะไร |
| --- | --- | --- |
| 1 | `server_name sync.example.com` | แยก traffic ของ replication ออกจากแอป (§3.1) |
| 2 | `client_max_body_size 64M` | replicator ส่ง `_bulk_docs` ทีละ 500 doc — ถ้าเล็กไป job จะได้ `413` แล้ว `crashing` |
| 3 | ปิด `/_utils` | replication ไม่ใช้ Fauxton ไม่ต้องเปิดเพิ่มอีกช่องทาง |
| 4 | `proxy_pass http://127.0.0.1:5984` | ส่งตรงไป CouchDB ไม่ตัด path (`/shelter_sh001/_changes`) — ต่างจาก `/couch/` ของแอปที่ตัด prefix ออก · stack ที่มี compose nginx ให้ชี้ `127.0.0.1:80` แทน (§3.3) |
| 5 | `proxy_set_header Host $host` | ให้ CouchDB / compose nginx เห็น hostname จริง — กรณี compose nginx ถ้าไม่ส่งต่อจะตกไป block ของแอปและได้ HTML ของ SPA แทน JSON |
| 6 | `proxy_buffering off` | `_changes` แบบ continuous ต้องส่งต่อทันที — ถ้า buffer ข้อมูลจะมาช้าหรือค้าง |
| 7 | `proxy_read_timeout 300s` | default 60s สั้นไปสำหรับ request ที่ค้างรอ `_changes` |

```bash
sudo nginx -t && sudo systemctl reload nginx
```

📖 [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) ·
[`client_max_body_size`](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size) ·
[CouchDB reverse proxies](https://docs.couchdb.org/en/stable/best-practices/reverse-proxies.html)

### 3.3 C3 — compose nginx: [`nginx/sync.conf`](../../nginx/sync.conf) (เฉพาะ stack ที่มี compose nginx)

ใช้กับ `docker-compose.{staging,production}.yml` (ไม่ใช่ `*.no-nginx.yml`) ซึ่ง host nginx ส่งทุกอย่างไป
compose nginx ที่ `127.0.0.1:80` — **อยู่ใน repo แล้ว** ไม่ต้องทำอะไรเพิ่มนอกจากให้ host nginx (C2) ชี้ `127.0.0.1:80`

| จุด | ทำไม |
| --- | --- |
| **ไฟล์แยก ไม่แก้ `nginx.conf`** | compose mount `./nginx` ทั้งโฟลเดอร์เป็น `conf.d` · `sync.conf` เรียงหลัง `nginx.conf` ทำให้ block เดิม (`server_name _`) ยังเป็น default |
| `server_name ~^sync\.` | รับทุก hostname ที่ขึ้นต้นด้วย `sync.` จึงไม่ต้อง hardcode domain ใน repo · stack ที่ไม่มี host ชื่อนี้จะไม่ได้รับผลอะไร |
| `proxy_pass http://couchdb:5984` + buffering / body / timeout / `/_utils` | เหตุผลเดียวกับ C2 — **ต้องตั้งทั้ง 2 ชั้น** ชั้นไหนเล็กกว่าจะเป็นตัวจำกัด |

📖 [nginx เลือก server block จาก `Host`](https://nginx.org/en/docs/http/request_processing.html)

### 3.4 C4 — replication user ของศูนย์

**เพิ่ม:** user `repl_sh001` (role `repl:SH001`) และเพิ่ม role นี้ใน `_security.members` ของ `registry`, `catalog`, `shelter_sh001`

```bash
export C=http://admin:<COUCHDB_PASSWORD>@127.0.0.1:5984    # no-nginx stack (compose-nginx stack: 127.0.0.1/couch)

curl -s -X PUT "$C/_users/org.couchdb.user:repl_sh001" -H 'Content-Type: application/json' \
  -d '{"name":"repl_sh001","password":"<pw>","type":"user","roles":["repl:SH001"]}'; echo

add_member_role() { # add_member_role <db> <role> — อ่าน _security เดิม เพิ่ม role แล้วเขียนกลับ
  curl -s "$C/$1/_security" | python3 -c '
import sys, json
sec = json.load(sys.stdin) or {}
roles = sec.setdefault("members", {}).setdefault("roles", [])
if sys.argv[1] not in roles:
    roles.append(sys.argv[1])
print(json.dumps(sec))' "$2" \
  | curl -s -X PUT "$C/$1/_security" -H 'Content-Type: application/json' -d @-; echo
}
for DB in registry catalog shelter_sh001; do add_member_role "$DB" repl:SH001; done
```

| เรื่อง | ทำไม |
| --- | --- |
| ไม่ใช้ central admin | รหัสผ่านใน `_replicator` ของ edge เก็บเป็น **plaintext** บนเครื่องที่ตั้งในศูนย์ ถ้าเครื่องหาย admin ของทั้งระบบหลุดไปด้วย |
| ต้องเป็น member ของ DB | job อ่าน/เขียนผ่าน HTTP ด้วยสิทธิ์ของ user นี้ CouchDB ตรวจ `_security.members` เหมือน client ทั่วไป |
| **ห้าม PUT `_security` ทับ** | `_security` ของ stack จริงมี member อื่นอยู่แล้ว (เช่น `public_writer` ที่ provisioning ใส่) PUT ทับจะลบทิ้ง · ทำตอนไม่มีใครกำลังเปิดหรือแก้ศูนย์ผ่านแอป เพราะ [`shelters.admin.ts`](../../frontend/src/lib/server/shelters.admin.ts) ก็แก้ `_security` แบบเดียวกัน |
| job `_users` ยังใช้ user นี้ไม่ได้ | user ทั่วไปอ่าน doc ของคนอื่นใน `_users` ไม่ได้ จึงยังต้องใช้ central admin (คำถามเปิด §7, README T11) |

📖 [`/{db}/_security`](https://docs.couchdb.org/en/stable/api/database/security.html) ·
[`_users` / security](https://docs.couchdb.org/en/stable/intro/security.html)

### 3.5 สิ่งที่ **ไม่ต้อง** แก้ที่ central

| ส่วน | ทำไมไม่ต้องแก้ |
| --- | --- |
| service `couchdb` | ไม่ต้องเปิด port เพิ่ม — replication เข้ามาทาง host nginx (bind `127.0.0.1` เหมือนเดิม) |
| `couchdb-session.ini` | `secret` ของ central คงเดิม — edge ใช้ `secret` ของตัวเอง (ทำให้ต้อง login ใหม่ตอน cutover ซึ่งรับได้ตาม OD-3) |
| `/couch` ของแอป (host nginx / `nginx.conf`) | แอปยังใช้ตามเดิม |
| frontend / fastapi / worker | replication เป็นเรื่องระหว่าง CouchDB กับ CouchDB แอปไม่เกี่ยว |
| staff user | user ที่มี role `shelter:SH001` อยู่แล้วจะถูก sync ลง edge เอง |

---

## 4. Edge (server B @ศูนย์) — เครื่องใหม่

ตั้งต้นจาก `docker-compose.production.yml` ที่ root แล้วตัดส่วนที่ edge ไม่มีออกตาม OD-1

### 4.1 E1 — compose ของ edge

ไฟล์: [`docker-compose.edge.yml`](../../docker-compose.edge.yml) — บน edge server ให้ clone repo แล้วรันจาก root

| service | เก็บ / ตัด | ทำไม |
| --- | --- | --- |
| `couchdb` | เก็บ | ตัวรับข้อมูลที่ศูนย์ + ที่อยู่ของ replication job |
| `couchdb-init` | เก็บ | สร้าง `_users`, `_replicator` (single node) |
| `edge-init` | **เพิ่ม** | provision DB + `_security` + job (§4.5) |
| `frontend` | เก็บ | staff ใช้แอปบน LAN ตอน WAN ขาด |
| `nginx` | เก็บ (config ใหม่ §4.2) | `/couch` + SPA ให้ browser ในศูนย์ |
| `mongodb`, `worker`, `fastapi` | ตัด | public plane อยู่ที่ central เท่านั้น (OD-1) |
| `import-worker` | ตัด | import ศูนย์เป็นงานของ central |

จุดที่เปลี่ยนจาก production:

| จุด | เปลี่ยนเป็น | ทำไม |
| --- | --- | --- |
| `couchdb` ports | `127.0.0.1:${EDGE_COUCHDB_PORT:-5984}` | ให้ admin ใช้จาก shell ของ server B เท่านั้น staff เข้าผ่าน nginx `/couch` |
| `couchdb` volumes | data `../deployment/tent-edge/couchdb/data` · ini `./couchdb-edge.ini` | **ห้ามใช้ `couchdb-session.ini` ของ central** — ไฟล์นั้นฝัง hash ของ admin และ `secret` ของ central (§4.3) |
| `couchdb` container_name | `couch-edge` | ชื่อที่คำสั่งทดสอบใน README §5 ใช้ |
| `frontend` `depends_on` | ไม่มี `fastapi` | ไม่มี service นี้ — compose จะ start ไม่ได้ |
| `frontend` env | เหลือ `ORIGIN`, `COUCHDB_ADMIN_URL` (ชี้ CouchDB ของ edge) | ตัด `FASTAPI_INTERNAL_URL`, `EXTERNAL_API_SECRET`, `COUCHDB_PUBLIC_WRITER_URL`, `SHELTER_IMPORT_WORKER_TOKEN`, OAuth — env พวกนี้ถูกอ่านตอนเรียก route เท่านั้น แอปจึง start ได้ และ route ของ public plane จะ fail ตามโหมด degraded |
| `PUBLIC_ORIGIN` | domain เดียวกับ central | cutover ทำที่ DNS — browser ยังเปิด URL เดิม |
| `nginx` ports | `${EDGE_LAN_IP}:80` | ให้เครื่องในศูนย์เข้าได้ ไม่เปิดออก WAN |
| `nginx` volume | `./nginx-edge` | §4.2 |

### 4.2 E2 — nginx ของ edge

ไฟล์: [`nginx-edge/default.conf`](../../nginx-edge/default.conf) — copy `nginx/nginx.conf` แล้วเปลี่ยน 1 จุด:

```nginx
location /external/ {
    default_type application/json;
    return 503 '{"error":"unavailable","reason":"edge-only mode: external API is served by central"}';
}
```

**ทำไม:** `nginx.conf` เดิม proxy `/external/` ไป `fastapi:9000` ซึ่งไม่มีที่ edge — nginx resolve ชื่อ upstream
ตอน start ถ้าหาไม่เจอจะ **start ไม่ขึ้นทั้งตัว** (`host not found in upstream "fastapi"`)
และต้องเป็นโฟลเดอร์แยก (`nginx-edge/`) เพราะ compose mount ทั้งโฟลเดอร์เป็น `conf.d`

### 4.3 E3 — config CouchDB ของ edge

ไฟล์: [`couchdb-edge-example.ini`](../../couchdb-edge-example.ini) → copy เป็น `couchdb-edge.ini` (อยู่ใน `.gitignore` — คู่กับ `couchdb-session-example.ini` ของ central)

```ini
[chttpd_auth]
timeout = 86400
allow_persistent_cookies = true
secret = <openssl rand -hex 16>          ; (1)

; (2) ไม่มี [admins]

[replicator]
verify_ssl_certificates = true            ; (3)
ssl_trusted_certificates_file = /etc/ssl/certs/ca-certificates.crt
```

| # | ส่วน | ทำไม |
| --- | --- | --- |
| 1 | `secret` ของ edge เอง | ใช้เซ็น cookie `AuthSession` — ต่างจาก central ทำให้ cookie ข้ามฝั่งไม่ได้ (ต้อง login ใหม่ตาม OD-3 ซึ่งทดสอบแล้วว่าเป็นแบบนั้น) ถ้าใช้ค่าเดียวกัน cookie ของ edge จะใช้ที่ central ได้ด้วย · BFF ของ edge อ่านค่านี้ผ่าน admin API เพื่อ mint session |
| 2 | ไม่มี `[admins]` | admin ของ edge มาจาก `COUCHDB_USER` / `COUCHDB_PASSWORD` ใน `.env` — คนละรหัสกับ central |
| 3 | `verify_ssl_certificates = true` | default ของ CouchDB 3.5 คือ `false` = **ไม่ตรวจ cert** ของ central เลย ทำให้ถูกดักกลางทางได้ · CA bundle มีอยู่ใน image แล้ว |

ค่าเสริมใน `[replicator]` เมื่อ WAN ของศูนย์ช้า: `connection_timeout` (30000 ms), `retries_per_request` (5),
`worker_batch_size` (500 — ลดแล้ว body เล็กลง checkpoint ถี่ขึ้น), `checkpoint_interval` (30000 ms)

> container จะ `chown` ไฟล์นี้เป็น uid 5984 (เหมือน `couchdb-session.ini` ของ central)

📖 [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html) ·
[`[replicator]`](https://docs.couchdb.org/en/stable/config/replicator.html)

### 4.4 E4 — `.env` ของ edge

ไฟล์ตัวอย่าง: [`.env.edge.example`](../../.env.edge.example) → copy เป็น `.env` บน edge server

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `COUCHDB_USER` / `COUCHDB_PASSWORD` | admin ของ CouchDB ที่ edge (คนละรหัสกับ central) |
| `SHELTER_CODE` | ศูนย์ที่ edge นี้ดูแล → DB `shelter_<code ตัวเล็ก>`, role `shelter:<CODE>`, ชื่อ job |
| `SYNC_URL` | `https://sync.example.com` (C1) — **ห้ามใช้ domain แอป** |
| `CENTRAL_REPL_USER` / `_PASSWORD` | `repl_sh001` (C4) สำหรับ `registry`, `catalog`, `shelter_*` |
| `CENTRAL_USERS_REPL_USER` / `_PASSWORD` | credential สำหรับ job `_users` (ตอนนี้ต้องเป็น central admin) — เว้นว่าง = ไม่สร้าง job นี้ และ staff จะ login ที่ edge ไม่ได้ |
| `PUBLIC_ORIGIN` | domain แอป (เหมือน central) |
| `EDGE_LAN_IP`, `EDGE_HTTP_PORT` | IP/port ฝั่ง LAN ที่ nginx ของ edge รับ |
| `FRONTEND_IMAGE` | ใช้ image ที่ build ไว้แล้วแทนการ build ใหม่ |
| `EDGE_COUCHDB_PORT`, `EDGE_COUCHDB_DATA` | admin port (127.0.0.1) และ data dir ของ CouchDB edge |

ห้ามใช้ `"` หรือ `\` ในรหัสผ่าน เพราะ `scripts/edge-init.sh` ประกอบ JSON เอง

### 4.5 E5 — provisioning บน CouchDB ของ edge

[`scripts/edge-init.sh`](../../scripts/edge-init.sh) รันอัตโนมัติตอน `up` (service `edge-init` หลัง `couchdb-init`) และรันซ้ำได้ ทำ 3 อย่าง:

**1) สร้าง DB + `_security`** — `registry`, `catalog`, `shelter_sh001` ด้วย
`members.roles = ["shelter:SH001"]`, `admins.roles = ["system_admin"]` (data-model §6)
- ทำไม: `_security` ไม่ replicate ถ้าปล่อยให้ job สร้าง DB เอง (`create_target`) DB จะไม่มี `_security`
  และ staff ทุกคน (รวมศูนย์อื่น) จะเข้าได้

**2) `_design/edge_readonly` บน `registry` / `catalog`** — `validate_doc_update` ที่ยอมให้เขียนเฉพาะ `_admin`
- ทำไม: 2 DB นี้เป็นทางเดียว (central → edge) ถ้า staff เขียนที่ edge ได้ ข้อมูลจะไม่กลับ central และไม่มีใครรู้
- ยอม `_admin` เพราะ replicator ฝั่ง edge เขียนด้วย admin · design doc นี้อยู่ที่ edge เท่านั้นเพราะ job เป็น pull อย่างเดียว

**3) replication job 5 ตัวใน `_replicator`** (`continuous: true` — อยู่รอดหลัง restart)

| job | จาก → ไป | credential ฝั่ง central | ใช้ทำอะไร |
| --- | --- | --- | --- |
| `registry_pull` | central → edge | `repl_sh001` | ข้อมูลศูนย์ / master data ให้อ่านตอน WAN ขาด |
| `catalog_pull` | central → edge | `repl_sh001` | catalog ของ supply |
| `sh001_pull` | central → edge | `repl_sh001` | ข้อมูลศูนย์ที่ถูกเขียนที่ central |
| `sh001_push` | edge → central | `repl_sh001` | ข้อมูลที่เขียนที่ edge ตอน WAN ขาด (backlog) |
| `users_sh001_pull` | central → edge, `selector` role `shelter:SH001` | central admin | ให้ staff ของศูนย์นี้ login ที่ edge ได้ · `selector` กรองที่ central จึงไม่ส่ง user ศูนย์อื่นมาเลย |

- URL ฝั่ง edge ใน job คือ `http://127.0.0.1:5984` เพราะ job รัน **ภายใน container CouchDB** เอง
- ถ้าจะเปลี่ยน credential ของ job: ลบ doc ใน `_replicator` (§6) แล้วรัน `edge-init` ใหม่ — script ข้าม doc ที่มีอยู่แล้ว

📖 [Replicator database](https://docs.couchdb.org/en/stable/replication/replicator.html) ·
[Selector objects](https://docs.couchdb.org/en/stable/replication/replicator.html#selectorobj) ·
[Validate document update](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions)

---

## 5. ลำดับการติดตั้งและจุดตรวจ

ทำตามลำดับ และตรวจให้ผ่านก่อนไปขั้นถัดไป

| ขั้น | ทำ | ตรวจ | ต้องได้ |
| --- | --- | --- | --- |
| 1 | C1 DNS + cert | `dig +short sync.example.com` | IP ของ server A |
| 2 | C2 + C3 nginx | จากเครื่องนอก A: `curl -s https://sync.example.com/_up` | `{"status":"ok",...}` (ถ้าได้ HTML = `Host` ไม่ถูกส่งต่อ) |
| 3 | C4 replication user | `curl -s -u repl_sh001:<pw> https://sync.example.com/shelter_sh001` | JSON ข้อมูล DB (ไม่ใช่ `unauthorized`) |
| 4 | E3 + E4 บน server B (root ของ repo) | `cp .env.edge.example .env`, `cp couchdb-edge-example.ini couchdb-edge.ini` แล้วแก้ค่า | — |
| 5 | E1 `up -d` | `docker logs couch-edge-provision` | ทุกบรรทัด `ok` หรือ `exists` |
| 6 | job | `curl -s $E/_scheduler/docs/_replicator` | ทั้ง 5 ตัว `"state":"running"` — หลัง `up` ครั้งแรกรอ ~30 วินาที (replicator ยังไม่หยิบ job ช่วงแรก รายการจะว่าง) |
| 7 | sync 2 ทาง | เขียน doc ทดสอบที่ central และที่ `http://<EDGE_LAN_IP>/couch/` | อีกฝั่งเห็นภายในไม่กี่วินาที |
| 8 | login ที่ edge | `POST http://<EDGE_LAN_IP>/couch/_session` ด้วย staff ของศูนย์ | `"ok":true` · staff ศูนย์อื่นไม่มีใน `_users` ของ edge |
| 9 | guard | staff `PUT` ลง `registry` ที่ edge | `forbidden` |

`$E=http://<COUCHDB_USER>:<COUCHDB_PASSWORD>@localhost:5984` บน server B (`EDGE_COUCHDB_PORT`) · จากนั้นทดสอบ WAN ขาด / conflict ตาม [README §4–§5](README.md)

> ผลจำลองบนเครื่องเดียว (2026-10-01, ไม่มี TLS): ขั้น 2–3 และ 5–9 ผ่านด้วยไฟล์จริงใน repo (`nginx/nginx.conf` + `nginx/sync.conf` ฝั่ง central, `docker-compose.edge.yml` ทั้งชุดฝั่ง edge)
> ยังไม่ได้ทดสอบ: cert จริง + `verify_ssl_certificates`, DNS / NAT จริง

---

## 6. งานประจำ / แก้ปัญหา

```bash
curl -s "$E/_scheduler/jobs"                   # job + history (error ล่าสุด)
curl -s "$E/_active_tasks"                     # docs_read / docs_written / changes_pending
docker logs couch-edge 2>&1 | grep -i replicat

kick() { # kick <doc-id> — ลบ job แล้วรัน edge-init ใหม่ เพื่อเริ่มทันที (ข้าม backoff) หรือเปลี่ยน credential
  local rev=$(curl -s "$E/_replicator/$1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_rev"])')
  curl -s -X DELETE "$E/_replicator/$1?rev=$rev"; echo
}
# แล้ว: docker compose -f docker-compose.edge.yml run --rm edge-init   (checkpoint ยังอยู่ ไม่ไล่ใหม่ทั้งหมด)
```

| อาการ | สาเหตุ | แก้ |
| --- | --- | --- |
| `crashing` + `unauthorized` | credential ผิด / user ไม่อยู่ใน `_security.members` ของ central | C4, `.env` |
| `crashing` + `nxdomain` / `econnrefused` | `SYNC_URL` ผิด หรือ container edge resolve ไม่ได้ | C1, `.env` |
| `crashing` + error certificate | cert ยังไม่ออก หรือนาฬิกา edge เพี้ยน | C1, NTP (README T10b) |
| ได้ HTML แทน JSON | host nginx ไม่ส่ง `Host` / `server_name` ไม่ตรง | C2 (4), C3 (1) |
| `413` ใน history ของ job | `client_max_body_size` ชั้นใดชั้นหนึ่งเล็กไป | C2 + C3 หรือลด `worker_batch_size` |
| doc มาช้าเป็นนาที | nginx buffer `_changes` | `proxy_buffering off` ทั้ง 2 ชั้น |
| `running` แต่ doc ไม่ถึง central | `SYNC_URL` เป็น domain แอปที่ถูก cutover | C1 |
| staff login ที่ edge ไม่ได้ | ไม่ได้ตั้ง `CENTRAL_USERS_REPL_USER` หรือ CouchDB คนละ version | E4, ใช้ `couchdb:3.5` ทั้งสองฝั่ง |
| nginx edge start ไม่ขึ้น `host not found in upstream` | ใช้ `nginx/` ของ central | E2 |

📖 [Replication states](https://docs.couchdb.org/en/stable/replication/replicator.html#replication-states) ·
[`/_scheduler/*`, `/_active_tasks`](https://docs.couchdb.org/en/stable/api/server/common.html)

---

## 7. คำถามเปิด และการถอดออก

**ต้องตัดสินใจ (ไม่ใช่แค่ config):**

1. **cert ของ domain แอปที่ edge** — ตอน cutover browser ยังเปิด `https://app.example.com` แต่ถูกชี้มาที่ edge
   edge จึงต้องมี cert ที่ valid ของ domain แอป **ตอน WAN ขาด** ไม่อย่างนั้น browser บล็อกและ cookie / PWA ใช้ไม่ได้
   ทางเลือก: ออก cert ด้วย DNS-01 ที่ central แล้ว sync ไฟล์ลง edge เป็นระยะ หรือ internal CA
   (ต้องลง CA ทุกเครื่องในศูนย์) — `nginx-edge` ตอนนี้ฟังแค่ :80 · ยังไม่มีใน
   [gap checklist §7.A](../../docs/features/edge-disaster-continuity-idea.md)
2. **credential ของ job `_users`** — ยังต้องเป็น central admin (README T11)
3. **CR-064 ยังรอ owner approve** — ไฟล์ edge / `nginx/sync.conf` ใน repo เป็นส่วนของ work package 3 ต้องผ่าน review ก่อน deploy

ถ้าต้องแก้ spec ให้ทำตาม [`docs/change-management.md`](../../docs/change-management.md) — ถามเจ้าของโครงการก่อนว่าจะ track แบบไหน

**ถอดออกหลังทดสอบ:**

- server B: `docker compose -f docker-compose.edge.yml down` (ลบ `../deployment/tent-edge/` ถ้าจะล้างข้อมูล)
- server A: ลบ server block `sync.*` ใน host nginx แล้ว reload · ลบ DNS record ·
  ลบ user `repl_sh001` และ role `repl:SH001` ออกจาก `_security`

---

## 8. แหล่งอ้างอิง

### ในโปรเจกต์

| เอกสาร | ใช้ดูอะไร |
| --- | --- |
| [`docs/data/data-model.md` §1, §5, §6](../../docs/data/data-model.md) | topology, conflict policy, `_security` / `_users` / VDU |
| [`docs/data/api-contract.md` §1](../../docs/data/api-contract.md) | ลำดับ endpoint และกฎเขียนได้ทีละฝั่ง |
| [`docs/changes/CR-064-edge-disaster-continuity.md`](../../docs/changes/CR-064-edge-disaster-continuity.md) | OD-1..OD-5 |
| [`docs/features/edge-disaster-continuity-idea.md` §7](../../docs/features/edge-disaster-continuity-idea.md) | gap checklist |
| [`docker-compose.production.no-nginx.yml`](../../docker-compose.production.no-nginx.yml) · [`nginx/nginx.conf`](../../nginx/nginx.conf) · [`couchdb-session-example.ini`](../../couchdb-session-example.ini) | stack ของ central ที่ใช้ตั้งต้น |
| [README root "Edge @ศูนย์"](../../README.md) | สรุปสั้น + host nginx config ฉบับเต็ม |
| [README.md](README.md) | คำถามที่ POC ต้องตอบ, test T1–T11, ตารางบันทึกผล |

> api-contract / data-model บางส่วนยังเขียนแบบ app สลับ endpoint เอง (ยังไม่ reconcile ตาม CR-064) ถ้าขัดกันให้ยึด CR-064

### CouchDB (3.x)

| หัวข้อ | ลิงก์ |
| --- | --- |
| Replication intro / protocol | https://docs.couchdb.org/en/stable/replication/intro.html · https://docs.couchdb.org/en/stable/replication/protocol.html |
| Replicator database, scheduler, selector, states | https://docs.couchdb.org/en/stable/replication/replicator.html |
| Conflicts | https://docs.couchdb.org/en/stable/replication/conflicts.html |
| `/_scheduler/*`, `/_active_tasks`, `/_cluster_setup` | https://docs.couchdb.org/en/stable/api/server/common.html |
| `[replicator]` config | https://docs.couchdb.org/en/stable/config/replicator.html |
| `[chttpd_auth]` (secret, cookie) | https://docs.couchdb.org/en/stable/config/auth.html |
| `/{db}/_security` | https://docs.couchdb.org/en/stable/api/database/security.html |
| Security overview, `_users` | https://docs.couchdb.org/en/stable/intro/security.html |
| `/_session` | https://docs.couchdb.org/en/stable/api/server/authn.html |
| Validate document update | https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions |
| Reverse proxies | https://docs.couchdb.org/en/stable/best-practices/reverse-proxies.html |

### nginx / TLS / infra

| หัวข้อ | ลิงก์ |
| --- | --- |
| nginx proxy module | https://nginx.org/en/docs/http/ngx_http_proxy_module.html |
| nginx `client_max_body_size` | https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size |
| nginx เลือก server block | https://nginx.org/en/docs/http/request_processing.html |
| Certbot (nginx) | https://eff-certbot.readthedocs.io/en/stable/using.html#nginx |
| Let's Encrypt challenge types | https://letsencrypt.org/docs/challenge-types/ |
| Docker Compose `.env` | https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ |
