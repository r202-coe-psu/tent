---
id: CR-252
title: ศูนย์จากระบบภายนอก (External shelter) — `is_external`, `external_url`, สถานะ `unknown`
status: approved
date: 2026-11-12
requested_by: Dev Team B — GitHub #1242
decided_by: Soravit Sukkarn (Team Lead)
layer: volatile
updated: 2026-11-13 # decision sync: ศูนย์ External กรอก/แสดงความจุสูงสุด (FR-6 / FR-19 / FR-21 แก้) — ไม่เปิด CR ใหม่ ไม่ bump schema_v
affects:
  - docs/data/schema.md §3.1 shelter (เพิ่ม `is_external`, `external_url`; `operation_status` +`unknown`; `capacity` req→opt เมื่อ External) · §9.1 `public_shelters` (เพิ่ม `is_external`, `external_url`; `status`/`location_status` +`unknown`; `capacity` = `0` เมื่อ External)
  - schema_v 9 → 10 (shelter; additive, doc เดิมไม่ต้อง backfill)
  - worker PROJECTION_VERSION 18 → 19 (worker/src/worker/projection_version.py)
  - docs/prd/role-permission-matrix.md §3 (เพิ่มแถวใหม่ "Shelter registry / Profile management" — ตั้ง `is_external` ตอนสร้างเฉพาะ `system_admin`; `shelter_manager` แก้ศูนย์ External ไม่ได้ (FR-10))
  - docs/adr/0002-partner-integration-architecture.md (EXT-002/003/008 contract change)
  - amends CR-039 (shelter Excel import) · CR-077 (import full schema coverage)
  - frontend/src/lib/features/shelters/domain/schema.ts · shelters/ui (ฟอร์ม system-management, badge)
  - frontend/src/lib/features/shelter-import/domain/columns.ts · import-row.ts · duplicates.ts (`ExistingShelter` +`is_external?: boolean`) · template/sample-row · e2e/shelter-import.test.ts
  - frontend/src/lib/features/public-portal (chip/pin/ตัวกรอง/i18n) · lib/features/{users,transfers,donation,needs,kiosk} (ตัวเลือกศูนย์)
  - frontend BFF /api/** route jobs (shelter import) · worker route · provisioner
  - worker/src/worker/projectors/shelter.py (+`is_external`/`external_url`; `backfill_capacity()` คืน `0` เมื่อ External แทน fallback 100) · couch/processor.py · couch/bootstrap.py
  - backend/apiapp/modules/shelter/schemas.py (`ShelterItem`/`ShelterDetail` +`is_external: bool = False`, `external_url: str | None = None`) · backend/apiapp/modules/shelter/use_case.py (`status_ui`) · utils/shelter_booking.py (`accepts_booking`) · modules/thirdparty_locations · modules/thirdparty_bookings
---

# CR-252 — ศูนย์จากระบบภายนอก (External shelter)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** shelter registry doc เพิ่ม `is_external` + `external_url` และ `operation_status = unknown` ("ไม่ทราบสถานะ") สำหรับศูนย์ที่บริหารในระบบอื่น (เก็บใน CouchDB doc type `shelter` เดิม ไม่แยก store)
> - **เพื่อใคร/ทำไม:** ให้ public / partner เห็นศูนย์ภายนอกบนแผนที่และรายการ พร้อมลิงก์ไประบบต้นทาง โดยไม่นับ capacity/occupancy และไม่รับจอง/ลงทะเบียน/บริจาค
> - **dev ต้อง build:** Zod invariant + guard `system_admin` · ฟอร์มแบบย่อ · worker/projector/FastAPI รองรับ `unknown` · Public UI (chip, pin, filter, ข้อความ i18n) · Excel import 2 คอลัมน์ · Partner API contract
> - **กระทบ:** shelter `schema_v` 9→10 · `PROJECTION_VERSION` 18→19 · role matrix · ADR 0002 (EXT-002/003/008) · amends CR-039 / CR-077

> **Tracking:** CR ใบเดียวครอบทั้งหมด (ตามที่ตกลงใน #1242). สถานะ `approved` โดย Soravit Sukkarn (Team Lead) — ลำดับถัดไปเตรียมแก้ `schema.md`, role matrix และ code.

---

## Requirements

### Schema / domain

- FR-1 — shelter doc เพิ่ม `is_external` (bool, default `false`).
- FR-2 — shelter doc เพิ่ม `external_url` (str\|null, optional). ถ้ามีค่า ต้องขึ้นต้น `https://` เท่านั้น; `http:`, `javascript:` และ scheme อื่น = reject. สตริงว่าง / whitespace ล้วนแปลงเป็น `null` ก่อน validate (ไม่ถือว่า error).
- FR-3 — `operation_status` เพิ่มค่า `unknown` (label "ไม่ทราบสถานะ"); enum = `standby | active | full_capacity | closed | cancelled | unknown`.
- FR-4 — เมื่อ `is_external = true` ต้อง `operation_status = unknown` เสมอ (ฟอร์มล็อกค่า). ข้อยกเว้นเดียว: `system_admin` เปลี่ยนเป็น `cancelled` ได้เพื่อถอดออกจาก public.
- FR-5 — เมื่อ `is_external = false` เลือก `unknown` ไม่ได้. บังคับที่ Zod (client) และ BFF `/api/**` (Zod ซ้ำฝั่ง server — shelter doc เขียนผ่าน admin credentials ทั้งหมด) ไม่เพิ่ม `validate_doc_update`; `registry-design.ts` / `REGISTRY_DESIGN_VERSION` ไม่เปลี่ยน.
- FR-6 — `capacity` เป็น optional เมื่อ `is_external = true` (กรอกได้แค่ความจุสูงสุด — ถ้ากรอกต้อง `int > 0`; ช่องว่าง = ไม่กรอก ไม่ใช่ `0`); ศูนย์ปกติยังบังคับ `int > 0` ตามเดิม. _(decision sync 2026-11-13)_
- FR-7 — bump shelter `schema_v` 9 → 10; doc เดิมอ่านได้โดย `is_external` = `false` (ไม่มี backfill).

### สิทธิ์

- FR-8 — เฉพาะ `system_admin` ตั้ง `is_external` ได้ และตั้งได้ **ตอนสร้างเท่านั้น**.
- FR-9 — หลังสร้างแล้ว สลับชนิด External ↔ ปกติไม่ได้ (immutable; บังคับทั้ง UI, PATCH และ import).
- FR-10 — เพิ่มกฎใน PATCH shelter: `shelter_manager` (ที่แก้ศูนย์ได้ปัจจุบัน) เปลี่ยน `is_external` หรือ `operation_status` ของศูนย์ External ไม่ได้.

### DB / worker

- FR-11 — provisioner สร้างเฉพาะ database เปล่าพร้อม grant สำหรับศูนย์ External (ไม่สร้าง views / sequence).
- FR-12 — worker ข้าม listener, bootstrap และ occupancy ของศูนย์ `is_external`.
- FR-13 — projector map `unknown` เป็นสถานะ public ที่ถูกต้อง: ไม่ใช่ HIDDEN และไม่ใช่ `open`. ศูนย์ External ยัง project เข้า `public_shelters` (ต่างจาก `cancelled`).
- FR-14 — bump `PROJECTION_VERSION` 18 → 19.
- FR-15 — FastAPI `status_ui` map `unknown` → `"UNKNOWN"` (ค่าของตัวเอง) ห้าม fallback เป็น `CLOSED`; ใช้สตริงเดียวกันใน OpenAPI และ `toUiShelterStatus` (`mappers.ts`).

### พฤติกรรมของศูนย์ External

- FR-16 — ไม่นับ capacity / occupancy; ไม่รับ pre-registration, booking, donation.
- FR-17 — `accepts_booking = false` เสมอ ทั้งฟังก์ชัน Python (`shelter_booking.py`) และ Mongo filter.
- FR-18 — ซ่อนจากตัวเลือกศูนย์ใน flow ปฏิบัติการทั้งหมด: scope ผู้ใช้, โอนย้าย, donation/needs, kiosk, import. แสดงเฉพาะรายการ system-management พร้อม badge "External".
- FR-19 — ฟอร์ม system-management เมื่อเปิด toggle External: ซ่อน zones/facilities, food, storage, utilities, risk, policy และ section ความจุเชิงพื้นที่; เหลือ basic-info (ชื่อ, ที่ตั้ง, ติดต่อ, URL) + ช่อง **ความจุสูงสุด** (optional) ช่องเดียว. _(decision sync 2026-11-13: เดิมซ่อน capacity ด้วย)_

### Public UI

- FR-20 — ศูนย์ External แสดง chip สถานะ "ไม่ทราบสถานะ" สีเทา (Slate/Neutral) + icon ลิงก์ออกนอก; ลิงก์ไป `external_url` (ถ้ามี) เปิดแท็บใหม่ด้วย `target="_blank" rel="noopener noreferrer"`.
- FR-21 — แทนที่ occupancy ด้วยข้อความ "ติดต่อ ณ ศูนย์พักพิง" (i18n string คงที่ ไม่ใช่ field ใน doc) และ **แสดงความจุสูงสุด** ของศูนย์ (ถ้า `> 0`) เหนือข้อความนั้น; ไม่มี capacity ⇒ แสดงเฉพาะข้อความ. `public_shelters.capacity` = ค่าที่กรอก (ไม่ fallback zones/100; `0` = ไม่ได้กรอก). _(decision sync 2026-11-13: เดิมแทนที่ตัวเลข capacity ด้วยข้อความ + `capacity = 0`)_
- FR-22 — ซ่อนปุ่มจองและลงทะเบียนล่วงหน้า.
- FR-23 — pin บนแผนที่ใช้สีเดียวกับ chip; ตัวกรองสถานะมีตัวเลือก "ไม่ทราบสถานะ".

### Partner API (contract change — ADR 0002)

- FR-24 — EXT-002 / EXT-003 คืน `location_status = 'unknown'` และ `is_external = true` สำหรับศูนย์ External; `?status=unknown` ใช้กรองได้.
- FR-25 — EXT-008 จองศูนย์ External ตอบ `409 location_not_bookable` แม้ partner มี `booking-bypass`.
- FR-26 — แจ้ง partner ล่วงหน้าก่อน deploy; บันทึกใน ADR 0002.

### Excel import (CR-039 / CR-077 — ใช้ format เดิม ไม่มี converter)

- FR-27 — ชีตหลักเพิ่ม 2 คอลัมน์: "ศูนย์จากระบบภายนอก" (ใช่/ไม่ใช่; ว่าง = ไม่ใช่) และ "ลิงก์ศูนย์ภายนอก". ไฟล์เก่าที่ไม่มีคอลัมน์ยังใช้ได้.
- FR-28 — เพิ่ม dropdown ใน `lists`, ชีต "คำแนะนำ", และแถวตัวอย่าง External ใน sample template.
- FR-29 — แถว External: ไม่บังคับ capacity; คอลัมน์สถานะต้องว่าง (ระบบใส่ `unknown`).
- FR-30 — แถว External ที่มีข้อมูลในชีตโซน / จุดแจกอาหาร หรือคอลัมน์ policy / สาธารณูปโภคที่ผูกกับแถวนั้น = `validation_error`.
- FR-31 — จับซ้ำตามชื่อ + `duplicateAction=update`: ถ้าชนิดไม่ตรงกับ doc เดิม = `validation_error` "เปลี่ยนชนิดไม่ได้"; บังคับทั้ง preview และ worker.

---

## Acceptance

- สร้างศูนย์ External โดย `system_admin` โดยไม่กรอก capacity และไม่กรอก URL ได้; `shelter_manager` สร้างหรือสลับชนิดไม่ได้.
- `external_url` = `http://…` / `javascript:…` ถูก reject; `https://…` ผ่าน.
- ศูนย์ปกติตั้ง `unknown` ไม่ได้; ศูนย์ External ตั้งสถานะอื่นนอกจาก `unknown` / `cancelled`(SA) ไม่ได้.
- Public list / detail / map แสดงศูนย์ External ด้วย chip + icon + ข้อความ "ติดต่อ ณ ศูนย์พักพิง"; ไม่มีปุ่มจอง/ลงทะเบียน; ตัวกรอง "ไม่ทราบสถานะ" ทำงาน.
- `status_ui` ของ `unknown` ไม่ใช่ `CLOSED`; `accepts_booking = false`.
- EXT-002/003 คืน `location_status='unknown'` + `is_external=true`; EXT-008 → 409 `location_not_bookable` แม้มี `booking-bypass`.
- ศูนย์ External ไม่ปรากฏใน combobox ปฏิบัติการ (user scope, transfer, donation/needs, kiosk, import) แต่ปรากฏในรายการ system-management พร้อม badge.
- Import: ไฟล์เก่าผ่านเหมือนเดิม; แถว External ที่มีข้อมูลโซน/policy → `validation_error`; เปลี่ยนชนิดผ่าน `duplicateAction=update` → `validation_error`.
- Test (ตามที่ตกลง): Vitest (Zod invariant, mapper / `toUiShelterStatus`, guard SA, `duplicates.ts`, `import-row` / `template` / `sample-row`, route jobs) · pytest (projector, use_case, `accepts_booking`, EXT API) · Playwright `@regression` mock (public UI 1 ชุด + ปรับ `e2e/shelter-import.test.ts`); ไม่เขียน live e2e ใหม่.

---

## Why

Team Lead PO Meeting 2026-11-07 (#1242, labels: priority:high, Before Floods): มีศูนย์ที่บริหารในระบบอื่น แต่ public ต้องการเห็นและลิงก์ไปหาได้ โดยเก็บใน CouchDB doc `shelter` เดิม — ไม่แยก store หรือ doc type ใหม่ (ตามความเห็นใน issue: "เก็บข้อมูลใน couchdb ไปเลยไม่ต้องแยกแล้ว").

`unknown` ใช้เพราะระบบนี้ไม่ทราบสถานะจริงของศูนย์ภายนอก — ห้ามแสดงเป็น `open` หรือ `closed`.

## Change

| ส่วน                    | Before                                      | After                                                                                               |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| shelter doc             | ไม่มี `is_external`, `external_url`         | `is_external` (default `false`), `external_url` (https only, opt)                                   |
| `operation_status`      | 5 ค่า                                       | 6 ค่า (+`unknown`)                                                                                  |
| `capacity`              | required `int>0`                            | required เมื่อศูนย์ปกติ, optional เมื่อ External                                                    |
| สิทธิ์ตั้ง External    | —                                           | `system_admin` ตอนสร้างเท่านั้น, immutable หลังสร้าง                                                |
| worker                  | listener/bootstrap/occupancy ทุกศูนย์ active | ข้ามศูนย์ External                                                                                  |
| FastAPI `status_ui`     | ค่าไม่รู้จัก fallback `CLOSED`              | `unknown` map เป็นของตัวเอง                                                                         |
| EXT-002/003             | `location_status` 5 ค่า                     | +`unknown`, +`is_external`, `?status=unknown`                                                       |
| EXT-008                 | bypass จองได้ตามสิทธิ์                      | ศูนย์ External → 409 `location_not_bookable`                                                        |
| Excel import            | ไม่มีแนวคิด External                        | +2 คอลัมน์, กฎ validation, ห้ามเปลี่ยนชนิดผ่าน update                                               |

## Impact

- **Docs:** `docs/data/schema.md` §3.1 / §9.1 · `docs/prd/role-permission-matrix.md` · ADR 0002 · CR-039 / CR-077 (amend note) · `docs/changes/_index.md` (ตอน approve).
- **Frontend:** shelters domain/ui, shelter-import domain + template/sample-row + route jobs, public-portal UI, ตัวเลือกศูนย์ในทุก flow ปฏิบัติการ.
- **Worker / provisioner:** projector, processor, bootstrap, provisioner (database เปล่า).
- **Backend:** `status_ui`, `accepts_booking`, thirdparty_locations / thirdparty_bookings.
- **ภายนอก:** partner agencies ต้องได้รับแจ้ง contract change ก่อน deploy (FR-26).
- **เกี่ยวข้อง:** `draft-shelter-cancelled-status` — `cancelled` ของศูนย์ External ใช้กลไกถอดจาก public เดียวกัน (FR-4); ตรวจ merge order ของ draft ทั้งสอง.

## Migration

- shelter `schema_v` 9 → 10: additive. doc เดิมไม่มี `is_external` → อ่านเป็น `false`; `external_url` → `null`. ไม่มี batch migration script.
- Zod (client + BFF) ต้องอัปเดตตาม schema v10 (invariant FR-4/5/6/9). ไม่แตะ `validate_doc_update` / `REGISTRY_DESIGN_VERSION` (คงที่ 9).
- `PROJECTION_VERSION` 18 → 19 → worker re-project `public_shelters` ครั้งเดียวหลัง deploy.
- ไม่ต้องรัน `pnpm openapi:update` ซ้ำนอกเหนือจากที่ `status_ui` / EXT schema เปลี่ยน — commit `fastapi.json` + `openapi.d.ts` ตาม workflow §4.2.

## Decision log

- 2026-11-07 — ตกลงสเปกจาก grilling ใน #1242 (Team Lead PO Meeting); เลือก track ด้วย CR ใบเดียว
- 2026-11-12 — proposed (draft) — บันทึกร่าง CR ใน PR #1371
- 2026-11-13 — decision sync (ติดตามด้วย note ใน CR นี้ ไม่เปิด CR ใหม่ ตามที่เจ้าของงานเลือก · #1242): ศูนย์ External กรอกความจุสูงสุดได้ (optional) และ public แสดงความจุนั้น — แก้ FR-6 / FR-19 / FR-21 · `public_shelters.capacity` ของศูนย์ External = ค่าที่กรอก (`backfill_capacity()` ไม่ fallback; เดิมคืน `0`) · ไม่ bump `schema_v` (10) และ `PROJECTION_VERSION` (19 ยังไม่ปล่อย) · occupancy ยังไม่นับ, accepts_booking ยังเป็น false
- 2026-11-12 — approved โดย Soravit Sukkarn (Team Lead) กำหนดหมายเลข CR-252; เลือกหมวด `00-baseline` (ตาม CR-205 / CR-039 / CR-077 ที่แก้ shelter schema); เคาะ chip สถานะ "ไม่ทราบสถานะ" ใช้สีเทา (Slate/Neutral) ไม่ซ้ำกับสีเหลืองของ standby
