---
title: Smart Shelter — API Contract v1
status: draft for review
created: 2026-06-11
updated: 2026-10-17
note: คู่กับ data-model.md v3 — ตัดสิน sync boundary: staff app คุย CouchDB ตรง, service API มีเฉพาะที่ CouchDB ทำเองไม่ได้; CR-112/CR-113 occupancy + unassigned registration; Partner Data API EXT-001–007 (#214); CR-124 staff Google step-up MFA + Google SSO login (enrolled + mint AuthSession); decision sync 2026-10-08 — เพิ่ม GET /public/v1/unassigned-registrations/{id}/status (service secret, status-only) แทนการเรียก staff detail จาก BFF registrations/status — แก้ ticket คิวกลางหายจากอุปกรณ์ (QA pre-register 2026-10-08); decision sync 2026-10-09 — `breakdown` ของ EXT-005 เพิ่ม `gender_unspecified` (null+other; `male+female+gender_unspecified = occupancy_total`) และ `POST /public/v1/unassigned-registrations` รับ `members[].gender = null`; CR-157 (2026-10-10) — เพิ่ม `GET /api/public/v1/donations/slots` (BFF-only อ่าน CouchDB ฝั่ง server) และ error code ของ slot ใน `POST /public/v1/donations` (`SLOT_REQUIRED`, `SLOT_UNAVAILABLE`, `SLOT_FULL`, `SLOTS_UNAVAILABLE`); CR-162 — §2.3 kiosk banner (`POST /api/v1/scanner/kiosk/banners`, signed image GET, back-office `/api/back-office/kiosk-banners/**`)
---

# Smart Shelter — API Contract v1

**Sync boundary (ตัดสินในรุ่นนี้):** ระบบมี 4 plane —

| Plane | ใคร | ผ่านอะไร |
| --- | --- | --- |
| **A. Sync plane** | staff app (login แล้ว) | **Remote-first** กับ active endpoint เดียว: **central CouchDB** ปกติ; **edge CouchDB @ศูนย์** เฉพาะ WAN/central outage; ถ้าไม่เห็นทั้งคู่ให้ fail/retry (ไม่มี local-only write queue) (topology ดู data-model.md §1) |
| **B. Service plane** | staff app เรียกเสริม | REST `/api/v1/*` ที่ **central เท่านั้น** (ต้องมี WAN + central session) — เฉพาะงานที่ CouchDB ทำไม่ได้: export, provisioning |
| **C. Public plane** | ไม่ login | REST `/public/v1/*` ที่ central — ดู [public-tier-flow-spec](../features/public-tier-flow-spec.html) |
| **D. Partner Data API** | ระบบพันธมิตร M6/M7 (machine) | OAuth2 `POST /external/token` + REST `/external/*` อ่านจาก MongoDB projection — ดู §5.3 ของเอกสารนี้ ([stub](./partner-api.md)), [ADR 0002](../adr/0002-partner-integration-architecture.md) |

ผลที่ตามมา: endpoint อย่าง `POST /evacuees` ใน feature specs เดิม **ไม่มีอยู่จริง** — การ
"สร้าง evacuee" = เขียน doc ไปที่ CouchDB endpoint ที่ active (central ก่อน, edge ตอน failover);
validation ระดับ field อยู่ที่ Zod ฝั่ง client + `validate_doc_update` ฝั่ง server. Error 422/403 ใน specs map เป็น
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
- central และ edge `_session` cookies แยกกันตาม origin/remote — edge fallback session ใช้เรียก edge endpoint
  เท่านั้น และ **ไม่** grant สิทธิ์เรียก `/api/v1/*` หรือ service API ของ central
- สร้าง/แก้ user และเปลี่ยนรหัสผ่านต้องทำผ่าน central (`/api/v1/users`)
- ไม่มี JWT, ไม่มี refresh token — cookie อายุ ตาม `couch_httpd_auth.timeout` (ตั้ง 8 ชม. + sliding)
- app อ่าน `userCtx.roles` เพื่อ derive shelter scope + เมนูตาม role — enforcement จริงอยู่ที่
  `_security` + `validate_doc_update` (UI เป็นแค่ความสะดวก)
- เมื่อ central กลับมา app ตรวจ/ขอ central session แล้ว fail back active endpoint ไป central
- ถ้า cookie หมดอายุและไม่มี central/edge session ที่ใช้ได้ ให้หยุด mutation และบังคับ re-auth ก่อนส่งคำขอใหม่

**Staff Google & ThaID MFA + Linked SSO login (CR-124 & CR-ThaID)** — Google และ ThaID (DOPA BORA Digital ID) เป็นปัจจัยเพิ่ม / ทางเข้าสำหรับบัญชีที่ผูกแล้ว ไม่แทนที่ CouchDB เป็น IdP หลัก และไม่เปิด SSO ให้บัญชีที่ยังไม่ enroll:

- **Login entry points (CR-141):** `/login` แสดงปุ่ม Google/ThaID ตาม `GET /api/public/v1/login-methods` → `{ password, google, thaid }`;
  ฟอร์ม username/password แสดงบน `/login` เฉพาะเมื่อ `config:app.password_login_enabled = true` (default `false`).
  `/admin-login` (ไม่ลิงก์จากที่ใด, `noindex`) แสดงฟอร์ม password เสมอสำหรับทุก role — เป็นการซ่อนระดับ UX เท่านั้น
  (`POST /couch/_session` ยังรับ password)
- **Password path:** Factor 1 = username/password → `POST /couch/_session` ตามเดิม
- หลัง password login: ถ้า `_users.mfa.providers` มี `type:"google"` หรือ `type:"thaid"` → สถานะแอป `pending_mfa` นำทางไปยัง `/mfa-challenge`
  ซึ่งผู้ใช้สามารถเลือกยืนยัน Google/ThaID เพื่อตั้ง `mfa_ok` หรือกด "ข้ามขั้นตอนนี้" (`POST /api/v1/auth/mfa/skip`) เพื่อเข้าสู่ระบบได้ทันที
- ถ้ายังไม่ enroll MFA → ไม่บังคับ step-up (opt-in link); ลำดับ gate = force-setup (CR-105) ก่อน แล้วจึง MFA
- **Linked SSO login path (enrolled-only):** ปุ่ม Google หรือ ThaID บนหน้า login → BFF `mode=login` (ไม่ต้องมี `AuthSession` ก่อน)
  - สำเร็จ: lookup `_users` โดย provider `sub` → **mint** cookie `AuthSession` + ตั้ง `mfa_ok` ในรอบเดียวกัน → redirect `/portal`
    (guards ยัง enforce force-setup ถ้าเข้าเงื่อนไข; ไม่ส่งไป `/mfa-challenge` เพราะมี `mfa_ok` แล้ว)
  - ไม่พบ link / `sub` ไม่รู้จัก → **ไม่** mint session; ตั้ง cookie `pending_link` (signed, HttpOnly, 10 นาที) → redirect `/login/link` (CR-141)
- **Link-on-first-login path (CR-141):** `/login/link` รับ username|เบอร์โทร + password (+ reCAPTCHA ตาม flag) → `POST /api/v1/auth/link-account`
  - ตรวจ `pending_link` → rate limit (nonce + IP) → captcha → verify password กับ central `_session` ฝั่งเซิร์ฟเวอร์
  - eligibility: `must_change_password = true` **และ** ไม่มี `mfa.providers` **และ** ไม่ใช่ bootstrap `_admin`; ไม่ผ่าน → 403
  - ผูก provider (`sub` ผูกกับ user อื่น → 409) → mint `AuthSession` + `mfa_ok` → client ไป `/force-setup`
  - รหัสผิด / ไม่พบ user → 401 ข้อความเดียวกัน; เกิน limit → 429 + ลบ cookie
  - บัญชีเดิมที่ยังไม่ผูก → `/admin-login` แล้วผูกที่ `/me`
  - Mint ใช้ cookie-auth secret จาก CouchDB config (`chttpd_auth` / `couch_httpd_auth`) + `_users.salt`
    และ hash ตาม `hash_algorithms` ของโหนด — อ่านได้เฉพาะฝั่งเซิร์ฟเวอร์ (ห้าม `PUBLIC_*`); **ไม่** ใช้ Proxy Auth
- BFF (central เท่านั้น; secrets ฝั่งเซิร์ฟเวอร์):
  ```
  GET/POST /api/v1/auth/oauth/google/start      → redirect ไป Google authorize (mode: link | stepup | login)
  GET      /api/v1/auth/oauth/google/callback   → แลก code, อ่าน sub/email; link / step-up / mint login
  POST     /api/v1/auth/oauth/google/unlink     → ถอดการผูก Google (self หรือ admin ตามสิทธิ์)
  GET/POST /api/v1/auth/oauth/thaid/start       → redirect ไป BORA ThaID authorize (mode: link | stepup | login; kiosk_check_in → §2.1.1)
  GET      /api/v1/auth/oauth/thaid/callback    → แลก code (Basic Auth), อ่าน sub/name/pid; link / step-up / mint login
  POST     /api/v1/auth/oauth/thaid/unlink      → ถอดการผูก ThaID (self หรือ admin ตามสิทธิ์)
  GET      /api/public/v1/login-methods          → { password, google, thaid } สำหรับหน้า login (CR-141)
  GET      /api/public/v1/system-banner          → { enabled, message, variant } สำหรับ system banner (อ่าน config:app.banner_*; no-store, ไม่ auth)
  GET      /api/v1/auth/link-account/pending     → { provider, display } จาก pending_link หรือ 401 (CR-141)
  DELETE   /api/v1/auth/link-account/pending     → ยกเลิก / ลบ pending_link (CR-141)
  POST     /api/v1/auth/link-account             → verify password + ผูก provider + mint session (CR-141)
  POST     /api/v1/auth/mfa/clear               → ล้าง cookie mfa_ok เมื่อ login ใหม่ / logout
  POST     /api/v1/auth/mfa/skip                → ข้ามขั้นตอน MFA challenge ในรอบ session ปัจจุบัน (ตั้ง cookie mfa_ok)
  GET      /api/v1/auth/me                      → รวมสถานะ mfa_enrolled / pending_mfa / providers (ขยายจาก CR-105/CR-124)
  ```
- `start` modes: `link` | `stepup` ต้องมี `AuthSession`; `login` ไม่ต้องมี session ก่อน
- `AuthSession` อาจเกิดก่อน MFA เสร็จ (password path) — แอป/BFF enforce `pending_mfa` ผ่าน `/mfa-challenge` ซึ่งผู้ใช้สามารถเลือกยืนยันหรือกดข้ามได้
- Step-up / OAuth login ต้องมี central + IdP reachable; ช่วง edge-only ถ้า enrolled แล้วแต่ทำไม่ได้ → บล็อกเข้าแอป
  (ไม่ข้าม MFA อัตโนมัติ)
- แยกจาก Partner OAuth2 `EXT-001` / ADR 0002 ทั้งหมด

### 1.2 Databases ที่ app sync

Endpoint ของ device เลือกตาม precedence และมี **active endpoint เดียวต่อเวลา**:

| ลำดับ | Active remote | ใช้เมื่อ | DB ที่ sync |
| --- | --- | --- | --- |
| 1 | `https://central.example/couch` | central reachable | `shelter_{shelter_code}` read/write (live+retry) · `registry`/`catalog` pull/read-through |
| 2 | `https://edge.local/couch` | WAN/central เข้าไม่ได้ แต่ LAN edge reachable | `shelter_{shelter_code}` read/write (live+retry) · `registry`/`catalog` อ่านจาก edge replica |
| 3 | — | ไม่เห็นทั้ง central และ edge | disconnected status-only (ไม่มี read-only local cache); automatic retry 3 attempts, เกินนั้นแสดงแบนเนอร์ cannot connect และเปิด force retry |

- ห้ามยิง write พร้อมกันไปทั้ง central และ edge; switching endpoint ต้องหยุด traffic ไป endpoint เดิมก่อน
- edge ⇄ central เป็น replication ระดับ server สำหรับ fallback replica/backlog (provisioning ตั้งให้ — app ไม่เกี่ยว)
- เมื่อ central กลับมา app fail back ไป central; edge จะ sync backlog ช่วง outage ขึ้น central เอง
- การเขียนทุกชนิดเป็น remote-first ไป active endpoint — UI แสดงสถานะส่งข้อมูล/ลองใหม่ตามผลจริง (auto retry 3 attempts ก่อนขึ้น cannot-connect banner และเปิด force retry)
- conflict ดู data-model.md §5 — app ไม่ resolve เองนอกจาก append-only retry (409 = สำเร็จ)

### 1.3 สัญญาเชิง doc (สรุป — รายละเอียด field อยู่ data-model.md §3)

| งานใน feature spec | การกระทำจริง |
| --- | --- |
| สร้าง/แก้คน (FR-4..6) | `put evacuee:{ulid}` — required `first_name` + `last_name` + `gender` + `phone`; phone เป็น `null` ได้เมื่อไม่มี |
| duplicate hint (FR-5) | query Mango index ชื่อ/phone ผ่าน active endpoint ก่อน put; override → `put audit:{ulid}` |
| screening (FR-7..9) | `put screening:{ulid}` (append-only) |
| check-in/out (FR-11..12) | `put movement:{ulid}` + update `evacuee.current_stay` |
| ค้นหา/QR (FR-10,13) | Mango query ที่ active endpoint (ชื่อ หรือ evacuee ULID จาก QR) |
| dashboard (FR-14) | query views `occupancy`, `stock_balance`, ... ที่ active endpoint |
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

### 2.1 Scanner kiosk — shelter configuration, lookup และ walk-in registration

เครื่อง scanner ยืนยันตัวตนด้วย `X-Device-ID` และ `X-Device-Secret` ที่ออกตอน provision เครื่อง
เส้นทาง `/api/v1/scanner/kiosk/*` ใช้ device credentials แทน staff `AuthSession` และตอบ
`cache-control: no-store`, `pragma: no-cache` เพื่อไม่เก็บข้อมูลเฉพาะศูนย์ไว้ใน cache

```http
POST /api/v1/scanner/kiosk/config
X-Device-ID: kiosk-sh001-01
X-Device-Secret: …
```

คืนค่าจาก shelter ที่ผูกกับเครื่อง (ไม่รับ `shelter_code` จาก request body):

```json
{
  "shelter_code": "SH001",
  "phone_check_in_enabled": false,
  "walk_in_registration_enabled": false,
  "thaid_check_in_enabled": false
}
```

`phone_check_in_enabled` อ่านจาก `shelter.feature_flags.kiosk_phone_check_in_enabled` และ
`walk_in_registration_enabled` อ่านจาก `shelter.feature_flags.kiosk_walk_in_registration_enabled`;
`thaid_check_in_enabled` เป็น `true` เมื่อ `shelter.feature_flags.kiosk_thaid_check_in_enabled` **และ** `config:app.thaid_registration_enabled` เปิดคู่กัน (§2.1.1); ไม่มี shelter หรือไม่มี flag ให้ถือเป็น `false` (ค่าเริ่มต้นปิด) ส่วน registry อ่านไม่ได้ตอบ
`503 DEPENDENCY_UNAVAILABLE`. Kiosk โหลด config เมื่อเข้า `/kiosk` และ `/kiosk/phone`; เมื่อปิดหรืออ่าน
ไม่สำเร็จจะซ่อนช่องทางเบอร์โทรและนำทางกลับหน้าเลือกวิธี. เมื่อปิด walk-in registration จะไม่แสดง
ปุ่มลงทะเบียนใหม่บนผล lookup.

การซ่อนปุ่มเป็นเพียง UX: `POST /api/v1/scanner/kiosk/lookup` ที่ `source: "phone"` ตรวจ flag
ซ้ำฝั่ง server ก่อน rate limit และ lookup; เมื่อปิดตอบ `403 KIOSK_METHOD_DISABLED`.
QR และ smart-card lookup ไม่ขึ้นกับ flag เบอร์โทร. Smart-card lookup ตรวจ
`kiosk_walk_in_registration_enabled` เพื่อกำหนด `can_register`; flag นี้ควบคุมเฉพาะการเริ่ม
walk-in registration และไม่ปิด lookup หรือ check-in flow เดิม.

`POST /api/v1/scanner/kiosk/register` สร้างผู้ประสบภัยจากการอ่าน Smart Card แบบเต็ม หลังผู้ใช้
ยินยอมที่ Kiosk:

```http
POST /api/v1/scanner/kiosk/register
X-Device-ID: kiosk-sh001-01
X-Device-Secret: …
Content-Type: application/json
```

Request body เป็น `{ "card": <SmartCardData without photo_base64>, "photo": <KioskPhotoPayload|null>, "consented": true, "consented_at": <ISO-8601 UTC> }`.
เมื่อมีรูป `photo` มี `content_type`, `full_base64`, `thumb_base64?`, `width`, `height`,
`original_size`, `compressed_size` และ `thumbnail_size`; base64 ไม่มี data URL prefix.
Browser บันทึก `consented_at` ตอนผู้ใช้กดยินยอมไว้ใน in-memory state; ห้ามใส่ citizen ID ใน URL
หรือ log. `card` เป็นข้อมูลบัตรแบบเต็มจาก `read_all_data()` รวม citizen ID, ชื่อ, วันเกิด, เพศ และ
ที่อยู่. รูปจากชิปถูก compress เป็น WEBP พร้อม thumbnail ก่อนส่งใน `photo` แยก; หาก compress ไม่สำเร็จ
จะส่ง JPEG เดิมโดยไม่มี thumbnail และหากไม่มีรูปหรือรูปเกินขนาดจะลงทะเบียนต่อโดยไม่แนบรูป. Server
ผูก shelter จาก device registry เท่านั้น, ตรวจ flag ซ้ำ, ตรวจข้อมูลบัตร
และค้น record เดิมใน shelter นั้นแบบ fail-closed ก่อนสร้าง `evacuee` ที่ `schema_v: 11`,
`current_stay.status: "kiosk_registered"`, `registered_via: "kiosk"`, `household_id: null`,
`phone: null`, `card_snapshot.consented_at` และ `photo: image:{ulid}` เมื่อมีรูป. Server ตรวจ
base64, ขนาด decoded (full ≤300 KB, thumb ≤50 KB) และ magic bytes; สร้าง image document พร้อม
inline attachments ก่อนเขียน evacuee. หากเขียน evacuee ไม่สำเร็จจะลบ image ที่เพิ่งสร้างแบบ best-effort.
`card_snapshot` ที่สร้างใหม่ไม่มี `photo_base64`. สำเร็จตอบ
`{ "status": "created", "evacuee_id": "evacuee:{ulid}" }`. Endpoint ต้องตอบ
`cache-control: no-store`, `pragma: no-cache`.

การ lookup ที่ไม่มี record อนุญาตให้เริ่มลงทะเบียนเมื่อ flag เปิด โดยส่ง `can_register: true`
ใน not-found response. เมื่อ flag ปิดให้ส่ง `can_register: false`. Record เดิมที่ไม่อนุญาตให้
ลงทะเบียนซ้ำตอบ `409 KIOSK_REGISTRATION_BLOCKED`; body ไม่ผ่าน schema ตอบ `400
INVALID_KIOSK_REGISTRATION`, flag ปิดตอบ `403 KIOSK_REGISTRATION_DISABLED`, limit ต่อ device
ตอบ `429 KIOSK_RATE_LIMITED`, auth ไม่ผ่านตอบ `401 DEVICE_AUTH_FAILED`, และ registry/database
อ่านหรือเขียนไม่ได้ตอบ `503` โดยไม่สร้าง record. รายละเอียดนี้ implement ตามค่าที่เสนอในแผน;
CR ที่แผนอ้างถึงยังไม่มีใน `docs/changes/` และต้องได้รับอนุมัติก่อนเปิด PR.

### 2.1.1 Kiosk ThaiD check-in — QR บนตู้ → ยืนยันในแอป ThaiD บนมือถือ

> [CR-163](../changes/14-kiosk/CR-163-kiosk-thaid-check-in.md) · รายละเอียด FR-KTD-01..45:
> [`docs/plans/kiosk-thaid-check-in-implementation-plan.md`](../plans/kiosk-thaid-check-in-implementation-plan.md).
> ค่า TTL / rate limit ด้านล่างเป็นข้อเสนอของทีม (D-4 / D-5) รอ PO เคาะ.

**สรุป:** ตู้ขอ session → แสดง `qr_url` เป็น QR → ผู้อพยพสแกนด้วยมือถือและยืนยันในแอป ThaiD → server เก็บเลข
13 หลัก (`pid`) ไว้ใน session ที่ผูกกับตู้ → ตู้ส่งแค่ `session_id` ไป lookup / check-in. Browser ของตู้ไม่เคยได้รับหรือส่ง
เลข 13 หลัก. Session อยู่ใน memory ของ Node (relay ข้าม worker ผ่าน cluster IPC) ไม่ persist ลง CouchDB.

**Gate (ตรวจทุก endpoint ด้านล่าง):** เปิดเมื่อ `config:app.thaid_registration_enabled` เปิด (อ่านไม่ได้ = ปิด) **และ**
shelter ที่ผูกกับเครื่องมี `feature_flags.kiosk_thaid_check_in_enabled = true`. ปิด → `403 KIOSK_METHOD_DISABLED`.

**Endpoint (device credential `X-Device-ID` / `X-Device-Secret`, `cache-control: no-store`):**

| Endpoint | Body | Response |
| --- | --- | --- |
| `POST /api/v1/scanner/kiosk/thaid/session` | — | `200 { "session_id", "qr_url", "expires_at", "expires_in_sec" }` |
| `POST /api/v1/scanner/kiosk/thaid/session/status` | `{ "session_id" }` | `200 { "status", "expires_at", "expires_in_sec" }` · `404 { "status": "expired" }` |
| `POST /api/v1/scanner/kiosk/thaid/session/cancel` | `{ "session_id" }` | `200 { "ok": true }` (idempotent — session ไม่มี / หมดอายุ / ของเครื่องอื่น ตอบเหมือนกัน) |

- `session_id` = hex 32 ตัว; รูปแบบผิด → `400 INVALID_INPUT`
- ทุก endpoint: auth ไม่ผ่าน → `401 DEVICE_AUTH_FAILED`; registry อ่านไม่ได้ → `503 DEPENDENCY_UNAVAILABLE`
- `qr_url` = `{origin}/api/v1/auth/oauth/thaid/start?mode=kiosk_check_in&session_id=…` (origin = `ORIGIN` / `PUBLIC_ORIGIN` ของ deploy)
- สร้าง session: ลำดับตรวจ auth → rate limit 10 ครั้ง/นาที/เครื่อง (`429 KIOSK_RATE_LIMITED` + `retry-after: 60`, นับต่อ worker) →
  gate → สร้าง. สร้างใหม่ = ยกเลิก session `pending` / `completed` เดิมของเครื่องเดียวกัน
- TTL: `pending` 300 วิ; เมื่อยืนยันสำเร็จเป็น `completed` และนับใหม่ 180 วิ. ตู้ต้องนับเวลาจาก `expires_in_sec` ด้วยนาฬิกา
  monotonic (ไม่ใช้ `expires_at` กับนาฬิกาตู้) และ poll `status` อีกครั้งก่อนแสดงว่าหมดอายุ
- `status`: `pending` · `completed` · `cancelled` · `consumed`; ไม่มี / หมดอายุ / เป็นของเครื่องอื่น → `404 { "status": "expired" }`
  (ไม่บอกว่ามี session อยู่). Response ไม่มี `pid` หรือ PII
- `GET /api/public/v1/thaid/scan-session/[id]` และ `/[id]/events` (ของ flow `member_scan`) ตอบ `404 { "status": "expired" }`
  สำหรับ session `kind = kiosk_check_in`

**ThaiD OAuth mode `kiosk_check_in`:** `GET /api/v1/auth/oauth/thaid/start?mode=kiosk_check_in&session_id=…` ไม่ต้องมี
`AuthSession`; scope `openid pid` (ไม่ใช้ `THAID_OAUTH_SCOPE`); ใช้ callback / redirect URI เดิม. Start ตรวจ kill-switch →
session ต้องเป็น kind kiosk และ `pending` → gate ของ shelter ใน session. Callback ต้องได้ `pid` 13 หลักแล้วตั้ง session เป็น
`completed`. ทุกผลลัพธ์ redirect ไป `/thaid-scan-success?flow=kiosk&status=success` หรือ `&error=<code>`
(`missing_session` · `session_expired` · `thaid_disabled` · `missing_pid` · `oauth_exchange_failed` · `oauth_<idp_error>` · `invalid_state`).

**Lookup (`POST /api/v1/scanner/kiosk/lookup`):** body `{ "source": "thaid", "session_id" }` (strict; ไม่รับ `citizen_id`).
ตรวจ rate limit เดิม → gate → session ต้องเป็นของเครื่องนี้, `completed`, และ `shelter_code` ตรงกับเครื่อง มิฉะนั้น
`409 KIOSK_THAID_SESSION_INVALID`. Lookup ใช้ `pid` จาก session และ**ไม่** consume session. ไม่พบ → `404
PRE_REGISTRATION_NOT_FOUND` พร้อม `can_register: false` (walk-in ด้วย ThaiD อยู่นอก scope).

**Check-in (`POST /api/v1/scanner/kiosk/check-in`):** body เพิ่ม `source: "thaid"` + `thaid_session_id`; ห้ามส่ง
`citizen_id` คู่กับ `source: "thaid"` และห้ามส่ง `thaid_session_id` กับ source อื่น (`400 INVALID_CHECK_IN_INPUT`).
- ลำดับ: gate → `shelter_code` ของ session ตรงกับเครื่อง → consume session (single-use) → เขียน check-in
- `pid` ต้องตรงกับ `person_id.number` ของ `primary_evacuee_id`; ไม่ตรงหรือไม่พบ primary → `409 KIOSK_THAID_SESSION_INVALID`
  และ session ถูกใช้แล้ว (ไม่คืน)
- การเขียน throw หรือสมาชิกทุกคนได้ `failed` → คืน session เป็น `completed` ให้ลองใหม่ด้วย scan เดิม
- session ไม่ใช่ `completed` / ใช้แล้ว / เป็นของเครื่องหรือศูนย์อื่น → `409 KIOSK_THAID_SESSION_INVALID`
- ตู้แนบ `source: "thaid"` เฉพาะ batch แรกที่มี primary (client ส่ง primary ไว้ batch แรกเสมอ); batch ถัดไปส่งแบบไม่มี
  `source` (ข้อเสนอ D-8 — รอ PO เคาะ)
- ช่องทาง ThaiD ไม่ใช้ face check / staff PIN

`scanner_client` แนบ device credential ให้ 3 path `thaid/session{,/status,/cancel}` เพิ่มจาก allowlist เดิม.

### 2.2 Scanner staff PIN — ข้ามการตรวจใบหน้าด้วย PIN ของเครื่อง

> [CR-158](../changes/14-kiosk/CR-158-kiosk-staff-pin-face-bypass.md).
> PIN อยู่ใน DB `scanner_secrets` (schema.md §3.11.1) บน central เท่านั้น. ทุก response ของ endpoint ในหัวข้อนี้
> มี `cache-control: no-store`, `pragma: no-cache`. error ใช้ envelope `{ "error": { "code", "message" } }`.
> ทุก endpoint log ผู้เรียก/เครื่อง, เวลา, ผล — **ห้าม log ค่า PIN**.

**Admin (SA เท่านั้น — `_session` cookie + `system_admin`):**

| Endpoint | Body | สำเร็จ |
| --- | --- | --- |
| `POST /api/v1/scanner/devices` (ใหม่ — ย้ายการสร้างเครื่องจาก browser มาฝั่ง server) | `{ device_id, name, shelter_code, station_name?, status? }` | `201 { "device", "plaintext_secret", "plaintext_staff_pin" }` — สร้างเครื่องพร้อม default PIN สุ่ม |
| `POST /api/v1/scanner/devices/[id]/staff-pin` | `{ "pin": "<6 หลัก>" }` หรือ `{ "regenerate": true }` | `200 { "ok": true }` · regenerate → `200 { "ok": true, "pin": "<6 หลัก>" }` |
| `POST /api/v1/scanner/devices/[id]/staff-pin/reveal` | — | `200 { "pin", "is_default", "updated_at", "updated_by" }` |
| `DELETE /api/v1/scanner/devices/[id]` | — | `200 { "ok": true }` — ลบ registry doc ก่อน แล้วลบ PIN doc (best effort) |

`[id]` ใน path = `device_id` (เช่น `kiosk-01`) **ไม่ใช่** `_id` ของ doc (`scanner_device:kiosk-01`); ค่าที่ไม่ใช่
`device_id` ที่ถูกต้อง = `404 NOT_FOUND`.

Error ของ admin endpoint: ไม่ login `401 UNAUTHENTICATED` · ไม่ใช่ SA `403 FORBIDDEN` · PIN ไม่ใช่ 6 หลักหรือเดาง่าย
`400 VALIDATION` · ไม่พบเครื่อง `404 NOT_FOUND` · reveal เครื่องที่ไม่มี PIN `409 staff_pin_not_set` · `_rev` ชน
`409 CONFLICT` · `scanner_secrets` ใช้ไม่ได้, `_security` มี member ที่ไม่ใช่ admin หรือ rollback PIN doc ไม่สำเร็จ `503 STAFF_PIN_UNAVAILABLE` ·
registry ใช้ไม่ได้ `503 DEPENDENCY_UNAVAILABLE`.

**Kiosk (device credential):**

```http
POST /api/v1/scanner/kiosk/staff-pin/verify
X-Device-ID: kiosk-sh001-01
X-Device-Secret: …
Content-Type: application/json

{ "pin": "482913" }
```

ตรวจ PIN ของเครื่องที่ยืนยันตัวตนแล้วเท่านั้น (ไม่รับ device id จาก body) เทียบแบบ constant-time และอ่าน PIN จาก
`scanner_secrets` เสมอ (ไม่เชื่อ `staff_pin_set` ใน registry):

| ผล | Response |
| --- | --- |
| PIN ถูก | `200 { "ok": true }` ตอบทันที |
| PIN ผิด | `401 staff_pin_invalid` ตอบหลังหน่วงประมาณ 1 วินาที |
| device credential ผิด | `401 DEVICE_AUTH_FAILED` (ตรวจก่อน PIN) |
| PIN ไม่ใช่ตัวเลข 6 หลัก (ว่าง, สั้น/ยาว, มีตัวอักษร) หรือ body อ่านไม่ได้ | ถือเป็น PIN ผิด: `401 staff_pin_invalid` หลังหน่วงเหมือนกัน (ตรวจ format ก่อน `timingSafeEqual`) |
| คิวของเครื่องเต็ม (ตรวจอยู่ 1 + รอ 1) | `429 RATE_LIMITED` ตอบทันที ไม่รับเข้าคิว |
| เครื่องไม่มี PIN doc | `409 staff_pin_not_set` |
| registry / `scanner_secrets` ใช้ไม่ได้ | `503 DEPENDENCY_UNAVAILABLE` |

ไม่ล็อกเครื่องและไม่จำกัดจำนวนครั้ง แต่ server ตรวจ PIN ได้ทีละ request ต่อเครื่อง (request ที่ซ้อนเข้ามารอคิวได้
1 request; เกินนั้น `429`; device auth ตรวจก่อนเข้าคิว เครื่องที่ credential ผิดจึงไม่กินที่ในคิว)
และ log ระดับ `warn` ทุกครั้งที่ PIN ผิดติดกันครบ 5 ครั้งต่อเครื่อง (ตัวนับอยู่ใน memory, reset เมื่อ PIN ถูกหรือ
server restart). `scanner_client` แนบ device credential ให้เฉพาะ request `POST` same-origin จากหน้า kiosk.

### 2.3 Kiosk banner — feed ของตู้ + back-office ([CR-162](../changes/14-kiosk/CR-162-kiosk-banner.md))

**ฝั่งตู้ (device credential, `cache-control: no-store` + `pragma: no-cache`)**

```http
POST /api/v1/scanner/kiosk/banners
X-Device-Id: kiosk-01
X-Device-Secret: <secret>
```

คืน banner ของ `shelter_code` ของเครื่อง (จาก device principal เท่านั้น) ที่ `status = active` และ
`start_at ≤ now < end_at` เรียง `order` → `start_at` → `_id` สูงสุด 20 รายการ:

```json
{
  "banners": [
    {
      "id": "kiosk_banner:01J...",
      "title": "แจกอาหารกลางวัน",
      "caption": "เวลา 12:00 ที่โรงอาหาร",
      "duration_sec": 10,
      "image_url": "/api/v1/scanner/kiosk/banners/kiosk_banner:01J.../image?exp=1760190000&sig=..."
    }
  ],
  "fetched_at": "2026-10-11T08:00:00.000Z"
}
```

| ผล | Response |
| --- | --- |
| สำเร็จ (รวมกรณีไม่มี banner) | `200` · `banners: []` ได้ |
| device credential ผิด / เครื่อง inactive | `401 DEVICE_AUTH_FAILED` |
| registry ใช้ไม่ได้ | `503 DEPENDENCY_UNAVAILABLE` |

```http
GET /api/v1/scanner/kiosk/banners/{id}/image?exp={unix}&sig={hex}
```

ไม่ใช้ device header (`<img>` ส่ง GET; `scanner_client` ฉีด credential เฉพาะ POST ใน allowlist). `sig =
HMAC-SHA256(server_secret, "{id}.{exp}")` อายุ 15 นาที · `200` + `content-type` ของรูป · sig ผิด/หมดอายุ `403` ·
ไม่พบ / inactive / นอกช่วงเวลา `404`.

**ฝั่ง back-office (`_session`; SA ทุกศูนย์ · `{code}:shelter_manager` / `{code}:banner_staff` เฉพาะ banner ที่
`shelter_codes` ทั้งหมดอยู่ใน scope — ทั้งค่าเดิมและค่าใหม่; อื่น ๆ `403`)**

| Method | Path | หมายเหตุ |
| --- | --- | --- |
| `GET` | `/api/back-office/kiosk-banners?view=current\|expired&shelter_code=` | `current` = `end_at ≥ now` เรียง `start_at` asc · `expired` = `end_at < now` เรียง `end_at` desc |
| `POST` | `/api/back-office/kiosk-banners` | body JSON ทุก field + `image: { content_type, data_base64 }` (req) · `201` |
| `GET` | `/api/back-office/kiosk-banners/{id}` | — |
| `PUT` | `/api/back-office/kiosk-banners/{id}` | `_rev` req · `image` opt (ไม่ส่ง = คงรูปเดิม) · `_rev` ชน `409` |
| `PATCH` | `/api/back-office/kiosk-banners/{id}` | `{ status }` เท่านั้น |
| `DELETE` | `/api/back-office/kiosk-banners/{id}?rev=` | hard delete |
| `GET` | `/api/back-office/kiosk-banners/{id}/image` | รูปสำหรับ preview ในหน้าจัดการ |

รูปผิดชนิด (magic bytes) / เกิน 2 MB / field ไม่ผ่าน Zod → `422 VALIDATION`.

### 2.4 Referral — bulk transition และ job ปิดศูนย์ ([CR-167](../changes/09-F-referral/CR-167-referral-withdraw-close-reason-bulk.md), [CR-168](../changes/09-F-referral/CR-168-referral-shelter-closure-worker.md))

> **สถานะ:** approved ทั้งสอง CR · ยังไม่ implement · สิทธิ์ทุก route ใช้ `authorizeReferral` เดิม: `shelter_manager` ของศูนย์ตัวเอง และ `system_admin` (ต้องระบุ `shelter_code`) · error shape ตามสัญญาข้างต้น

| Method | Path | หมายเหตุ |
| --- | --- | --- |
| `POST` | `/api/back-office/referral/bulk-transition` | `{ ids[], to, reason? }` · ตรวจสิทธิ์/transition ต่อรายการด้วย `assertActorMayTransition` ตัวเดียวกับ endpoint รายตัว · ตอบ partial success `{ succeeded[], failed[{id,error}] }` (ไม่ rollback รายการที่ผ่าน) · ขนาด `ids` proposed default 200 · concurrency จำกัด (default 5) · `reason` เก็บที่ `close_reason` เมื่อ `to=closed`, `response_reason` เมื่อ `accepted`/`rejected` |
| `GET` | `/api/back-office/referral/close-shelter/preview` | จำนวนที่จะถูกกระทบ แยกขาออก/ขาเข้า และสถานะ |
| `POST` | `/api/back-office/referral/close-shelter/jobs` | `{ reason, confirm_shelter_code }` · คืน job id ทันที (ไม่รอประมวลผล) · `status=scheduled`, `start_after` = สร้าง + 60 วินาที · `confirm_shelter_code` ไม่ตรง `shelter_code` → `422` · มี job active ของศูนย์เดียวกัน → `409` |
| `GET` | `/api/back-office/referral/close-shelter/jobs/{id}` | สถานะ + ตัวนับ + `failures[]` (ETag polling) |
| `POST` | `/api/back-office/referral/close-shelter/jobs/{id}/cancel` | ได้เฉพาะ `scheduled` และ `now < start_after` ด้วย CAS · หลังเริ่ม → `409` |
| `POST` | `/api/back-office/referral` | เพิ่ม: ศูนย์ที่มี job active สร้าง referral ใหม่ไม่ได้ → `409` (ศูนย์อื่น/ขาเข้าจากศูนย์อื่นไม่ถูกบล็อก) |

**Internal worker (private network เท่านั้น — ห้ามอยู่หลัง public listener; nginx ต้อง deny):**

| Method | Path | หมายเหตุ |
| --- | --- | --- |
| `POST` | `/api/internal/referral-close/worker/next` | `Authorization: Bearer <REFERRAL_WORKER_TOKEN>` (constant-time compare) · claim/ประมวลผลไม่เกิน 1 batch ต่อ request (proposed default 50) · `204` เมื่อไม่มีงาน · ไม่ตั้ง token → API ไม่รับ job ใหม่ |

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
> (`/api/v1/users`) authorization ละเอียดกว่า (FR-34, แก้ 2026-06-14, CR-074 / CR-075 2026-08-14):
> - **`system_admin`** (และ Couch `_admin` ที่ login ผ่านแอป — SA-equivalent) — สร้าง/ลบ user ได้ทุก role
>   (ยกเว้น CouchDB `_admin`), ทุกศูนย์; เลือก `shelter:{code}` จาก payload.
>   Grant `system_admin` ได้เมื่อ caller เป็น SA-equivalent (`system_admin` หรือ `_admin` — CR-075).
>   รูป `roles` ของ SA ต้องเป็น `["system_admin"]` เท่านั้น (`shelter_id = null`) — ผสม shelter/capability → `VALIDATION`.
>   ห้ามลบหรือลดสิทธิ์ app SA คนสุดท้าย → `FORBIDDEN`.
>   CouchDB server admin (username จาก `COUCHDB_ADMIN_URL` / `COUCHDB_USER` หรือ `roles` มี `_admin`) ห้าม
>   create ทับชื่อ / update / delete ผ่านแอป → `FORBIDDEN`; ไม่ปรากฏใน `GET /api/v1/users`.
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
| `POST /public/v1/occupants` | — (rate-limited + audit); ค้นชื่อ: ทุกคำ ≥2 ตัวอักษร (สูงสุด 4 คำ), หลายคำ = ชื่อต้น prefix AND นามสกุลเต็ม exact, คำเดียว = ชื่อต้น prefix หรือ นามสกุลเต็ม, เรียงคงที่, max 10 ผล (CR-166) |
| `GET /public/v1/needs` | — |
| `POST /public/v1/donations` | เบอร์โทร (+OTP เมื่อ `public_otp_required` เปิด) |
| `GET /api/public/v1/donations/slots?shelter_code&date&mode` | — (BFF-only, CR-157) — BFF อ่าน `donation_slot` จาก CouchDB ฝั่ง server (doc type นี้ไม่ถูก project ลง Mongo) คืนเฉพาะช่วงเวลา/ความจุ/ยอดจอง ไม่มี PII |
| `GET /public/v1/donations/{tracking_token}` | token |
| `PATCH /public/v1/donations/{tracking_token}` | token |
| `PATCH /public/v1/donations/{tracking_token}/items` | token |
| `DELETE /public/v1/donations/{tracking_token}` | token |
| `GET /public/v1/transparency/*` | — |
| `POST /api/public/v1/registrations` | CAPTCHA + rate-limit (BFF-only, ไม่มีบน FastAPI) |
| `POST /api/public/v1/registrations/photos` | rate-limit (BFF-only) — multipart → Couch `image:{ulid}` ใน DB ศูนย์ที่เลือก (face/pet; ไม่ใช่ GridFS) |
| `POST /api/public/v1/registrations/lookup` | รหัสการจอง + เบอร์โทร (BFF-only) |

> **หมายเหตุ (CR-070/T-71):** endpoints กลุ่ม `registrations/**` เป็น **BFF-only** — อยู่บน SvelteKit เท่านั้น
> (`frontend/src/routes/api/public/v1/registrations/**`) และเขียน CouchDB ตรงผ่าน
> `putAsPublicWriter` (CouchDB user `public_writer` ไม่มี role → ผ่าน `validate_doc_update`).
> **ไม่มี path คู่กันบน FastAPI** เพราะ booking ต้องกันที่ทันทีตาม D-BOOK-OCC=C ซึ่งรอ
> projection Mongo ไม่ได้ และ QR ต้องสแกนที่ประตูได้ทันที. Auth ของทุก `/public/v1/*` บน
> FastAPI ยังเป็น Bearer `EXTERNAL_API_SECRET` ตาม CR-063.
>
> **Photos (shelter booking):** `POST /api/public/v1/registrations/photos` รับ compressed
> full/thumb + `shelter_code` แล้วสร้าง `image:{ulid}` (+ attachments) ใน `shelter_{code}`
> ผ่าน public writer — คืน `photo_id` ให้ `evacuee.photo` / `household.pets[].image_url`
> (เหมือน onsite CR-054). เส้น **ไม่ระบุศูนย์** ยังใช้ GridFS ผ่าน
> `POST /api/public/v1/unassigned-registrations/photos` (§5.2).

**donor แก้การจองของตัวเอง — สองเส้นแยกกัน** (DN-6 + CR-080)

| Path | Body | ทำอะไร |
| --- | --- | --- |
| `PATCH /public/v1/donations/{tracking_token}` | `{ "courier_tracking_no": "TH123..." }` | เลข courier tracking (DN-6) — แตะแค่ intake buffer, ปฏิเสธเพราะโควตาไม่ได้ |
| `PATCH /public/v1/donations/{tracking_token}/items` | `{ "items": [...] }` | แก้รายการ/จำนวน (CR-080) — ขยับ atomic counter จึงตอบ `409 NEED_FULL` ได้ |

**แยกสองเส้นโดยเจตนา ไม่ใช่เส้นเดียวที่รับสองอย่าง** — เส้นล่างเป็นเส้นเดียวที่แตะโควตา
(`router.py:106` / `router.py:124`)

```jsonc
// PATCH /public/v1/donations/{tracking_token}/items
{ "items": [{ "item_id": "item:rice", "free_text": "ข้าวสาร", "qty": "8", "unit": "kg" }] }
```

> `items[].unit` ต้องเป็น `item_master.base_unit` (code เช่น `kg`) เมื่อส่ง `item_id` มาด้วย —
> ป้ายภาษาไทยที่ผู้ใช้เห็นเป็นเรื่องของชั้น UI เท่านั้น (schema.md §2.1; ด่านตรวจรับตอบ
> `CATALOG_MISMATCH` ถ้าไม่ตรง)

`items` เป็น **ชุดเต็มที่ต้องการให้เป็น** ไม่ใช่ delta — ลบรายการ = ไม่ส่งมันมา. ระบบคิด
ส่วนต่างกับที่จองไว้เดิมเอง แล้ว release ก่อน reserve เสมอ เพื่อให้การย้ายจำนวนระหว่าง item
ไม่ชนเพดานของตัวเอง.

| สถานะ | ความหมาย |
| --- | --- |
| `200` | แก้สำเร็จ — บันทึก `revisions[]` เพิ่ม 1 รายการ |
| `400` | สถานะไม่ได้อยู่ใน `{declared, pending_review}` แล้ว — เจ้าหน้าที่รับเรื่องไปแล้ว (`DONOR_EDITABLE_STATUSES`, CR-052 §1.4) |
| `409 NEED_FULL` | โควตาไม่พอ — **ของเดิมไม่เปลี่ยนเลย** ทุกการจองที่ทำไปในคำขอนี้ถูกคืนกลับ |
| `429` | rate-limit ต่อ IP (ไม่มีเพดานจำนวนครั้งต่อใบจอง) |

TTL **ไม่รีเซ็ต** — `expires_at` ยังนับจาก `declared_at` เดิม

#### Slot error codes ของ `POST /public/v1/donations` (CR-157)

BFF ตรวจช่วงเวลา (`logistics.slot`) ก่อนส่งต่อ FastAPI; ช่วงที่มีเพดานตัดสินแบบ atomic ผ่าน Mongo
`donation_slot_counters` (CR-157 §C-6). `delivery_method = parcel` ไม่จองคิว จึงไม่ผ่านด่านนี้

| สถานะ | ความหมาย |
| --- | --- |
| `422 SLOT_REQUIRED` | `delivery_method = shelter_pickup` แต่ไม่ได้ส่ง `logistics.slot` (FR-DS-11) |
| `409 SLOT_UNAVAILABLE` | ช่วงที่ส่งมาไม่อยู่บนกระดาน — `shelter_pickup` ที่ศูนย์ไม่ได้ประกาศรอบ (ไม่มี doc `pickup`) (FR-DS-11) หรือ `self_dropoff` ที่ไม่มี doc และ `from`/`to` ไม่ตรงช่วงมาตรฐาน 5 ช่วง (FR-DS-12) |
| `409 SLOT_FULL` | ช่วงเต็มตามการนับ CouchDB, ถูกปฏิเสธโดย `$inc` แบบมีเงื่อนไขบน `donation_slot_counters`, หรือ doc มี `status = closed` (FR-DS-7, FR-DS-14) |
| `503 SLOTS_UNAVAILABLE` | อ่าน `donation_slot` จาก CouchDB ไม่สำเร็จ (ไม่ใช่ 200/404) — ไม่รับ booking ที่ตรวจช่วงไม่ได้ (FR-DS-13) |

### 5.1 External plane `/external/v1` (CR-062) — legacy

สำหรับหน่วยงานและระบบภายนอกที่ถือ managed API key (CR-062) เรียกใช้งาน — **คนละ plane กับ Partner Data API (§5.3)** (path / auth / error shape ต่างกัน). **Soft-deprecated สำหรับงานใหม่:** คง router + API Keys UI ไว้; integration ใหม่ของพันธมิตรใช้ §5.3 `/external` (OAuth2) ไม่ใช่ `/external/v1`.

> **CR-154:** บริการ M2 (`/external/v1/shelters`, `/external/v1/persons/shelter-residency` จาก CR-098) **ถูกลบ** — ย้ายไป §5.3 (EXT-002, EXT-008–011). endpoint `/external/v1` ที่เหลือ (needs, occupants, announcements, config/faqs) ไม่เปลี่ยน.

| Endpoint | Method | Auth | Response |
| --- | --- | --- | --- |
| `/external/v1/shelters/{code}` | GET | `Authorization: Bearer <key>` หรือ `X-API-Key` | รายละเอียดศูนย์ (`ShelterDetailResponse`) |
| `/external/v1/needs` | GET | เหมือนกัน | รายการความต้องการ (`NeedsListResponse`) |
| `/external/v1/occupants` | POST | เหมือนกัน | ค้นหาผู้ประสบภัยแบบ public search (rate limit + `SearchAudit`); กติกาค้นชื่อเหมือน `/public/v1/occupants` (CR-166 — partner เห็นพฤติกรรมเปลี่ยน) |
| `/external/v1/announcements` | GET | เหมือนกัน | ประกาศ (แบ่งหน้า) |
| `/external/v1/config/faqs` | GET | เหมือนกัน | FAQ config |

**Public shelter occupancy (CR-112):** response ศูนย์สาธารณะคืนคีย์ `occupancy` (= Forecast), `present`, `in_zone`, `capacity` แบบ additive — ดูสูตรใน `schema.md` §1.1. Public family search allow-list รวม `arriving` และ `room_confirmed`.

### 5.2 Unassigned Registration (CR-113)

คิวกลาง Mongo-only เมื่อยังไม่เลือกศูนย์ — **ไม่** สร้าง Couch `evacuee` / `public_persons` จน claim:

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/public/v1/unassigned-registrations/photos` | public BFF + secret — GridFS face/pet photo (#255); returns `photo_id` (`gfs:{oid}`) |
| POST | `/public/v1/unassigned-registrations` | public BFF + secret — body mirrors public UnifiedRegistration fields (+ member `photo` / pet `image_url` refs); `schema_v: 3`; optional `join_registration_id` appends into existing family (incl. closed → reopen) |
| GET | `/public/v1/unassigned-registrations/{id}/status` | public BFF + secret (`verify_external_secret`) — status-only, **no PII**: `{id, status, members_total, members_claimed, claimed}`; `claimed = members_claimed > 0 and status in (closed, claimed)` (partial claim = `open` → still pending); 404 `NOT_FOUND` when deleted. Caller: BFF `/api/public/v1/registrations/status` (ticket sync) — upstream errors map to 502 `STATUS_UNAVAILABLE`, never `notFound` |
| GET | `/staff/v1/unassigned-registrations/search?q=` | staff session — open members + open pets |
| GET | `/staff/v1/unassigned-registrations/{id}/review` | `require_registration_staff` — read-only pre-claim review (CR-140 addendum); open members/pets + household address only (no `pets[]` claim-status list); writes nothing |
| GET | `/staff/v1/unassigned-registrations/photos/{photo_id}` | `require_registration_staff` — streams GridFS bytes (CR-140 addendum); 404 unless `photo_id` is still referenced by an **open** member `photo` or pet `image_url` |
| POST | `/staff/v1/unassigned-registrations/{id}/claim` | staff + shelter scope — body `member_ids` and/or `pet_ids`; copies nickname/religion/emergency_contact; GridFS member `photo` + pet `image_url` → Couch `image:{ulid}`; append claimed pets onto existing Couch HH |
| DELETE | `/staff/v1/unassigned-registrations/{id}` | `system_admin` only |

Claim = Mongo mark (คน+สัตว์) แล้ว birth/append Couch (option B — ดู [CR-113](../changes/00-baseline/CR-113-unassigned-registration-mongo.md) + [CR-140](../changes/00-baseline/CR-140-persistent-unassigned-family.md)); shape: `schema.md` §9.5. เมื่อไม่มี `open` เหลือ → เอกสาร `closed` (**ไม่** hard-delete); `deleted` เสมอ `false`. Public browser เรียกผ่าน SvelteKit BFF เท่านั้น (ไม่ตรง FastAPI).

**CR-140 addendum:** Staff claim UI ไม่เรียก `POST .../claim` ทันทีที่ติ๊กเลือก — ไปหน้า review (`GET .../{id}/review`, อ่านอย่างเดียว) ก่อนเสมอ; `POST .../claim` ถูกเรียกเมื่อ staff กดยืนยันในหน้านั้นเท่านั้น (ดู [CR-140](../changes/00-baseline/CR-140-persistent-unassigned-family.md) addendum ท้ายไฟล์).

### 5.3 Partner Data API — OAuth2 `/external` (EXT-001–011, #214, CR-154)

Machine-to-machine สำหรับ **M6 Resource Logistics / M7 Command Center / M2 กลุ่มเปราะบาง (CR-154)** — อ่าน MongoDB projection; ข้อยกเว้นเดียวที่เขียน = EXT-008/009 booking ผ่าน Mongo buffer `external_bookings` → worker inbound → CouchDB (FastAPI ไม่แตะ CouchDB SoR ตรง) — สถาปัตยกรรมใน [ADR 0002](../adr/0002-partner-integration-architecture.md); **as-built ส่งมอบพันธมิตร:** รายงาน as-built ส่งมอบพันธมิตรถูกลบออกจาก repo แล้ว (commit `4374bcc20`) — **§5.3 นี้คือแหล่งอ้างอิงหลัก** (ODT ใน `docs/source/` เป็น immutable archive; [stub](./partner-api.md) คงไว้เพื่อลิงก์เดิม).

| Endpoint | Method | Auth / scope | หมายเหตุสั้น |
| --- | --- | --- | --- |
| `/external/token` | POST | body: `grant_type=client_credentials`, `client_id`, `client_secret` | JWT ~3600s + `scopes[]` (EXT-001) |
| `/external/locations` | GET | Bearer · `location-read` | Location Master list (EXT-002) |
| `/external/locations/{code}` | GET | Bearer · `location-read` | detail + `facilities` (EXT-003) |
| `/external/locations/{code}/stock` | GET | Bearer · `location-stock-read` | stock; `updated_at` ระดับ location (EXT-004) |
| `/external/locations/{code}/occupancy` | GET | Bearer · `occupancy-read` | breakdown (`male`, `female`, `gender_unspecified`, `child_under_5`, `elderly_over_60`, `pregnant`, `bedridden`, `disabled`) + `updated_by_role` คงที่ (EXT-005); `gender_unspecified` = `gender` เป็น `null`/`'other'`, invariant `male+female+gender_unspecified = occupancy_total` (decision sync 2026-10-09) |
| `/external/summary` | GET | Bearer · `location-read` (+ `occupancy-read` สำหรับ top-level `occupancy_total`) | `critical_items` เฉพาะ `low`/`critical` (EXT-006) |
| `/external/locations/{code}/occupants` | GET | Bearer · `occupancy-pii-read` + `?purpose=` | **denied by default**; ได้ scope แล้วยังคืน `result: []` จนกว่ามี data source (EXT-007 scaffold) |
| `/external/bookings` | POST | Bearer · `booking-write` | จองศูนย์แทนประชาชน (M2) — body **`{location_code, persons: [{cid, first_name, last_name, phone}, …]}`** 1–100 คนต่อ request (CR-169 FR-1/FR-6) หรือ body เดิม `{location_code, cid, first_name, last_name, phone}` (= `persons` ยาว 1, D1; ส่งสองรูปแบบพร้อมกัน → 422) → **201** `result: {booking_id: "BK-{ulid}", location_code, booking_status: "BOOKED", persons_count: N}`; `booking_id` เดียวต่อกลุ่ม (ใช้กับ EXT-009/010) · **all-or-nothing** — ผิดกี่คนก็ตอบ 422 ครั้งเดียวพร้อมดัชนีทุกคนที่ผิด · ซ้ำกับศูนย์เดียวกัน → **409** `duplicate_booking` `detail: "persons[i]"` (0-based, คนแรกที่ซ้ำ; body เดี่ยว = `persons[0]`) และไม่สร้างอะไรเลย · worker เขียน `household` + `evacuee` (`pre_registered`, `registered_via: api`) **ต่อคน** ภายใน ~10s (1 คน = 1 household, `booking_ref` = `booking_id`) · ศูนย์ `full` จองได้ (EXT-008) |
| `/external/bookings/{booking_id}/cancel` | POST | Bearer · `booking-write` | body `{reason?}` (≤200) → **200** `result: {booking_id, booking_status: "CANCELLED"}` — ยกเลิก**ทั้งกลุ่ม**ด้วย call เดียว; เฉพาะ booking ของ client เดียวกัน (อื่น → 404); มีคนที่ยกเลิกไม่ได้ (เช่น check-in แล้ว) → **409** `booking_not_cancellable` และไม่เปลี่ยนแถวใดเลย (EXT-009; caveat: ยังไม่ atomic — คนที่ check-in แทรกระหว่าง phase อาจทำให้แถวก่อนหน้าถูกยกเลิกไปแล้ว; ยอมรับ residual ตาม CR-169 decision sync (#612) — ปิดจริงต้อง [#616](https://github.com/r202-coe-psu/tent/issues/616)) · ยกเลิกเฉพาะคนที่ยังเปิดอยู่ (`pending` หรือ `written` ที่ยังไม่ขอยกเลิก) ข้ามคนที่จบแล้ว (`cancelled`, `rejected`, `written` ที่ขอยกเลิกแล้ว) โดยไม่เขียนทับ `cancel_reason` เดิม; ไม่เหลือคนเปิดอยู่และมี `cancelled`/`cancel_requested` ≥ 1 → **200** idempotent; ทุกคน `rejected` → **409** `booking_not_cancellable` (CR-169 FR-40) |
| `/external/bookings/{booking_id}` | GET | Bearer · `booking-write` | **200** `result: {booking_id, location_code, booking_status, reject_reason, persons: [{index, booking_status, reject_reason}], created_at, updated_at}` — `booking_status` = aggregate ของกลุ่ม; `persons[]` รายคน `index` = ลำดับใน request (0-based) — **ไม่มี CID/ชื่อ/เบอร์**; `reject_reason` ระดับบน = ของคน `REJECTED` คนแรก; ใช้ poll ผลหลัง 201 (EXT-010). aggregate ตามลำดับ: ไม่มีคนที่ยังเปิดอยู่และมี `cancelled`/`cancel_requested` ≥ 1 → `CANCELLED` (แม้มี `REJECTED` ปน) → มี `REJECTED` → `REJECTED` → อื่น → `BOOKED` (CR-169 FR-42) |
| `/external/persons/shelter-residency` | GET | Bearer · `residency-read` + `?cid=&purpose=` | M2 get-person-shelter-residency — `result: {location_code, name_th, checkin_datetime (+07:00), residency_status: CHECKED_IN\|CHECKED_OUT, stay_status, in_zone}`; ค้นด้วย `national_id_hash`; หลาย record → เลือก Present ก่อน แล้ว `updated_at` ล่าสุด; `pre_registered` = 404; log ทุก call ลง `third_party_access_logs` (ไม่เก็บ CID) (EXT-011) |

```
Success : { "status": 200, "message": "Found Data.", "result": … }
Error   : { "status": <http>, "message": "…", "code"?: "…", "detail"?: "…", "result"?: [] }
         → partner ควร key off `code` เป็นหลัก (ไม่เทียบ message string)
```

**Error codes (CR-154 — ใช้ทั้ง plane):** `400 missing_purpose` · `401 invalid_token` · `403 insufficient_scope` · `404 location_not_found` / `booking_not_found` / `residency_not_found` · `409 location_not_bookable` / `duplicate_booking` / `booking_not_cancellable` · `422 validation_error` · `500 internal_error`.

#### EXT-008–010 — ตัวอย่างและกฎกลุ่ม (CR-169, เทียบ `fastapi.json` ที่ regenerate แล้ว)

- **FR-1/FR-6** `persons` 1–100 คน (`MAX_PERSONS = 100`); ว่างหรือเกิน → 422 `validation_error`
- **FR-4** `cid` ซ้ำใน request เดียว → 422 (ระบุดัชนีที่ซ้ำ)
- **422 รวมทุกคนที่ผิด:** message ระบุทุกดัชนีที่ผิดในครั้งเดียว เช่น `persons[1].phone`, `persons[3].cid` · **ไม่มีค่า CID / ชื่อ / เบอร์ใน message** · body เดี่ยวเดิมใช้ message เดิม
- **409 `duplicate_booking`:** `detail` = `"persons[i]"` (0-based, คนแรกที่ซ้ำ; body เดี่ยวเดิมได้ `persons[0]`) · ไม่มี CID/ชื่อ · ทั้งกลุ่มไม่ถูกสร้าง ไม่มีแถวค้างใน buffer
- **booking_id** = `BK-{ulid}` เดียวทุกคนในกลุ่ม (รหัสกลุ่ม) · แต่ละคนมี `_id` เป็น `BP-{ulid}` ของตัวเอง (อย่าคาดว่า `_id == booking_id`)
- **Access log (EXT-008–010):** 1 แถวต่อ request ใน `third_party_access_logs` (§9.4) · `result_count = persons_count` เมื่อ `granted` (EXT-008) และ `0` เมื่อ `denied` · ไม่เก็บ CID/ชื่อ/เบอร์

**ตัวอย่าง — EXT-008 กลุ่ม (2 คน)**

```json
POST /external/bookings
{
  "location_code": "SH014",
  "persons": [
    { "cid": "1909800123458", "first_name": "สมชาย", "last_name": "ใจดี", "phone": "0812345678" },
    { "cid": "1101700207030", "first_name": "สมหญิง", "last_name": "ใจดี", "phone": "0898765432" }
  ]
}

201
{ "status": 201, "message": "Booking accepted.",
  "result": { "booking_id": "BK-01J…", "location_code": "SH014", "booking_status": "BOOKED", "persons_count": 2 } }
```

**ตัวอย่าง — EXT-008 รูปแบบเดิม (คนเดียว)** — ตอบ 201 เหมือนเดิม โดย `persons_count: 1`

```json
POST /external/bookings
{ "location_code": "SH014", "cid": "1909800123458", "first_name": "สมชาย", "last_name": "ใจดี", "phone": "0812345678" }

201
{ "status": 201, "message": "Booking accepted.",
  "result": { "booking_id": "BK-01J…", "location_code": "SH014", "booking_status": "BOOKED", "persons_count": 1 } }
```

**ตัวอย่าง — EXT-008 422 หลายคนผิด** (ดัชนี 1 และ 3 ผิด — ไม่มีค่าที่ส่งมาใน message)

```json
422
{ "status": 422, "code": "validation_error",
  "message": "Required fields missing or blank: persons[1].first_name. persons[1].cid must be 13 digits with a valid checksum. persons[3].phone must be a 9–10 digit Thai number." }
```

**ตัวอย่าง — EXT-008 409 duplicate** (คนที่ดัชนี 1 มีผู้จองอยู่แล้วที่ศูนย์เดียวกัน)

```json
409
{ "status": 409, "code": "duplicate_booking",
  "message": "This person already holds a booking at this location.", "detail": "persons[1]" }
```

**ตัวอย่าง — EXT-009 ยกเลิกทั้งกลุ่ม** (`POST /external/bookings/BK-01J…/cancel`, body `{"reason": "…"}` ไม่บังคับ)

```json
200
{ "status": 200, "message": "Booking cancelled.", "result": { "booking_id": "BK-01J…", "booking_status": "CANCELLED" } }
```

**ตัวอย่าง — EXT-010 สถานะกลุ่ม** (`GET /external/bookings/BK-01J…`)

```json
200
{ "status": 200, "message": "Found Data.",
  "result": {
    "booking_id": "BK-01J…", "location_code": "SH014",
    "booking_status": "BOOKED", "reject_reason": null,
    "persons": [
      { "index": 0, "booking_status": "BOOKED", "reject_reason": null },
      { "index": 1, "booking_status": "BOOKED", "reject_reason": null }
    ],
    "created_at": "2026-10-17T10:00:00+07:00", "updated_at": "2026-10-17T10:00:03+07:00"
  } }
```

**EXT-009/010 — กฎการยกเลิกกลุ่มและ aggregate `booking_status`** (CR-169 FR-40/FR-42, decided 2026-10-17):

- **FR-40 (ยกเลิกทั้งกลุ่ม):** ยกเลิกเฉพาะคนที่ยังเปิดอยู่ (`pending` หรือ `written` ที่ยังไม่ขอยกเลิก); คนที่จบแล้ว (`cancelled`, `rejected`, `written` ที่ขอยกเลิกแล้ว) ถูกข้ามและไม่เขียนทับ `cancel_reason` เดิม · ถ้ามีคนเปิดอยู่ที่ยกเลิกไม่ได้ → 409 `booking_not_cancellable` และไม่เปลี่ยนแถวใด · ไม่เหลือคนเปิดอยู่ และมี `cancelled` หรือ `cancel_requested` อย่างน้อย 1 คน → **200 idempotent** · ทุกคน `rejected` → 409 `booking_not_cancellable`
- **FR-42 (`booking_status` aggregate):** ไม่มีคนเปิดอยู่และมี `cancelled`/`cancel_requested` ≥ 1 → `CANCELLED` · มี `REJECTED` → `REJECTED` · อื่น → `BOOKED` · `persons[]` ไม่เปลี่ยน
- **ผลข้างเคียง:** cancel ที่ล้มกลางทางแล้ว retry สำเร็จได้ เพราะคนที่ยกเลิกไปแล้วถูกข้าม
- **Legacy single-person booking** ใช้กฎ FR-40 เดียวกัน — ยกเลิกซ้ำตอบ 200; `rejected` ตอบ 409
- **นอกขอบเขต:** ล้าง stay `pre_registered` ค้างของแถว rejected → #613 · cancel แบบ atomic (`update_many`) → #612

แยกจาก §5.1: ไม่ใช้ `X-API-Key` / `/external/v1`; ไม่มี partner-plane rate limit 429 ในรุ่นนี้

## 6. สิ่งที่ตั้งใจ "ไม่มี"

- ไม่มี REST CRUD สำหรับ doc ปฏิบัติการ (evacuee/movement/stock/...) — ใช้ sync plane เท่านั้น
  **ข้อยกเว้น (CR-070):** public booking สร้าง `evacuee`/`household` ผ่าน BFF
  (`POST /api/public/v1/registrations`) เพราะผู้จองไม่มี session จึงเข้า sync plane ไม่ได้
  — เป็น intake action ที่ปิดตาย ไม่ใช่ CRUD surface: ไม่มี GET/PUT/PATCH/DELETE รายตัว,
  สร้างได้อย่างเดียว, สถานะบังคับเป็น `pre_registered`, และอ่านกลับได้เฉพาะผ่าน
  `/lookup` ด้วยรหัส+เบอร์ที่ตรงกัน. แก้ไข/ยกเลิกหลังจากนั้นเป็นงาน staff บน sync plane
  (เทียบเคียง `PATCH /public/v1/donations/{token}` ของ CR-052 ที่เขียน `donation` doc).
  **Photos:** `POST /api/public/v1/registrations/photos` สร้าง `image` doc (+attachments)
  ในศูนย์ที่เลือกเท่านั้น (ไม่ใช่ read/list/delete surface).
- ไม่มี JWT/refresh-token layer สำหรับ **staff sync plane** — template เดิม (`auth-interceptor`, `mock-api.js`) ไม่ใช้ (Partner plane §5.3 ใช้ JWT client_credentials แยกต่างหาก ไม่มี refresh)
- EOC dashboard / Open API tier เต็มรูปแบบยัง deferred เป็น service แยก — **แต่** Partner Data API EXT-001–011 (§5.3) เปิดให้อ่าน aggregate ให้ M6/M7 และ booking/residency ให้ M2 แล้ว (CR-154)
- ไม่มี endpoint อ่านข้อมูลรายบุคคลใน public plane; EXT-007 เป็น scaffold เท่านั้น (ไม่มี PII payload จริง); EXT-011 คืนเฉพาะสถานะการเข้าพักของ CID ที่ partner ระบุ (scope `residency-read` ออกรายกรณี + `purpose` + access log — CR-154)
