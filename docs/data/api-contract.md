---
title: Smart Shelter — API Contract v1
status: draft for review
created: 2026-06-11
updated: 2026-06-11
note: คู่กับ data-model.md v3 — ตัดสิน sync boundary: staff app คุย CouchDB ตรง, service API มีเฉพาะที่ CouchDB ทำเองไม่ได้
---

# Smart Shelter — API Contract v1

**Sync boundary (ตัดสินในรุ่นนี้):** ระบบมี 3 plane —

| Plane | ใคร | ผ่านอะไร |
| --- | --- | --- |
| **A. Sync plane** | staff app (login แล้ว) | PouchDB ⇄ **edge server (CouchDB @ศูนย์)** ผ่าน proxy `/couch` บน LAN; edge ⇄ central เป็น replication อีกชั้น (topology ดู data-model.md §1) |
| **B. Service plane** | staff app เรียกเสริม | REST `/api/v1/*` ที่ **central** (ต้องมี WAN) — เฉพาะงานที่ CouchDB ทำไม่ได้: mint code, export, provisioning |
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
  200 { ok, userCtx: { name, roles: ["shelter:sh001","volunteer"] } } + Set-Cookie: AuthSession
GET  /couch/_session            → ตรวจ session ปัจจุบัน (ใช้เป็น "whoami")
DELETE /couch/_session          → logout
```

- login ทำกับ **edge server ของศูนย์ตน** — สำเร็จแม้ WAN ขาด เพราะ `_users` ถูก filtered-replicate
  ลง edge (data-model.md §6); สร้าง/แก้ user และเปลี่ยนรหัสผ่านต้องทำผ่าน central (`/api/v1/users`)
- ไม่มี JWT, ไม่มี refresh token — cookie อายุ ตาม `couch_httpd_auth.timeout` (ตั้ง 8 ชม. + sliding)
- app อ่าน `userCtx.roles` เพื่อ derive shelter scope + เมนูตาม role — enforcement จริงอยู่ที่
  `_security` + `validate_doc_update` (UI เป็นแค่ความสะดวก)
- offline ที่ cookie หมดอายุ: PouchDB local ใช้ต่อได้ (อ่าน/เขียน local) — sync จะ resume เมื่อ login ใหม่

### 1.2 Databases ที่ app sync

Remote ของ device = **edge server ของศูนย์** (LAN) เสมอ — ไม่ใช่ central:

| Local PouchDB | Remote (edge) | ทิศ | เมื่อไหร่ |
| --- | --- | --- | --- |
| `shelter` | `https://edge.local/couch/shelter_{code}` | ⇄ live+retry | ตลอดที่เห็น edge |
| `registry` | `https://edge.local/couch/registry` | ← pull | ตอน start + ทุก 5 นาที |
| `catalog` | `https://edge.local/couch/catalog` | ← pull | ตอน start + ทุก 5 นาที |

- edge ⇄ central อีกขาเป็น replication ระดับ server (provisioning ตั้งให้ — app ไม่เกี่ยว)
- fallback ชี้ device ตรงไป central = runbook ฉุกเฉินเมื่อ edge ตายแต่ WAN อยู่ — ไม่ใช่โหมดปกติ
- การเขียนทุกชนิด = เขียน local ก่อนเสมอ (offline-first) — UI ห้าม block รอ network
- conflict ดู data-model.md §5 — app ไม่ resolve เองนอกจาก append-only retry (409 = สำเร็จ)

### 1.3 สัญญาเชิง doc (สรุป — รายละเอียด field อยู่ data-model.md §3)

