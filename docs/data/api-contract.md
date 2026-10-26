---
title: Smart Shelter — API Contract v1
status: draft for review
created: 2026-06-11
updated: 2026-10-26
note: CR-175 donor photos (implemented 2026-10-26) — §5 BFF `POST /api/public/v1/donations/photos` (multipart → `image:{ulid}` `purpose: donation`), `photos` ใน `POST /public/v1/donations` + error code ของ 422 (`PHOTO_LIMIT_EXCEEDED` / `PHOTO_NOT_FOUND` / `PHOTO_INVALID` / `PHOTO_ALREADY_USED` / `PHOTOS_TOO_LARGE`) · ไม่มี public read path ของรูป; decision sync 2026-10-26 — EXT-007 คืนรายชื่อ masked จริง (แก้คำอธิบาย scaffold เดิม) และไม่รวมคนที่ `privacy.search_excluded = true` (#791); decision sync 2026-10-25 — §2.1 kiosk register body เพิ่ม `consent` (PDPA consent block, FR-43/45; endpoint path แก้เป็น `/api/v1/kiosk/register`); CR-189 approved (2026-10-24, #838) — §2.1.3 kiosk lookup ค้นคิวกลางต่อเมื่อไม่พบใน `shelter_*` (QR รับ ULID เปล่าของตั๋วไม่ระบุศูนย์) + check-in claim ก่อน (error `KIOSK_CLAIM_*` / `KIOSK_QUEUE_UNAVAILABLE`), §2.1.1 ThaiD primary ที่ไม่ถูกเลือกใช้สมาชิกแทนได้, §5.2 FastAPI `kiosk-lookup` / `kiosk-claim/prepare` / `kiosk-claim/revert` (service secret); CR-158 §9 (ข้อเสนอทีม kiosk 2026-10-24, #796 — ยังไม่ approved) — §2.2 `POST /api/v1/kiosk/reprint` รับ `staff_pin` แทน `id_last4` ได้; CR-182 approved (2026-10-21, #751) — EXT-002/003 เพิ่ม `accepts_booking` + filter `?accepts_booking=`; EXT-008 เปลี่ยนกติกา bookability (ศูนย์ที่ไม่มี `accepts_pre_registration` = จองไม่ได้ → 409 — breaking สำหรับ M2) + scope ใหม่ `booking-bypass` (EOC override; log `granted_bypass`, `external_bookings.bypass`); CR-181 approved (2026-10-21) — EXT-012 `POST /external/persons/search` (scope `occupant-search`) + sort deterministic ของ ID search (#736); CR-176 (2026-10-20) — EXT-011 `cancelled` / `kiosk_registered` (ไม่เคย check-in) = 404 `residency_not_found` (#710); คู่กับ data-model.md v3 — ตัดสิน sync boundary: staff app คุย CouchDB ตรง, service API มีเฉพาะที่ CouchDB ทำเองไม่ได้; CR-112/CR-113 occupancy + unassigned registration; Partner Data API EXT-001–007 (#214); CR-124 staff Google step-up MFA + Google SSO login (enrolled + mint AuthSession); decision sync 2026-10-08 — เพิ่ม GET /public/v1/unassigned-registrations/{id}/status (service secret, status-only) แทนการเรียก staff detail จาก BFF registrations/status — แก้ ticket คิวกลางหายจากอุปกรณ์ (QA pre-register 2026-10-08); decision sync 2026-10-09 — `breakdown` ของ EXT-005 เพิ่ม `gender_unspecified` (null+other; `male+female+gender_unspecified = occupancy_total`) และ `POST /public/v1/unassigned-registrations` รับ `members[].gender = null`; CR-157 (2026-10-10) — เพิ่ม `GET /api/public/v1/donations/slots` (BFF-only อ่าน CouchDB ฝั่ง server) และ error code ของ slot ใน `POST /public/v1/donations` (`SLOT_REQUIRED`, `SLOT_UNAVAILABLE`, `SLOT_FULL`, `SLOTS_UNAVAILABLE`); CR-162 — §2.3 kiosk banner (`POST /api/v1/kiosk/banners`, signed image GET, back-office `/api/back-office/kiosk-banners/**` + `PUT …/order`) และ §2.2 field เครื่อง `screen_type` / `banner_enabled` (ส่วนที่ปรับ 2026-10-15..17 Team Lead อนุมัติ 2026-10-18); CR-151 §17 (2026-10-18, approved 2026-10-20) — §2.1.2 `POST /api/v1/kiosk/volunteer-card` พิมพ์ QR จิตอาสาแบบอ่านอย่างเดียว; CR-172 (2026-10-21) — response ของ `GET /public/v1/donations/{tracking_token}` เพิ่ม `reject_reason`/`reject_reason_code` + `received_summary.items[].rejected/reject_reason/reject_reason_code` (§5); CR-174 (2026-10-21) — `POST /public/v1/donations` response เพิ่ม `status`; `PATCH …/{tracking_token}/items` request เพิ่ม `current_items`/`current_status` (opt), response เพิ่ม `status` + `auto_approved_lines` และ `items[].review_*`; `DONOR_EDITABLE_STATUSES` = `{declared, pending_review, verifying}` (§5); CR-162 ส่วนที่ปรับ 2026-10-21 (Team Lead อนุมัติ 2026-10-22) — kiosk banner group: §2.2 `PATCH /api/v1/kiosk/devices/[id]` ตัด `banner_enabled` + summary มี `banner_group_id`, §2.3 feed กรองตาม `banner_group_id`, banner `group_id`, order body `group_id`, §2.3.1 `/api/back-office/kiosk-banner-groups/**`
---

# Smart Shelter — API Contract v1

**Sync boundary (ตัดสินในรุ่นนี้):** ระบบมี 4 plane —

| Plane                   | ใคร                          | ผ่านอะไร                                                                                                                                                                                                              |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Sync plane**       | staff app (login แล้ว)       | **Remote-first** กับ active endpoint เดียว: **central CouchDB** ปกติ; **edge CouchDB @ศูนย์** เฉพาะ WAN/central outage; ถ้าไม่เห็นทั้งคู่ให้ fail/retry (ไม่มี local-only write queue) (topology ดู data-model.md §1) |
| **B. Service plane**    | staff app เรียกเสริม         | REST `/api/v1/*` ที่ **central เท่านั้น** (ต้องมี WAN + central session) — เฉพาะงานที่ CouchDB ทำไม่ได้: export, provisioning                                                                                         |
| **C. Public plane**     | ไม่ login                    | REST `/public/v1/*` ที่ central — ดู [public-tier-flow-spec](../features/public-tier-flow-spec.html)                                                                                                                  |
| **D. Partner Data API** | ระบบพันธมิตร M6/M7 (machine) | OAuth2 `POST /external/token` + REST `/external/*` อ่านจาก MongoDB projection — ดู §5.3 ของเอกสารนี้ ([stub](./partner-api.md)), [ADR 0002](../adr/0002-partner-integration-architecture.md)                          |

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
  - ตรวจ `pending_link` → captcha → verify password กับ central `_session` ฝั่งเซิร์ฟเวอร์
  - eligibility: `must_change_password = true` **และ** ไม่มี `mfa.providers` **และ** ไม่ใช่ bootstrap `_admin`; ไม่ผ่าน → 403
  - ผูก provider (`sub` ผูกกับ user อื่น → 409) → mint `AuthSession` + `mfa_ok` → client ไป `/force-setup`
  - รหัสผิด / ไม่พบ user → 401 ข้อความเดียวกัน; rate limit ต่อ IP ที่ nginx zone `auth` (CR-188 — ยกเลิก limit ต่อ nonce)
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

| ลำดับ | Active remote                   | ใช้เมื่อ                                      | DB ที่ sync                                                                                                                                 |
| ----- | ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `https://central.example/couch` | central reachable                             | `shelter_{shelter_code}` read/write (live+retry) · `registry`/`catalog` pull/read-through                                                   |
| 2     | `https://edge.local/couch`      | WAN/central เข้าไม่ได้ แต่ LAN edge reachable | `shelter_{shelter_code}` read/write (live+retry) · `registry`/`catalog` อ่านจาก edge replica                                                |
| 3     | —                               | ไม่เห็นทั้ง central และ edge                  | disconnected status-only (ไม่มี read-only local cache); automatic retry 3 attempts, เกินนั้นแสดงแบนเนอร์ cannot connect และเปิด force retry |

- ห้ามยิง write พร้อมกันไปทั้ง central และ edge; switching endpoint ต้องหยุด traffic ไป endpoint เดิมก่อน
- edge ⇄ central เป็น replication ระดับ server สำหรับ fallback replica/backlog (provisioning ตั้งให้ — app ไม่เกี่ยว)
- เมื่อ central กลับมา app fail back ไป central; edge จะ sync backlog ช่วง outage ขึ้น central เอง
- การเขียนทุกชนิดเป็น remote-first ไป active endpoint — UI แสดงสถานะส่งข้อมูล/ลองใหม่ตามผลจริง (auto retry 3 attempts ก่อนขึ้น cannot-connect banner และเปิด force retry)
- conflict ดู data-model.md §5 — app ไม่ resolve เองนอกจาก append-only retry (409 = สำเร็จ)

### 1.3 สัญญาเชิง doc (สรุป — รายละเอียด field อยู่ data-model.md §3)

| งานใน feature spec         | การกระทำจริง                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| สร้าง/แก้คน (FR-4..6)      | `put evacuee:{ulid}` — required `first_name` + `last_name` + `gender` + `phone`; phone เป็น `null` ได้เมื่อไม่มี |
| duplicate hint (FR-5)      | query Mango index ชื่อ/phone ผ่าน active endpoint ก่อน put; override → `put audit:{ulid}`                        |
| screening (FR-7..9)        | `put screening:{ulid}` (append-only)                                                                             |
| check-in/out (FR-11..12)   | `put movement:{ulid}` + update `evacuee.current_stay`                                                            |
| ค้นหา/QR (FR-10,13)        | Mango query ที่ active endpoint (ชื่อ หรือ evacuee ULID จาก QR)                                                  |
| dashboard (FR-14)          | query views `occupancy`, `stock_balance`, ... ที่ active endpoint                                                |
| stock/donation/kitchen/ฯลฯ | put doc ตาม type ใน data-model.md §3.2                                                                           |

## 2. Service plane `/api/v1` — conventions

```
Auth      : ใช้ central AuthSession cookie เท่านั้น (service ตรวจกับ central GET /couch/_session)
Error     : { "error": { "code": "FORBIDDEN", "message": "..." } }
Content   : JSON UTF-8 · เวลาเป็น ISO-8601 UTC
Versioning: path prefix /api/v1 — breaking change = /api/v2
```

`/api/v1/*` อยู่ที่ central เท่านั้น: ระหว่าง Edge-only fallback endpoint เหล่านี้ถือว่า unavailable
(ไม่มี WAN/no route) และ edge `_session` cookie ใช้แทน central service auth ไม่ได้.

| Code                  | ความหมาย                                  |
| --------------------- | ----------------------------------------- |
| `UNAUTHENTICATED` 401 | ไม่มี/หมดอายุ session                     |
| `FORBIDDEN` 403       | role/scope ไม่พอ                          |
| `VALIDATION` 422      | payload ผิด (รายละเอียดใน `error.fields`) |
| `CONFLICT` 409        | ทำซ้ำ/สถานะไม่ให้ทำ                       |
| `RATE_LIMITED` 429    | เกิน limit                                |

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
ซ้ำฝั่ง server ก่อน lookup; เมื่อปิดตอบ `403 KIOSK_METHOD_DISABLED`.
QR และ smart-card lookup ไม่ขึ้นกับ flag เบอร์โทร. Smart-card lookup ตรวจ
`kiosk_walk_in_registration_enabled` เพื่อกำหนด `can_register`; flag นี้ควบคุมเฉพาะการเริ่ม
walk-in registration และไม่ปิด lookup หรือ check-in flow เดิม.

`POST /api/v1/kiosk/register` สร้างผู้ประสบภัยจากการอ่าน Smart Card แบบเต็ม หลังผู้ใช้
ยินยอมที่ Kiosk:

```http
POST /api/v1/kiosk/register
X-Device-ID: kiosk-sh001-01
X-Device-Secret: …
Content-Type: application/json
```

Request body เป็น `{ "card": <SmartCardData without photo_base64>, "photo": <KioskPhotoPayload|null>, "consented": true, "consented_at": <ISO-8601 UTC>, "consent": <ConsentDecision> }`.
`consent` คือผลจากบล็อกความยินยอม PDPA (`docs/features/pdpa-consent-block-spec.md`, FR-43/45): `{ mode, health?, search_visible?, guardian_for, verbal, ref, given_at, notice_version }` (`mode = basic` ไม่มี `health`/`search_visible`). Kiosk ไม่แสดงช่องผู้ปกครอง/เจ้าหน้าที่ จึง `guardian_for = []` และ `verbal = false` เสมอ. Server ตรวจด้วย Zod เดียวกับ client (FR-34), ตั้ง `channel = kiosk` และ `given_by = self`, เขียน `evacuee.consent` + `privacy.search_excluded` ตามผล (FR-30/31) และไม่สร้าง `medical` เมื่อ `mode = basic` หรือ `health = false` (FR-32). `consent` ไม่มีหรือไม่ผ่าน Zod → `400` และไม่สร้าง evacuee (FR-45). `consent` ถูกรูปแบบแต่ `given_at` ย้อนหลังเกิน 10 นาที → `400 KIOSK_CONSENT_EXPIRED` ("การยินยอมหมดเวลาแล้ว กรุณากดยินยอมอีกครั้ง") — ตู้ต้องขอความยินยอมใหม่ ไม่ retry ด้วย decision เดิม (บัตรสมาร์ทการ์ดเก็บข้อมูลบัตรไว้; ThaiD เริ่มสแกนใหม่ เพราะ session สแกนหมดอายุแล้ว); `given_at` ล้ำอนาคตเกิน 10 นาทียังเป็น `INVALID_KIOSK_REGISTRATION` (decision sync 2026-10-25). `card_snapshot.consented_at` คงไว้เหมือนเดิม.
เมื่อมีรูป `photo` มี `content_type`, `full_base64`, `thumb_base64?`, `width`, `height`,
`original_size`, `compressed_size` และ `thumbnail_size`; base64 ไม่มี data URL prefix.
Browser บันทึก `consented_at` ตอนผู้ใช้กดยินยอมไว้ใน in-memory state; ห้ามใส่ citizen ID ใน URL
หรือ log. `card` เป็นข้อมูลบัตรแบบเต็มจาก `read_all_data()` รวม citizen ID, ชื่อ, วันเกิด, เพศ และ
ที่อยู่. รูปจากชิปถูก compress เป็น WEBP พร้อม thumbnail ก่อนส่งใน `photo` แยก; หาก compress ไม่สำเร็จ
จะส่ง JPEG เดิมโดยไม่มี thumbnail และหากไม่มีรูปหรือรูปเกินขนาดจะลงทะเบียนต่อโดยไม่แนบรูป. Server
ผูก shelter จาก device registry เท่านั้น, ตรวจ flag ซ้ำ, ตรวจข้อมูลบัตร
และค้น record เดิมใน shelter นั้นแบบ fail-closed ก่อนสร้าง `evacuee` ที่ `schema_v: 15`,
`current_stay.status: "kiosk_registered"`, `registered_via: "kiosk"`, `household_id: null`,
`phone: null`, `card_snapshot.consented_at` และ `photo: image:{ulid}` เมื่อมีรูป. Server ตรวจ
base64, ขนาด decoded (full ≤300 KB, thumb ≤50 KB) และ magic bytes; สร้าง image document พร้อม
inline attachments ก่อนเขียน evacuee. หากเขียน evacuee ไม่สำเร็จจะลบ image ที่เพิ่งสร้างแบบ best-effort.
`card_snapshot` ที่สร้างใหม่ไม่มี `photo_base64`. สำเร็จตอบ
`{ "status": "created", "evacuee_id": "evacuee:{ulid}", "qr_payload", "label", "consent_ref": "CS-XXXXXXXX", "consent_mode": "full" | "basic" }`
โดย `consent_ref` / `consent_mode` อ่านจาก `evacuee.consent` ที่เพิ่งเขียน (FR-43) เพื่อให้หน้า `/kiosk/register/done`
แสดงสรุปผลความยินยอมและเลขอ้างอิงที่ผู้ใช้ถือไปอ้างกับเจ้าหน้าที่. Endpoint ต้องตอบ
`cache-control: no-store`, `pragma: no-cache`.

การ lookup ที่ไม่มี record อนุญาตให้เริ่มลงทะเบียนเมื่อ flag เปิด โดยส่ง `can_register: true`
ใน not-found response. เมื่อ flag ปิดให้ส่ง `can_register: false`. Record เดิมที่ไม่อนุญาตให้
ลงทะเบียนซ้ำตอบ `409 KIOSK_REGISTRATION_BLOCKED`; body ไม่ผ่าน schema ตอบ `400
INVALID_KIOSK_REGISTRATION` (consent หมดเวลา → `400 KIOSK_CONSENT_EXPIRED`), flag ปิดตอบ `403 KIOSK_REGISTRATION_DISABLED`, เกิน limit ของ
nginx zone `kiosk` ตอบ `429 KIOSK_RATE_LIMITED` (CR-188), auth ไม่ผ่านตอบ `401 DEVICE_AUTH_FAILED`, และ registry/database
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

| Endpoint                                          | Body               | Response                                                                                  |
| ------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `POST /api/v1/scanner/kiosk/thaid/session`        | —                  | `200 { "session_id", "qr_url", "expires_at", "expires_in_sec" }`                          |
| `POST /api/v1/scanner/kiosk/thaid/session/status` | `{ "session_id" }` | `200 { "status", "expires_at", "expires_in_sec" }` · `404 { "status": "expired" }`        |
| `POST /api/v1/scanner/kiosk/thaid/session/cancel` | `{ "session_id" }` | `200 { "ok": true }` (idempotent — session ไม่มี / หมดอายุ / ของเครื่องอื่น ตอบเหมือนกัน) |

- `session_id` = hex 32 ตัว; รูปแบบผิด → `400 INVALID_INPUT`
- ทุก endpoint: auth ไม่ผ่าน → `401 DEVICE_AUTH_FAILED`; registry อ่านไม่ได้ → `503 DEPENDENCY_UNAVAILABLE`
- `qr_url` = `{origin}/api/v1/auth/oauth/thaid/start?mode=kiosk_check_in&session_id=…` (origin = `ORIGIN` / `PUBLIC_ORIGIN` ของ deploy)
- สร้าง session: ลำดับตรวจ auth → (rate limit ที่ nginx zone `kiosk` ต่อ IP — `429 KIOSK_RATE_LIMITED` + `retry-after: 60`; CR-188) →
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
Callback ของ mode `kiosk_check_in` และ `member_scan` **ไม่**เทียบ cookie `oauth_thaid_state` กับ `state` (แอป ThaiD อาจเปิด
callback ในเบราว์เซอร์อื่น) — ตรวจแค่ HMAC ของ `state`; `invalid_state` ใน mode นี้จึงหมายถึงไม่มี `code`/`state` หรือ `state`
เซ็นไม่ถูก. Mode อื่นยังเทียบ cookie (CR-163 KTD-AC-10, #757)

**Lookup (`POST /api/v1/scanner/kiosk/lookup`):** body `{ "source": "thaid", "session_id" }` (strict; ไม่รับ `citizen_id`).
gate → session ต้องเป็นของเครื่องนี้, `completed`, และ `shelter_code` ตรงกับเครื่อง มิฉะนั้น
`409 KIOSK_THAID_SESSION_INVALID`. Lookup ใช้ `pid` จาก session และ**ไม่** consume session. ไม่พบ → `404
PRE_REGISTRATION_NOT_FOUND` พร้อม `can_register: false` (walk-in ด้วย ThaiD อยู่นอก scope).

**Check-in (`POST /api/v1/scanner/kiosk/check-in`):** body เพิ่ม `source: "thaid"` + `thaid_session_id`; ห้ามส่ง
`citizen_id` คู่กับ `source: "thaid"` และห้ามส่ง `thaid_session_id` กับ source อื่น (`400 INVALID_CHECK_IN_INPUT`).

- ลำดับ: gate → `shelter_code` ของ session ตรงกับเครื่อง → consume session (single-use) → เขียน check-in
- `pid` ต้องตรงกับ `person_id.number` ของ `primary_evacuee_id`; ไม่ตรงหรือไม่พบ primary → `409 KIOSK_THAID_SESSION_INVALID`
  และ session ถูกใช้แล้ว (ไม่คืน)
  - ยกเว้น primary อยู่ในคิวกลางและไม่ได้ถูกเลือก (CR-189 FR-KUC-07a, §2.1.3): `pid` ต้องเป็นสมาชิกที่ `matched` ในคิวกลาง
    และตรวจกับใบลงทะเบียนผ่าน `required_person_id` ตอน `prepare` แทน
- การเขียน throw หรือสมาชิกทุกคนได้ `failed` → คืน session เป็น `completed` ให้ลองใหม่ด้วย scan เดิม
- session ไม่ใช่ `completed` / ใช้แล้ว / เป็นของเครื่องหรือศูนย์อื่น → `409 KIOSK_THAID_SESSION_INVALID`
- ตู้แนบ `source: "thaid"` เฉพาะ batch แรกที่มี primary (client ส่ง primary ไว้ batch แรกเสมอ); batch ถัดไปส่งแบบไม่มี
  `source` (ข้อเสนอ D-8 — รอ PO เคาะ)
- ช่องทาง ThaiD ไม่ใช้ face check / staff PIN

`scanner_client` แนบ device credential ให้ 3 path `thaid/session{,/status,/cancel}` เพิ่มจาก allowlist เดิม.

### 2.1.2 Kiosk พิมพ์ QR จิตอาสา ([CR-151 §17](../changes/14-kiosk/CR-151-kiosk-pre-registration-check-in.md), #609)

> ข้อเสนอทีม kiosk — approved โดย Soravit Sukkarn (Team Lead) 2026-10-20 (CR-151 §17)

จิตอาสากรอกเบอร์โทรที่ตู้ → server หา volunteer ใน `shelter_{code}` ของเครื่องเท่านั้น แล้วคืน
role-card payload **ที่มีอยู่แล้ว** (`TKT-VOL-HASH-` + `tracking_token_hash` ตัวพิมพ์ใหญ่). Endpoint
**อ่านอย่างเดียว** — ไม่ mint, rotate หรือ backfill token และไม่เขียน CouchDB (ยกเว้น device last-seen).

```http
POST /api/v1/kiosk/volunteer-card
X-Device-ID: kiosk-sh001-01
X-Device-Secret: …
Content-Type: application/json

{ "phone": "0812345678" }
```

```json
{
  "shelter_code": "SH001",
  "volunteer": {
    "display_name": "สมชาย ใจ****ดี",
    "volunteer_code": "V-012",
    "qr_payload": "TKT-VOL-HASH-…"
  }
}
```

- `display_name` = `first_name` + `maskLastName(last_name)` (+ ` (ชื่อเล่น)` ถ้ามี); ไม่คืนเบอร์หรือชื่อเต็ม
- เงื่อนไขพิมพ์ได้: `type: "volunteer"`, `status: "active"`, เบอร์ตรงกับ `phone` (หรือ `phone_hash` ที่ `phone`
  ปัจจุบันยังตรง) **เพียง 1 คน**, และมี `tracking_token_hash` เป็น hex 64 ตัว
- ตรวจ `kiosk_phone_check_in_enabled` ฝั่ง server (ใช้ toggle เดียวกับ reprint)
- Rate limit: nginx zone `kiosk` ต่อ IP (CR-188) — ไม่มี limit ต่อเครื่อง/ต่อเบอร์ในแอปแล้ว
- ตอบ `cache-control: no-store`, `pragma: no-cache`

| Status | Code                             | เมื่อ                                                                                |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| 400    | `INVALID_VOLUNTEER_CARD_INPUT`   | body ผิด / เบอร์ normalize ไม่ได้                                                    |
| 401    | `DEVICE_AUTH_FAILED`             | device credential ไม่ผ่าน                                                            |
| 403    | `KIOSK_METHOD_DISABLED`          | ศูนย์ปิด kiosk phone check-in                                                        |
| 404    | `KIOSK_VOLUNTEER_CARD_NOT_FOUND` | ไม่พบ / ต่าง shelter / `inactive` / ไม่มี hash / เบอร์ซ้ำ — **body เดียวกันทุกกรณี** |
| 429    | `KIOSK_RATE_LIMITED`             | เกิน limit ของ nginx zone `kiosk` (`retry-after: 60`; CR-188)                        |
| 503    | `DEPENDENCY_UNAVAILABLE`         | registry/CouchDB อ่านไม่ได้                                                          |

`scanner_client` แนบ device credential ให้ path `/api/v1/kiosk/volunteer-card` (same-origin POST เท่านั้น).

### 2.1.3 Kiosk claim ผู้ลงทะเบียนแบบไม่ระบุศูนย์ ([CR-189](../changes/14-kiosk/CR-189-kiosk-claim-unassigned.md))

**สรุป:** kiosk ค้นคิวกลาง Unassigned Registration (Mongo, ผ่าน FastAPI §5.2) ต่อเมื่อไม่พบใน `shelter_*` แล้ว claim
สมาชิกที่เลือกเข้าศูนย์ของ kiosk ก่อน check-in. Body ของ lookup / check-in ไม่เปลี่ยน (client ไม่ส่ง registration id).
BFF ทำ `authenticateScannerDevice` ก่อนเรียก FastAPI ทุกครั้ง; `shelter_code` / `device_id` ที่ส่งต่อมาจาก principal.

**Lookup (`POST /api/v1/kiosk/lookup`):**

- `source: "qr"` รับ `token` เป็น `evacuee:{ulid}` หรือ **ULID เปล่า** (registration `_id` บนตั๋วแบบไม่ระบุศูนย์). ULID เปล่า →
  ค้นคิวกลางทันที
- `source: "smart-card"` / `"thaid"`: ไม่พบใน `shelter_*` → ค้นคิวกลางด้วย citizen id (เฉพาะสมาชิก `open`) ก่อนตอบ not-found
- `source: "phone"` ไม่ค้นคิวกลาง
- พบ → response `household` เดิม แสดงทั้งครอบครัว:
  - `open` → `pre_registered`, เลือกได้
  - `claimed` เข้าศูนย์นี้ → สถานะจาก Couch; ไม่มี doc ใน Couch (orphan claim) → แสดงเหมือน `open`
  - `claimed` ศูนย์อื่น / `cancelled` → ไม่แสดง; ไม่เหลือใครเลย → not-found `can_register: false`
  - primary = สมาชิกที่ตรงกับ citizen id ที่สแกน; QR ตั๋ว = สมาชิกคนแรกที่แสดงได้ · นามสกุล mask เหมือนเดิม
- คิวกลางไม่พร้อม (network / 5xx / body ผิดรูป / timeout 3 วิ): QR ULID → `503 KIOSK_LOOKUP_UNAVAILABLE`;
  บัตร / ThaiD → fail open (ถือว่าไม่พบ, เสนอ walk-in ตาม flag เดิม)

**Check-in (`POST /api/v1/kiosk/check-in`):**

- สมาชิกที่เลือกแต่ไม่มี doc ใน Couch ของศูนย์ → BFF หาใบจาก `reserved_evacuee_id` → FastAPI `prepare` (timeout 6 วิ) →
  `_bulk_docs` (household ถ้ายังไม่มี + evacuee + image) ด้วย `adminFetch`; row `conflict` = OK → check-in เดิม
- ทุกคนที่เลือกมี doc ใน Couch แล้ว → ไม่เรียก FastAPI
- smart-card ส่ง `citizen_id` ของ body เป็น `required_person_id`; ThaiD ใช้ `pid` ของ session (mismatch → `409 KIOSK_THAID_SESSION_INVALID`)
- primary ไม่ถูกเลือกและไม่มีใน Couch → ใช้สมาชิกที่เลือกคนแรกที่อยู่ household เดียวกันเป็น primary แทน
- Couch ล้ม หรือ `prepare` ล้มแบบ network / timeout / 5xx หลังส่ง request → `revert` แบบ best-effort (timeout 3 วิ) แล้วไม่ check-in ใคร
- ThaiD: error ใด ๆ ที่ไม่ใช่ mismatch → คืน session ให้สแกนใหม่ได้

| Status | Code                          | ข้อความ / เมื่อ                                                       |
| ------ | ----------------------------- | --------------------------------------------------------------------- |
| 409    | `KIOSK_CLAIM_CONFLICT`        | มีสมาชิกถูกรับเข้าศูนย์อื่นแล้วหรือถูกยกเลิก กรุณาติดต่อเจ้าหน้าที่   |
| 409    | `KIOSK_CLAIM_PERSON_MISMATCH` | บัตรนี้ไม่ตรงกับผู้ลงทะเบียน กรุณาติดต่อเจ้าหน้าที่                   |
| 503    | `KIOSK_QUEUE_UNAVAILABLE`     | ระบบคิวกลางไม่พร้อม กรุณาติดต่อเจ้าหน้าที่                            |
| 503    | `KIOSK_CLAIM_FAILED`          | รับเข้าศูนย์ไม่สำเร็จ กรุณาลองอีกครั้ง (Couch write ล้ม, revert แล้ว) |

Out of scope: claim สัตว์เลี้ยง, ความจุศูนย์ (Station 3), edge/LAN (ไม่มี FastAPI → เข้าเคสคิวกลางไม่พร้อม).

### 2.2 Scanner staff PIN — ข้ามการตรวจใบหน้าด้วย PIN ของเครื่อง

> [CR-158](../changes/14-kiosk/CR-158-kiosk-staff-pin-face-bypass.md).
> PIN อยู่ใน DB `scanner_secrets` (schema.md §3.11.1) บน central เท่านั้น. ทุก response ของ endpoint ในหัวข้อนี้
> มี `cache-control: no-store`, `pragma: no-cache`. error ใช้ envelope `{ "error": { "code", "message" } }`.
> ทุก endpoint log ผู้เรียก/เครื่อง, เวลา, ผล — **ห้าม log ค่า PIN**.

**Admin (SA เท่านั้น — `_session` cookie + `system_admin`):**

| Endpoint                                                                             | Body                                                        | สำเร็จ                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /api/v1/scanner/devices` (ใหม่ — ย้ายการสร้างเครื่องจาก browser มาฝั่ง server) | `{ device_id, name, shelter_code, station_name?, status? }` | `201 { "device", "plaintext_secret", "plaintext_staff_pin" }` — สร้างเครื่องพร้อม default PIN สุ่ม |
| `POST /api/v1/scanner/devices/[id]/staff-pin`                                        | `{ "pin": "<6 หลัก>" }` หรือ `{ "regenerate": true }`       | `200 { "ok": true }` · regenerate → `200 { "ok": true, "pin": "<6 หลัก>" }`                        |
| `POST /api/v1/scanner/devices/[id]/staff-pin/reveal`                                 | —                                                           | `200 { "pin", "is_default", "updated_at", "updated_by" }`                                          |
| `DELETE /api/v1/scanner/devices/[id]`                                                | —                                                           | `200 { "ok": true }` — ลบ registry doc ก่อน แล้วลบ PIN doc (best effort)                           |

**Field เครื่องของ CR-162 ([CR-162](../changes/14-kiosk/CR-162-kiosk-banner.md) FR-KBR-36/40 · path ตาม CR-165 คือ
`/api/v1/kiosk/devices`):** `POST /api/v1/kiosk/devices` รับ `screen_type` (`compact` | `portrait` · ไม่ส่ง = `compact`)
และเขียน `banner_enabled: true` · `PATCH /api/v1/kiosk/devices/[id]` รับ `screen_type` และ `banner_enabled` (boolean)
ร่วมกับ field เดิม · summary ของรายการเครื่องมี `screen_type` และ `banner_enabled` เสมอ (doc ที่ไม่มี field อ่านเป็น
`compact` / `true`).

> **ปรับ 2026-10-21 — เสนอโดยทีม kiosk (Team Lead อนุมัติ 2026-10-22; CR-162 FR-KBG-14..15):** `banner_enabled` ถูกแทนที่ด้วย
> `banner_group_id` — `POST /api/v1/kiosk/devices` **ไม่เขียน** `banner_enabled` อีก (เครื่องใหม่ไม่มีกลุ่ม) ·
> `PATCH /api/v1/kiosk/devices/[id]` **ไม่รับ** `banner_enabled` (strict body → `422`; การจัดกลุ่มเครื่องทำผ่าน
> `/api/back-office/kiosk-banner-groups/**` §2.3.1 เท่านั้น — PATCH ของเครื่องไม่รับ `banner_group_id`) · summary ของรายการ
> เครื่องและของ `PATCH` มี `banner_group_id: string | null` (ไม่มีกลุ่ม = `null`) **แทน** `banner_enabled` · `screen_type` ไม่เปลี่ยน.

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

| ผล                                                                        | Response                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| PIN ถูก                                                                   | `200 { "ok": true }` ตอบทันที                                                                    |
| PIN ผิด                                                                   | `401 staff_pin_invalid` ตอบหลังหน่วงประมาณ 1 วินาที                                              |
| device credential ผิด                                                     | `401 DEVICE_AUTH_FAILED` (ตรวจก่อน PIN)                                                          |
| PIN ไม่ใช่ตัวเลข 6 หลัก (ว่าง, สั้น/ยาว, มีตัวอักษร) หรือ body อ่านไม่ได้ | ถือเป็น PIN ผิด: `401 staff_pin_invalid` หลังหน่วงเหมือนกัน (ตรวจ format ก่อน `timingSafeEqual`) |
| คิวของเครื่องเต็ม (ตรวจอยู่ 1 + รอ 1)                                     | `429 RATE_LIMITED` ตอบทันที ไม่รับเข้าคิว                                                        |
| เครื่องไม่มี PIN doc                                                      | `409 staff_pin_not_set`                                                                          |
| registry / `scanner_secrets` ใช้ไม่ได้                                    | `503 DEPENDENCY_UNAVAILABLE`                                                                     |

ไม่ล็อกเครื่องและไม่จำกัดจำนวนครั้ง แต่ server ตรวจ PIN ได้ทีละ request ต่อเครื่อง (request ที่ซ้อนเข้ามารอคิวได้
1 request; เกินนั้น `429`; device auth ตรวจก่อนเข้าคิว เครื่องที่ credential ผิดจึงไม่กินที่ในคิว)
และ log ระดับ `warn` ทุกครั้งที่ PIN ผิดติดกันครบ 5 ครั้งต่อเครื่อง (ตัวนับอยู่ใน memory, reset เมื่อ PIN ถูกหรือ
server restart). `scanner_client` แนบ device credential ให้เฉพาะ request `POST` same-origin จากหน้า kiosk.

**Reprint ด้วย PIN (ข้อเสนอ [CR-158 §9](../changes/14-kiosk/CR-158-kiosk-staff-pin-face-bypass.md), #796 — ยังไม่ approved):**
`POST /api/v1/kiosk/reprint` รับ `id_last4` **หรือ** `staff_pin` อย่างใดอย่างหนึ่ง (ทั้งคู่ / ไม่มีเลย = `400 INVALID_REPRINT_INPUT`):

```json
{
  "phone": "0812345678",
  "primary_evacuee_id": "evacuee:…",
  "staff_pin": "482913",
  "evacuee_ids": ["evacuee:…"]
}
```

ตรวจ phone / shelter scope ของ primary ก่อน (`404 KIOSK_REPRINT_NOT_FOUND`) แล้วตรวจ PIN ของเครื่องที่ยืนยันตัวตนแล้วด้วยกติกาเดียวกับ
verify ข้างบน (คิวต่อเครื่องเดียวกัน) โดยไม่ดูเลขบัตรของ primary · สำเร็จตอบ body เดียวกับ reprint ด้วย `id_last4` ·
PIN ผิด `401 KIOSK_REPRINT_STAFF_PIN_INVALID` (หน่วง ~1 วินาที) · ไม่มี PIN `409 staff_pin_not_set` · คิวเต็ม `429 RATE_LIMITED` ·
`scanner_secrets` ใช้ไม่ได้ `503 DEPENDENCY_UNAVAILABLE` · log `[kiosk-reprint] staff_pin_bypass` เมื่อพิมพ์ด้วย PIN (ไม่มี PIN / เบอร์ / ชื่อ).

### 2.3 Kiosk banner — feed ของตู้ + back-office ([CR-162](../changes/14-kiosk/CR-162-kiosk-banner.md))

**ฝั่งตู้ (device credential, `cache-control: no-store` + `pragma: no-cache`)**

```http
POST /api/v1/kiosk/banners
X-Device-Id: kiosk-01
X-Device-Secret: <secret>
```

คืน banner ของ `shelter_code` และ `screen_type` ของเครื่อง (จาก device principal เท่านั้น — เครื่องที่ไม่มี
`screen_type` = `compact`) ที่ `status = active` และ `start_at ≤ now < end_at` เรียง `order` → `start_at` → `_id`
สูงสุด 20 รายการ (กรองก่อนตัด cap) · เครื่องที่ `banner_enabled = false` ได้ `banners: []` โดย server ไม่ query banner:

> **ปรับ 2026-10-21 — เสนอโดยทีม kiosk (Team Lead อนุมัติ 2026-10-22; CR-162 FR-KBG-30..33) — แทนที่เงื่อนไข `banner_enabled` ด้านบน:**
> เครื่องที่ไม่มี `banner_group_id` ได้ `{ banners: [], fetched_at }` โดย server ไม่ query banner · เครื่องที่มี → คืน banner ที่
> `status = active` และ `start_at ≤ now < end_at` และ `shelter_code` + **`group_id` (= `banner_group_id` ของเครื่อง)** +
> `screen_type` ตรงกับเครื่อง (จาก device principal เท่านั้น) เรียง `order` → `start_at` → `_id` สูงสุด 20 รายการ (กรองก่อนตัด cap) ·
> banner v1 (ไม่มี `group_id`) ไม่ถูกคืน · **shape ของ response ไม่เปลี่ยน** (ด้านล่าง) · allowlist ของ `kiosk/app/manager.py` ไม่เปลี่ยน

```json
{
  "banners": [
    {
      "id": "kiosk_banner:01J...",
      "title": "แจกอาหารกลางวัน",
      "caption": "เวลา 12:00 ที่โรงอาหาร",
      "duration_sec": 10,
      "image_url": "/api/v1/kiosk/banners/kiosk_banner:01J.../image?exp=1760190000&sig=..."
    }
  ],
  "fetched_at": "2026-10-11T08:00:00.000Z"
}
```

`caption` ยังอยู่ใน response แต่ overlay บนตู้แสดงรูปอย่างเดียว (CR-162 FR-KBR-46).

| ผล                                                                                                        | Response                     |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| สำเร็จ (รวมกรณีไม่มี banner / ~~`banner_enabled = false`~~ → เครื่องไม่มี `banner_group_id` (2026-10-21)) | `200` · `banners: []` ได้    |
| device credential ผิด / เครื่อง inactive                                                                  | `401 DEVICE_AUTH_FAILED`     |
| registry ใช้ไม่ได้                                                                                        | `503 DEPENDENCY_UNAVAILABLE` |

```http
GET /api/v1/kiosk/banners/{id}/image?exp={unix_sec}&sig={hex}
```

ไม่ใช้ device header (`<img>` ส่ง GET; `kiosk/app/manager.py` แนบ credential เฉพาะ POST ใน allowlist).
`sig = HMAC-SHA256(key, "{id}.{exp}")` เป็น hex lowercase โดย `key = HMAC-SHA256(EXTERNAL_API_SECRET,
"kiosk-banner-image-url:v1")` (ไม่มี env ใหม่) อายุ 15 นาที · `200` + `content-type` ของรูป +
`cache-control: private, max-age={วินาทีที่ลายเซ็นเหลือ}` (≤900 — ตู้วนรูปเดิมซ้ำโดยไม่โหลดใหม่) · sig ผิด/หมดอายุ
`403 INVALID_SIGNATURE` · ไม่พบ / inactive / นอกช่วงเวลา `404 NOT_FOUND` · secret ไม่ได้ตั้ง / registry ใช้ไม่ได้
`503 DEPENDENCY_UNAVAILABLE` · error ทุกกรณี `no-store`.

**ฝั่ง back-office (`_session`; ผู้เรียก resolve ด้วย `requireShelterCapabilityCaller(cookie, SCANNER_MANAGER_CAPABILITIES)`)**

- SA จัดการได้ทุกศูนย์ · `{code}:shelter_manager` / `{code}:kiosk_staff` จัดการได้เฉพาะ banner ที่ `shelter_code = {code}`
- list / create / order ต้องส่ง `?shelter_code=` (ไม่ส่ง `422`) · ศูนย์นอก scope `403`
- endpoint ที่มี `{id}`: ไม่พบ หรือ `shelter_code` ของ doc อยู่นอก scope → `404 NOT_FOUND` (ไม่บอกว่ามี id อยู่)
- ไม่มี session `401 UNAUTHENTICATED` · ไม่ใช่ SA และไม่มี `shelter_manager` / `kiosk_staff` ที่ศูนย์ใดเลย `403 FORBIDDEN`

| Method   | Path                                        | Body / query                                                                                                                                                                                                                                                               | สำเร็จ                                                                                                                                                                                               | ข้อผิดพลาด                                                                |
| -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET`    | `/api/back-office/kiosk-banners`            | `?shelter_code=` (req) `&view=current\|expired` (default `current`) · `current` = `end_at ≥ now` เรียง `start_at` asc · `expired` = `end_at < now` เรียง `end_at` desc                                                                                                     | `200 KioskBannerSummary[]` (ไม่มี `_attachments` · มี `image_content_type`)                                                                                                                          | `422` · `403`                                                             |
| `POST`   | `/api/back-office/kiosk-banners`            | `?shelter_code=` (req) · body = field แก้ไขได้ + `image: { content_type, data_base64 }` (req)                                                                                                                                                                              | `201 KioskBannerSummary` (`order` ต่อท้ายของ `screen_type` นั้น · **2026-10-21:** ต่อท้ายของ (`group_id`, `screen_type`) และ body ต้องมี `group_id` — ขาด / ไม่รู้จัก / กลุ่มของศูนย์อื่น `422`)     | `403` · field / รูปผิด `422`                                              |
| `GET`    | `/api/back-office/kiosk-banners/{id}`       | —                                                                                                                                                                                                                                                                          | `200 KioskBannerSummary` (มี `_rev`)                                                                                                                                                                 | `404`                                                                     |
| `PUT`    | `/api/back-office/kiosk-banners/{id}`       | field แก้ไขได้ + `_rev` (req) + `image` (opt — ไม่ส่ง = คงรูปเดิม) · ห้ามมี `shelter_code` · ไม่รับ `order`                                                                                                                                                                | `200` · **2026-10-21:** body ต้องมี `group_id` (ขาด / ไม่รู้จัก / กลุ่มของศูนย์อื่น `422`) · ย้ายกลุ่มหรือย้ายขนาดจอ → `order` ต่อท้าย slot ใหม่ · แก้ banner v1 ต้องส่ง `group_id` แล้วเขียนเป็น v2 | `404` · มี `shelter_code` หรือ field ผิด `422` · `_rev` ชน `409 CONFLICT` |
| `PATCH`  | `/api/back-office/kiosk-banners/{id}`       | `{ _rev, status }` เท่านั้น (strict)                                                                                                                                                                                                                                       | `200`                                                                                                                                                                                                | `404` · `422` · `409`                                                     |
| `DELETE` | `/api/back-office/kiosk-banners/{id}?rev=`  | — (hard delete)                                                                                                                                                                                                                                                            | `204`                                                                                                                                                                                                | `404` · `409`                                                             |
| `GET`    | `/api/back-office/kiosk-banners/{id}/image` | — (รูปสำหรับ preview ในหน้าจัดการ)                                                                                                                                                                                                                                         | `200` + รูป · `cache-control: private, no-store`                                                                                                                                                     | `404`                                                                     |
| `PUT`    | `/api/back-office/kiosk-banners/order`      | `?shelter_code=` (req) · `{ screen_type, items: [{ id, _rev }] }` ครบทุก banner ที่ยังไม่หมดอายุของขนาดนั้น · **2026-10-21:** `{ group_id, screen_type, items: [{ id, _rev }] }` ครบทุก banner ที่ยังไม่หมดอายุของ slot (`group_id`, `screen_type`) นั้น (ส่งได้ทีละ slot) | `200` (เขียน `order` 1..n เฉพาะรายการที่เปลี่ยน)                                                                                                                                                     | `403` · `id` ซ้ำ `422` · ชุด `id` ไม่ตรง / `_rev` ไม่ตรง `409`            |

"field แก้ไขได้" = `title`, `caption`, `duration_sec`, `start_at`, `end_at`, `status`, `screen_type` · รูปผิดชนิด
(magic bytes) / base64 ไม่ canonical / เกิน 2 MB หลัง decode / field ไม่ผ่าน Zod → `422 VALIDATION` · body upload
จำกัดที่ Node server ด้วย `BODY_SIZE_LIMIT=4M`.

#### 2.3.1 Kiosk banner group — back-office (2026-10-21 · Team Lead อนุมัติ 2026-10-22 — CR-162 FR-KBG-20..29)

กลุ่ม banner ต่อศูนย์ (schema.md §3.13) · guard เหมือน `/api/back-office/kiosk-banners` ทุกข้อ (SA ทุกศูนย์ ·
`{code}:shelter_manager` / `{code}:kiosk_staff` เฉพาะศูนย์ตัวเอง · list / create นอก scope `403` · endpoint ที่มี `{id}` ไม่พบหรือ
นอก scope `404` · ไม่มี session `401` · ไม่มี capability ที่ศูนย์ใด `403`). `KioskBannerGroupSummary` = field ของ doc (§3.13) + `_rev` +
`device_ids: string[]` (= `device_id` ของ `scanner_device` ที่ `banner_group_id` = กลุ่มนั้น).

| Method   | Path                                                | Body / query                                                                                                                                                          | สำเร็จ                          | ข้อผิดพลาด                                                                                           |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/back-office/kiosk-banner-groups`              | `?shelter_code=` (req)                                                                                                                                                | `200 KioskBannerGroupSummary[]` | ไม่ส่ง `shelter_code` `422` · นอก scope `403`                                                        |
| `POST`   | `/api/back-office/kiosk-banner-groups`              | `?shelter_code=` (req) · `{ name, description?, device_ids?: string[] }` — server สร้างกลุ่มก่อน แล้วกำหนดเครื่องใน `device_ids` (flow: เลือกเครื่องก่อนสร้าง banner) | `201 KioskBannerGroupSummary`   | นอก scope `403` · field ผิด / เครื่องของศูนย์อื่น `422` · `name` ซ้ำในศูนย์ (case-insensitive) `409` |
| `GET`    | `/api/back-office/kiosk-banner-groups/{id}`         | —                                                                                                                                                                     | `200 KioskBannerGroupSummary`   | ไม่พบ / นอก scope `404`                                                                              |
| `PUT`    | `/api/back-office/kiosk-banner-groups/{id}`         | `{ _rev, name, description? }`                                                                                                                                        | `200 KioskBannerGroupSummary`   | `404` · field ผิด `422` · `name` ซ้ำ `409` · `_rev` ชน `409 CONFLICT`                                |
| `DELETE` | `/api/back-office/kiosk-banner-groups/{id}?rev=`    | — (hard delete · ล้าง `banner_group_id` ของเครื่องในกลุ่มเป็น `null`)                                                                                                 | `204`                           | `404` · กลุ่มยังมี banner (ทั้งที่ยังแสดงและหมดอายุ) `409` · `_rev` ชน `409 CONFLICT`                |
| `PUT`    | `/api/back-office/kiosk-banner-groups/{id}/devices` | `{ device_ids: string[] }` — **แทนที่สมาชิกทั้งชุด:** เครื่องที่ระบุได้กลุ่มนี้ (ย้ายออกจากกลุ่มเดิม) · เครื่องที่เคยอยู่แต่ไม่ระบุ → `banner_group_id = null`        | `200 KioskBannerGroupSummary`   | `404` · เครื่องของศูนย์อื่น `422`                                                                    |

- `name` trim 1–60 · `description` trim ≤200 · `shelter_code` = `?shelter_code=` ตอนสร้าง แก้ไม่ได้
- error ใช้ envelope `{ "error": { "code", "message" } }` เหมือน endpoint อื่นในหัวข้อ §2.3
- `KioskBannerSummary` (§2.3) มี `group_id: string | null` (banner v1 = `null` = "ยังไม่จัดกลุ่ม")

### 2.4 Referral — bulk transition และ job ปิดศูนย์ ([CR-167](../changes/09-F-referral/CR-167-referral-withdraw-close-reason-bulk.md), [CR-168](../changes/09-F-referral/CR-168-referral-shelter-closure-worker.md))

> **สถานะ:** approved ทั้งสอง CR · ยังไม่ implement · สิทธิ์ทุก route ใช้ `authorizeReferral` เดิม: `shelter_manager` ของศูนย์ตัวเอง และ `system_admin` (ต้องระบุ `shelter_code`) · error shape ตามสัญญาข้างต้น

| Method | Path                                                       | หมายเหตุ                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/back-office/referral/bulk-transition`                | `{ ids[], to, reason? }` · ตรวจสิทธิ์/transition ต่อรายการด้วย `assertActorMayTransition` ตัวเดียวกับ endpoint รายตัว · ตอบ partial success `{ succeeded[], failed[{id,error}] }` (ไม่ rollback รายการที่ผ่าน) · ขนาด `ids` proposed default 200 · concurrency จำกัด (default 5) · `reason` เก็บที่ `close_reason` เมื่อ `to=closed`, `response_reason` เมื่อ `accepted`/`rejected` |
| `GET`  | `/api/back-office/referral/close-shelter/preview`          | จำนวนที่จะถูกกระทบ แยกขาออก/ขาเข้า และสถานะ                                                                                                                                                                                                                                                                                                                                         |
| `POST` | `/api/back-office/referral/close-shelter/jobs`             | `{ reason, confirm_shelter_code }` · คืน job id ทันที (ไม่รอประมวลผล) · `status=scheduled`, `start_after` = สร้าง + 60 วินาที · `confirm_shelter_code` ไม่ตรง `shelter_code` → `422` · มี job active ของศูนย์เดียวกัน → `409`                                                                                                                                                       |
| `GET`  | `/api/back-office/referral/close-shelter/jobs/{id}`        | สถานะ + ตัวนับ + `failures[]` (ETag polling)                                                                                                                                                                                                                                                                                                                                        |
| `POST` | `/api/back-office/referral/close-shelter/jobs/{id}/cancel` | ได้เฉพาะ `scheduled` และ `now < start_after` ด้วย CAS · หลังเริ่ม → `409`                                                                                                                                                                                                                                                                                                           |
| `POST` | `/api/back-office/referral`                                | เพิ่ม: ศูนย์ที่มี job active สร้าง referral ใหม่ไม่ได้ → `409` (ศูนย์อื่น/ขาเข้าจากศูนย์อื่นไม่ถูกบล็อก)                                                                                                                                                                                                                                                                            |

**Internal worker (private network เท่านั้น — ห้ามอยู่หลัง public listener; nginx ต้อง deny):**

| Method | Path                                       | หมายเหตุ                                                                                                                                                                                              |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
>
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

| Endpoint                                                    | Auth                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /public/v1/occupants`                                 | — (audit; rate limit ที่ nginx, CR-188); ค้นชื่อ: ทุกคำ ≥2 ตัวอักษร (สูงสุด 4 คำ), หลายคำ = ชื่อต้น prefix AND นามสกุลเต็ม exact, คำเดียว = ชื่อต้น prefix หรือ นามสกุลเต็ม, เรียงคงที่ทุกประเภทการค้น (ชื่อ และเลขบัตร / พาสปอร์ต / เบอร์ — `first_name_key, _id`, CR-181), max 10 ผล (CR-166) |
| `GET /public/v1/needs`                                      | —                                                                                                                                                                                                                                                                                               |
| `POST /public/v1/donations`                                 | เบอร์โทร (+OTP เมื่อ `public_otp_required` เปิด)                                                                                                                                                                                                                                                |
| `GET /api/public/v1/donations/slots?shelter_code&date&mode` | — (BFF-only, CR-157) — BFF อ่าน `donation_slot` จาก CouchDB ฝั่ง server (doc type นี้ไม่ถูก project ลง Mongo) คืนเฉพาะช่วงเวลา/ความจุ/ยอดจอง ไม่มี PII                                                                                                                                          |
| `POST /api/public/v1/donations/photos`                      | — (BFF-only, CR-175 donor photos); rate limit ที่ nginx `public_write` (CR-188) — multipart (`shelter_code`, `full`, `thumb`) → Couch `image:{ulid}` `purpose: donation` ใน DB ศูนย์ ผ่าน `public_writer` · ตรวจ magic bytes JPEG/WEBP, ≤ 1.5MB ต่อไฟล์, ศูนย์ต้องเปิดรับบริจาค · คืน `photo_id` |
| `GET /public/v1/donations/{tracking_token}`                 | token                                                                                                                                                                                                                                                                                           |
| `PATCH /public/v1/donations/{tracking_token}`               | token                                                                                                                                                                                                                                                                                           |
| `PATCH /public/v1/donations/{tracking_token}/items`         | token                                                                                                                                                                                                                                                                                           |
| `DELETE /public/v1/donations/{tracking_token}`              | token                                                                                                                                                                                                                                                                                           |
| `GET /public/v1/transparency/*`                             | —                                                                                                                                                                                                                                                                                               |
| `POST /api/public/v1/registrations`                         | CAPTCHA (BFF-only, ไม่มีบน FastAPI); rate limit ที่ nginx (CR-188)                                                                                                                                                                                                                              |
| `POST /api/public/v1/registrations/photos`                  | rate limit ที่ nginx (CR-188) — multipart → Couch `image:{ulid}` ใน DB ศูนย์ที่เลือก (face/pet; ไม่ใช่ GridFS)                                                                                                                                                                                  |
| `POST /api/public/v1/registrations/lookup`                  | รหัสการจอง + เบอร์โทร (BFF-only)                                                                                                                                                                                                                                                                |

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

**PDPA consent บน public pre-register (FR-42 · `docs/features/pdpa-consent-block-spec.md`):** ทั้งสอง path
(`POST /api/public/v1/registrations` และ `POST /api/public/v1/unassigned-registrations`) รับ field เพิ่มสองตัว
**ทั้งคู่ required** ใน body เดิม (ไม่ส่งหรือไม่ผ่านการตรวจ → `422 INVALID_INPUT` พร้อม `details` และไม่เขียนอะไร):

| Field                 | Shape                                                                                                                                                                                                                                         | กติกา                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consent`             | ผลจากบล็อกช่อง `web`: `{ mode: "full", health: boolean, search_visible: boolean, guardian_for: string[], verbal: false, ref, given_at, notice_version }` หรือ `{ mode: "basic", guardian_for, verbal: false, ref, given_at, notice_version }` | strict (field เกินปฏิเสธ); `ref` = `CS-` + 8 ตัวอักษร ULID; `given_at` = ISO-8601 มี offset; `verbal` เป็น `false` เสมอ (ช่อง `web` ไม่มี verbal); `guardian_for` เก็บ **member key** ไม่ใช่ลำดับ |
| `consent_member_keys` | `string[]` (≥1)                                                                                                                                                                                                                               | key ของสมาชิกตามลำดับเดียวกับ `members` (ตัวแรก = ผู้ลงทะเบียน) — จำนวนต้องเท่ากับ `members` และไม่ซ้ำ; `guardian_for` ต้องเป็นสมาชิกใน list นี้และไม่ใช่ผู้ลงทะเบียน                             |

BFF คำนวณผลต่อสมาชิกด้วย `planRegistrationConsent` ตัวเดียวกับทุก channel (FR-11, FR-30–33): ผู้ลงทะเบียน `given_by = self`,
สมาชิกใน `guardian_for` = `guardian`, ที่เหลือ = `household_member`; `search_excluded = (mode = basic) หรือ search_visible = false`;
`health = false` → ไม่เขียน `medical` ของสมาชิกนั้น (FR-32) และข้อมูลสุขภาพไม่ถูกส่งต่อไป Mongo. Path `registrations` (shelter booking)
เขียน `evacuee.consent` + `privacy.search_excluded` ลง CouchDB ศูนย์ที่เลือกโดยตรงพร้อม `schema_v: 15` (`channel = web`,
`giver_evacuee_id` = evacuee id ของผู้ลงทะเบียนเมื่อ `given_by` เป็น `guardian`/`household_member`). Path `unassigned-registrations`
ส่งต่อเป็น `members[].consent` / `members[].search_excluded` ไป FastAPI (§5.2).

#### Response ของ `POST /public/v1/donations` (CR-174 FR-15)

```jsonc
// 201
{
  "success": true,
  "tracking_token": "TX-SH001-…",
  "booking_ref": "DN-306892",
  "status": "verifying",
} // หรือ "pending_review" — สถานะที่ใบเริ่ม (req)
```

`status` คำนวณจากรายการ (schema.md §2.3 "ประเมินทีละรายการ"): รายการที่จองโควต้าในแคมเปญได้ →
`approved`, อื่น ๆ (พิมพ์เอง / ไม่มีแคมเปญ / counter ยังไม่ seed) → `pending` · มี `pending` ≥ 1 →
`pending_review` · ไม่งั้น `verifying` (ตั๋วแสดง QR ทันที — FR-16). BFF `/api/public/v1/donations`
ส่ง `status` ต่อให้ client. `review_status` ของแต่ละรายการ client ส่งเองไม่ได้ (FR-3)

**donor แก้การจองของตัวเอง — สองเส้นแยกกัน** (DN-6 + CR-080)

| Path                                                | Body                                    | ทำอะไร                                                                     |
| --------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `PATCH /public/v1/donations/{tracking_token}`       | `{ "courier_tracking_no": "TH123..." }` | เลข courier tracking (DN-6) — แตะแค่ intake buffer, ปฏิเสธเพราะโควตาไม่ได้ |
| `PATCH /public/v1/donations/{tracking_token}/items` | `{ "items": [...] }`                    | แก้รายการ/จำนวน (CR-080) — ขยับ atomic counter จึงตอบ `409 NEED_FULL` ได้  |

**แยกสองเส้นโดยเจตนา ไม่ใช่เส้นเดียวที่รับสองอย่าง** — เส้นล่างเป็นเส้นเดียวที่แตะโควตา
(`router.py:106` / `router.py:124`)

```jsonc
// PATCH /public/v1/donations/{tracking_token}/items — request
{
  // line_key (CR-196 FR-LK-5) — ส่งกลับทุกรายการเดิมที่ยังอยู่ · รายการที่เพิ่มใหม่ไม่ส่ง
  "items": [{ "line_key": "01K8…", "item_id": "item:rice", "free_text": "ข้าวสาร", "qty": "8", "unit": "kg" }],
  // (opt) donation doc ใน CouchDB ก่อนแก้ ตามที่ BFF อ่านมา (service-to-service หลัง Bearer).
  // ผลประเมินของเจ้าหน้าที่อยู่ใน CouchDB ซึ่ง FastAPI อ่านไม่ได้ → ใช้ตัดสิน ALREADY_REVIEWED
  // และเป็นชุด line_key ที่ใบถืออยู่
  "current_items": [{ "line_key": "01K8…", "item_id": "item:rice", "qty": "5", "unit": "kg",
                      "review_status": "pending" }] | null,
  "current_status": "pending_review" | null
}

// 200 — response
{
  "success": true, "message": "Donation items updated",
  "revisions": 2,                       // จำนวนใน revisions[] หลังแก้
  "items": [{ "line_key": "01K8…", "item_id": "item:rice", "free_text": "ข้าวสาร", "qty": "8",
              "unit": "kg", "reserved_qty": "8", "review_status": "approved" }], // รายการที่เก็บจริง
  "revision": { "at": "…", "by": "donor", "items_before": [...], "items_after": [...] },
  "status": "verifying",                // CR-174 FR-18b — สถานะใบหลังคำนวณ (req)
  "auto_approved_lines": [0]            // CR-174 FR-26 — index ใน items ที่ได้ approved อัตโนมัติครั้งนี้
}
```

BFF `items/+server.ts` เขียน `items`, `revisions`, `status` และ `schema_v` ปัจจุบันของ donation ลง
CouchDB ใน `PUT` เดียว แล้วเขียน `audit` อนุมัติอัตโนมัติ (`approved_by: 'system'`,
`rule: 'campaign_line'`, `lines` = `auto_approved_lines`) เมื่อ list ไม่ว่าง (FR-18b, FR-26).

**แก้ได้เฉพาะใบที่ยังไม่ได้รับการประเมิน (CR-196 FR-LK-4)** — สถานะ `declared` หรือ `pending_review`
และไม่มีรายการใดที่ `review_status` เป็น `approved`/`rejected` (อนุมัติอัตโนมัติจากแคมเปญนับด้วย) ·
ใบ `verifying`/`rejected` หรือมีรายการที่ตัดสินแล้ว → `400 ALREADY_REVIEWED` ก่อนแตะโควตา. ฐานที่ใช้ตัดสิน
= `current_items`/`current_status` ถ้าส่งมา · ไม่ส่ง: ใบที่ยังไม่ sync ใช้ intake buffer · sync แล้วใช้
`status` + `review_*` (วางทับรายการใน buffer ตามลำดับ) จาก `public_donations` · และเช็ค intake buffer
ด้วยเสมอ. BFF เช็คแบบเดียวกันกับ doc ใน CouchDB ก่อนเรียก FastAPI.

**จับคู่รายการด้วย `line_key` (CR-196 FR-LK-5..FR-LK-7)** — รายการที่ส่ง `line_key` = รายการเดิมตัวนั้น:
คง key เดิม และเติม `item_id`/`category`/`condition`/`note` ที่ request ไม่ได้ส่งจากรายการเดิม (ค่าที่ request
ส่งมาชนะ) · รายการที่ไม่ส่ง = รายการใหม่ ได้ ULID ใหม่ (ใบก่อน schema_v 8 ไม่มี key ให้อ้าง ทุกรายการจึงได้
key ใหม่ในการแก้ครั้งแรก) · `line_key` ที่ใบไม่มี → `400 UNKNOWN_LINE_KEY`, ซ้ำในคำขอเดียว →
`400 DUPLICATE_LINE_KEY` (ทั้งสองไม่ขยับโควตา). ไม่มีการจับคู่ด้วยชื่อหรือเนื้อหาแล้ว ยกเว้นการเติม
`item_id` ให้รายการที่ไม่มี `line_key` จากรายการเดิมชื่อเดียวกัน (`_carry_item_ids`). ทุกรายการคำนวณ
`review_status` ใหม่: จองโควต้าในแคมเปญได้ → `approved` (นับใน `auto_approved_lines`), ไม่ได้ → `pending` ·
ใบ `declared` (ก่อน schema_v 7) ไม่เขียน `review_status` และคง `declared`. ผลเขียนลง intake buffer
(`items_declared` + `status`) และ stub `public_donations` (`items_declared` ทุกกรณี · `status` เฉพาะใบที่
BFF ไม่ได้ส่ง `current_status` — ใบที่ sync แล้วได้ `status` จาก projector หลัง BFF เขียน CouchDB สำเร็จ)

> `items[].unit` ต้องเป็น `item_master.base_unit` (code เช่น `kg`) เมื่อส่ง `item_id` มาด้วย —
> ป้ายภาษาไทยที่ผู้ใช้เห็นเป็นเรื่องของชั้น UI เท่านั้น (schema.md §2.1; ด่านตรวจรับตอบ
> `CATALOG_MISMATCH` ถ้าไม่ตรง)

`items` เป็น **ชุดเต็มที่ต้องการให้เป็น** ไม่ใช่ delta — ลบรายการ = ไม่ส่งมันมา. ระบบคิด
ส่วนต่างกับที่จองไว้เดิมเอง แล้ว release ก่อน reserve เสมอ เพื่อให้การย้ายจำนวนระหว่าง item
ไม่ชนเพดานของตัวเอง.

| สถานะ                      | ความหมาย                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`                      | แก้สำเร็จ — บันทึก `revisions[]` เพิ่ม 1 รายการ                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `400 ALREADY_REVIEWED`     | ใบได้รับการประเมินแล้ว — `verifying`, `rejected` หรือมีรายการที่ `review_status` เป็น `approved`/`rejected` (CR-196 FR-LK-4) · ไม่แตะโควตา · body `{ success: false, error: "ALREADY_REVIEWED" }` · ผู้บริจาคยกเลิกแล้วจองใหม่ หรือแจ้งเจ้าหน้าที่หน้างาน (ยกเลิกและเลขพัสดุยังทำได้ใน `{declared, pending_review, verifying}` — FR-LK-10/11) |
| `400 UNKNOWN_LINE_KEY`     | `line_key` ที่ใบไม่มี (CR-196 FR-LK-5) · ไม่แตะโควตา · body มี `line_key` ที่ไม่รู้จัก |
| `400 DUPLICATE_LINE_KEY`   | `line_key` เดียวกันสองรายการในคำขอเดียว (CR-196 FR-LK-5) · ไม่แตะโควตา |
| `400`                      | สถานะอื่นนอก `{declared, pending_review, verifying, rejected}` — ของถึงศูนย์/ปิดใบไปแล้ว · body `error` = `Cannot edit a donation in status "…"` · เช็คกับ `current_status` ถ้า BFF ส่งมา และกับ `status` ของ intake buffer ด้วยเสมอ (settle อาจเลื่อนไปก่อนแล้ว) |
| `409 NEED_FULL`            | โควตาไม่พอ — **ของเดิมไม่เปลี่ยนเลย** ทุกการจองที่ทำไปในคำขอนี้ถูกคืนกลับ                                                                                                                                                                                                                                                                                                                                                                                                          |
| `409 BOOKING_CHANGED`      | `status` ของ intake buffer เปลี่ยนระหว่างที่คำขอนี้ขยับโควตา (เช่น ศูนย์รับของแล้ว settle ปรับเป็น `received`) — **ของเดิมไม่เปลี่ยนเลย** โควตาที่ขยับไปในคำขอนี้ถูกคืนกลับ ผู้บริจาคโหลดใหม่แล้วลองอีกครั้ง                                                                                                                                                                                                                                                                       |
| `409 GOODS_IN_STOCK`       | ศูนย์เริ่มรับของของใบนี้เข้าคลังแล้ว (มีแถว `stock_ledger` `reason: donation` ที่ `ref_id` ชี้ใบนี้) — BFF ปฏิเสธก่อนแตะโควตา · `DELETE /public/v1/donations/{tracking_token}` ตอบแบบเดียวกัน · body `{ success: false, error: "GOODS_IN_STOCK", message }` (decision sync 2026-10-22, CR-174 FR-20/21)                                                                                                                                                                            |
| `429`                      | rate limit ต่อ IP ที่ nginx (CR-188; ไม่มีเพดานจำนวนครั้งต่อใบจอง)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `503 DONATION_UNAVAILABLE` | BFF อ่านใบใน CouchDB ไม่ได้ (error อื่นนอกจาก 404 ของ DB ศูนย์ — 404 = ใบยังไม่ sync ไปทาง FastAPI ตามเดิม) — **ไม่เปลี่ยนอะไรเลย** ทั้งโควตาที่ FastAPI และ CouchDB ผู้บริจาคลองใหม่ได้ · `PATCH /public/v1/donations/{tracking_token}` (เลขพัสดุ) และ `DELETE /public/v1/donations/{tracking_token}` ตอบแบบเดียวกัน · body `{ success: false, error: "DONATION_UNAVAILABLE" }` · `GET` ไม่ได้รับผล (overlay CouchDB เป็น optional ตอบจาก FastAPI ต่อ) (decision sync 2026-10-22) |

TTL **ไม่รีเซ็ต** — `expires_at` ยังนับจาก `declared_at` เดิม

#### Response ของ `GET /public/v1/donations/{tracking_token}` (CR-172)

FastAPI อ่าน `public_donations` (fallback intake buffer เมื่อ projection ยังไม่มา); BFF
`/api/public/v1/donations/{tracking_token}` overlay ด้วย donation doc ใน CouchDB ทีละ key
(doc ชนะ projection lag) แล้วคืนรูปเดียวกัน. `donation` เป็น `dict` (OpenAPI = object
`additionalProperties`) — เพิ่ม key ใหม่ไม่เปลี่ยน OpenAPI

```jsonc
{
  "success": true,
  "donation": {
    "status": "received",              // enum ตาม schema.md §2.3
    "booking_ref": "DN-306892",
    "shelter_code": "SH001",
    "donor": { ... },                  // เฉพาะทาง buffer / BFF overlay — ไม่มี phone_hash
    "items": [{ "item_id": "item:rice", "item_name": "ข้าวสาร", "qty": "10", "unit": "kg", "category": null,
                "line_key": "01K8…" | null,      // CR-196 FR-LK-3 — null = ใบก่อน schema_v 8 / walk-in
                "review_status": "approved|pending|rejected" | null,           // CR-174 FR-17/FR-27
                "review_reason_code": "not_needed|expired|damaged|other" | null,
                "review_reason": "…" | null }],
    "logistics": { ... } | null,
    "received_summary": {              // null จนกว่าตรวจรับ — รูปเต็มดู schema.md §2.3
      "total_items": 2, "received_at": "…", "remarks": "…", "shortfalls": [ ... ],
      "items": [
        { "item_id": "item:rice", "qty": "10", "unit": "kg" },
        { "free_text": "นมกล่อง", "qty": "0", "unit": "กล่อง",
          "rejected": true, "reject_reason": "หมดอายุ — กล่องนมหมดอายุ 2 กล่อง", "reject_reason_code": "expired" }
      ]
    } | null,
    "reject_reason": "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ" | null,          // CR-172 FR-1
    "reject_reason_code": "not_needed|expired|damaged|other" | null,     // CR-172 FR-2
    "updated_at": "…", "expires_at": "…" | null,
    "revisions": [ ... ]               // CR-080
  }
}
```

- `reject_reason` = ข้อความที่ผู้บริจาคเห็น (label ภาษาไทยของ code + รายละเอียด, ≤ 500) — มีค่าเฉพาะ
  `status: rejected`; ใบที่ยังอยู่ใน buffer และ doc ก่อน schema_v 6 ได้ `null` ทั้งคู่ (FR-17)
- บรรทัดใน `received_summary.items[]` ที่ `rejected: true` = "ไม่รับ" ≠ "ขาด" — ไม่อยู่ใน
  `shortfalls` (FR-13); UI แสดงป้าย "ไม่รับ" พร้อมเหตุผลรายบรรทัด (FR-16)

#### Slot error codes ของ `POST /public/v1/donations` (CR-157)

BFF ตรวจช่วงเวลา (`logistics.slot`) ก่อนส่งต่อ FastAPI; ช่วงที่มีเพดานตัดสินแบบ atomic ผ่าน Mongo
`donation_slot_counters` (CR-157 §C-6). `delivery_method = parcel` ไม่จองคิว จึงไม่ผ่านด่านนี้

| สถานะ                   | ความหมาย                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `422 SLOT_REQUIRED`     | `delivery_method = shelter_pickup` แต่ไม่ได้ส่ง `logistics.slot` (FR-DS-11)                                                                                                                 |
| `409 SLOT_UNAVAILABLE`  | ช่วงที่ส่งมาไม่อยู่บนกระดาน — `shelter_pickup` ที่ศูนย์ไม่ได้ประกาศรอบ (ไม่มี doc `pickup`) (FR-DS-11) หรือ `self_dropoff` ที่ไม่มี doc และ `from`/`to` ไม่ตรงช่วงมาตรฐาน 5 ช่วง (FR-DS-12) |
| `409 SLOT_FULL`         | ช่วงเต็มตามการนับ CouchDB, ถูกปฏิเสธโดย `$inc` แบบมีเงื่อนไขบน `donation_slot_counters`, หรือ doc มี `status = closed` (FR-DS-7, FR-DS-14)                                                  |
| `503 SLOTS_UNAVAILABLE` | อ่าน `donation_slot` จาก CouchDB ไม่สำเร็จ (ไม่ใช่ 200/404) — ไม่รับ booking ที่ตรวจช่วงไม่ได้ (FR-DS-13)                                                                                   |

#### รูปของบริจาค (CR-175 donor photos)

ผู้บริจาคโหมดพิมพ์เองอัปรูปทีละรูปก่อนจองผ่าน `POST /api/public/v1/donations/photos` แล้วส่ง id ใน
`POST /api/public/v1/donations` เป็น `photos: string[]` (`image:{ulid}`; id ซ้ำนับเป็นรูปเดียว · รูปแบบ id ผิด → `422 Invalid input`).

| Upload (`POST /api/public/v1/donations/photos`) | ความหมาย |
| ----------------------------------------------- | -------- |
| `201` | `{ success: true, photo_id, content_type, filename, width, height, original_size, compressed_size, thumbnail_size }` — `content_type` และขนาดอ่านจากไฟล์จริงฝั่ง server |
| `422 EMPTY_PHOTO` / `422 PHOTO_NOT_IMAGE` | ไม่มี `full`/`thumb` หรือ bytes ไม่ใช่ JPEG/WEBP (ไม่เชื่อ `content-type`, FR-6) |
| `413 PHOTO_TOO_LARGE` | `full` หรือ `thumb` เกิน 1.5MB |
| `422 SHELTER_REQUIRED` / `422 SHELTER_CLOSED` | ไม่ส่งศูนย์ / ศูนย์ไม่มีหรือไม่เปิดรับบริจาค (`closed`, `standby`, `cancelled`) |
| `502 WRITE_FAILED` | เขียน CouchDB ไม่สำเร็จ (rollback doc แล้ว) |

BFF booking ตรวจ `photos` ตามลำดับนี้ก่อนส่งต่อ FastAPI (FR-10) ไม่ผ่านตอบ body `{ success: false, error: "<code>", error_code: "<code>" }`:

| สถานะ | ความหมาย |
| ----- | -------- |
| `422 PHOTO_LIMIT_EXCEEDED` | เกิน 30 id — ตรวจก่อนอ่าน CouchDB |
| `422 PHOTO_NOT_FOUND` | อ่านตาม `_id` ใน `shelter_{code}` ไม่เจอ (รวมรูปของศูนย์อื่น) |
| `422 PHOTO_INVALID` | ไม่ใช่ `purpose: 'donation'` |
| `422 PHOTO_ALREADY_USED` | มี `donation_id` แล้ว (ผูกกับใบอื่น) |
| `422 PHOTOS_TOO_LARGE` | `full` + `thumb` ทุกรูป (ความยาว attachment ที่เก็บจริง) รวมเกิน 10MB |
| `503 PHOTOS_UNAVAILABLE` | อ่านเอกสารรูปไม่สำเร็จ (ไม่ใช่ 200/404) — ไม่รับ booking ที่ตรวจรูปไม่ได้ |

FastAPI `DonationCreateRequest.photos: string[]` (≤ 30, default `[]`) เก็บลง buffer พร้อม `photos_linked`
(ไม่มีรูป = `true`) · worker inbound copy `photos` ลง donation doc และเขียน `image.donation_id` (FR-11a).
`GET /public/v1/donations/{tracking_token}` และ `public_donations` **ไม่มี** `photos` (FR-14).

### 5.1 External plane `/external/v1` (CR-062) — legacy

สำหรับหน่วยงานและระบบภายนอกที่ถือ managed API key (CR-062) เรียกใช้งาน — **คนละ plane กับ Partner Data API (§5.3)** (path / auth / error shape ต่างกัน). **Soft-deprecated สำหรับงานใหม่:** คง router + API Keys UI ไว้; integration ใหม่ของพันธมิตรใช้ §5.3 `/external` (OAuth2) ไม่ใช่ `/external/v1`.

> **CR-154:** บริการ M2 (`/external/v1/shelters`, `/external/v1/persons/shelter-residency` จาก CR-098) **ถูกลบ** — ย้ายไป §5.3 (EXT-002, EXT-008–011). endpoint `/external/v1` ที่เหลือ (needs, occupants, announcements, config/faqs) ไม่เปลี่ยน.

| Endpoint                       | Method | Auth                                           | Response                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/external/v1/shelters/{code}` | GET    | `Authorization: Bearer <key>` หรือ `X-API-Key` | รายละเอียดศูนย์ (`ShelterDetailResponse`)                                                                                                                                                                                                                                                         |
| `/external/v1/needs`           | GET    | เหมือนกัน                                      | รายการความต้องการ (`NeedsListResponse`)                                                                                                                                                                                                                                                           |
| `/external/v1/occupants`       | POST   | เหมือนกัน                                      | ค้นหาผู้ประสบภัยแบบ public search (`SearchAudit`; rate limit ที่ nginx zone `external`, CR-188); กติกาค้นชื่อเหมือน `/public/v1/occupants` (CR-166 — partner เห็นพฤติกรรมเปลี่ยน); ค้นเลขบัตร / พาสปอร์ต / เบอร์เรียง `first_name_key, _id` แล้ว (CR-181) — ยังคืน `cancelled` + `family_members` |
| `/external/v1/announcements`   | GET    | เหมือนกัน                                      | ประกาศ (แบ่งหน้า)                                                                                                                                                                                                                                                                                 |
| `/external/v1/config/faqs`     | GET    | เหมือนกัน                                      | FAQ config                                                                                                                                                                                                                                                                                        |

**Public shelter occupancy (CR-112):** response ศูนย์สาธารณะคืนคีย์ `occupancy` (= Forecast), `present`, `in_zone`, `capacity` แบบ additive — ดูสูตรใน `schema.md` §1.1. Public family search allow-list รวม `arriving` และ `room_confirmed`.

### 5.2 Unassigned Registration (CR-113)

คิวกลาง Mongo-only เมื่อยังไม่เลือกศูนย์ — **ไม่** สร้าง Couch `evacuee` / `public_persons` จน claim:

| Method | Path                                                           | Auth                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/public/v1/unassigned-registrations/photos`                   | public BFF + secret — GridFS face/pet photo (#255); returns `photo_id` (`gfs:{oid}`)                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/public/v1/unassigned-registrations`                          | public BFF + secret — body mirrors public UnifiedRegistration fields (+ member `photo` / pet `image_url` refs); `schema_v: 4`; optional `join_registration_id` appends into existing family (incl. closed → reopen); ทุก `members[]` ต้องมี `consent` + `search_excluded` (ด้านล่าง)                                                                                                                                                                           |
| GET    | `/public/v1/unassigned-registrations/{id}/status`              | public BFF + secret (`verify_external_secret`) — status-only, **no PII**: `{id, status, members_total, members_claimed, claimed}`; `claimed = members_claimed > 0 and status in (closed, claimed)` (partial claim = `open` → still pending); 404 `NOT_FOUND` when deleted. Caller: BFF `/api/public/v1/registrations/status` (ticket sync) — upstream errors map to 502 `STATUS_UNAVAILABLE`, never `notFound`                                                 |
| GET    | `/staff/v1/unassigned-registrations/search?q=`                 | staff session — open members + open pets                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/staff/v1/unassigned-registrations/{id}/review`               | `require_registration_staff` — read-only pre-claim review (CR-140 addendum); open members/pets + household address only (no `pets[]` claim-status list); writes nothing                                                                                                                                                                                                                                                                                        |
| GET    | `/staff/v1/unassigned-registrations/photos/{photo_id}`         | `require_registration_staff` — streams GridFS bytes (CR-140 addendum); 404 unless `photo_id` is still referenced by an **open** member `photo` or pet `image_url`                                                                                                                                                                                                                                                                                              |
| POST   | `/staff/v1/unassigned-registrations/{id}/claim`                | staff + shelter scope — body `member_ids` and/or `pet_ids`; copies nickname/religion/emergency_contact; GridFS member `photo` + pet `image_url` → Couch `image:{ulid}`; append claimed pets onto existing Couch HH                                                                                                                                                                                                                                             |
| POST   | `/public/v1/unassigned-registrations/kiosk-lookup`             | kiosk BFF + secret (`verify_external_secret`; CR-189) — body หนึ่งใน `registration_id` / `citizen_id` (13 หลัก, สมาชิก `open`) / `evacuee_id`; คืนทั้งครอบครัว `{registration_id, reserved_household_id, members[{reserved_evacuee_id, first_name, last_name, gender, age, status, claimed_shelter_code, matched}]}` — ชื่อไม่ mask (BFF mask), ไม่มีเบอร์ / person id / รูป · 404 `NOT_FOUND`                                                                 |
| POST   | `/public/v1/unassigned-registrations/{id}/kiosk-claim/prepare` | kiosk BFF + secret (CR-189) — body `shelter_code`, `device_id`, `member_ids` (1–20), `required_person_id?`; mark claimed (`claimed_by = kiosk:{device_id}`) แล้วคืน `{registration_id, shelter_code, household, evacuees[], images[{doc, full_b64, thumb_b64, content_type}]}` ให้ BFF เขียน Couch · claimed เข้าศูนย์เดียวกันแล้ว → 200 idempotent · 404 `NOT_FOUND` / `MEMBER_NOT_FOUND` · 403 `PERSON_MISMATCH` · 409 `ALREADY_CLAIMED` / `MEMBER_NOT_OPEN` |
| POST   | `/public/v1/unassigned-registrations/{id}/kiosk-claim/revert`  | kiosk BFF + secret (CR-189) — body `shelter_code`, `device_id`, `member_ids`; reopen เฉพาะสมาชิกที่ kiosk นี้ claim เข้าศูนย์นั้น + คำนวณ `open_*` ใหม่; idempotent → `{reverted: [...]}` · 404 `NOT_FOUND` · 409 `DUPLICATE_OPEN_IDENTITY` (มีคนลงทะเบียน identity เดิมระหว่างนั้น)                                                                                                                                                                           |
| DELETE | `/staff/v1/unassigned-registrations/{id}`                      | `system_admin` only                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Consent ต่อสมาชิก (FR-42, `schema_v` 3 → 4):** `members[]` ของ `POST /public/v1/unassigned-registrations` เพิ่มสอง field **required**
(ขาด → `422`; ใช้กับทั้งสร้างใหม่และ join ครอบครัวเดิม):

| Field                       | Shape                                                                                                                                                         | กติกา                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `members[].consent`         | `{ mode: "full", health: boolean, ref, given_at, notice_version, given_by }` หรือ `{ mode: "basic", health: false, ref, given_at, notice_version, given_by }` | `given_by` ∈ `self` \| `guardian` \| `household_member` (ไม่รับ `backfill`); `ref` = `^CS-[0-9A-HJKMNP-TV-Z]{8}$`; `given_at` = ISO-8601 มี offset (เก็บสตริงตามที่ client ส่ง); ไม่มี `channel`, `giver_evacuee_id`, `recorded_verbally_by` ใน request (server ผูกเอง) |
| `members[].search_excluded` | `boolean`                                                                                                                                                     | BFF คำนวณจากผลบล็อก (FR-30/31); `consent.mode = "basic"` แล้ว `search_excluded = false` → `422` (FR-31)                                                                                                                                                                 |

FastAPI **ไม่ตัดสิน policy** — BFF คำนวณต่อสมาชิกแล้ว; use case เพียงผูกให้ครบก่อนเก็บ: `channel = "web"`, `recorded_verbally_by = null`,
`giver_evacuee_id = null` เมื่อ `self` และ = `reserved_evacuee_id` ของ **สมาชิกคนแรกของ request** (ผู้ลงทะเบียน) เมื่อเป็น `guardian`/`household_member`.
ผลที่เก็บใน `unassigned_registrations.members[]` คือ `consent` (shape เดียวกับ `evacuee.consent`, `schema.md`) + `search_excluded`.
สมาชิกที่คิวไว้ก่อน `schema_v 4` ไม่มี `consent` (`null`; FR-44) และ report-in ถามความยินยอมเฉพาะคนเหล่านี้ (FR-41).

**`OpenMemberHit`** (member `open` ใน hit ของ `GET /staff/v1/unassigned-registrations/search` และ `…/{id}/review`) เพิ่ม `consent: EvacueeConsent | null`
(`null` = ยังไม่เคยให้ความยินยอม) และ `search_excluded: boolean` (default `false`) เพื่อให้หน้า report-in แสดงสรุปแบบอ่านอย่างเดียวของคนที่มี `consent` แล้ว.
Claim คัดลอก `consent` และ `search_excluded` ไป evacuee doc โดยไม่เปลี่ยนค่า (`sync` §3.3).

Claim = Mongo mark (คน+สัตว์) แล้ว birth/append Couch (option B — ดู [CR-113](../changes/00-baseline/CR-113-unassigned-registration-mongo.md) + [CR-140](../changes/00-baseline/CR-140-persistent-unassigned-family.md)); shape: `schema.md` §9.5. เมื่อไม่มี `open` เหลือ → เอกสาร `closed` (**ไม่** hard-delete); `deleted` เสมอ `false`. Public browser เรียกผ่าน SvelteKit BFF เท่านั้น (ไม่ตรง FastAPI).

**CR-140 addendum:** Staff claim UI ไม่เรียก `POST .../claim` ทันทีที่ติ๊กเลือก — ไปหน้า review (`GET .../{id}/review`, อ่านอย่างเดียว) ก่อนเสมอ; `POST .../claim` ถูกเรียกเมื่อ staff กดยืนยันในหน้านั้นเท่านั้น (ดู [CR-140](../changes/00-baseline/CR-140-persistent-unassigned-family.md) addendum ท้ายไฟล์).

### 5.3 Partner Data API — OAuth2 `/external` (EXT-001–012, #214, CR-154)

Machine-to-machine สำหรับ **M6 Resource Logistics / M7 Command Center / M2 กลุ่มเปราะบาง (CR-154)** — อ่าน MongoDB projection; ข้อยกเว้นเดียวที่เขียน = EXT-008/009 booking ผ่าน Mongo buffer `external_bookings` → worker inbound → CouchDB (FastAPI ไม่แตะ CouchDB SoR ตรง) — สถาปัตยกรรมใน [ADR 0002](../adr/0002-partner-integration-architecture.md); **as-built ส่งมอบพันธมิตร:** รายงาน as-built ส่งมอบพันธมิตรถูกลบออกจาก repo แล้ว (commit `4374bcc20`) — **§5.3 นี้คือแหล่งอ้างอิงหลัก** (ODT ใน `docs/source/` เป็น immutable archive; [stub](./partner-api.md) คงไว้เพื่อลิงก์เดิม).

| Endpoint | Method | Auth / scope | หมายเหตุสั้น |
| --- | --- | --- | --- |
| `/external/token` | POST | body: `grant_type=client_credentials`, `client_id`, `client_secret` | JWT ~3600s + `scopes[]` (EXT-001) |
| `/external/locations` | GET | Bearer · `location-read` | Location Master list (EXT-002) — แต่ละรายการมี `accepts_booking: bool` (กติกาเดียวกับ EXT-008: `location_status != closed` **และ** `feature_flags.accepts_pre_registration == true`; ไม่มี flag หรือ `raw_data` / `feature_flags` ผิดรูป (ไม่ใช่ object) หรือค่าไม่ใช่ boolean `true` เป๊ะ = `false` (ไม่ error); ค่าเดียวกันทุก partner ไม่ขึ้นกับ scope) · filter `?accepts_booking=true\|false` กรองใน Mongo (`total`/pagination ถูกต้อง; ใช้ร่วมกับ `status` ได้ — เช่น `status=closed&accepts_booking=true` = ว่าง) · รับเฉพาะ `true` / `false` ตัวพิมพ์เล็ก; ค่าอื่น (`yes`, `1`, `True`, ค่าว่าง ฯลฯ) → **422** `validation_error` (#751) |
| `/external/locations/{code}` | GET | Bearer · `location-read` | detail + `facilities` + `accepts_booking` (กติกาเดียวกับ EXT-002, #751) (EXT-003) |
| `/external/locations/{code}/stock` | GET | Bearer · `location-stock-read` | stock; `updated_at` ระดับ location (EXT-004) |
| `/external/locations/{code}/occupancy` | GET | Bearer · `occupancy-read` | breakdown (`male`, `female`, `gender_unspecified`, `child_under_5`, `elderly_over_60`, `pregnant`, `bedridden`, `disabled`) + `updated_by_role` คงที่ (EXT-005); `gender_unspecified` = `gender` เป็น `null`/`'other'`, invariant `male+female+gender_unspecified = occupancy_total` (decision sync 2026-10-09) |
| `/external/summary` | GET | Bearer · `location-read` (+ `occupancy-read` สำหรับ top-level `occupancy_total`) | `critical_items` เฉพาะ `low`/`critical` (EXT-006) |
| `/external/locations/{code}/occupants` | GET | Bearer · `occupancy-pii-read` + `?purpose=` | **denied by default**; ได้ scope แล้วคืนรายชื่อผู้พักที่ `current_stay.status = active` แบบ masked (`occupant_ref`, `name_masked`, `age_range`, `gender`, `care_flags`, `checked_in_at`) แบ่งหน้า — ไม่รวมคนที่ `privacy.search_excluded = true` (EXT-007; decision sync 2026-10-26, #791) |
| `/external/bookings` | POST | Bearer · `booking-write` | จองศูนย์แทนประชาชน (M2) — body **`{location_code, persons: [{cid, first_name, last_name, phone}, …]}`** 1–100 คนต่อ request (CR-169 FR-1/FR-6) หรือ body เดิม `{location_code, cid, first_name, last_name, phone}` (= `persons` ยาว 1, D1; ส่งสองรูปแบบพร้อมกัน → 422) → **201** `result: {booking_id: "BK-{ulid}", location_code, booking_status: "BOOKED", persons_count: N}`; `booking_id` เดียวต่อกลุ่ม (ใช้กับ EXT-009/010) · **all-or-nothing** — ผิดกี่คนก็ตอบ 422 ครั้งเดียวพร้อมดัชนีทุกคนที่ผิด · ซ้ำกับศูนย์เดียวกัน → **409** `duplicate_booking` `detail: "persons[i]"` (0-based, คนแรกที่ซ้ำ; body เดี่ยว = `persons[0]`) และไม่สร้างอะไรเลย · worker เขียน `household` + `evacuee` (`pre_registered`, `registered_via: api`) **ต่อคน** ภายใน ~10s (1 คน = 1 household, `booking_ref` = `booking_id`) · **กติการับจอง (#751):** จองได้เมื่อ `accepts_booking` = true คือ `location_status != closed` **และ** `raw_data.feature_flags.accepts_pre_registration == true` — ศูนย์ที่ไม่เคยเปิด switch (ไม่มี flag) หรือปิด หรือ `closed` → **409** `location_not_bookable` (เดิมบล็อกเฉพาะ `closed`/flag `false`; CR-154 FR-15/16, CR-169); ศูนย์ `full` ยังจองได้ถ้า switch เปิด; ศูนย์ไม่มี/`is_active=false` → 404 `location_not_found` เสมอ (ตรวจก่อน) · **`booking-bypass` (#751; ใช้คู่ `booking-write`, EOC override):** token ที่มีทั้งสอง scope จองศูนย์ที่ไม่ผ่านกติกาข้างต้น (รวม `closed`) ได้ → **201** ตามปกติ; ไม่ต้องส่ง field เพิ่ม, ใช้อัตโนมัติเมื่อศูนย์ไม่ผ่านกติกาเท่านั้น; `booking-bypass` อย่างเดียวไม่มี `booking-write` → 403 `insufficient_scope`; ใช้กับศูนย์ที่จองได้ปกติ = จองปกติ (ไม่นับเป็น bypass) · เมื่อ bypass ถูกใช้จริง: access log `status = "granted_bypass"` และ `external_bookings.bypass = true` ทุกแถวของกลุ่ม · **header `Idempotency-Key`** (ไม่บังคับ; 1–255 ตัวอักษร, ผิดรูปแบบ → 422 `validation_error`; ไม่ส่ง = พฤติกรรมเดิม) — key + body เดิม → **201** body เดิม (`booking_id` เดิม ไม่สร้างกลุ่มใหม่); key เดิม body ต่าง → **409** `idempotency_key_reused`; request แรกยังไม่จบ → **409** `idempotency_in_progress`; key ใช้ได้ 24 ชม. ต่อ client (#614) |
| `/external/bookings/{booking_id}/cancel` | POST | Bearer · `booking-write` | body `{reason?}` (≤200) → **200** `result: {booking_id, booking_status: "CANCELLED"}` — ยกเลิก**ทั้งกลุ่ม**ด้วย call เดียว; เฉพาะ booking ของ client เดียวกัน (อื่น → 404); มีคนที่ยกเลิกไม่ได้ (เช่น check-in แล้ว) → **409** `booking_not_cancellable` และโดยหลักไม่เปลี่ยนแถวใดเลย (EXT-009) · ลำดับ (#612): ตั้ง `cancel_requested` + `cancel_flag_token` ของแถว `written` ด้วย `update_many` ก่อน → อ่าน stay ใหม่ (มีคน check-in → ย้อน flag ของตัวเองแล้ว 409) → ค่อยยกเลิกแถว `pending`; แถวที่มี token ของ request อื่น → รอ ≤ 1 วิ แล้วอ่านใหม่ (หมดเวลา → 409) — รายละเอียดดู "EXT-009/010 — กฎการยกเลิกกลุ่ม" ด้านล่าง · ยังไม่ atomic: ยอมรับ residual (CR-169 decision sync 2026-10-17, PR #635 รอบ 1–3) — เช่น 409 หลังแถว `pending` บางคนถูกยกเลิกไปแล้ว; partner retry ได้ผลถูก; ปิดจริงด้วย [#616](https://github.com/r202-coe-psu/tent/issues/616) เท่านั้น · ยกเลิกเฉพาะคนที่ยังเปิดอยู่ (`pending` หรือ `written` ที่ยังไม่ขอยกเลิก) ข้ามคนที่จบแล้ว (`cancelled`, `rejected`, `written` ที่ขอยกเลิกแล้ว) โดยไม่เขียนทับ `cancel_reason` เดิม; ไม่เหลือคนเปิดอยู่และมี `cancelled`/`cancel_requested` ≥ 1 → **200** idempotent; ทุกคน `rejected` → **409** `booking_not_cancellable` (CR-169 FR-40) |
| `/external/bookings/{booking_id}` | GET | Bearer · `booking-write` | **200** `result: {booking_id, location_code, booking_status, reject_reason, persons: [{index, booking_status, reject_reason}], created_at, updated_at}` — `booking_status` = aggregate ของกลุ่ม; `persons[]` รายคน `index` = ลำดับใน request (0-based) — **ไม่มี CID/ชื่อ/เบอร์**; `reject_reason` ระดับบน = ของคน `REJECTED` คนแรก; ใช้ poll ผลหลัง 201 (EXT-010). aggregate ตามลำดับ: ไม่มีคนที่ยังเปิดอยู่และมี `cancelled`/`cancel_requested` ≥ 1 → `CANCELLED` (แม้มี `REJECTED` ปน) → มี `REJECTED` → `REJECTED` → อื่น → `BOOKED` (CR-169 FR-42) |
| `/external/persons/shelter-residency` | GET | Bearer · `residency-read` + `?cid=&purpose=` | M2 get-person-shelter-residency — `result: {location_code, name_th, checkin_datetime (+07:00), residency_status: CHECKED_IN\|CHECKED_OUT, stay_status, in_zone}`; ค้นด้วย `national_id_hash`; หลาย record → เลือก Present ก่อน แล้ว `updated_at` ล่าสุด; `pre_registered` / `kiosk_registered` / `cancelled` (ไม่เคย check-in) = 404 `residency_not_found`; row `cancelled` ถูกกรองออกก่อนเลือก record (CR-176, #710); log ทุก call ลง `third_party_access_logs` (ไม่เก็บ CID) (EXT-011) |
| `/external/persons/search` | POST | Bearer · `occupant-search` + `?purpose=` · body `{search}` | ค้นคนด้วยชื่อ / เลขบัตร 13 หลัก / พาสปอร์ต / เบอร์โทร — กติกาค้นหาและ masking เดียวกับ public search (`parse_search_query`, CR-166, CR-099); คำค้นอยู่ใน body ไม่อยู่ใน URL; ลำดับตรวจ `purpose` → scope → validation (สั้น/ผิดรูปแบบ/เกิน 200 ตัวอักษร → 422 `validation_error`) → query; `result: [{name, status, national_id (masked), gender, shelter_name, shelter_address, origin_address, checked_in_at (ISO 8601 `+07:00` \| null), care_zone, zone_name}]` สูงสุด 10 รายการ เรียง `first_name_key ASC, _id ASC`; **ไม่คืน `family_members`/เบอร์/พาสปอร์ต**; ตัด `cancelled` และคน opt-out (`search_excluded`) ใน Mongo query ก่อน limit, สถานะอื่นคืนจริง; ไม่พบ = **200** `result: []`; ตอบ `Cache-Control: no-store`; log ทุก call ลง `third_party_access_logs` (`endpoint="EXT-012"`, `location_code=""`, `result_count`; **ไม่เก็บคำค้น/CID**) และ**ไม่เขียน** `search_audits`; ไม่มี rate limit ใน FastAPI (owner คุมที่ nginx) (EXT-012, #736) |

```
Success : { "status": 200, "message": "Found Data.", "result": … }
Error   : { "status": <http>, "message": "…", "code"?: "…", "detail"?: "…", "result"?: [] }
         → partner ควร key off `code` เป็นหลัก (ไม่เทียบ message string)
```

**Error codes (CR-154 — ใช้ทั้ง plane):** `400 missing_purpose` · `401 invalid_token` · `403 insufficient_scope` · `404 location_not_found` / `booking_not_found` / `residency_not_found` · `409 location_not_bookable` (EXT-008: ศูนย์ `closed` หรือไม่ได้เปิด `accepts_pre_registration` — ไม่มี flag นับว่าปิด, #751; ข้ามได้ด้วย `booking-bypass`) / `duplicate_booking` / `booking_not_cancellable` / `idempotency_key_reused` / `idempotency_in_progress` (#614) · `422 validation_error` · `500 internal_error`. EXT-012 ใช้ `400` / `401` / `403` / `422` เท่านั้น (ไม่พบ = `200` + `result: []`, ไม่ใช่ 404).

#### EXT-008–010 — ตัวอย่างและกฎกลุ่ม (CR-169, เทียบ `fastapi.json` ที่ regenerate แล้ว)

- **FR-1/FR-6** `persons` 1–100 คน (`MAX_PERSONS = 100`); ว่างหรือเกิน → 422 `validation_error`
- **FR-4** `cid` ซ้ำใน request เดียว → 422 (ระบุดัชนีที่ซ้ำ)
- **422 รวมทุกคนที่ผิด:** message ระบุทุกดัชนีที่ผิดในครั้งเดียว เช่น `persons[1].phone`, `persons[3].cid` · **ไม่มีค่า CID / ชื่อ / เบอร์ใน message** · body เดี่ยวเดิมใช้ message เดิม
- **409 `duplicate_booking`:** `detail` = `"persons[i]"` (0-based, คนแรกที่ซ้ำ; body เดี่ยวเดิมได้ `persons[0]`) · ไม่มี CID/ชื่อ · ทั้งกลุ่มไม่ถูกสร้าง ไม่มีแถวค้างใน buffer
- **booking_id** = `BK-{ulid}` เดียวทุกคนในกลุ่ม (รหัสกลุ่ม) · แต่ละคนมี `_id` เป็น `BP-{ulid}` ของตัวเอง (อย่าคาดว่า `_id == booking_id`)
- **Access log (EXT-008–010):** 1 แถวต่อ request ใน `third_party_access_logs` (§9.4) · `result_count = persons_count` เมื่อ `granted` หรือ `granted_bypass` (EXT-008; #751) และ `0` เมื่อ `denied` · ไม่เก็บ CID/ชื่อ/เบอร์
- **Idempotency-Key (EXT-008, #614; decision sync CR-169 2026-10-17):**
  - header ไม่บังคับ 1–255 ตัวอักษร · ไม่ส่ง = พฤติกรรมเดิมทุกประการ · ค่าว่างหรือยาวเกิน → 422 `validation_error` (ตรวจหลัง scope)
  - key เก็บต่อ `client_id` (unique) อายุ 24 ชม. จาก `created_at` (TTL) — รายละเอียดแถวใน [schema.md §9.8](./schema.md)
  - **key + body เดิม** (หลัง normalize; `persons[]` และรูปแบบเดิมที่คนเดียวนับเป็นรูปแบบเดียวกัน) → **201** body เดิม: `booking_id`, `location_code`, `booking_status: "BOOKED"`, `persons_count` เดิม — ไม่สร้างแถวใหม่ และไม่ตรวจ `duplicate_booking` ซ้ำ; นับ access log เป็น `granted` (`result_count = persons_count`; ไม่ตรวจ bookability ซ้ำ — แม้ booking เดิมเป็น bypass ก็ log `granted` ไม่ใช่ `granted_bypass`)
  - **key เดิม body ต่าง** → **409** `idempotency_key_reused` (ไม่มีข้อมูลของ booking เดิมในคำตอบ)
  - **key เดิม body เดียวกัน แต่รอบแรกยังไม่จบ (`in_progress` อายุ ≤ 60 วินาที)** → **409** `idempotency_in_progress` — partner ลองใหม่ได้ภายหลัง
  - **key เดิม body เดียวกัน และ `in_progress` อายุเกิน 60 วินาที** (รอบแรกอาจค้างหลัง process ถูก kill) → ตัดสินจากแถวจริงของ `booking_id` ที่ key เก็บไว้:
    - ทุกแถวของกลุ่ม committed ครบ → **201** booking เดิม (`booking_id` เดิม) และ key เป็น completed
    - ไม่มีแถว committed เลย → key ถูก claim (lease ต่ออายุ `created_at` → ลบแถว staged ของรอบเดิม → นับซ้ำ): ไม่มีแถวเลย → key ถูกปล่อยและคำขอนี้ทำเป็นคำขอใหม่ (ได้ `booking_id` ใหม่) · คำขอซ้ำที่แข่งกันมีเพียงหนึ่งเดียวที่ได้สิทธิ์ ที่เหลือตอบ 409 `idempotency_in_progress` · ถ้า flip ที่ค้างจบครบระหว่างนั้น → 201 booking เดิม · ถ้าจบบางส่วน → 409 และลบแถวที่เหลือของกลุ่ม (ลบไม่สำเร็จ → 409 เหมือนกัน และ retry ถัดไปหลัง 60 วินาทีลองลบใหม่)
    - รอบแรกที่ค้างนานแต่ยังทำงานอยู่: ก่อน commit ตรวจว่า key ยังเป็นของรอบนี้ (`created_at` เดิม) ถ้าถูก claim แล้ว → ลบแถว staged ของรอบนี้และตอบ **409** `idempotency_in_progress` (ไม่ commit) · ถ้า flip มาถึงหลังการ claim ลบแถวไปแล้ว → **500** `internal_error` ตามกติกา shortfall โดยไม่มีแถวที่ commit
    - รอบที่เสีย lease แล้ว (key ถูก claim ระหว่างที่รอบนั้นยังทำงาน) ปิดหรือปล่อย key ไม่ได้: การ release / mark completed ทุกครั้ง guard ด้วย `_id` + `status: in_progress` + `created_at` ของรอบนั้นเอง จึงไม่ลบหรือเขียนทับ key ที่รอบใหม่ถืออยู่ — retry ถัดไปเห็น key ของรอบใหม่ตามกติกาด้านบน
    - committed บางส่วนที่ไม่เหลือแถว staged (sweeper ไม่กวาด เช่น การลบรอบก่อนล้ม) → key ถูก claim และลบแถวที่เหลือของกลุ่ม → **409** `idempotency_in_progress` · retry ถัดไปหลัง 60 วินาทีไม่พบแถว committed จึงทำเป็นคำขอใหม่
    - committed บางส่วนที่ยังมีแถว staged → **409** `idempotency_in_progress` และคำขอนี้ไม่แก้ไขแถวใด ๆ · worker sweeper กวาดกลุ่มที่ staged ค้างเกิน 60 วินาที (ลบแถว staged แล้วแถว pending ที่เหลือ) → retry ถัดไปหลังจากนั้นไม่พบแถว committed จึง claim key ได้ (ไม่ใช่ 409 จนหมด TTL)
  - รอบแรกล้มโดยยังไม่มี booking (4xx/5xx ก่อน commit, รวม `duplicate_booking` 409 และ insert key ที่ ack หาย) → key ถูกปล่อย ส่งซ้ำได้ทันที · ยกเว้น commit ล้มแล้วลบแถวของกลุ่มไม่สำเร็จ → key ไม่ถูกปล่อย (ตอบ 409 `idempotency_in_progress` จนอายุเกิน 60 วินาที แล้วตัดสินตามข้อ `in_progress` ค้าง)
  - รอบแรกถูกตัดการเชื่อมต่อระหว่าง commit: ถ้ากลุ่มถูก commit ครบแล้ว → key เป็น completed และ retry ได้ 201 body เดิม; ถ้ายังไม่ครบ → key ถูกปล่อยเหมือนข้อด้านบน (ถ้าลบแถวของกลุ่มไม่สำเร็จ key ไม่ถูกปล่อย: retry ด้วย key เดิมได้ 409 `idempotency_in_progress` จนอายุเกิน 60 วินาทีแล้วตัดสินตามข้อ `in_progress` ค้าง)
  - **G5 (ทำเสมอ ไม่ขึ้นกับ key):** ถ้า commit ตอบ error แต่แถวของ `booking_id` ที่สร้างใหม่ `committed: true` ครบ `group_size` แล้ว → **201** แทน 500 (กรณี ack หายหลัง flip สำเร็จ); ไม่ครบ → 500 `internal_error` เดิม
  - **key ค้างจาก process ที่ถูก kill:** ตัดสินตามข้อ `in_progress` อายุเกิน 60 วินาทีข้างบน (decision sync CR-169 2026-10-17, PR #666; claim และ sweeper ตามข้อ 2026-10-17 จาก code review PR #635/#665/#666) · กรณี committed บางส่วนตอบ 409 จนกว่า sweeper จะกวาดกลุ่ม แล้ว retry ถัดไปจึงดำเนินการต่อ

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

- **FR-40 (ยกเลิกทั้งกลุ่ม):** ยกเลิกเฉพาะคนที่ยังเปิดอยู่ (`pending` หรือ `written` ที่ยังไม่ขอยกเลิก); คนที่จบแล้ว (`cancelled`, `rejected`, `written` ที่ขอยกเลิกแล้ว) ถูกข้ามและไม่เขียนทับ `cancel_reason` เดิม · ถ้ามีคนเปิดอยู่ที่ยกเลิกไม่ได้ → 409 `booking_not_cancellable` และโดยหลักไม่เปลี่ยนแถวใด (ข้อยกเว้น residual race ดูบรรทัดความเสี่ยงที่ยอมรับด้านล่าง) · ไม่เหลือคนเปิดอยู่ และมี `cancelled` หรือ `cancel_requested` อย่างน้อย 1 คน → **200 idempotent** · ทุกคน `rejected` → 409 `booking_not_cancellable`
  - **FR-40 in-flight (decision sync 2026-10-17, #612):** แถว `written` ที่ `cancel_requested` และมี `cancel_flag_token` ของ request อื่น = กำลังยกเลิกอยู่ → รอสั้น ๆ (≤ 1 วินาที) แล้วอ่านใหม่: token หาย → ข้ามเป็นจบแล้ว · flag ถูกย้อน → ยกเลิกต่อ · หมดเวลา → 409 `booking_not_cancellable` และไม่เปลี่ยนแถวของ request นี้ · แถวที่ `cancel_requested` โดยไม่มี token = จบแล้ว (ข้าม) · งบรอ 1 วินาทีใช้ร่วมกันทั้งคำขอ; หมดเวลาแล้วอ่านแถวซ้ำอีกหนึ่งครั้งก่อนตอบ 409 (token หาย → ข้าม; flag ถูกย้อน → ยกเลิกต่อ)
  - **token ค้าง (decision sync 2026-10-17, review รอบ 2 ของ PR #635):** request ล้าง token ของตัวเองเฉพาะเมื่อสำเร็จ (ก่อนตอบ 200; ล้างไม่ได้ → ย้อน flag แล้วตอบ 500 · ไม่มีกำหนดเวลาถือ flag สูงสุด — กฎ "ถือ flag ได้ไม่เกิน 60 วินาที" ไม่รับ, review รอบ 3 ของ PR #635) หรือเมื่อย้อน flag สำเร็จ · ย้อน flag ล้ม (retry แล้ว) หรือ process ตาย → flag + token ค้าง — worker ไม่ยกเลิกแถวที่มี token และย้อน flag ให้เองเมื่อ token อายุเกิน 2 นาที (ไม่ยกเลิก stay) · ผลต่อ partner: retry ยกเลิกกลุ่มเดิมระหว่างนั้นได้ **409** `booking_not_cancellable` (หลังรอ 1 วินาที) ได้นานสูงสุดราว 2 นาที แล้ว retry สำเร็จ · EXT-010 ระหว่างนั้นอาจแสดง `CANCELLED` แล้วกลับเป็น `BOOKED`
  - **ความเสี่ยงที่ยอมรับ (owner decision, decision sync 2026-10-17 จาก review PR #635):** ตอบ 409 หลังยกเลิกแถว `pending` ไปแล้วบางส่วน (กรณี residual race ของ bulk cancel) — partner retry ได้ผลถูกต้อง · ปิดได้จริงเฉพาะด้วย #616
  - **ความเสี่ยงที่ยอมรับเพิ่ม (decision sync 2026-10-17, review รอบ 3 ของ PR #635):** (1) ล้าง token ได้บางแถวแล้ว Mongo ล้ม → แถวเหล่านั้นจบแล้ว (ส่งต่อ worker) ขณะตอบ 500 · (2) ล้าง token นานเกิน TTL 2 นาทีของ worker → worker อาจย้อน flag ไปแล้วขณะตอบ 200 · (3) access log `granted` ถูกเขียนแล้วแต่ commit ล้ม → ตอบ 500 · (4) client ตัดการเชื่อมต่อกลาง commit → ไม่แน่นอนว่าแถวใด commit หรือถูกย้อน (partner ไม่ได้ response) — ทุกกรณีต้อง Mongo ล้มกลางคำสั่งหรือช้าเกิน 1 นาที · partner retry ได้ผลถูกต้อง · ปิดได้จริงเฉพาะด้วย #616 (ถ้าพบใน production → replica set / transaction)
- **FR-42 (`booking_status` aggregate):** ไม่มีคนเปิดอยู่และมี `cancelled`/`cancel_requested` ≥ 1 → `CANCELLED` · มี `REJECTED` → `REJECTED` · อื่น → `BOOKED` · `persons[]` ไม่เปลี่ยน
- **ผลข้างเคียง:** cancel ที่ล้มกลางทางแล้ว retry สำเร็จได้ เพราะคนที่ยกเลิกไปแล้วถูกข้าม
- **Legacy single-person booking** ใช้กฎ FR-40 เดียวกัน — ยกเลิกซ้ำตอบ 200; `rejected` ตอบ 409
- **นอกขอบเขต:** ล้าง stay `pre_registered` ค้างของแถว rejected → #613 · cancel แบบ atomic (atomic group commit) → #616

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
- EOC dashboard / Open API tier เต็มรูปแบบยัง deferred เป็น service แยก — **แต่** Partner Data API EXT-001–012 (§5.3) เปิดให้อ่าน aggregate ให้ M6/M7 และ booking/residency ให้ M2 แล้ว (CR-154)
- ไม่มี endpoint อ่านข้อมูลรายบุคคลใน public plane; EXT-007 คืนรายชื่อผู้พักแบบ masked เฉพาะ scope `occupancy-pii-read` (ออกรายกรณี + `purpose` + access log) และไม่รวมคนที่ `privacy.search_excluded = true` (#791); EXT-011 คืนเฉพาะสถานะการเข้าพักของ CID ที่ partner ระบุ (scope `residency-read` ออกรายกรณี + `purpose` + access log — CR-154); EXT-012 ค้นคนแบบ masked ได้สูงสุด 10 รายการ (scope `occupant-search` ออกรายกรณี + `purpose` + access log, ไม่คืน `family_members` — #736)
