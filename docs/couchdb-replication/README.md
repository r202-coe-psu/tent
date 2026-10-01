# POC — CouchDB replication ระหว่าง server (central ⇄ edge)

POC นี้ใช้ทดสอบว่า CouchDB 2 ตัว (**central** และ **edge @ศูนย์**) sync ข้อมูลกันได้ตามที่ออกแบบไว้ใน
[`docs/data/data-model.md` §1](../data/data-model.md) และ
[CR-064 edge disaster continuity](../changes/CR-064-edge-disaster-continuity.md)
ได้แก่ sync ปกติ, ตอน WAN ขาด, การไล่ backlog ตอน WAN กลับมา และ conflict

> 📘 คู่มือ setup แยกตามเครื่อง: [SETUP-CENTRAL.md](SETUP-CENTRAL.md) · [SETUP-EDGE.md](SETUP-EDGE.md)

> ⚠️ POC นี้ใช้ทดลองเท่านั้น ห้ามนำ credential / config ไปใช้ใน production
> และแยกจาก dev stack หลัก (`docker-compose.yml` ที่ root ใช้ port `5984`) — POC ใช้ port `5985` / `5986`

---

## 1. คำถามที่ POC ต้องตอบ

| #  | คำถาม                                                                                                               | ผลที่ต้องได้                                                                                             |
| -- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Q1 | central → edge sync`registry` / `catalog` แบบทางเดียว (one-way) ได้ไหม                             | doc ใหม่ที่ central ขึ้นที่ edge ภายในไม่กี่วินาที                                    |
| Q2 | `shelter_sh001` sync สองทาง (central ⇄ edge) ได้ไหม                                                       | เขียนฝั่งไหนก็เห็นทั้งสองฝั่ง                                                           |
| Q3 | `_users` แบบ filtered (เฉพาะ role `shelter:SH001`) ลง edge แล้ว login ที่ edge ได้ไหม         | `POST /_session` ที่ edge สำเร็จ, user ศูนย์อื่นไม่ถูก sync ลงมา                       |
| Q4 | ตอน WAN ขาด เขียนที่ edge ได้ แล้วพอ WAN กลับมา backlog ไหลกลับ central เองไหม | central ได้ doc ครบ โดยไม่ต้องสั่งอะไรเพิ่ม                                             |
| Q5 | ถ้าแก้ doc เดียวกันทั้งสองฝั่งช่วง WAN ขาด จะเกิดอะไร                          | ทั้งสองฝั่งได้ winner ตัวเดียวกัน และมี`_conflicts` ให้ repair job ตรวจเจอ |
| Q6 | client retry สร้าง doc ด้วย ULID`_id` เดิมข้ามฝั่ง จะเกิด doc ซ้ำไหม                  | ไม่มี doc ซ้ำ (ได้`_id` เดียว อาจมี conflict branch)                                          |
| Q7 | `_security` / design doc ถูก replicate ไปด้วยไหม                                                           | ต้องรู้ว่าอะไรต้อง provision แยก                                                                |
| Q8 | backlog ขนาดใหญ่ (เช่น 20,000 doc) ใช้เวลาไล่นานเท่าไร                                    | ได้ตัวเลขเวลาไว้วางแผนความจุ                                                             |

---

## 2. Topology ของ POC

```
            network: wan
   ┌──────────────────────────────┐
   │                              │
couch-central :5985         couch-edge :5986 ── network: lan
 (master)                    (replica @ศูนย์)
                              └─ _replicator  ← replication ทุกตัวรันฝั่ง edge
                                               (edge เป็นฝ่ายเปิด connection ไปหา central)
```

- ตัด WAN = `docker network disconnect` เอา edge ออกจาก network `wan` (host ยังเข้า edge ได้ผ่าน port ที่ publish ไว้)
- replication doc ทุกตัวเก็บใน `_replicator` ของ **edge** เพราะของจริง edge อยู่หลัง NAT ของศูนย์
  central ยิงเข้ามาหา edge ไม่ได้

| DB                | ทิศทาง    | หมายเหตุ                                             |
| ----------------- | --------------- | ------------------------------------------------------------ |
| `registry`      | central → edge | one-way                                                      |
| `catalog`       | central → edge | one-way                                                      |
| `shelter_sh001` | central ⇄ edge | two-way (ใช้ replication doc 2 ตัว คือ pull + push) |
| `_users`        | central → edge | filtered ด้วย selector`roles` มี `shelter:SH001`   |

### ทำไมต้องตั้งค่าแบบนี้ (หลักการ)

| หลักการ | ผลต่อการ setup |
| --- | --- |
| **edge เป็นฝ่ายเปิด connection** — edge อยู่หลัง NAT ของศูนย์ central เรียกเข้าไม่ได้ | job ทุกตัวอยู่ใน `_replicator` ของ **edge** · central ไม่ต้องตั้ง job อะไร แค่เปิดทางให้ edge เข้ามา |
| **replication คือ HTTP ปกติ** (`_changes`, `_revs_diff`, `_bulk_get`, `_bulk_docs`) | วิ่งผ่าน nginx ได้ แต่ต้องตั้ง nginx ไม่ให้ buffer, รับ body ใหญ่, timeout ยาว |
| **job ใช้สิทธิ์ของ user ที่ใส่ไว้** เหมือน client ทั่วไป | ต้องมี replication user ต่อศูนย์ที่ central (ไม่ใช้ admin เพราะรหัสผ่านถูกเก็บ plaintext ที่ edge) |
| **`_security` ไม่ถูก replicate** | edge ต้องตั้ง `_security` ของตัวเอง (`edge-init.sh` ทำให้) |
| **cutover ทำที่ DNS ของ LAN** (OD-2) — domain แอปชี้มาที่ edge ตอน WAN ขาด | replication ต้องใช้ hostname อื่น (`sync.*`) ที่ไม่ถูก override ไม่งั้น edge replicate วนเข้าตัวเอง (README T9) |
| **checkpoint** เก็บใน `_local/*` ทั้งสองฝั่ง | WAN กลับมาแล้ว job ไล่ต่อจากจุดเดิมเอง ไม่ต้องสั่ง |
| **cookie ผูกกับ `secret`** ของแต่ละ CouchDB | edge ใช้ `secret` ของตัวเอง → login ใหม่ตอน cutover (OD-3) |

