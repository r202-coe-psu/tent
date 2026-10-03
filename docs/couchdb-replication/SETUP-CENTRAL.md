# Setup Central — ฝั่งที่ edge มา sync ด้วย

คู่มือนี้ใช้กับ **เครื่อง central เท่านั้น** (เครื่องที่รัน CouchDB หลักของระบบ) ทำตามลำดับ และตรวจให้ผ่านก่อนไปขั้นถัดไป
ฝั่ง edge อยู่ที่ [SETUP-EDGE.md](SETUP-EDGE.md) · หลักการและเหตุผลของการออกแบบอยู่ที่ [README.md §2](README.md)

> **หลักการข้อเดียวที่ต้องจำ:** edge เป็นฝ่ายเปิด connection หา central เสมอ (edge อยู่หลัง NAT ของศูนย์)
> central จึงไม่ต้องรู้จัก edge ไม่ต้องตั้ง job replication อะไรเลย — หน้าที่ของ central มี 3 อย่าง:
> **(1) มีข้อมูลศูนย์ให้ดึง (2) มี user ที่ edge ใช้ล็อกอินได้ (3) เปิดทางให้ edge เข้ามาถึง CouchDB**

## 0. เลือกแบบที่จะทำ

| | **Lab** (ทดลอง ไม่มี cert) | **จริง** (staging / production) |
| --- | --- | --- |
| central คือ | laptop / mini PC ที่รัน dev stack (`docker-compose.yml`) | server ที่ deploy ด้วย `docker-compose.{staging,production}[.no-nginx].yml` |
| edge เข้าถึงด้วย | `http://<IP ของ central>:5984` ตรง ๆ | `https://<domain>/sync` ผ่าน nginx เดิมของแอป |
| ต้องมี DNS / cert เพิ่ม | ไม่ต้อง | ไม่ต้อง (ใช้ domain และ cert ของแอปที่มีอยู่) |
| ต้องทำขั้น | 1 → 2 → 3 → 4A → 5 | 1 → 2 → 3 → 4B → 5 |
| ความเสี่ยง | รหัสผ่านและข้อมูลวิ่งแบบไม่เข้ารหัส ใช้ได้เฉพาะ LAN ที่เชื่อถือได้ | — |

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
(user เหล่านี้จะถูก filtered-replicate ลง edge เพื่อให้ staff login ที่ edge ได้ตอน WAN ขาด)

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

## ขั้น 3 — สร้าง replication user ของศูนย์

**ทำไมไม่ใช้ admin ของ central:** รหัสผ่านที่ใส่ใน job ของ edge ถูกเก็บใน `_replicator` เป็น **plaintext**
บนเครื่องที่ตั้งในศูนย์ ถ้าเครื่อง edge หายหรือถูกเปิด รหัสผ่านนั้นต้องไม่ใช่กุญแจของทั้งระบบ
user นี้จึงถูกจำกัดให้เห็นแค่ `registry`, `catalog` และ DB ของศูนย์ตัวเอง

### วิธีที่แนะนำ: สคริปต์เดียวจบ

```bash
# จาก root ของ repo ที่ central (อ่านรหัส admin จาก .env เอง หรือใช้ COUCHDB_PASSWORD / --url)
scripts/central-repl-user.sh SH001
```

สคริปต์ [`scripts/central-repl-user.sh`](../../scripts/central-repl-user.sh) ทำทุกอย่างที่เขียนไว้ด้านล่างให้ในคำสั่งเดียว:
สร้าง `repl_sh001` ด้วยรหัสผ่านสุ่ม → เพิ่ม role ลง `_security` ของ 3 DB (อ่านของเดิมมาเพิ่ม ไม่ลบ member เดิม) →
ทดสอบด้วย user นั้นเอง (3 DB ต้อง 200, `_users` ต้อง 403) → พิมพ์ค่าที่ต้องใส่ใน `.env` ของ edge **ครั้งเดียว**

