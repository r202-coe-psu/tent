---
title: Smart Shelter — API Contract v1
status: draft for review
created: 2026-06-11
updated: 2026-06-18
note: คู่กับ data-model.md v3 — ตัดสิน sync boundary: staff app คุย CouchDB ตรง, service API มีเฉพาะที่ CouchDB ทำเองไม่ได้
---

# Smart Shelter — API Contract v1

**Sync boundary (ตัดสินในรุ่นนี้):** ระบบมี 3 plane —

| Plane | ใคร | ผ่านอะไร |
| --- | --- | --- |
| **A. Sync plane** | staff app (login แล้ว) | PouchDB เขียน local ก่อน แล้ว sync กับ active remote เดียว: **central CouchDB** ปกติ; **edge CouchDB @ศูนย์** เฉพาะ WAN/central outage; local-only ถ้าไม่เห็นทั้งคู่ (topology ดู data-model.md §1) |
| **B. Service plane** | staff app เรียกเสริม | REST `/api/v1/*` ที่ **central เท่านั้น** (ต้องมี WAN + central session) — เฉพาะงานที่ CouchDB ทำไม่ได้: export, provisioning |
| **C. Public plane** | ไม่ login | REST `/public/v1/*` ที่ central — ดู [public-tier-flow-spec](../features/public-tier-flow-spec.html) |

ผลที่ตามมา: endpoint อย่าง `POST /evacuees` ใน feature specs เดิม **ไม่มีอยู่จริง** — การ
"สร้าง evacuee" = `db.put(evacueeDoc)` ใน PouchDB แล้ว sync เอง; validation ระดับ field อยู่ที่
Zod ฝั่ง client + `validate_doc_update` ฝั่ง server. Error 422/403 ใน specs map เป็น
Zod error / CouchDB `forbidden` ตามลำดับ

---

## 1. Plane A — CouchDB sync (staff app)

### 1.1 Auth — CouchDB session cookie

```
POST /couch/_session            { "name": "...", "password": "..." }
  200 { ok, userCtx: { name, roles: ["shelter:{id}","registration_staff"] } } + Set-Cookie: AuthSession
GET  /couch/_session            → ตรวจ session ปัจจุบัน (ใช้เป็น "whoami")
DELETE /couch/_session          → logout
```

- login ทำกับ **central** ก่อนเสมอ; ถ้า WAN/central เข้าไม่ได้จึง login กับ **edge fallback** ของศูนย์ตน
  เพราะ `_users` ถูก filtered-replicate ลง edge (data-model.md §6)
- central และ edge `_session` cookies แยกกันตาม origin/remote — edge fallback session ใช้ sync กับ edge
  เท่านั้น และ **ไม่** grant สิทธิ์เรียก `/api/v1/*` หรือ service API ของ central
- สร้าง/แก้ user และเปลี่ยนรหัสผ่านต้องทำผ่าน central (`/api/v1/users`)
- ไม่มี JWT, ไม่มี refresh token — cookie อายุ ตาม `couch_httpd_auth.timeout` (ตั้ง 8 ชม. + sliding)
- app อ่าน `userCtx.roles` เพื่อ derive shelter scope + เมนูตาม role — enforcement จริงอยู่ที่
  `_security` + `validate_doc_update` (UI เป็นแค่ความสะดวก)
- เมื่อ central กลับมา app ตรวจ/ขอ central session แล้ว fail back active remote ไป central
- offline ที่ cookie หมดอายุ: PouchDB local ใช้ต่อได้ (อ่าน/เขียน local) — sync จะ resume เมื่อ login ใหม่กับ remote ที่ active

### 1.2 Databases ที่ app sync

Remote ของ device เลือกตาม precedence และมี **active remote เดียวต่อเวลา**:

| ลำดับ | Active remote | ใช้เมื่อ | DB ที่ sync |
| --- | --- | --- | --- |
| 1 | `https://central.example/couch` | central reachable | `shelter_{shelter_code}` ⇄ live+retry · `registry`/`catalog` ← pull ตอน start + ทุก 5 นาที |
| 2 | `https://edge.local/couch` | WAN/central เข้าไม่ได้ แต่ LAN edge reachable | `shelter_{shelter_code}` ⇄ live+retry · `registry`/`catalog` ← pull จาก edge replica |
| 3 | — | ไม่เห็นทั้ง central และ edge | local PouchDB only; queue changes จนกว่า remote กลับมา |

- ห้าม run long-lived replication จาก device ไปทั้ง central และ edge พร้อมกัน; switching remote ต้องหยุด
  replication เดิมก่อนเริ่มตัวใหม่
- edge ⇄ central เป็น replication ระดับ server สำหรับ fallback replica/backlog (provisioning ตั้งให้ — app ไม่เกี่ยว)
- เมื่อ central กลับมา app fail back ไป central; edge จะ sync backlog ช่วง outage ขึ้น central เอง
- การเขียนทุกชนิด = เขียน local ก่อนเสมอ (offline-first) — UI ห้าม block รอ network
- conflict ดู data-model.md §5 — app ไม่ resolve เองนอกจาก append-only retry (409 = สำเร็จ)

### 1.3 สัญญาเชิง doc (สรุป — รายละเอียด field อยู่ data-model.md §3)

| งานใน feature spec | การกระทำจริง |
| --- | --- |
| สร้าง/แก้คน (FR-4..6) | `put evacuee:{ulid}` — required `first_name` + `last_name` + `gender` + `phone`; phone เป็น `null` ได้เมื่อไม่มี |
| duplicate hint (FR-5) | query Mango index ชื่อ/phone ฝั่ง local ก่อน put; override → `put audit:{ulid}` |
| screening (FR-7..9) | `put screening:{ulid}` (append-only) |
| check-in/out (FR-11..12) | `put movement:{ulid}` + update `evacuee.current_stay` |
| ค้นหา/QR (FR-10,13) | local Mango query (ชื่อ หรือ evacuee ULID จาก QR) — ไม่มี network call |
| dashboard (FR-14) | query views `occupancy`, `stock_balance`, ... ฝั่ง local |
| stock/donation/kitchen/ฯลฯ | put doc ตาม type ใน data-model.md §3.2 |

## 2. Service plane `/api/v1` — conventions

```
Auth      : ใช้ central AuthSession cookie เท่านั้น (service ตรวจกับ central GET /couch/_session)
Error     : { "error": { "code": "FORBIDDEN", "message": "..." } }
Content   : JSON UTF-8 · เวลาเป็น ISO-8601 UTC
Versioning: path prefix /api/v1 — breaking change = /api/v2
```

`/api/v1/*` อยู่ที่ central เท่านั้น: ระหว่าง Edge-only fallback endpoint เหล่านี้ถือว่า unavailable
(ไม่มี WAN/no route) และ edge `_session` cookie ใช้แทน central service auth ไม่ได้.

| Code | ความหมาย |
| --- | --- |
| `UNAUTHENTICATED` 401 | ไม่มี/หมดอายุ session |
| `FORBIDDEN` 403 | role/scope ไม่พอ |
| `VALIDATION` 422 | payload ผิด (รายละเอียดใน `error.fields`) |
| `CONFLICT` 409 | ทำซ้ำ/สถานะไม่ให้ทำ |
| `RATE_LIMITED` 429 | เกิน limit |

## 3. Provisioning (system_admin เท่านั้น)

