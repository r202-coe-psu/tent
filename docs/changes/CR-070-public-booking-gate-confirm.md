---
id: CR-070
title: จองเข้าศูนย์ผ่านเว็บ + ยืนยันตัวตนที่ประตู (reuse QR scan)
status: approved
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (IMPS, approved 2026-08-13)
layer: volatile
parent: CR-066
affects:
  - docs/data/schema.md §1.1 evacuee (`registered_via` — หลัง approve)
  - schema_v evacuee (bump เฉพาะถ้าขยาย enum; หลัง approve)
  - frontend public ปุ่มลงทะเบียนผู้ประสบภัย + flow จอง
  - frontend/src/lib/features/people (pre_registered → check-in)
  - docs/task-breakdown/02-people.md (T-71)
  - docs/features/site-occupancy-booking-program.md
---

# CR-070 — Public booking + ยืนยันที่ประตู

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เปิดช่องจองผ่านเว็บไซต์ สร้างคนสถานะ `pre_registered` (นับ occupancy ทันที); ที่ประตูยืนยันด้วย QR scan ที่มีอยู่ (T-51); ตามสถานะด้วย QR หรือ `official_code` + เบอร์โทร
- **เพื่อใคร/ทำไม:** ประชาชนจองล่วงหน้าได้; staff ไม่ต้องลงทะเบียนใหม่ทั้งใบเมื่อมาถึง; ที่นั่งถูกถือจนกว่ายกเลิกชัดเจน
- **dev ต้อง build อะไร:** public booking UI + BFF write path + ผูก check-in เดิม + ยกเลิก hold + แสดงอายุการจอง (T-71)
- **กระทบ schema/scope ไหน:** ขยาย `registered_via` ด้วย `web` (และ `api` ร่วม CR-071); เสนอ stay `cancelled` หลัง approve; **ไม่สร้าง doc type booking ใหม่**; **ไม่ bump schema.md ในรอบนี้**

## Why

ปุ่ม public «ลงทะเบียนผู้ประสบภัย» disabled. Staff มี pre-register + QR scan แล้ว. ไม่มีช่องเว็บสำหรับประชาชน. Household `pre-registered` และ evacuee `pre_registered` มีใน schema แล้ว — ใช้ซ้ำ.

## Change

### Before → After

| Area | Before | After |
| --- | --- | --- |
| Public ลงทะเบียนผู้ประสบภัย | ปุ่ม disabled | เปิดจอง (เลือกศูนย์/บ้านที่ยังรับ) |
| Persist | — | `evacuee` + `household` สถานะ pre-registered; QR/`official_code` ตาม T-50 |
| ประตู | walk-in register หรือ staff pre-register | scan QR → check-in (T-51/T-06) ไม่ต้องสร้างคนใหม่ |
| `registered_via` | `app`\|`import`\|`paper` | เพิ่ม `web` (D-REG-VIA ล็อก) — `api` อยู่ CR-071 |
| Occupancy ของจอง | T-04/T-06: `pre_registered` ไม่นับ | **D-BOOK-OCC=C:** นับ `active` + `pre_registered` (ศูนย์และบ้านกฎเดียวกัน) |
| อายุ hold | ไม่มี | รายการ staff แสดงวัน/ชม./นาที ตอนโหลด/รีเฟรช (D-PRE-REG-AGE) — ห้าม poll |
| หมดอายุจอง | ไม่ระบุ | **D-HOLD-TTL=none** — ไม่มีหน้าต่างเวลา ไม่ auto-cancel |
| ยกเลิกจอง | SM ยกเลิก household `cancelled` | **D-HOLD-CANCEL:** SA/SM/RS; audit actor+timestamp; ห้าม hard-delete; stay เสนอ `cancelled` |
| ตามสถานะจอง | ไม่มี self-lookup | **D-BOOK-TOKEN=A:** QR หรือ `official_code` + เบอร์โทร — ไม่มี token แยก ไม่จำกัดที่ประตู |

### Flow