| คำสั่ง | ทำอะไร |
| --- | --- |
| `scripts/central-repl-user.sh SH001` | สร้าง (ถ้ามีอยู่แล้วจะไม่เปลี่ยนรหัสผ่าน รันซ้ำได้) |
| `scripts/central-repl-user.sh SH001 --rotate` | ตั้งรหัสผ่านใหม่ (ใส่ `--password PW` เพื่อกำหนดเอง) · job ที่ edge ที่ถือรหัสเก่าอยู่ต้อง "เตะ" ใหม่ |
| `scripts/central-repl-user.sh SH001 --remove` | ลบ user และถอด role ออกจาก `_security` |
| `--url http://host:5984` | ชี้ CouchDB อื่น (default `COUCHDB_URL` หรือ `http://localhost:5984`) |

- ต้องมี DB `registry`, `catalog`, `shelter_<code>` อยู่แล้ว (เปิด/seed ศูนย์ก่อน) ไม่งั้นสคริปต์หยุดพร้อมบอก
- ต้องมี `curl` และ `python3` · รหัสผ่านห้ามมีช่องว่าง `"` หรือ `\`
- หลัง `--rotate` รหัสใหม่ใช้ได้ช้าราว 2–3 วินาที (cache ของ CouchDB) สคริปต์รอให้เอง
- **`--rotate` ทำให้ edge ที่ใช้รหัสเก่าอยู่ sync ไม่ได้ทันที** และ job ที่ retry ด้วยรหัสผิดจะโดนล็อกเอาต์ (403) ราว 5 นาที — หมุนรหัสแล้วต้องอัปเดต `.env` ของ edge และ "เตะ" job ทันที (SETUP-EDGE.md)
- **ทดสอบแล้ว** บน CouchDB 3.5 ชั่วคราว: create / รันซ้ำ / rotate / custom password / remove / DB ไม่มี / รหัส admin ผิด / ชื่อศูนย์ผิดรูปแบบ — `public_writer` และ member เดิมคงอยู่ทุกกรณี

### สิ่งที่สคริปต์ทำเบื้องหลัง (ทำมือ / อ่านเพื่อเข้าใจ)

```bash
CODE=SH001
code=$(printf '%s' "$CODE" | tr 'A-Z' 'a-z')
REPL_USER="repl_$code"
REPL_PW='<ตั้งรหัสผ่านใหม่>'          # ห้ามมี " หรือ \  (edge ประกอบ JSON เอง)

# 1) สร้าง user — role repl:<CODE> ใช้เป็นป้ายใน _security
curl -s -X PUT "$C/_users/org.couchdb.user:$REPL_USER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$REPL_USER\",\"password\":\"$REPL_PW\",\"type\":\"user\",\"roles\":[\"repl:$CODE\"]}"; echo

# 2) เพิ่ม role นี้เป็น member ของ DB (อ่าน _security เดิม → เพิ่ม → เขียนกลับ)
add_member_role() { # add_member_role <db> <role>
  curl -s "$C/$1/_security" | python3 -c '
import sys, json
sec = json.load(sys.stdin) or {}
roles = sec.setdefault("members", {}).setdefault("roles", [])
if sys.argv[1] not in roles:
    roles.append(sys.argv[1])
print(json.dumps(sec))' "$2" \
  | curl -s -X PUT "$C/$1/_security" -H 'Content-Type: application/json' -d @-; echo
}
for DB in registry catalog "shelter_$code"; do add_member_role "$DB" "repl:$CODE"; done
```

**ห้าม PUT `_security` ทับตรง ๆ** — `_security` ของ DB จริงมี member อื่นอยู่แล้ว (เช่น `public_writer` ที่ provisioning ใส่)
PUT ทับจะลบทิ้ง ฟังก์ชัน `add_member_role` จึงอ่านของเดิมมาเพิ่มแล้วเขียนกลับ (เหมือน
[`shelters.admin.ts`](../../frontend/src/lib/server/shelters.admin.ts)) — ทำตอนไม่มีใครกำลังเปิดหรือแก้ศูนย์ผ่านแอป

**ตรวจ** (ผลที่ทดสอบแล้วบน CouchDB 3.5):

```bash
R=http://$REPL_USER:$REPL_PW@localhost:5984
for DB in registry catalog shelter_$code shelter_sh002 _users; do
  echo "$DB: $(curl -s -o /dev/null -w '%{http_code}' $R/$DB)"