📖 [Replication intro](https://docs.couchdb.org/en/stable/replication/intro.html) ·
[Replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)

---

## 3. Setup

### 3.1 สร้างไฟล์ `docker-compose.yml` ในโฟลเดอร์นี้

```yaml
name: couch-poc

services:
  couch-central:
    image: couchdb:3.5
    container_name: couch-central
    environment:
      COUCHDB_USER: admin
      COUCHDB_PASSWORD: password
    ports:
      - "5985:5984"
    networks: [wan]

  couch-edge:
    image: couchdb:3.5
    container_name: couch-edge
    environment:
      COUCHDB_USER: admin
      COUCHDB_PASSWORD: password
    ports:
      - "5986:5984"
    networks: [wan, lan]

networks:
  wan:
  lan:
```

> ไม่ mount volume — ทุกครั้งที่ `docker compose down` ข้อมูลหายหมด ซึ่งเหมาะกับ POC

### 3.2 เปิด server + ตั้งค่า single node

```bash
cd docs/couchdb-replication
docker compose up -d

export C=http://admin:password@localhost:5985   # central (จาก host)
export E=http://admin:password@localhost:5986   # edge (จาก host)

for URL in $C $E; do
  until curl -sf "$URL/_up" >/dev/null; do sleep 1; done
  curl -s -X POST "$URL/_cluster_setup" -H 'Content-Type: application/json' \
    -d '{"action":"enable_single_node","bind_address":"0.0.0.0","username":"admin","password":"password","port":5984}'
  echo
done
```

### 3.3 สร้าง DB ฝั่ง central

```bash
for DB in registry catalog shelter_sh001; do curl -s -X PUT "$C/$DB"; done
```

ฝั่ง edge ไม่ต้องสร้าง DB เอง — ใช้ `create_target: true` ใน replication doc

### 3.4 สร้าง replication doc (ที่ edge)

URL ใน replication doc ต้องเป็นชื่อที่ **container edge** มองเห็น (`couch-central:5984`, `127.0.0.1:5984`)
ไม่ใช่ `localhost:5985` ของ host

```bash
AUTH='{"basic":{"username":"admin","password":"password"}}'
CEN=http://couch-central:5984
LOC=http://127.0.0.1:5984

rep() { # rep <id> <source-url> <target-url> [extra-json]
  curl -s -X PUT "$E/_replicator/$1" -H 'Content-Type: application/json' -d "{
    \"source\": {\"url\": \"$2\", \"auth\": $AUTH},
    \"target\": {\"url\": \"$3\", \"auth\": $AUTH},
    \"continuous\": true,
    \"create_target\": true
    ${4:+, $4}
  }"; echo
}

# one-way central → edge
rep registry_pull  $CEN/registry      $LOC/registry
rep catalog_pull   $CEN/catalog       $LOC/catalog

# two-way shelter
rep sh001_pull     $CEN/shelter_sh001 $LOC/shelter_sh001
rep sh001_push     $LOC/shelter_sh001 $CEN/shelter_sh001

# filtered _users (เฉพาะ user ของ SH001)
rep users_sh001_pull $CEN/_users $LOC/_users \
  '"selector": {"roles": {"$elemMatch": {"$eq": "shelter:SH001"}}}'
```

ตรวจสถานะ — ทุกตัวต้องเป็น `running`:

```bash
curl -s "$E/_scheduler/docs/_replicator" \
  | python3 -c 'import sys,json; [print(d["doc_id"], d["state"]) for d in json.load(sys.stdin)["docs"]]'
```

---

## 4. Test cases

ทุกเคสใช้ตัวแปร `$C` / `$E` จาก §3.2 · `_id` ใช้รูปแบบเดียวกับ schema จริง `{type}:{ULID}`
(POC ใช้ ULID ปลอมได้ ขอแค่ไม่ซ้ำ)

helper สำหรับวัดเวลา sync — รอจน doc ขึ้นที่อีกฝั่งแล้วพิมพ์เวลาที่ใช้:

```bash
wait_doc() { # wait_doc <base-url> <db> <doc-id>
  local t0=$(date +%s%N)
  until curl -sf "$1/$2/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe="/"))' "$3")" >/dev/null; do sleep 0.2; done
  echo "synced in $(( ($(date +%s%N) - t0) / 1000000 )) ms"
}
```

### T1 — one-way central → edge (Q1)

```bash
curl -s -X PUT "$C/registry/shelter:SH001" -d '{"type":"shelter","code":"SH001","name":"POC"}'
wait_doc $E registry shelter:SH001

# ลองเขียนที่ edge — ต้องไม่ไหลกลับ central
curl -s -X PUT "$E/registry/shelter:SH999" -d '{"type":"shelter","code":"SH999"}'
sleep 5; curl -s -o /dev/null -w '%{http_code}\n' "$C/registry/shelter:SH999"   # ต้องได้ 404
```

**ผ่านเมื่อ:** doc จาก central ขึ้นที่ edge และ doc ที่เขียนที่ edge ไม่ขึ้นที่ central

> ข้อสังเกต: ในระบบจริง edge ต้องกันไม่ให้เขียน `registry`/`catalog` ด้วย `_security` หรือ `validate_doc_update`
> ไม่ใช่ปล่อยให้เขียนได้แล้วไม่ sync

### T2 — two-way shelter (Q2)

```bash
curl -s -X PUT "$C/shelter_sh001/evacuee:01POCCENTRAL0000000000001" -d '{"type":"evacuee","first_name":"จากกลาง"}'
wait_doc $E shelter_sh001 evacuee:01POCCENTRAL0000000000001

curl -s -X PUT "$E/shelter_sh001/evacuee:01POCEDGE000000000000001" -d '{"type":"evacuee","first_name":"จากศูนย์"}'
wait_doc $C shelter_sh001 evacuee:01POCEDGE000000000000001
```

**ผ่านเมื่อ:** ทั้งสอง doc อยู่ครบทั้งสองฝั่ง และ `doc_count` เท่ากัน

### T3 — filtered `_users` + login ที่ edge (Q3)

```bash
mkuser() { # mkuser <name> <role>
  curl -s -X PUT "$C/_users/org.couchdb.user:$1" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"password\":\"pw-$1\",\"type\":\"user\",\"roles\":[\"$2\",\"registration_staff\"]}"; echo
}
mkuser staff_a shelter:SH001
mkuser staff_b shelter:SH002

wait_doc $E _users org.couchdb.user:staff_a
curl -s -o /dev/null -w 'staff_b on edge: %{http_code}\n' "$E/_users/org.couchdb.user:staff_b"  # ต้องได้ 404

# login ที่ edge ด้วยรหัสที่ตั้งไว้ที่ central
curl -s -X POST http://localhost:5986/_session -H 'Content-Type: application/json' \
  -d '{"name":"staff_a","password":"pw-staff_a"}'
```

**ผ่านเมื่อ:** `staff_a` login ที่ edge ได้ (`"ok":true`) และ `staff_b` ไม่อยู่ที่ edge

> เพิ่มเติม (optional): cookie `AuthSession` จาก central ใช้ที่ edge ไม่ได้ ถ้า `[chttpd_auth] secret`
> ของสองฝั่งต่างกัน — ตรงกับ OD-3 (ยอมให้ login ใหม่ตอน cutover) ให้จดผลไว้

### T4 — WAN ขาด → เขียนที่ edge → WAN กลับ (Q4)

```bash
# 1) ตัด WAN
docker network disconnect couch-poc_wan couch-edge

# 2) เขียนที่ edge ระหว่าง WAN ขาด
for i in $(seq -w 1 50); do
  curl -s -o /dev/null -X PUT "$E/shelter_sh001/movement:01POCOUTAGE0000000000000$i" -d '{"type":"movement","kind":"check_in"}'
done

# สถานะ replication ฝั่ง edge ควรเป็น crashing / pending
curl -s "$E/_scheduler/docs/_replicator/sh001_push" | python3 -m json.tool

# 3) ต่อ WAN กลับ แล้วจับเวลาจนถึง central
docker network connect couch-poc_wan couch-edge
wait_doc $C shelter_sh001 movement:01POCOUTAGE000000000000050
```

**ผ่านเมื่อ:** central ได้ครบ 50 doc โดยไม่ต้องสั่งอะไรเพิ่ม

> ต้องจด: เวลาที่ใช้ resume หลังต่อ WAN กลับ — replicator scheduler จะ back off แบบ exponential
> หลัง job crash ซ้ำ ถ้า WAN ขาดนาน อาจต้องรอนานกว่าที่คาด ให้ลองตัด WAN 1 นาที / 10 นาที / 1 ชม.
> แล้วเทียบเวลา และทดลองว่าการ "เตะ" job (แก้หรือสร้าง replication doc ใหม่) ช่วยให้เร็วขึ้นไหม

### T5 — conflict ช่วง WAN ขาด (Q5)

```bash
ID=evacuee:01POCCONFLICT000000000001
curl -s -X PUT "$C/shelter_sh001/$ID" -d '{"type":"evacuee","first_name":"เดิม"}'
wait_doc $E shelter_sh001 $ID

docker network disconnect couch-poc_wan couch-edge

REV_C=$(curl -s "$C/shelter_sh001/$ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_rev"])')
REV_E=$(curl -s "$E/shelter_sh001/$ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_rev"])')
curl -s -X PUT "$C/shelter_sh001/$ID" -d "{\"_rev\":\"$REV_C\",\"type\":\"evacuee\",\"first_name\":\"แก้ที่กลาง\",\"updated_at\":\"2026-09-29T10:00:00Z\"}"
curl -s -X PUT "$E/shelter_sh001/$ID" -d "{\"_rev\":\"$REV_E\",\"type\":\"evacuee\",\"first_name\":\"แก้ที่ศูนย์\",\"updated_at\":\"2026-09-29T10:05:00Z\"}"

docker network connect couch-poc_wan couch-edge
sleep 30   # รอ sync (ปรับตามผล T4)

curl -s "$C/shelter_sh001/$ID?conflicts=true"; echo
curl -s "$E/shelter_sh001/$ID?conflicts=true"; echo
```

**ผ่านเมื่อ:** ทั้งสองฝั่งได้ `_rev` winner ตัวเดียวกัน และมี `_conflicts` ที่ชี้ไปยัง revision ที่แพ้

> ข้อสังเกต: winner ที่ CouchDB เลือกเป็นแบบ deterministic (ดูจาก rev) **ไม่ได้ดูจาก `updated_at`**
> ดังนั้นกติกา LWW ตาม `updated_at` ใน data-model §5 ต้องทำด้วย repair job — ให้จดว่า winner ตรงกับ
> `updated_at` ล่าสุดหรือไม่

### T6 — retry ด้วย ULID เดิมข้ามฝั่ง (Q6)

จำลองกรณี client เขียนที่ central สำเร็จแต่ไม่ได้ response กลับ แล้วไปเขียนซ้ำที่ edge

```bash
ID=movement:01POCRETRY00000000000001
BODY='{"type":"movement","kind":"check_in","at":"2026-09-29T10:00:00Z"}'

docker network disconnect couch-poc_wan couch-edge
curl -s -X PUT "$C/shelter_sh001/$ID" -d "$BODY"; echo   # เขียนสำเร็จที่ central
curl -s -X PUT "$E/shelter_sh001/$ID" -d "$BODY"; echo   # retry ที่ edge ด้วย body เดิม
docker network connect couch-poc_wan couch-edge
sleep 30

curl -s "$C/shelter_sh001/$ID?conflicts=true&revs_info=true"; echo
```

**ผ่านเมื่อ:** มี `_id` เดียว (ไม่มี doc ซ้ำ) — ให้จดว่า rev ของสองฝั่งตรงกันไหม
(ถ้า body เหมือนกันทุก byte, rev ควรเหมือนกันและไม่เกิด conflict) แล้วลองซ้ำโดยให้ body ต่างกัน
เช่น timestamp ต่างกัน เพื่อดูว่าจะเกิด conflict

### T7 — `_security` และ design doc (Q7)

```bash
# _security ที่ central
curl -s -X PUT "$C/shelter_sh001/_security" -H 'Content-Type: application/json' \
  -d '{"members":{"roles":["shelter:SH001"]},"admins":{"roles":["_admin"]}}'
sleep 5
curl -s "$E/shelter_sh001/_security"; echo   # คาดว่าเป็น {} — _security ไม่ replicate

# design doc ที่ central
curl -s -X PUT "$C/shelter_sh001/_design/poc" -d '{"views":{"by_type":{"map":"function(d){emit(d.type,1)}"}}}'
wait_doc $E shelter_sh001 _design/poc
```

**ผ่านเมื่อ:** ยืนยันได้ว่า `_security` ต้อง provision แยกที่ edge และ design doc replicate ได้
(เพราะ replicator ใช้ admin credential)

### T8 — backlog ใหญ่ (Q8)

```bash
docker network disconnect couch-poc_wan couch-edge

python3 - <<'EOF' > bulk.json
import json
docs = [{"_id": f"movement:01POCBULK{i:017d}", "type": "movement", "kind": "check_in"} for i in range(20000)]
print(json.dumps({"docs": docs}))
EOF
curl -s -o /dev/null -X POST "$E/shelter_sh001/_bulk_docs" -H 'Content-Type: application/json' -d @bulk.json

docker network connect couch-poc_wan couch-edge
time wait_doc $C shelter_sh001 movement:01POCBULK00000000000019999
curl -s "$C/shelter_sh001" | python3 -c 'import sys,json;print("central doc_count:", json.load(sys.stdin)["doc_count"])'
```

**ผ่านเมื่อ:** central ได้ครบ 20,000 doc — จดเวลาที่ใช้ และลองซ้ำโดยจำกัด bandwidth
(เช่น `tc qdisc` ใน container edge) เพื่อจำลอง WAN ช้าของศูนย์จริง

---

## 5. ทดสอบข้าม server จริง (central กับ edge อยู่คนละเครื่อง)

§3–§4 รันทั้งสองฝั่งบนเครื่องเดียว จึงยังไม่ได้ทดสอบเรื่อง DNS, TLS, NAT, firewall, สิทธิ์ของ
replication user, นาฬิกาของแต่ละเครื่อง และ WAN ที่ช้าหรือหลุดไม่หมด
ส่วนนี้แยก central กับ edge ไปไว้คนละ server แล้วรัน T1–T8 ซ้ำ พร้อมเคสเพิ่ม T9–T11

### 5.1 Topology

```
 server A — central (stack เดิม *.no-nginx.yml)   server B — edge @ศูนย์ (หลัง NAT)
┌──────────────────────────────────┐   internet  ┌──────────────────────────────┐
│ host nginx :443 (TLS)            │ ◀────────── │ couch-edge                   │
│  sync.example.com                │   HTTPS     │  _replicator (ทุก job)       │
│   └─▶ CouchDB 127.0.0.1:5984     │ (edge เป็น   │ nginx (LAN) ─▶ SPA / /couch  │
│                                  │  ฝ่ายเปิด)   │ 127.0.0.1:5984 = $E          │
└──────────────────────────────────┘             └──────────────────────────────┘
```

- central ใช้ host nginx ที่มีอยู่แล้ว แค่เพิ่ม server block ของ `sync.example.com` — CouchDB ยัง bind `127.0.0.1`
- edge ไม่ต้องมี public IP และไม่ต้องเปิด port ขาเข้าจาก WAN
- `sync.example.com` = hostname ที่ใช้**เฉพาะ replication** ต้องแยกจาก domain ของแอป (ดู T9)
- ถ้ายังไม่มี domain จริง ใช้ VPN แทนได้ (เช่น WireGuard หรือ Tailscale) แล้วตั้ง `SYNC_URL` ของ edge
  เป็น IP ภายใน VPN ของ central (ต้องให้ nginx ของ central รับที่ IP นั้นด้วย)

### 5.2 Setup

ทำตาม [SETUP-CENTRAL.md](SETUP-CENTRAL.md) และ [SETUP-EDGE.md](SETUP-EDGE.md) (ไฟล์อยู่ใน repo แล้ว — สรุปสั้นที่ [README root "Edge @ศูนย์"](../../README.md)):

| server | ขั้นตอน | ไฟล์ |
| --- | --- | --- |
| A — central | SETUP-CENTRAL ขั้น 1–5 (ข้อมูลศูนย์, `repl_sh001`, DNS + cert + host nginx `sync.*`) | host nginx (นอก repo) · [`nginx/sync.conf`](../../nginx/sync.conf) |
| B — edge | SETUP-EDGE ขั้น 1–6 (config, `.env`, `up`, ตรวจ sync) | [`docker-compose.edge.yml`](../../docker-compose.edge.yml) + ไฟล์ที่เกี่ยวข้อง |

จากนั้นรันคำสั่งทดสอบทั้งหมดจาก shell ของ **server B**:

```bash
export E=http://admin:<COUCHDB_PASSWORD ใน .env ของ edge>@localhost:5984
export C=https://admin:<COUCHDB_PASSWORD ของ central>@sync.example.com
curl -s "$C/_up"; echo   # ต้องได้ {"status":"ok",...} ผ่าน TLS
```

> ⚠️ `$C` ใช้ central admin ผ่านอินเทอร์เน็ต — ใช้เฉพาะ server ทดสอบ (staging) และเปลี่ยนรหัสผ่านหลังทดสอบเสร็จ

### 5.4 ตัด WAN แบบเครื่องจริง

`docker network disconnect` ใช้ไม่ได้แล้ว ให้ใช้ `iptables` บน server B ตัดเฉพาะ traffic
จาก container edge ไป central ส่วน shell ของ server B ยังเขียนเข้า `$C` ได้ตามปกติ
(T5/T6 ต้องใช้)

```bash
CENTRAL_IP=$(getent ahostsv4 sync.example.com | awk 'NR==1{print $1}')
EDGE_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' couch-edge)

wan_down() { sudo iptables -I DOCKER-USER -s "$EDGE_IP" -d "$CENTRAL_IP" -j DROP; }
wan_up()   { sudo iptables -D DOCKER-USER -s "$EDGE_IP" -d "$CENTRAL_IP" -j DROP; }
```

ใน T4–T8 ให้ใช้ `wan_down` แทน `docker network disconnect couch-poc_wan couch-edge`
และใช้ `wan_up` แทน `docker network connect ...`

> `DROP` ทำให้ packet หายไปเฉย ๆ (connection ค้างจน timeout) ไม่ใช่ connection refused
> ซึ่งใกล้กับอาการ WAN ขาดจริงมากกว่า ให้จดว่า job ใช้เวลานานเท่าไรกว่าจะเปลี่ยนเป็น `crashing`

จำลอง WAN ช้าหรือ packet หาย (ใช้กับ T4/T8 รอบที่สอง) — `<wan-if>` = interface ขาออกของ server B:

```bash
sudo tc qdisc add dev <wan-if> root netem delay 300ms 50ms loss 5% rate 2mbit
# ... รัน T4 / T8 ...
sudo tc qdisc del dev <wan-if> root
```

### T9 — DNS cutover ต้องไม่ทำให้ edge replicate เข้าหาตัวเอง

ตาม CR-064 OD-2 ตอน WAN หรือ central ล่ม DNS ใน LAN ของศูนย์จะชี้ **domain ของแอป** มาที่ edge
container edge ใช้ resolver ของ host ซึ่งก็คือ DNS ของ LAN ดังนั้นถ้า replication doc ใช้ domain
เดียวกับแอป พอ cutover แล้ว job จะวิ่งมาหา edge เอง ไม่ไปถึง central

```bash
# 1) จำลอง LAN DNS cutover: เปิด extra_hosts ของ service couchdb ใน docker-compose.edge.yml (root ของ repo)
export EDGE_LAN_IP=<ip-lan-ของ-server-B>
docker compose -f docker-compose.edge.yml up -d   # recreate container

# 2) domain แอป → edge แต่ hostname ของ replication ต้องยังชี้ central
docker exec couch-edge getent ahostsv4 app.example.com    # ต้องได้ EDGE_LAN_IP
docker exec couch-edge getent ahostsv4 sync.example.com   # ต้องได้ CENTRAL_IP

# 3) ยืนยันว่า replication ยังถึง central
curl -s -X PUT "$E/shelter_sh001/evacuee:01POCDNSCUTOVER0000000001" -d '{"type":"evacuee","first_name":"หลัง cutover"}'
wait_doc $C shelter_sh001 evacuee:01POCDNSCUTOVER0000000001

# 4) (เคสผิด) replication ที่ใช้ domain แอป
AUTH='{"basic":{"username":"admin","password":"password"}}'
curl -s -X PUT "$E/_replicator/sh001_push_bad" -H 'Content-Type: application/json' -d "{
  \"source\": {\"url\": \"http://127.0.0.1:5984/shelter_sh001\", \"auth\": $AUTH},
  \"target\": {\"url\": \"https://app.example.com/shelter_sh001\", \"auth\": $AUTH},
  \"continuous\": true
}"; echo
sleep 10
curl -s "$E/_scheduler/docs/_replicator/sh001_push_bad" | python3 -m json.tool
curl -s -X DELETE "$E/_replicator/sh001_push_bad?rev=$(curl -s "$E/_replicator/sh001_push_bad" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_rev"])')"
```

**ผ่านเมื่อ:** ขั้น 2–3 ผ่าน และขั้น 4 แสดงว่า job ไปถึง edge แทน central

> ใน POC ไม่มี nginx ที่ edge เคสผิดจึงแค่ `crashing` (ไม่มีอะไรรับที่ 443) แต่ appliance จริงมี
> nginx `/couch` (OD-1) job จะ **replicate วนเข้า DB ตัวเองโดยไม่มี error** ซึ่งตรวจพบได้ยากกว่ามาก
> — ต้องจดไว้เป็นข้อกำหนดของ runbook: replication ต้องใช้ hostname หรือ resolver ที่ LAN DNS ไม่ override

### T10 — นาฬิกาเพี้ยน

`updated_at` ถูกสร้างจากนาฬิกาของ **อุปกรณ์ที่ใช้งาน** (`now()` ใน `frontend/src/lib/db/model.ts`
รันใน browser) ไม่ใช่นาฬิกาของ CouchDB ความเสี่ยงของ LWW จึงอยู่ที่นาฬิกาของเครื่อง staff ส่วนนาฬิกา
ของ server มีผลต่อการตรวจ TLS cert และเวลาหมดอายุของ cookie

**(a) นาฬิกาอุปกรณ์เพี้ยน → LWW เลือกผิดตัว** — ทำ T5 ซ้ำ โดยให้ฝั่งที่แก้ **ทีหลังจริง** ส่ง
`updated_at` ที่ **ย้อนหลัง** 10 นาที (จำลองแท็บเล็ตที่ศูนย์ที่นาฬิกาช้า)

```bash
# ใน T5: แก้ที่ central ก่อน (updated_at 10:00) แล้วแก้ที่ edge ทีหลัง แต่ใส่ updated_at 09:50
```

**ผ่านเมื่อ:** จดได้ว่า repair job ที่ใช้ `updated_at` จะเลือก revision ของ central ทั้งที่ edge แก้ทีหลัง
— ใช้เป็น input ว่ากติกา LWW ใน data-model §5 ต้องมีเงื่อนไขเพิ่มหรือไม่ (เช่น ใช้เวลาของ server
หรือรับได้ว่าคลาดเคลื่อน)

**(b) นาฬิกา server edge เพี้ยน → TLS** — ต้องเปิด `verify_ssl_certificates` (§5.3) ไว้ก่อน

```bash
sudo timedatectl set-ntp false
sudo date -s '+2 years'
docker restart couch-edge   # ให้ทุก job ต่อ TLS ใหม่
sleep 20
curl -s "$E/_scheduler/docs/_replicator/sh001_pull" | python3 -m json.tool
sudo timedatectl set-ntp true
```

**ผ่านเมื่อ:** เห็นว่า job `crashing` ด้วย error cert หมดอายุ — ยืนยันว่า edge appliance ต้องมี NTP
และ ops ต้องมี alert เมื่อนาฬิกาเพี้ยน

### T11 — replication user ที่ไม่ใช่ admin

credential ใน `_replicator` ของ edge อยู่ในเครื่องที่ตั้งในศูนย์ จึงไม่ควรเป็น central admin
เคสนี้ดูว่าถ้าใช้ user ที่มีสิทธิ์น้อยที่สุด job ไหนจะใช้ไม่ได้

setup โหมด B ([SETUP-CENTRAL.md](SETUP-CENTRAL.md) ขั้น 3) ใช้ `repl_sh001` กับ `registry` / `catalog` / `shelter_*` อยู่แล้ว
(`_security` ของ central เพิ่ม role ด้วย `add_member_role` — ห้าม PUT ทับ) เคสนี้ทดลองให้ job `_users` ใช้ `repl_sh001` ด้วย

```bash
# ที่ server B (root ของ repo): ให้ job _users ใช้ repl_sh001 แทน central admin
sed -i 's/^CENTRAL_USERS_REPL_USER=.*/CENTRAL_USERS_REPL_USER=repl_sh001/; s/^CENTRAL_USERS_REPL_PASSWORD=.*/CENTRAL_USERS_REPL_PASSWORD=pw-repl/' .env
kick users_sh001_pull                                        # SETUP-EDGE.md "งานประจำ"
docker compose -f docker-compose.edge.yml run --rm edge-init
```

แล้วดูสถานะ:

```bash
curl -s "$E/_scheduler/docs/_replicator" \
  | python3 -c 'import sys,json; [print(d["doc_id"], d["state"], (d.get("info") or {}).get("error","")) for d in json.load(sys.stdin)["docs"]]'
```

สิ่งที่คาดว่าจะเห็น (ต้องยืนยันด้วยผลจริง):

| job                                                 | คาดว่า                        | เหตุผล                                                                    |
| --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `registry_pull`, `catalog_pull`, `sh001_pull` | ผ่าน                            | member อ่าน DB ได้                                                       |
| `sh001_push`                                      | ผ่านสำหรับ doc ปกติ   | member เขียน doc ปกติได้ แต่เขียน`_design/*` ไม่ได้ |
| `users_sh001_pull`                                | ไม่ผ่าน / ได้ไม่ครบ | user ปกติอ่าน doc ของคนอื่นใน`_users` ไม่ได้         |

ทดลองต่อ: เขียน `_design/edge_only` ที่ edge แล้วดูว่า `sh001_push` เป็น error ไหม แล้วลองเพิ่ม
`"selector": {"_id": {"$regex": "^(?!_design/)"}}` ใน `sh001_push` เพื่อกัน design doc ออก

**ผ่านเมื่อ:** รู้ว่า job ไหนต้องใช้สิทธิ์ระดับไหน และได้ทางเลือกสำหรับ `_users`
(เช่น แยก credential เฉพาะ job นี้ หรือให้ central เป็นฝ่าย push user ลง edge)

### 5.5 ข้อจำกัดเรื่อง monitoring (OD-4)

job ทั้งหมดรันที่ edge และ central เรียกเข้าหา edge ไม่ได้เพราะติด NAT ดังนั้น
`_scheduler` / `_active_tasks` / `changes_pending` (§6) **อ่านได้ที่ edge เท่านั้น** ถ้า central ต้องเห็นสถานะ
ต่อศูนย์ edge ต้องส่งสถานะขึ้นไปเอง (เช่นเขียน status doc ที่ push ขึ้น central) — ให้จดไว้เป็นคำถามต่อ
ถ้าจะทำจริงถือว่าเป็น doc type ใหม่ ต้องทำตาม `docs/change-management.md`

---

## 6. ดูสถานะ / debug

```bash
curl -s "$E/_scheduler/jobs"                     # job ที่กำลังรัน + history (error ล่าสุด)
curl -s "$E/_scheduler/docs/_replicator"         # สถานะราย replication doc
curl -s "$E/_active_tasks"                       # docs_read / docs_written / changes_pending
docker logs couch-edge 2>&1 | grep -i replicat   # log ฝั่ง replicator
```

`changes_pending` ใน `_active_tasks` คือจำนวน doc ที่ยังค้าง ใช้ประกอบ ops UI สถานะต่อ shelter (OD-4) ได้
— แต่อ่านได้ที่ edge เท่านั้น (ดู §5.5)

---

## 7. บันทึกผล

ทดสอบ 2026-10-01 บน **lab 2 เครื่อง**: central = laptop (dev stack, CouchDB 3.5, `http://<IP>:5984`) · edge = mini PC (`docker-compose.edge.yml`)
เชื่อมผ่าน wifi เดียวกัน ไม่มี TLS · ศูนย์ SH001 (1,193 doc ใน `shelter_sh001`) · ขั้นตอน: [SETUP-CENTRAL.md](SETUP-CENTRAL.md) / [SETUP-EDGE.md](SETUP-EDGE.md)
"จำลอง" = ทดสอบบนเครื่องเดียวด้วยไฟล์ชุดเดียวกัน ไม่ใช่ 2 เครื่อง

| Test | ผ่าน/ไม่ผ่าน | เวลา sync | ข้อสังเกต |
| --- | --- | --- | --- |
| T1 one-way (`registry`) | ✅ ผ่าน (lab 2 เครื่อง) | ≤ 5 วินาที (ความละเอียดการวัด 5 วินาที) | doc `sync_probe` ที่เขียนที่ central ใน `registry` ไปถึง edge · job `registry_pull` เป็นขาเข้าอย่างเดียว ไม่มี push · staff เขียน `registry` ที่ edge ไม่ได้ (`forbidden: read-only replica on edge`) — ส่วนนี้ทดสอบแบบจำลอง |
| T2 two-way (`shelter_sh001`) | ✅ ผ่าน (lab 2 เครื่อง) | ดึงเริ่มต้น 1,193 doc ครบก่อนการตรวจครั้งแรกหลังเริ่ม job (ไม่ได้จับเวลา) · doc ใหม่ ≤ 5 วินาที | central → edge ✅ (`sync_probe`) · edge → central ✅ (`shelter_sh001` ที่ central 1,193 → 1,194 หลังเขียนทดสอบที่ edge, เห็น `_bulk_docs` ใน log ของ central) |
| T3 filtered `_users` + login | ✅ ผ่าน (lab 2 เครื่อง) | — | `staff01` และ user ที่สร้างใหม่ที่ central login ที่ edge ได้ · user ศูนย์อื่น (`staff_b`) **ไม่** ถูก sync และ cookie ของ central ใช้ที่ edge ไม่ได้ (ส่วนนี้จำลอง) |
| T4 WAN cut / restore (1 นาที / 10 นาที / 1 ชม.) | ⚠️ ผลสำคัญ แต่ไม่ใช่การทดสอบแบบควบคุม | ดูข้อสังเกต | ช่วง ~1.5 ชม. ที่สองเครื่องไม่คุยกัน (13:47–15:15 UTC ไม่ทราบสาเหตุ) → job ฝั่งดึง 4 ตัว `crashing` `error_count=8` และ **ไม่กลับมาเอง** เมื่อเครือข่ายคืน (ติด exponential backoff) · `push` ทำงานต่อเมื่อมีการเขียนใหม่ · หลัง "เตะ" job ข้อมูลมาถึง ≤ 5 วินาที · ด้วย `edge-watchdog` (จำลอง central ล่ม → กลับ): เตะภายใน 1 วินาทีหลัง `/_up` ตอบ และข้อมูลมาถึง ≤ 5 วินาที · **ยังไม่ได้วัดตามช่วง 1 / 10 / 60 นาที** |
| T5 conflict | ยังไม่ได้ทดสอบ | | winner ตรงกับ `updated_at` ล่าสุด? |
| T6 ULID retry | ยังไม่ได้ทดสอบ | | rev ตรงกัน? |
| T7 `_security` / design doc | ยังไม่ได้ทดสอบโดยตรง | | setup อาศัยข้อสมมติว่า `_security` ไม่ถูก replicate จึงให้ `edge-init.sh` ตั้งเองทุกครั้ง · design doc ของ central (`_design/app`, `_design/access`) มี `validate_doc_update` ที่ยอมให้ `_admin` เขียน ซึ่งเป็นสิทธิ์ที่ replicator ฝั่ง edge ใช้เขียนลง DB ตัวเอง |
| T8 backlog 20k | ยังไม่ได้ทดสอบ | | |
| T4 ข้าม server (DROP / `tc netem`) | ยังไม่ได้ทดสอบ | | กี่วินาทีกว่า job เป็น `crashing` · resume ใช้เวลาเท่าไร |
| T8 ข้าม server (ลิงก์จริง / `tc netem`) | ยังไม่ได้ทดสอบ | | |
| T9 DNS cutover | ยังไม่ได้ทดสอบ | | lab ใช้ IP ตรง ไม่ได้ผ่าน `sync.*` |
| T10a นาฬิกาอุปกรณ์เพี้ยน | ยังไม่ได้ทดสอบ | | LWW เลือกผิดตัว? |
| T10b นาฬิกา server edge เพี้ยน | ยังไม่ได้ทดสอบ | | lab ใช้ `http://` จึงไม่มี TLS ให้ทดสอบ |
| T11 non-admin replication user | ✅ ผ่านบางส่วน (lab 2 เครื่อง) | — | `repl_sh001` (ไม่ใช่ admin) ใช้ได้กับ `registry` / `catalog` / `shelter_sh001` ทั้ง pull และ push · ได้ 403 กับ `shelter_sh002` และ `_users` · **job `_users` ต้องใช้ central admin** (ยืนยันแล้ว) · การ push `_design/*` ด้วย user นี้ ยังไม่ได้ทดสอบ |

### ข้อค้นพบจาก lab (ไม่อยู่ในแผนเดิมของ T1–T11)

| # | ข้อค้นพบ | ผลต่อ runbook / spec |
| --- | --- | --- |
| F1 | **Backoff ของ replicator:** job ฝั่งดึงที่ล้มติดกันหลายครั้งรอนานขึ้นเป็นเท่าตัวทุกครั้ง ไม่กลับมาเองเมื่อ central กลับ แม้ฝั่งส่ง (push) ยังทำงาน → edge ไม่ได้ข้อมูลใหม่จาก central โดยไม่มี error ในแอป | ต้องมีกลไกเตะ job บน edge — ทำเป็น `edge-watchdog` แล้ว (ทดสอบแบบจำลอง) · ควรเป็นข้อกำหนดของ runbook CR-064 และเพิ่ม alert เมื่อ job ฝั่งดึง `crashing` นานเกินกำหนด |
| F2 | **Auth lockout:** CouchDB 3.5 default `chttpd_auth_lockout = enforce` นับรหัสผิดต่อ (user, IP) เกิน 5 ครั้งตอบ **403** ต่อไปแม้ใส่รหัสถูก นาน 5 นาที (`max_lifetime`) job ที่ retry ด้วยรหัสผิดทำให้เกิดเอง (log ของ central: `Authentication rejected for locked-out user`) อาการ: 401 → 403 | การหมุนรหัส `repl_<code>` ที่ central ต้องอัปเดต edge และเตะ job พร้อมกัน · watchdog จึงไม่เตะ job ที่โดนปฏิเสธรหัส |
| F3 | **หมุน/แก้ user ที่ central ทำให้ session ของ job ที่ edge ใช้ไม่ได้** (job ที่ไม่ได้ถูกลบก็ล้มตาม) | ใส่ไว้ในคำเตือนของ `scripts/central-repl-user.sh --rotate` |
| F4 | **`replication_auth_error` ครอบ 2 เรื่อง:** รหัสถูกปฏิเสธ (`session_request_unauthorized` / `forbidden`) และต่อ central ไม่ได้ (`session_request_failed`: nxdomain, conn_failed) | ใช้แยกว่าเตะ job ได้หรือไม่ |
| F5 | `edge-init.sh` ข้าม job ที่มีอยู่แล้ว → แก้ `.env` แล้ว job เก่ายังถือรหัสเดิม ต้องลบ job ก่อน | ระบุไว้ใน SETUP-EDGE "งานประจำ" |
| F6 | ตัวแปรใน shell ชนะ `.env` ของ docker compose (เช่น `export COUCHDB_PASSWORD=...` ค้างอยู่) | ให้ `unset` ก่อนรัน compose |
| F7 | หลังสร้าง job ครั้งแรก รายการใน `_scheduler/docs` ว่าง ~30 วินาทีก่อน replicator หยิบ | ระบุไว้ใน SETUP-EDGE |
| F8 | `_security` จริงของ DB มี member อื่น (เช่น `public_writer`) — PUT ทับจะลบทิ้ง | ใช้อ่าน-แก้-เขียนกลับ (`add_member_role` / `scripts/central-repl-user.sh`) |

### คำถามเปิด (ต้องให้เจ้าของโครงการตัดสิน ไม่ใช่แค่ config)

1. **cert ของ domain แอปที่ edge** — ตอน cutover browser ยังเปิด `https://<domain แอป>` แต่ถูกชี้มาที่ edge
   edge จึงต้องมี cert ที่ valid ของ domain แอป **ตอน WAN ขาด** ไม่อย่างนั้น browser บล็อกและ cookie / PWA ใช้ไม่ได้
   ทางเลือก: ออก cert ด้วย DNS-01 ที่ central แล้ว sync ไฟล์ลง edge เป็นระยะ หรือ internal CA
   (ต้องลง CA ทุกเครื่องในศูนย์) — `nginx-edge` ตอนนี้ฟังแค่ :80 · ยังไม่มีใน
   [gap checklist §7.A](../features/edge-disaster-continuity-idea.md)
2. **credential ของ job `_users`** — ยังต้องเป็น central admin เพราะ user ทั่วไปอ่าน `_users` ไม่ได้ (T11)
3. **CR-064 ยังรอ owner approve** — ไฟล์ edge / `nginx/sync.conf` ใน repo เป็นส่วนของ work package 3 ต้องผ่าน review ก่อน deploy

ข้อค้นพบ F1–F3 กระทบ runbook ของ CR-064 (WP5) และเกณฑ์ "ops UI สถานะต่อ shelter" (OD-4: ต้องเห็น job ฝั่งดึงค้าง) —
ควรยกให้เจ้าของโครงการตัดสินใจ

ถ้าผล POC ทำให้ต้องแก้ spec (เช่น `data-model.md` §1 / §5 หรือ runbook ของ CR-064) ต้องทำตาม
[`docs/change-management.md`](../change-management.md) — ถามเจ้าของโครงการก่อนว่าจะ track แบบไหน

---

## 8. เก็บกวาด

```bash
docker compose down        # ไม่มี volume — ข้อมูลหายหมด
rm -f bulk.json
```

ถ้าทดสอบข้าม server (§5):

```bash
# server B (edge)
wan_up 2>/dev/null; sudo tc qdisc del dev <wan-if> root 2>/dev/null
sudo timedatectl set-ntp true
docker compose -f docker-compose.edge.yml down

# server A (central) — ลบ server block sync.* ใน host nginx แล้ว reload, ลบ DNS record,
# ลบ user repl_sh001 และ role repl:SH001 ออกจาก _security (SETUP-CENTRAL.md "ถอดออกหลังทดสอบ")
```