```
POST /api/v1/shelters            { name, capacity, zones[], area_m2?, facilities? }
  → mint shelter.code จาก central counter (central_ops:counter:shelter)
    + สร้าง shelter:{ulid} (มี code) ใน registry + shelter_{shelter_code} + _security + design docs ที่ central
    + deploy design docs/_security ชุดเดียวกันลง edge fallback replica
    + ออก credentials/replication docs สำหรับ edge server ของศูนย์ (edge⇄central สำหรับ fallback/backlog + filtered _users)
  → res: { id: "shelter:{ulid}", shelter_code: "SH001" }
POST /api/v1/shelters/{id}/close   → ตั้ง status=closed + closed_at (เริ่มนาฬิกา retention 3 เดือน)

POST   /api/v1/users             { name, password, roles[], affiliation_tags? }   // ห่อ _users เพื่อบังคับกติกา 1 user 1 shelter
GET    /api/v1/users             → list users (scoped: SA=ทั้งหมด, SM=เฉพาะศูนย์ตน)
DELETE /api/v1/users?name=       → ลบ user (SM ลบได้เฉพาะ staff ในศูนย์ตน)
```

> **shelter provisioning** (`/api/v1/shelters*`) = `system_admin` เท่านั้น. **user management**
> (`/api/v1/users`) authorization ละเอียดกว่า (FR-34, แก้ 2026-06-14):
> - **`system_admin`** — สร้าง/ลบ user ได้ทุก role (ยกเว้น CouchDB `_admin`), ทุกศูนย์; เลือก `shelter:{code}` จาก payload.
> - **`shelter_manager`** — เฉพาะ **staff** (`registration_staff`/`kitchen_staff`/`warehouse_staff`) ใน **ศูนย์ตนเท่านั้น**;
>   `shelter:{code}` derive จาก session ผู้เรียก (ไม่เชื่อ client). ห้าม grant `shelter_manager`/`system_admin`/`_admin` หรือข้ามศูนย์ → `FORBIDDEN`.
> - server validate `roles[]` เสมอ (ไม่ไว้ใจ payload). contract นี้คือสิ่งที่ service จริง (FastAPI) ต้องบังคับเหมือนกัน — dev BFF เป็น implementation ชั่วคราว.

## 4. Export service (FR-14..16)

```
POST /api/v1/exports             { shelter_code, kind: "evacuees|movements|stock|donations",
                                   format: "csv|xlsx", filters? }
  res: { export_job_id }
GET  /api/v1/exports/{id}        { status: "queued|running|done|failed", download_url?, expires_at }
```

- ทำงานฝั่ง central (อ่าน central replica) — ทุก export เขียน `audit`
- `download_url` อายุ 24 ชม.; ไฟล์ลบตาม retention เดียวกับข้อมูลต้นทาง

## 5. Public plane `/public/v1`

> **Backing store (refine):** public plane ไม่อ่าน central CouchDB ตรงแล้ว — ทำงานบน **MongoDB**
> ที่ sync มาจาก CouchDB; donation ที่ public ประกาศไม่กลายเป็น stock อัตโนมัติ (staff คีย์เอง).
> กลไกเต็มดู [couchdb-mongodb-sync.md](./couchdb-mongodb-sync.md).

Contract เต็มอยู่ที่ [public-tier-flow-spec.html](../features/public-tier-flow-spec.html) — สรุป endpoint:

| Endpoint | Auth |
| --- | --- |
| `POST /public/v1/family-search` | — (rate-limited + audit) |
| `GET /public/v1/needs` | — |
| `POST /public/v1/donations` | เบอร์โทร (+OTP เมื่อ `public_otp_required` เปิด) |
| `GET /public/v1/donations/{tracking_token}` | token |
| `GET /public/v1/transparency/*` | — |

## 6. สิ่งที่ตั้งใจ "ไม่มี"

- ไม่มี REST CRUD สำหรับ doc ปฏิบัติการ (evacuee/movement/stock/...) — ใช้ sync plane เท่านั้น
- ไม่มี JWT/refresh-token layer — template เดิม (`auth-interceptor`, `mock-api.js`) ไม่ใช้
- ไม่มี EOC / Open API ในรุ่นนี้ (deferred — จะเป็น service แยกอ่าน central)
- ไม่มี endpoint อ่านข้อมูลรายบุคคลใน public plane