1. ประชาชนเลือกสถานที่ (`site_kind` ทั้งสองชนิดที่ยังเปิดรับ) → กรอกข้อมูลขั้นต่ำตาม T-48 → ได้ QR/`official_code`
2. Occupancy: **D-BOOK-OCC=C** — จอง = นับทันที (`pre_registered` นับ). Check-in → `active` ไม่ +1 ซ้ำ
3. ประชาชนตามสถานะด้วย QR หรือ `official_code` + เบอร์โทร (D-BOOK-TOKEN=A)
4. ที่ประตู staff scan → screening ตาม T-49/T-06 → check-in
5. ไม่มา / ยกเลิก = staff (SA/SM/RS) เปลี่ยนสถานะ `cancelled` — occupancy ลดตอนรีเฟรช; ห้าม hard-delete; ห้าม auto-expire (D-HOLD-TTL=none)

จองตอน health แดงเข้ม = warning ฝั่งผู้จอง; ไม่ block จนกว่ามี CR แยก (สอดคล้อง T-51 warning-only).

Public write ต้องผ่าน BFF (CR-063) — ห้ามให้เบราว์เซอร์เขียน CouchDB โดยไม่มี session. Path ละเอียดของ BFF = งาน Lead review ตอน implement ไม่ใช่การเปลี่ยน stable core ใน CR นี้.

## Requirements

- **FR-70..FR-72, FR-77..FR-79** ตาม program spec
- CAPTCHA / rate-limit ตาม Public task DoD
- ไม่ expose medical/national ID บน public ticket
- Permission ประตู: role เดิมของ T-51 (registration_staff / SM / SA)
- Permission ยกเลิก hold: **SA, SM, RS** (D-HOLD-CANCEL)
- รายการ `pre_registered`: แสดง elapsed วัน/ชม./นาที คำนวณตอนโหลด/รีเฟรช — ห้าม polling ห้ามนาฬิกาเดินสด (D-PRE-REG-AGE)

### Acceptance (T-71)

- จองผ่านเว็บแล้วคนอยู่ในระบบเป็น `pre_registered`; occupancy **เพิ่ม** (D-BOOK-OCC=C)
- scan QR ที่ประตู → `active`; occupancy **ไม่ +1 ซ้ำ**
- ยกเลิก hold โดย SA/SM/RS → สถานะ `cancelled`; occupancy ลด; มี audit actor+timestamp; เอกสารคนยังอยู่
- ไม่มี job/TTL ตัดจองเอง
- รายการ staff แสดงอายุการจองเป็นวัน/ชม./นาที และค่าไม่เดินเองระหว่างเปิดหน้า
- ตามสถานะด้วย QR หรือ `official_code` + เบอร์โทร ได้ (ไม่มี token แยก)
- จองซ้ำเบอร์/ชื่อ hint ตาม T-48 (override ได้)
- test: จอง, ไม่มา+ยกเลิก, scan ซ้ำ, ศูนย์ปิดจอง, RS ยกเลิกได้, role อื่นยกเลิกไม่ได้
- demo จองเว็บ → พิมพ์ QR → scan check-in; demo ตามสถานะด้วยรหัส+เบอร์

## Impact

- people domain + public portal UI + BFF ใหม่สำหรับ public create evacuee
- ไม่แตะ donation booking (`/donate`) — คนละโดเมน
- Team B เป็นเจ้าของ; Lead รีวิว public BFF / ไม่ให้เบราว์เซอร์ถือ admin secret

## Migration

ขยาย `registered_via` เป็น additive enum (`web`; `api` ร่วม CR-071); doc เดิมไม่ต้อง backfill. Stay `cancelled`: household มีอยู่แล้ว; evacuee stay (CR-035 6 ค่า) **ยังไม่มี** — เสนอเพิ่มชื่อ `cancelled` หลัง approve (ห้ามสร้าง `no_show`). Bump evacuee schema_v หลัง approve เท่านั้น — **รอบนี้ไม่ bump `schema.md`.**

## Out of scope

