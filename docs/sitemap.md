---
title: Smart Shelter — Sitemap & Endpoint Map
status: draft for review
created: 2026-06-11
updated: 2026-06-11
note: แตกจาก api-contract.md v1 + role-permission-matrix — map หน้าจอ (SPA route) ↔ endpoint/doc action แบ่งตามระบบ Intake / Backoffice / Public
---

# Smart Shelter — Sitemap & Endpoint Map

เอกสารนี้สรุป **โครงหน้าจอ (sitemap) และ endpoint ที่ควรมี** ของระบบทั้งหมด แบ่งเป็น 2 ระบบหลัก
ตามผู้ใช้งาน + 1 ชั้นสาธารณะ:

1. **ระบบรับคนเข้าศูนย์พักพิง (Intake)** — งานหน้างาน: ลงทะเบียน คัดกรอง QR เข้า-ออก
2. **ระบบ Backoffice** — บริหารจัดการศูนย์: zoning, inventory, donation, kitchen, volunteer, รายงาน, provisioning
3. **Public plane** — ไม่ต้อง login (family search, donor, transparency) — อยู่นอกสองระบบแรก

ทั้งสองระบบแรกเป็น **SPA ตัวเดียวกัน** (เมนูแยกตาม role) และเป็น **offline-first**: งานปฏิบัติการ
เกือบทั้งหมด **ไม่มี REST endpoint** — เป็นการเขียน doc ลง PouchDB ฝั่ง client แล้ว sync ผ่าน
`/couch` (Plane A ใน [api-contract.md](data/api-contract.md)) endpoint จริงมีเฉพาะงานที่ CouchDB
ทำเองไม่ได้ (`/api/v1/*`, Plane B) กับชั้นสาธารณะ (`/public/v1/*`, Plane C). ดังนั้นตารางข้างล่าง
คอลัมน์ "Endpoint / Data action" จะบอกว่าแต่ละหน้า **คุยกับอะไรจริง ๆ**

Role ย่อ (ดู [role-permission-matrix](prd/role-permission-matrix.md)): **SA** system_admin ·
**SM** shelter_manager · **VOL** volunteer · **KS** kitchen_staff · **WS** warehouse_staff

---

## 0. ส่วนกลาง (ทุก role)

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/login` | login เข้า edge server ของศูนย์ตน (ทำงานแม้ WAN ขาด) | FR-1 | `POST /couch/_session` |
| *(ทุกหน้า — session check)* | whoami / ตรวจ session, derive เมนูจาก `userCtx.roles` | FR-1 | `GET /couch/_session` |
| `/logout` (action) | ออกจากระบบ — local PouchDB ยังใช้ต่อได้ offline | FR-1 | `DELETE /couch/_session` |
| `/me` | โปรไฟล์ผู้ใช้ + สถานะ sync / needsReauth | — | local (`authStore`) |

**Sync background (ไม่มี UI):** PouchDB ⇄ `shelter_{code}` (live, สองทาง) · pull `registry`,
`catalog` ทุก 5 นาที · auto-mint เมื่อ WAN ถึง central (`POST /api/v1/mint` — ดู §1)

---

## 1. ระบบรับคนเข้าศูนย์พักพิง (Intake)

ผู้ใช้หลัก: **VOL + SM** (scope ศูนย์ตน) — เส้นหลักของ flow หน้างาน: **ลงทะเบียน → คัดกรอง →
ออกบัตร/QR → เช็คอิน** (T-48..T-51) ทุกการเขียน = เขียน local ก่อนเสมอ, UI ห้าม block รอ network

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/people` | ค้นหา + รายชื่อผู้พักพิง (ชื่อ / เบอร์ / official code) | FR-10 | local Mango query — ไม่มี network call |
| `/people/register` | ลงทะเบียนบุคคล — required ขั้นต่ำ `first_name+last_name+gender`; duplicate hint จากชื่อ/เบอร์ก่อน save, override ได้ | FR-4..5 | `put evacuee:{ulid}` · override → `put audit:{ulid}` |
| `/people/[id]` | โปรไฟล์ + แก้ไขข้อมูล + ประวัติเข้า-ออก | FR-5, FR-13 | `put evacuee` (แก้) · Mango `movement(evacuee_id, occurred_at)` |
| `/people/[id]/screening` | คัดกรอง: vulnerability flags, medical notes, fast-track | FR-6..8 | `put screening:{ulid}` (append-only) + `put medical:{ulid}` |
| `/people/[id]/card` | บัตร/QR ประจำตัว — QR ฝังแค่ `official_code` ไม่มี PII/health | FR-9 | อ่าน local; code ออกโดย `POST /api/v1/mint` (app เรียกอัตโนมัติเมื่อ WAN ถึง central) |
| `/checkin` | สแกน QR / ค้นชื่อ → check-in / check-out / ย้าย; occupancy guard เตือนเกิน capacity (warning-only) | FR-11..13 | `put movement:{ulid}` (append-only) + update `evacuee.current_stay` · view `occupancy` |
| `/households` | รายการครัวเรือน + ค้นหา + check-in/out รายครัวเรือน | FR-23 | local Mango query |
| `/households/new`, `/households/[id]` | สร้างครัวเรือน + ผูกสมาชิก + ออก Household ID/QR + บันทึก pet/asset/vehicle | FR-21..24 | `put household:{ulid}` |
| `/import` | fallback: import ข้อมูลจากกระดาษ/Excel (assisted) | FR-19..20 | batch `put evacuee` (`registered_via: "import"`) |