| งานใน feature spec | การกระทำจริง |
| --- | --- |
| สร้าง/แก้คน (FR-4..6) | `put evacuee:{ulid}` — required แค่ first_name+last_name+gender |
| duplicate hint (FR-5) | query Mango index ชื่อ/phone ฝั่ง local ก่อน put; override → `put audit:{ulid}` |
| screening (FR-7..9) | `put screening:{ulid}` (append-only) |
| check-in/out (FR-11..12) | `put movement:{ulid}` + update `evacuee.current_stay` |
| ค้นหา/QR (FR-10,13) | local Mango query (`official_code` หรือชื่อ) — ไม่มี network call |
| dashboard (FR-14) | query views `occupancy`, `stock_balance`, ... ฝั่ง local |
| stock/donation/kitchen/ฯลฯ | put doc ตาม type ใน data-model.md §3.2 |

## 2. Service plane `/api/v1` — conventions

```
Auth      : ใช้ AuthSession cookie เดียวกับ CouchDB (service ตรวจกับ GET /couch/_session)
Error     : { "error": { "code": "FORBIDDEN", "message": "..." } }
Content   : JSON UTF-8 · เวลาเป็น ISO-8601 UTC
Versioning: path prefix /api/v1 — breaking change = /api/v2
```

| Code | ความหมาย |
| --- | --- |
| `UNAUTHENTICATED` 401 | ไม่มี/หมดอายุ session |
| `FORBIDDEN` 403 | role/scope ไม่พอ |
| `VALIDATION` 422 | payload ผิด (รายละเอียดใน `error.fields`) |
| `CONFLICT` 409 | ทำซ้ำ/สถานะไม่ให้ทำ |
| `RATE_LIMITED` 429 | เกิน limit |

## 3. Mint service — official code

```
POST /api/v1/mint
  req : { shelter_code: "SH001", evacuee_ids: ["evacuee:01H...", ...] }   // batch ≤500
  res : { minted: [{ evacuee_id, official_code: "SH001-00045" }], skipped: [...] }
```

- เรียกโดย app อัตโนมัติเมื่อ WAN ถึง central และเจอ evacuee ที่ `official_code == null`
  (LAN-only ในศูนย์ไม่พอ — mint เป็น central จุดเดียวเพื่อกัน code ชน)
- service กัน race ด้วย counter ใน `central_ops` (central จุดเดียว — ไม่มี offline mint)
- idempotent: evacuee ที่มี code แล้ว → `skipped`
- code ฝังใน QR; QR ไม่บรรจุข้อมูลอื่น — scan แล้ว lookup local เสมอ

## 4. Provisioning (system_admin เท่านั้น)

```
POST /api/v1/shelters            { code, name, capacity, zones[], area_m2?, facilities? }
  → สร้าง shelter_{code} + _security + design docs + registry doc ที่ central
    + ออก credentials/replication docs สำหรับ edge server ของศูนย์ (edge⇄central + filtered _users)
POST /api/v1/shelters/{code}/close   → ตั้ง status=closed + closed_at (เริ่มนาฬิกา retention 3 เดือน)
POST /api/v1/users               { name, password, roles[] }   // ห่อ _users เพื่อบังคับกติกา 1 user 1 shelter
```

## 5. Export service (FR-14..16)

```
POST /api/v1/exports             { shelter_code, kind: "evacuees|movements|stock|donations",
                                   format: "csv|xlsx", filters? }
  res: { export_job_id }
GET  /api/v1/exports/{id}        { status: "queued|running|done|failed", download_url?, expires_at }
```

- ทำงานฝั่ง central (อ่าน central replica) — ทุก export เขียน `audit`
- `download_url` อายุ 24 ชม.; ไฟล์ลบตาม retention เดียวกับข้อมูลต้นทาง

## 6. Public plane `/public/v1`

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

## 7. สิ่งที่ตั้งใจ "ไม่มี"

- ไม่มี REST CRUD สำหรับ doc ปฏิบัติการ (evacuee/movement/stock/...) — ใช้ sync plane เท่านั้น
- ไม่มี JWT/refresh-token layer — template เดิม (`auth-interceptor`, `mock-api.js`) ไม่ใช้
- ไม่มี EOC / Open API ในรุ่นนี้ (deferred — จะเป็น service แยกอ่าน central)
- ไม่มี endpoint อ่านข้อมูลรายบุคคลใน public plane
