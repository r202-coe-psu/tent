---
id: draft
title: ปิดศูนย์ → เช็คเอาต์ผู้พักพิงที่ยังค้าง / ยกเลิก pre-registered อัตโนมัติ (เหตุผล `shelter_closed`) พร้อม modal ยืนยันแบบพิมพ์รหัส+ชื่อศูนย์ · SA เท่านั้น
status: proposed
date: 2026-10-31
requested_by: Dev Team B #979 — chip "เข้าพักแล้ว" ขัดกับป้าย "ศูนย์อพยพปิดแล้ว" · GitHub #986
decided_by:
layer: volatile # business rule ของ stay status + flow ปิดศูนย์ · role/permission (ปิดศูนย์ = SA)
affects:
  - docs/data/schema.md §1.3 household `checkout_destination.type` (enum +`shelter_closed`) · §1.4 movement `reason` (ค่า `shelter_closed`)
  - no schema_v bump (additive enum value; doc เดิมยัง valid)
  - docs/changes/00-baseline/CR-112-registration-foundation-schema-stay.md — movement guard (check_out จาก `temporary_leave`/`arriving`/`kiosk_registered` เฉพาะ system close) — แก้ผ่าน CR นี้ ไม่แก้ไฟล์ CR-112
  - docs/changes/01-core/CR-183-closed-shelter-search-retention.md — ลำดับ: เช็คเอาต์ก่อน แล้วจึงตั้ง `closed` + `closed_at`; FR-10 (sync การแก้ไขหลังปิด) ใช้ต่อ ไม่ต้องแก้ worker
  - role/permission: เปลี่ยน `operation_status` → `closed` = SA เท่านั้น (เดิม shelter manager หรือ SA)
  - frontend/src/lib/features/people/domain/people.ts (`checkoutDestinationSchema`, `SHELTER_CLOSE_CHECKOUT_STATUSES` / `SHELTER_CLOSE_CANCEL_STATUSES`, guard ของ system close)
  - frontend/src/lib/server/ (ใหม่: shelter-close service ผ่าน `couch-admin.ts`, `_bulk_docs`)
  - frontend/src/routes/api/back-office/shelter/[code]/+server.ts (PATCH: บล็อก `closed` ตรง) · ใหม่ `[code]/close/+server.ts` (GET preview / POST close)
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte · shelter-form-page.svelte (+ modal ยืนยันปิดศูนย์)
  - frontend/src/lib/features/people/ui/** — label เหตุผล `shelter_closed` (ประวัติ movement / ปลายทางเช็คเอาต์)
  - frontend/scripts/migrate-closed-shelter-checkout.ts + package.json `migrate:closed-shelter-checkout` (backfill)
  - tests: people domain · server close service · route · e2e ปิดศูนย์
---

# draft-shelter-close-checkout — ปิดศูนย์แล้วเช็คเอาต์คนที่ค้างอยู่

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** การปิดศูนย์ (`operation_status → closed`) ต้องปิดสถานะผู้พักพิงทุกคนที่ยังค้างในศูนย์ก่อน — `pre_registered` → `cancelled`, สถานะค้างอื่นทั้งหมด → `checked_out` — เหตุผล `shelter_closed`; เปิดศูนย์ใหม่ไม่คืนสถานะ
> - **เพื่อใคร/ทำไม:** หลังปิดศูนย์ คนยังเป็น `active` ทั้งฝั่ง staff และ public search (SH001 ปิดแล้ว 452 คนยัง `active`) → ขัดกับป้าย "ศูนย์อพยพปิดแล้ว"
> - **build:** server route ปิดศูนย์ (preview จำนวน + batch `_bulk_docs` ผ่าน movement ปกติ, idempotent) · modal ยืนยันที่ต้องพิมพ์ `<รหัส> <ชื่อศูนย์>` · จำกัดการปิดศูนย์ให้ SA
> - **กระทบ:** household `checkout_destination.type` +`shelter_closed` (ไม่ bump `schema_v`) · movement guard ของ CR-112 · ลำดับปิดศูนย์ของ CR-183 · ไม่ต้องแก้ worker

---

## ปัญหาปัจจุบัน (as-is, `develop` @ `065a08d65`)

| # | พฤติกรรม | ที่ |
| --- | --- | --- |
| P-1 | PATCH ปิดศูนย์แก้แค่ registry doc (`operation_status`, `closed_at`) ไม่แตะ evacuee ใน `shelter_<code>` | `frontend/src/routes/api/back-office/shelter/[code]/+server.ts` |
| P-2 | เช็คเอาต์ทำได้ทีละครอบครัว ไม่มีทางเช็คเอาต์ทั้งศูนย์ | `people/ui/search-scan/scan-check-in-out-page.svelte` (`handleBulkCheckOut`) |
| P-3 | `check_out` อนุญาตเฉพาะ `active` / `room_confirmed` → `temporary_leave`, `arriving`, `kiosk_registered` เช็คเอาต์ไม่ได้ | `people/domain/people.ts` `CHECK_OUT_ELIGIBLE_STATUSES` |
| P-4 | `checkout_destination.type` ไม่มีค่าที่สื่อว่า "ศูนย์ปิด" | `people/domain/people.ts` `checkoutDestinationSchema` · schema.md §1.3 |
| P-5 | shelter manager ของศูนย์ปิดศูนย์ได้เอง (`requireShelterManagerOrSA`) | PATCH route บรรทัด 80 |

---

## Requirements

### Domain — สถานะที่ครอบ (scope)

| สถานะปัจจุบัน | ผลหลังปิดศูนย์ | ทางเขียน |
| --- | --- | --- |
| `active` | `checked_out` | movement `check_out`, `reason = shelter_closed` |
| `room_confirmed` | `checked_out` | movement `check_out`, `reason = shelter_closed` |
| `temporary_leave` | `checked_out` | movement `check_out`, `reason = shelter_closed` (ข้อยกเว้น guard — FR-3) |
| `arriving` | `checked_out` | movement `check_out`, `reason = shelter_closed` (ข้อยกเว้น guard — FR-3) |
| `pre_registered` | `cancelled` | hold-cancel semantics (FR-6) + audit `reason = shelter_closed` |
| `kiosk_registered` | `checked_out` | movement `check_out`, `reason = shelter_closed` (ข้อยกเว้น guard — FR-3) |
| `transferred` · `checked_out` · `deceased` · `cancelled` | ไม่แตะ | — |

- **FR-1** — เพิ่ม `shelter_closed` ใน `checkoutDestinationSchema.type` (`returned_home | transferred_shelter | referred_facility | other | shelter_closed`). `shelter_closed` ตั้งได้เฉพาะจาก flow ปิดศูนย์ — dropdown เช็คเอาต์ปกติ **ไม่แสดง** ค่านี้.
- **FR-2** — เพิ่มค่าคงที่ `SHELTER_CLOSE_CHECKOUT_STATUSES = ['active', 'room_confirmed', 'temporary_leave', 'arriving', 'kiosk_registered']` และ `SHELTER_CLOSE_CANCEL_STATUSES = ['pre_registered']` ใน people domain.
- **FR-3** — guard `check_out` ยอม `temporary_leave` / `arriving` / `kiosk_registered` **เฉพาะ** เมื่อ `reason === 'shelter_closed'` และเรียกจาก flow ปิดศูนย์ (ฟังก์ชัน domain แยก เช่น `assertShelterCloseCheckoutAllowed`). เช็คเอาต์ปกติยังใช้ `CHECK_OUT_ELIGIBLE_STATUSES` เดิม.
- **FR-4** — movement ที่สร้างจาก flow ปิดศูนย์ใช้ `action = check_out`, `reason = 'shelter_closed'`, `zone = null`, `created_by` = ผู้ปิดศูนย์.
- **FR-5** — household ที่ derived status กลายเป็น `checked_out` และ `checkout_destination == null` → ตั้ง `checkout_destination = { type: 'shelter_closed' }`. household ที่มี `checkout_destination` อยู่แล้วไม่ถูกเขียนทับ.
- **FR-6** — evacuee `pre_registered` → `current_stay.status = 'cancelled'`, `since = now` ตาม semantics ของ hold-cancel (`cancelPreRegistration`) — ไม่มี movement (ไม่มี movement action สำหรับยกเลิก). ทำรายคน (household แบบผสมก็ได้ ไม่ต้องให้ทั้ง household เป็น `pre_registered`).
- **FR-6a** — เขียน audit 1 รายการต่อ household ที่มีคนถูกยกเลิก: `action = other`, `target_type = household`, `reason = 'shelter_closed'`, `context = { cancelled_member_count, evacuee_ids }`.
- **FR-6b** — household status หลังเปลี่ยนใช้ `deriveHouseholdStatus` เดิม: ทุกคน `cancelled` → `cancelled`; ผสม `cancelled` + `checked_out` → `checked_out` (+ FR-5). `cancelled` ยังเป็น terminal — เปิดศูนย์ใหม่แล้วต้องลงทะเบียนใหม่.
- **FR-6c** — ไม่กระทบ Unassigned Registration (Mongo `unassigned_registrations`, CR-113) — ยังไม่ใช่ evacuee ในศูนย์.

### Server — route ปิดศูนย์

- **FR-7** — `GET /api/back-office/shelter/[code]/close` คืนจำนวนคนที่จะถูกเปลี่ยน แยกตามสถานะ (`{ by_status: Record<StayStatus, number>, total }`) อ่านสด (ไม่ใช้ cache).
- **FR-8** — `POST /api/back-office/shelter/[code]/close` body `{ confirm_text: string }`; server ต้องตรวจ `confirm_text` ตาม FR-15 อีกรอบ (ไม่เชื่อ client) — ไม่ตรง → `400`.
- **FR-9** — ทำทั้งหมดใน server (`$lib/server/` ผ่าน `couch-admin.ts`) ไม่ทำทีละคนจาก client.
- **FR-10** — เขียนเป็น batch `_bulk_docs` (chunk ≤ 200 docs) ผ่าน domain เดิม (`applyMovementToStay` / `deriveHouseholdStatus`) — ห้าม set `current_stay.status` ตรง. ลำดับต่อ chunk: evacuee docs ก่อน → movement docs ของ evacuee ที่เขียนสำเร็จ → household docs ที่กระทบ.
- **FR-11** — 409 (`_rev` ชน) → re-fetch แล้ว retry doc นั้นสูงสุด 3 ครั้ง; ยังไม่ผ่าน = นับเป็น failed พร้อม `evacuee_id` + เหตุผล.
- **FR-12 — idempotent:** รันซ้ำแล้วข้ามคนที่อยู่นอก `SHELTER_CLOSE_CHECKOUT_STATUSES` ∪ `SHELTER_CLOSE_CANCEL_STATUSES` แล้ว — ไม่สร้าง movement ซ้ำ.
- **FR-13 — ลำดับ:** เช็คเอาต์/ยกเลิกคนก่อน → re-count ตาม FR-7 → ถ้าเหลือ 0 จึงเขียน registry `operation_status = closed` + `closed_at` (CR-183). ถ้ามี failed หรือ re-count > 0 → **ไม่ปิดศูนย์** สถานะศูนย์คงเดิม และตอบผลรายตัว ให้ staff กดซ้ำได้.
- **FR-14** — response `{ closed: boolean, checked_out: n, cancelled: n, failed: [{ evacuee_id, error }] }`; ศูนย์ ~500 คนต้องเสร็จโดยไม่ timeout ของ route.

### UI — modal ยืนยัน

- **FR-15** — เลือก "ปิดศูนย์" แล้วกดบันทึก → เปิด modal ก่อนส่งอะไร; modal ดึงจำนวนจาก FR-7 ตอนเปิด.
- **FR-16** — modal แสดง: หัวข้อ "ยืนยันปิดศูนย์ <ชื่อศูนย์>" · จำนวนแยกตามสถานะ (label จาก `STATUS_LABELS`) · คำเตือนว่าทุกคนในรายการจะถูกเปลี่ยนเป็น "เช็คเอาต์" (ลงทะเบียนล่วงหน้า → "ยกเลิก") และเปิดศูนย์ใหม่จะไม่คืนสถานะ.
- **FR-17** — ช่องพิมพ์ยืนยัน: ต้องพิมพ์ `<shelter_code> <ชื่อศูนย์>` ตรงกับที่แสดงใน modal (trim + ยุบช่องว่างซ้ำ, case-sensitive ตามต้นฉบับ). ไม่ตรง → ปุ่มยืนยัน disabled. ห้าม paste-protect (ยอม paste ได้).
- **FR-18** — ปุ่ม "ยกเลิก" = ปิด modal ไม่ส่ง request, สถานะศูนย์ในฟอร์มกลับเป็นค่าเดิม. ปุ่มยืนยันสีแดง "เช็คเอาต์ทั้งหมดและปิดศูนย์".
- **FR-19** — ระหว่างทำงาน: loading + ปุ่มกดซ้ำไม่ได้ + ปิด modal ไม่ได้. เสร็จแล้ว toast: สำเร็จ → "ปิดศูนย์แล้ว · เช็คเอาต์ X คน · ยกเลิก Y คน"; มี failed → toast error "ล้มเหลว Z คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ".
- **FR-20** — ไม่มีคนค้าง → modal ยังขึ้นพร้อมช่องพิมพ์ยืนยัน แต่ไม่มีรายการจำนวน.
- **FR-21** — label เหตุผล `shelter_closed` = "ศูนย์ปิด" ในทุกจุดที่แสดง movement reason / ปลายทางเช็คเอาต์.

### Role / permission

- **FR-22** — การเปลี่ยน `operation_status` เป็น `closed` ทำได้เฉพาะ **SA** (route FR-7/FR-8 ใช้ guard SA-only). PATCH `/api/back-office/shelter/[code]` ที่ตั้ง `operation_status = closed` ตรง ๆ → `400` ให้ใช้ route ปิดศูนย์ (กัน bypass). การแก้ field อื่นของ shelter manager คงเดิม.
- **FR-23** — UI: ผู้ใช้ที่ไม่ใช่ SA ไม่เห็นตัวเลือก "ปิดศูนย์ (Closed)" (ถ้าศูนย์ปิดอยู่แล้ว แสดงเป็นค่าปัจจุบันแบบอ่านอย่างเดียว).

### Worker / public plane

- **FR-24** — ไม่ต้องแก้ worker: CR-183 FR-10 sync การแก้ไขของคนในศูนย์ปิด → `public_persons.status` อัปเดตภายในรอบ sync. ต้อง verify ใน acceptance เท่านั้น.

### Backfill — ศูนย์ที่ปิดไปแล้ว

- **FR-28** — script one-off `frontend/scripts/migrate-closed-shelter-checkout.ts` + `package.json` `migrate:closed-shelter-checkout` วนทุกศูนย์ที่ `operation_status = closed` แล้วเรียก service เดียวกับ FR-10..FR-12 (เช็คเอาต์ / ยกเลิกตาม FR-2, FR-6).
- **FR-29** — โหมด backfill ข้ามการเขียน registry: ไม่แก้ `operation_status` และ **ไม่แตะ `closed_at`** (นาฬิกา retention CR-183 คงเดิม).
- **FR-30** — movement / audit ที่สร้างใช้เวลาที่รัน script (`occurred_at = now`); audit ต่อศูนย์บันทึก `context = { backfill: true, shelter_closed_at, checked_out, cancelled, failed }`.
- **FR-31** — รองรับ `--dry-run` (นับอย่างเดียว) และ `--shelter <code>`; รันซ้ำได้ (FR-12); พิมพ์สรุปรายศูนย์ + รายการ failed.

### เปิดศูนย์ใหม่ (#645)

- **FR-25** — เปลี่ยน `operation_status` จาก `closed` → ค่าอื่น ต้องไม่แก้ evacuee / household / movement ใด ๆ — คนที่ถูกปิดด้วย `shelter_closed` คงเป็น `checked_out` / `cancelled`.
- **FR-26** — คนที่กลับมาหลังเปิดศูนย์ใหม่: `checked_out` → เช็คอินปกติ (`CHECK_IN_ELIGIBLE_STATUSES`, ระบุโซน); `cancelled` → ลงทะเบียนใหม่. ไม่มี flow คืนสถานะอัตโนมัติ.
- **FR-27** — เปิดใหม่แล้ว `public_persons` ของคนเหล่านี้แสดงสถานะที่ถูกปิดไว้ (worker rescan ตาม CR-183 FR-9 ไม่ต้องแก้).

---

## Acceptance

- [ ] SA เลือก "ปิดศูนย์" แล้วกดบันทึก → modal ขึ้นพร้อมจำนวนแยกตามสถานะ (ตรงกับข้อมูลจริงตอนเปิด modal).
- [ ] พิมพ์ `<รหัส> <ชื่อศูนย์>` ไม่ตรง → ปุ่มยืนยันกดไม่ได้; POST ที่ `confirm_text` ผิด → `400`.
- [ ] กด "ยกเลิก" → ไม่มีอะไรถูกเขียน ทั้งศูนย์และคน.
- [ ] กดยืนยัน → ศูนย์ `closed` + `closed_at`; ไม่มีคนในศูนย์เหลือสถานะใน `SHELTER_CLOSE_CHECKOUT_STATUSES` / `SHELTER_CLOSE_CANCEL_STATUSES`.
- [ ] ทุกคนที่ถูกเช็คเอาต์มี movement `check_out` `reason = shelter_closed` หนึ่งรายการ; household status derive ถูก และ `checkout_destination.type = shelter_closed` (ถ้าเดิมว่าง).
- [ ] คน `pre_registered` → `cancelled` ไม่มี movement, มี audit `reason = shelter_closed` ต่อ household; household ที่ทุกคน `pre_registered` → `cancelled`; household ผสม → `checked_out`.
- [ ] จำลอง failure กลางทาง → ศูนย์ยังไม่ปิด, toast แจ้งจำนวนล้มเหลว; กดซ้ำ → ปิดได้ และไม่มี movement ซ้ำ.
- [ ] ศูนย์ ~500 คนปิดสำเร็จโดยไม่ timeout.
- [ ] shelter manager (ไม่ใช่ SA) ไม่เห็นตัวเลือกปิดศูนย์; เรียก route ปิดศูนย์ → `403`; PATCH `operation_status = closed` → `400`.
- [ ] `/search` ของคนในศูนย์ที่ปิดแสดง "เช็คเอาต์" คู่ป้าย "ศูนย์อพยพปิดแล้ว" ภายในรอบ sync.
- [ ] ปิดแล้วเปิดศูนย์ใหม่ → คนที่ถูกปิดยังเป็น `checked_out` / `cancelled` ทั้ง staff และ `/search`; เช็คอินคนเดิมกลับเข้าศูนย์ได้ตามปกติ.
- [ ] รัน `migrate:closed-shelter-checkout` → SH001 ไม่มีคนเหลือสถานะค้าง; `closed_at` ไม่เปลี่ยน; รันซ้ำแล้วไม่มี movement ซ้ำ; `--dry-run` ไม่เขียนอะไร.
- [ ] Tests: people domain (FR-1..FR-6, FR-25) · server close service (batch, 409 retry, idempotent, ลำดับ FR-13) · route (auth, `confirm_text`, PATCH block) · e2e flow ปิดศูนย์.

---

## Why

ปิดศูนย์แล้วสถานะคนไม่ตาม → staff และ public เห็นข้อมูลขัดกัน (chip "เข้าพักแล้ว" + "ศูนย์อพยพปิดแล้ว"), ยอด occupancy / dashboard ของศูนย์ที่ปิดยังนับคนอยู่. เช็คเอาต์ต้องผ่าน movement เดิมเพื่อรักษา audit trail (movement = source of truth, `current_stay` = snapshot) และ household status ที่ derive จาก member.

## Impact

- **Docs:** schema.md §1.3 (enum `checkout_destination.type`), §1.4 (ค่า reason `shelter_closed`) — update `updated:`.
- **Code:** ตาม `affects:`. ไม่แตะ `_id` pattern / envelope / sync priority (stable core).
- **CR-112:** เพิ่มข้อยกเว้น guard `check_out` จาก `temporary_leave` / `arriving` / `kiosk_registered` เฉพาะ system close; `pre_registered` ใช้ hold-cancel semantics เดิม.
- **CR-183:** ใช้ `closed_at` stamp เดิม แต่ย้ายจุดเขียนไป route ปิดศูนย์ (FR-13); PATCH ตั้ง `closed` ตรงไม่ได้แล้ว.
- **Role:** shelter manager เสียสิทธิ์ปิดศูนย์ (SA เท่านั้น).

## Migration

- CouchDB: ไม่มี — enum กว้างขึ้น, doc เดิม valid, ไม่ bump `schema_v`.
- ศูนย์ที่ปิดไปแล้วก่อน deploy และคนยังค้าง (เช่น SH001 452 คน `active`): รัน backfill ตาม FR-28..FR-31 ครั้งเดียวหลัง deploy.
- Mongo: ไม่ต้อง bump `PROJECTION_VERSION` (shape `public_persons` ไม่เปลี่ยน).

---

## Decision log

- 2026-10-31 — proposed (#986).

### D-1 — แนวทาง ✅
เช็คเอาต์อัตโนมัติเมื่อปิดศูนย์ พร้อม modal เตือน (owner, ใน #986).

### D-2 — ความเข้มของการยืนยัน ✅
ต้องพิมพ์รหัสและชื่อศูนย์ก่อนกดยืนยัน (owner, 2026-10-31) → FR-17.

### D-3 — สถานะที่ครอบ ✅
- `pre_registered` → `cancelled` (owner, 2026-10-31): ลงทะเบียนล่วงหน้ากับศูนย์นี้แต่ยังไม่มาถึง — การจองเป็นโมฆะเมื่อศูนย์ปิด → FR-6..FR-6c.
- `active`, `room_confirmed`, `temporary_leave`, `arriving`, `kiosk_registered` → `checked_out` (owner, 2026-10-31) → FR-2, FR-3.
- `transferred`, `checked_out`, `deceased`, `cancelled` → ไม่แตะ.
- ตัดทิ้ง: `pre_registered` → `checked_out` (ประวัติ "เช็คเอาต์" ทั้งที่ไม่เคยเข้าศูนย์) · ส่ง `pre_registered` กลับ pool กลาง (ต้องย้อน claim CR-113 — stable core).

### D-4 — เหตุผล ✅
ใช้ `shelter_closed` (owner, 2026-10-31) — ไม่เพิ่ม stay status ใหม่; เหตุผลอยู่ที่ movement `reason` + household `checkout_destination.type` (เช็คเอาต์) และ audit `reason` (ยกเลิก) → FR-1, FR-4, FR-5, FR-6a.

### D-5 — เปิดศูนย์ใหม่ ✅
ไม่คืนสถานะ — คนคงเป็น `checked_out` และกลับเข้าศูนย์ผ่านเช็คอินปกติ (owner, 2026-10-31) → FR-25..FR-27. ตัดทิ้ง: คืนสถานะอัตโนมัติ (สร้าง `active` เท็จให้คนที่ไม่ได้กลับมา / ไปศูนย์อื่นแล้ว) · เช็คอินกลับแบบกลุ่ม (เป็น CR แยกได้ถ้าหน้างานต้องการ).

### D-6 — ใครทำได้ ✅
SA เท่านั้นในตอนนี้ (owner, 2026-10-31) → FR-22, FR-23.

### D-7 — ลำดับเมื่อเช็คเอาต์ล้มบางส่วน ✅
เช็คเอาต์/ยกเลิกคนก่อน → นับใหม่ → เหลือ 0 จึงปิดศูนย์; ล้มบางส่วน = ไม่ปิดศูนย์ ให้กดซ้ำ (owner, 2026-10-31) → FR-13. เหตุผล: CouchDB ไม่มี transaction ข้าม doc — ศูนย์ `closed` แต่มีคนค้าง = ปัญหาเดิมของ #986; FR-12 รับประกันกดซ้ำไม่สร้าง movement ซ้ำ. ตัดทิ้ง: ปิดศูนย์ก่อน · ปิดศูนย์เสมอแม้ล้ม (ทั้งคู่ทิ้งคนค้างในศูนย์ปิด).

### D-8 — Backfill ศูนย์ที่ปิดไปแล้ว ✅
script ครั้งเดียวใช้ service เดียวกัน (owner, 2026-10-31) → FR-28..FR-31. movement ใช้เวลาที่รันจริง + เก็บ `closed_at` เดิมใน audit (ไม่ backdate — บางศูนย์ `closed_at` ว่าง). ตัดทิ้ง: ปุ่ม UI สำหรับศูนย์ปิดแล้ว (งานเพิ่ม) · ปล่อยไว้ (ข้อมูลขัดกันต่อ).