- xlsx/csv คนและ inbound API (CR-071)
- Triage 3 สี (CR-072)
- Auto-assign zone บังคับตอนจอง (คง warning-only T-09)
- Auto-expire / job ตัดจอง (D-HOLD-TTL=none)
- Kitchen/SOP occupancy คนอยู่จริง (ยัง `active` only — CR-022)

## Implementation notes (2026-08-14)

Slice: **bulk cancel + status filters** on `/back-office/evacuee-management` (evacuee + household
tabs). Public booking / `registered_via=web` / D-PRE-REG-AGE remain out of this slice.

- **schema.md §1.1:** bump evacuee `schema_v` 5 → 6; add stay status `cancelled` (7-value enum).
- **Domain/data:** `cancelPreRegistration(householdId)` sets household → `cancelled` **and**
  cascades member stays with `pre_registered` → `cancelled` (+ `since`); audit context includes
  cancelled-member count. New `cancelEvacueePreRegistration(evacueeId)` for person-level cancel;
  if linked household is still `pre_registered` and no members remain `pre_registered`, cancel
  the household too.
- **RBAC (D-HOLD-CANCEL):** UI + mutation gate = SA / SM / RS only.
- **Lists:** status filters on both tabs; multi-select across pagination; select-all matching
  filters; sticky bulk «ยกเลิกการลงทะเบียนล่วงหน้า».
- Occupancy: `cancelled` is not counted in dashboard `pre_registered` / `total` (unknown keys
  discarded by `rowsToOccupancyPayload`).

## Implementation notes (2026-08-20)

Slice: **public booking + self-lookup** (`/register`, `/register/track`) — ปิดงานหลักของ T-71
ยกเว้น multi-member household และ D-PRE-REG-AGE ที่ยกไปรอบถัดไป.

- **schema.md §1.1:** bump evacuee `schema_v` 6 → 7; `registered_via` += `web` (D-REG-VIA,
  additive ไม่ต้อง backfill; ไม่มีโค้ดไหน branch บนค่านี้). อัปเดต `data-model.md` +
  `schema-er-diagram.md` ให้ตรงด้วย.
- **Write path (Lead review ตาม CR นี้):** เลือก **BFF → CouchDB ตรง** ผ่าน
  `putAsPublicWriter` (user `public_writer` ไม่มี role → write ยังผ่าน `validate_doc_update`)
  — **ไม่ผ่าน FastAPI**. เหตุผล: reuse `createEvacuee` ตัวเดียวกับ staff (ไม่มี doc shape ซ้ำใน
  Python), occupancy ขยับใน request เดียวตาม D-BOOK-OCC=C, และ QR สแกนได้ทันทีที่ประตู.
  Endpoint: `POST /api/public/v1/registrations` + `POST /api/public/v1/registrations/lookup`.
- **Shelter validation:** `registry/_design/app/_view/by_code` (ใหม่) — `findMasterByCode` เลิก
  scan ทั้ง registry (ลบ TODO เดิม). ศูนย์ `closed` → 409 `SHELTER_CLOSED`; `full_capacity`
  จองได้แต่ขึ้น warning (FR-72 warning-only).
- **Booking code = evacuee ULID.** D-BOOK-TOKEN=A ระบุ "QR **หรือ** `official_code`" — สาย QR ใช้
  ได้เลยเพราะ QR ของ staff ฝัง `evacuee._id` อยู่แล้วและ `CHECK_IN_ELIGIBLE_STATUSES` มี
  `pre_registered` แล้ว → **FR-71 ไม่ต้องเขียนโค้ดใหม่**. เมื่อ `official_code` (T-50) เสร็จ ให้
  lookup รับทั้งสองแบบ และ **ต้องรับ ULID ต่อไปตลอด** เพราะใบจองที่พิมพ์ไปแล้วออกใหม่ไม่ได้.