done
# registry 200 · catalog 200 · shelter_sh001 200 · shelter_sh002 403 · _users 403
```

`_users` ได้ 403 เป็นเรื่องปกติ — user ทั่วไปอ่าน `_users` ไม่ได้ จึงยังต้องใช้ **central admin** กับ job `_users`
ของ edge (ข้อจำกัดที่รู้แล้ว — [README.md](README.md) หัวข้อ "คำถามเปิด" ข้อ 2)

📖 [`/{db}/_security`](https://docs.couchdb.org/en/stable/api/database/security.html) ·
[`_users` และการ auth](https://docs.couchdb.org/en/stable/intro/security.html)

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

| stack | nginx ที่ต้องแก้ | proxy_pass ไปที่ |
| --- | --- | --- |
| `*.no-nginx.yml` (Jenkins ใช้) | **host nginx** (นอก repo — ใส่เองบน server ใน server block ของ domain แอป) | `http://127.0.0.1:5984/` |
| `docker-compose.{staging,production}.yml` (มี nginx ใน compose) | [`nginx/nginx.conf`](../../nginx/nginx.conf) มี `location /sync/` อยู่แล้ว ไม่ต้องทำอะไร (ถ้ามี host nginx อยู่หน้า ให้ส่งต่อ `/sync/` ไปที่ nginx ใน compose ตามปกติ) | `couchdb:5984/` |

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

| # | บรรทัด | ทำไม / ถ้าไม่ใส่จะเกิดอะไร |
| --- | --- | --- |
| 1 | `client_max_body_size 64M` | replicator ส่ง `_bulk_docs` ทีละ 500 doc ค่าที่เล็กไป → `413` แล้ว job `crashing` (ค่า 10M ของแอปไม่พอ จึงตั้งเฉพาะ location นี้) |
| 2 | `proxy_pass …:5984/` **มี `/` ท้าย** | ตัด prefix `/sync` ออกก่อนส่งให้ CouchDB (เหมือน `/couch/` ของแอป) ทดสอบแล้วว่า doc id ที่มี `/` (`a%2Fb`) และ `_design/…` replicate ผ่าน |
| 3 | ปิด `/sync/_utils` | replication ไม่ใช้ Fauxton ไม่ต้องเปิดเป็นช่องทางเพิ่ม |
| 4 | `proxy_buffering off` | `_changes` แบบ continuous ต้องส่งต่อทันที ถ้า buffer ข้อมูลจะมาช้าหรือค้าง |
| 5 | `proxy_read_timeout 300s` | default 60s สั้นไปสำหรับ request ที่ค้างรอ `_changes` |

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