> **ตั้งใจไม่มี:** `POST /evacuees` หรือ REST CRUD ใด ๆ สำหรับ evacuee/movement/screening —
> validation อยู่ที่ Zod ฝั่ง client + `validate_doc_update` ฝั่ง server (ดู api-contract §7)

---

## 2. ระบบ Backoffice (บริหารจัดการศูนย์)

ผู้ใช้: **SM** (ศูนย์ตน — สิทธิ์ครอบ VOL/KS/WS), **WS**, **KS**, **SA** (global)

### 2.1 Dashboard & รายงาน — SM

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/dashboard` | occupancy, capacity, vulnerable/fast-track count, เข้า-ออกวันนี้, last-updated | FR-14 | views `occupancy`, `latest_screening` (local) |
| `/exports` | สั่ง export evacuees/movements/stock/donations เป็น csv/xlsx + ติดตามสถานะ + download | FR-15..16 | `POST /api/v1/exports` · `GET /api/v1/exports/{id}` (ต้องมี WAN; ทุก export เขียน `audit`) |

### 2.2 Zoning — SM (assign: VOL ทำได้)

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/zones` | กำหนดโซน + capacity ของศูนย์; ดู occupancy ราย zone | FR-25 | แก้ zones ใน registry ผ่าน central (SA/SM) · view `occupancy` |
| `/zones/assign` | จัด/ย้าย person·household เข้าโซน | FR-26 | `put movement` (action: transfer) + update `current_stay.zone` |

### 2.3 Inventory & Supply — WS (SM ดู dashboard ได้)

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/inventory` | stock dashboard + reorder alert + ตั้ง threshold | FR-31 | view `stock_balance` · catalog `supply_item.reorder_level` |
| `/inventory/receive` | รับของเข้า (inbound) | FR-28 | `put stock_ledger:{ulid}` (+qty, append-only) |
| `/inventory/distribute` | จ่ายของออก (outbound) | FR-29 | `put stock_ledger:{ulid}` (−qty) |
| `/inventory/transfers` | โอนของข้ามศูนย์: สร้างคำขอ → ส่ง → ยืนยันรับ | FR-30 | `put stock_transfer` (state machine `requested→shipped→received`, forward-only) |

### 2.4 Donation — WS/SM

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/donations` | รายการ pre-declaration จาก public + บันทึกรับของจริงหน้างาน + audit trail | FR-32..33, 35 | `put donation` (state `declared→received→expired`) |
| `/donations/campaigns` | ประกาศความต้องการของศูนย์ (needs ที่ public เห็น) + cut-off + smart redirect config | FR-36..37 | `put donation_campaign` · view `needs_open` |
| `/donations/transparency` | จัดทำ/publish transparency report 🔒 (governance ก่อนเปิด) | FR-38 | publish ผ่าน central → Plane C |

### 2.5 Kitchen & Food — KS (SM ครอบ)

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/kitchen/meal-plans` | แผนมื้ออาหารจาก occupancy × recipe + แสดง "stock ทำได้กี่กล่อง" (producible) | FR-39 | `put meal_plan` · views `occupancy`, `stock_balance` + producible calc ฝั่ง client |
| `/kitchen/requisitions` | เบิกวัตถุดิบ — ตัด stock ตรง (no approval) | FR-40 | `put kitchen_requisition` + `put stock_ledger` (−qty) คู่กัน |
| `/kitchen/service` | บันทึกแจกอาหารจริงต่อมื้อ + kitchen dashboard | FR-41 | `put meal_service` (append-only) · view `meals_served` |

### 2.6 Volunteer — SM

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/volunteers` | ทะเบียนอาสาสมัคร + skills (อาสาไม่จำเป็นต้องมี login) | FR-42 | `put volunteer:{ulid}` |
| `/volunteers/shifts` | skill match + จัดเวร/มอบหมายงาน | FR-43 | `put shift_assignment:{ulid}` |

### 2.7 SOP & Resource Calculation — SM ดู / SA config

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/resources` | daily resource calculation (น้ำ/อาหาร/ของใช้ ต่อ occupancy) + dashboard | FR-45..46 | views + `sop_profile` (catalog, read-only บน device) |

### 2.8 Security & Referral — SM เท่านั้น

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/security-events` | บันทึก/ติดตามเหตุการณ์ความปลอดภัย | FR-47 | `put security_event:{ulid}` (append-only) |
| `/referrals` | ส่งต่อหน่วยงานภายนอก — SM เห็น flag medical-emergency แต่ **medical detail = null** | FR-48 | `put referral` (state `draft→sent→accepted|rejected→closed`) |