- **D-BOOK-OCC=C ฝั่ง public:** รอบ 2026-08-14 แก้แค่ dashboard ของ staff — รอบนี้แก้เพิ่ม 3 จุดที่
  ยังนับแค่ `active`: `backend/apiapp/modules/shelter/use_case.py`,
  `api/public/v1/transparency/{shelters,summary}`. ถ้าไม่แก้ ประชาชนจองแล้วเลขบนหน้าเว็บไม่ขยับ.
- **Anti-abuse:** rate limiter แยก bucket จาก donation (`registerIpLimiter` /
  `registerPhoneLimiter` / `registerLookupIpLimiter`) + reCAPTCHA v3 action `register`
  (parity กับ `/donations`; ข้อเสนอ PoW ใน `public-tier-flow-spec.html` ยังเป็น "Open point").
- **Infra:** `COUCHDB_PUBLIC_WRITER_URL` ไม่เคยถูกตั้งไว้ที่ไหนเลย (prod `putAsPublicWriter`
  throw → courier PATCH ของ CR-052 น่าจะพังบน staging/prod อยู่ก่อนแล้ว). รอบนี้เพิ่มใน
  `.env.example` ×2 + compose ×5, seed สร้าง user, และ `redeploy:access` grant
  `_security.members` ให้ทุกศูนย์ (อยู่ใน `db:sync` อยู่แล้ว).
- **ปุ่มเข้า flow (เจ้าของเคาะ):** เปิดปุ่มการ์ดหน้าแรกที่ disabled อยู่ + dropdown «จองเข้าศูนย์»
  ใน navbar (desktop + mobile) + ปุ่ม «จองที่ศูนย์นี้» บนหน้า `/shelters/[id]`
  (deep link `?shelter=CODE` ล็อก step 1). UAT-151 แคบเหลือเฉพาะปุ่มอาสาสมัคร +
  เพิ่ม UAT-160..164.
- **ยังไม่ทำในรอบนี้:** household/multi-member ตาม CR-076 (จองเดี่ยว `household_id=null`),
  D-PRE-REG-AGE (FR-77), `official_code` จริง (T-50).

## Decision log

- 2026-08-13 — proposed. Reuse `pre_registered` + T-51. ไม่สร้าง booking doc.
- 2026-08-13 — Wave 1 ล็อกใน CR-066 (D-TRACK-METHOD=CR+Notion). CR นี้ยัง `proposed`.
- 2026-08-13 — **Wave 3 ล็อก** (decision ≠ approve CR): D-BOOK-OCC=**C** (เจ้าของทับคำแนะนำ A — จองนับ occupancy ทั้งศูนย์และบ้าน) · D-HOLD-TTL=**none** · D-PRE-REG-AGE · D-HOLD-CANCEL (เจ้าของเริ่ม SA/SM แล้วเพิ่ม RS) · D-REG-VIA เพิ่ม `web`+`api` · D-BOOK-TOKEN=**A**. **ไม่ bump schema.md.**
- 2026-08-13 — **approved** โดยเจ้าของโครงการ (IMPS): Wave 3 ทั้งก้อน (D-BOOK-OCC=C, D-HOLD-TTL=none, D-PRE-REG-AGE, D-HOLD-CANCEL, D-REG-VIA `web`, D-BOOK-TOKEN=A). **ไม่ bump schema.md ในรอบนี้** (evacuee `registered_via` + stay `cancelled` ตอน implement ตาม Migration).
- 2026-08-20 — **implement (public booking):** `/register` + `/register/track`; BFF เขียน
  CouchDB ตรงผ่าน `putAsPublicWriter` (ไม่ผ่าน FastAPI); `registry` `_view/by_code`;
  `registered_via=web` + evacuee schema_v 7; public occupancy นับ `pre_registered`;
  booking code = evacuee ULID จนกว่า T-50 จะส่ง `official_code`. เหลือ multi-member
  household + D-PRE-REG-AGE.
- 2026-08-14 — **implement (partial):** stay `cancelled` + schema_v 6 + cancel cascade + list
  status filters + bulk cancel (SA/SM/RS). Public booking / `web` / D-PRE-REG-AGE ยังไม่ทำในรอบนี้.