curl -s -u repl_sh001:'<รหัสผ่านขั้น 3>' <SYNC_URL>/shelter_sh001
# JSON ข้อมูล DB (doc_count ฯลฯ)  — ถ้า unauthorized = รหัสผิด / ขั้น 3 ไม่ครบ
```

ผ่านทั้ง 2 ข้อ = central พร้อม

---

## ค่าที่ต้องส่งให้ฝั่ง edge

| ค่า | ได้จาก | ใส่ใน `.env` ของ edge |
| --- | --- | --- |
| URL ของ central | ขั้น 4 | `SYNC_URL` |
| รหัสศูนย์ | ขั้น 2–3 | `SHELTER_CODE` (เช่น `SH001`) |
| replication user / password | ขั้น 3 | `CENTRAL_REPL_USER` / `CENTRAL_REPL_PASSWORD` |
| central admin / password (ใช้กับ job `_users`) | `.env` ของ central | `CENTRAL_USERS_REPL_USER` / `CENTRAL_USERS_REPL_PASSWORD` |

---

## สิ่งที่ **ไม่ต้อง** แก้ที่ central

| ส่วน | ทำไมไม่ต้องแก้ |
| --- | --- |
| service `couchdb` ใน compose | ไม่ต้องเปิด port เพิ่ม (จริง: เข้าทาง nginx · lab: dev stack เปิดอยู่แล้ว) |
| `couchdb-session.ini` / `secret` | edge ใช้ `secret` ของตัวเอง → cookie ข้ามฝั่งไม่ได้ ต้อง login ใหม่ตอน cutover (OD-3) |
| `/couch` ของแอป | แอปใช้ตามเดิม ไม่เกี่ยวกับ `/sync` |
| frontend / fastapi / worker | replication คือ CouchDB คุยกับ CouchDB แอปไม่เกี่ยว |
| job replication | อยู่ที่ edge ทั้งหมด |
| staff user | user ที่มี role `shelter:SH001` อยู่แล้วจะถูก sync ลง edge เอง |

---

## แก้ปัญหา (ฝั่ง central)

| อาการ | สาเหตุ | แก้ |
| --- | --- | --- |
| edge ต่อ `SYNC_URL` ไม่ติด (timeout / refused) | firewall, IP เปลี่ยน, port ไม่ได้ publish | ขั้น 4A / ตรวจ `ss -ltn \| grep 5984` |
| ได้ HTML ของ SPA แทน JSON | host nginx ไม่ส่ง `Host` หรือ `server_name` ไม่ตรง → ตกไป block ของแอป | ขั้น 4B ข้อ (1), (5) |
| `unauthorized` ทั้งที่รหัสถูก | user ไม่ใช่ member ของ DB | ขั้น 3 ดู `curl $C/shelter_sh001/_security` |
| job ของ edge ได้ `413` | `client_max_body_size` ชั้นใดชั้นหนึ่งเล็กไป | ขั้น 4B ข้อ (2) ทุกชั้น |
| sync ช้าเป็นนาที | nginx buffer `_changes` | `proxy_buffering off` ทุกชั้น |
| `_security` หายสมาชิกเดิม | ใช้ PUT ทับ | คืนค่าเดิมจาก backup / provisioning ของแอป แล้วใช้ `add_member_role` |

---

## ถอดออกหลังทดสอบ

```bash
# ลบ replication user และถอด role ออกจาก _security ของ registry / catalog / shelter_<code>
scripts/central-repl-user.sh SH001 --remove
```

จริง: ลบ `location /sync/` ใน host nginx แล้ว reload · Lab: ปิด firewall rule

---

## อ้างอิง

| เอกสาร | ใช้ดูอะไร |
| --- | --- |
| [`docs/data/data-model.md` §1, §6](../data/data-model.md) | topology และ `_security` / `_users` |
| [`docs/changes/CR-064-edge-disaster-continuity.md`](../changes/CR-064-edge-disaster-continuity.md) | OD-1..OD-5 |
| [`nginx/nginx.conf`](../../nginx/nginx.conf) | nginx ของ compose stack (`location /sync/`) |
| [Replication intro](https://docs.couchdb.org/en/stable/replication/intro.html) · [protocol](https://docs.couchdb.org/en/stable/replication/protocol.html) | หลักการ `_changes` / `_revs_diff` / `_bulk_docs` |
| [`/{db}/_security`](https://docs.couchdb.org/en/stable/api/database/security.html) | สิทธิ์ของ DB |
| [`[chttpd_auth]`](https://docs.couchdb.org/en/stable/config/auth.html) | secret และ cookie |