### 2.9 Administration — SA เท่านั้น (global, ต้องมี WAN ถึง central)

| Route | หน้าที่ | FR | Endpoint / Data action |
| --- | --- | --- | --- |
| `/admin/shelters` | เปิดศูนย์: สร้าง db + `_security` + design docs + edge credentials/replication | FR-2..3 | `POST /api/v1/shelters` |
| `/admin/shelters/[code]` | แก้ config ศูนย์ + **ปิดศูนย์** (เริ่มนาฬิกา retention 3 เดือน) | FR-2 | `POST /api/v1/shelters/{code}/close` |
| `/admin/users` | สร้าง/แก้ user + role + เปลี่ยนรหัสผ่าน (กติกา 1 user 1 shelter) | FR-1, FR-34 | `POST /api/v1/users` (ห่อ `_users`) |
| `/admin/catalog` | master ข้ามศูนย์: supply item catalog, recipe, SOP ratio profile | FR-27, FR-44 | เขียน `catalog` db ที่ central (device ได้ผ่าน pull) |
| `/admin/api-keys` | issue/rotate/revoke EOC API key + scope (FD-14) | FR-50 | central service (R4 deferred) |
| `/admin/audit` | ดู audit trail (override, retroactive edit, export, ลบ) | FR-16, 33 | Mango query `audit` ที่ central |
| `/admin/consent` | search consent / opt-out (SM ทำใน scope ศูนย์ตนได้) | FR-52 | update `evacuee.privacy.search_excluded` |

> **Dev เท่านั้น:** route `src/routes/api/admin/*` ใน frontend ปัจจุบัน (users/shelter/demo) เป็น
> dev-server stand-in ของ Plane B — ไม่อยู่ใน static prod build และไม่ใช่ endpoint ของระบบจริง

---

## 3. Public plane (`/public/v1` — ไม่ login, อยู่นอกสองระบบ)

ทำงานบน **MongoDB read-model** ที่ sync จาก CouchDB (ดู [couchdb-mongodb-sync.md](data/couchdb-mongodb-sync.md));
ทุก endpoint rate-limited + anti-enumeration (NFR-24) — contract เต็มดู
[public-tier-flow-spec](features/public-tier-flow-spec.html)

| Endpoint | หน้าที่ | FR | Auth |
| --- | --- | --- | --- |
| `POST /public/v1/family-search` | ค้นญาติ — คืน masked directory (`first_name`, `last_name`, `nickname`, `shelter_status` เท่านั้น); เคารพ opt-out 100% | FR-53 | — (audit ทุกครั้ง) |
| `GET /public/v1/needs` | shortage รายศูนย์ (counts only, no-PII) เพื่อ direct การบริจาค | FR-32 | — |
| `POST /public/v1/donations` | donor pre-declaration + reservation | FR-32, 35 | เบอร์โทร + OTP (เมื่อ `public_otp_required` เปิด) |
| `GET /public/v1/donations/{tracking_token}` | ติดตามสถานะการบริจาคของตน | FR-35, 37 | `tracking_token` |
| `GET /public/v1/transparency/*` | รายงานความโปร่งใส (aggregate) 🔒 | FR-38 | — |

**EOC / Open API (R4 deferred — service แยก):** `GET` aggregate API + API key per consumer
(FR-49, 51) — ไม่มี endpoint รายบุคคล, no-PII, audited; spec จะนิยามใน P-03

---

## 4. สรุป endpoint ทั้งระบบ (ทุก plane)

| Plane | Endpoint | ใช้โดย |
| --- | --- | --- |
| A — Sync | `POST/GET/DELETE /couch/_session` | ทุก role (login/whoami/logout) |
| A — Sync | replicate `shelter_{code}` ⇄ · `registry` ← · `catalog` ← (edge) | PouchDB background |
| B — Service | `POST /api/v1/mint` | app อัตโนมัติ (intake §1) |
| B — Service | `POST /api/v1/shelters` · `POST /api/v1/shelters/{code}/close` | SA (backoffice §2.9) |
| B — Service | `POST /api/v1/users` | SA |
| B — Service | `POST /api/v1/exports` · `GET /api/v1/exports/{id}` | SM/SA (backoffice §2.1) |
| C — Public | 5 endpoints ตาม §3 | DN / FAM / PUB |

**สิ่งที่ตั้งใจ "ไม่มี"** (ยืนยันตาม api-contract §7): REST CRUD ของ doc ปฏิบัติการทุกชนิด ·
JWT/refresh token · EOC human dashboard ในระบบหลัก · endpoint อ่านข้อมูลรายบุคคลใน public plane

## Traceability

- Endpoint จริง + plane → [api-contract.md](data/api-contract.md)
- Doc types / views → [data-model.md](data/data-model.md) §3–4 · field เต็ม → [schema.md](data/schema.md)
- สิทธิ์ราย action → [role-permission-matrix.md](prd/role-permission-matrix.md)
- FR ราย phase → [PRD index](prd/index.md) · task → [task-breakdown](task-breakdown/_index.md)
