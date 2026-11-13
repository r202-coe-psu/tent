---
id: CR-254
title: Public shelter detail — ยอดคนต่อโซน (Present ต่อโซน) ฝั่ง public
status: approved
date: 2026-11-11
requested_by: Team Lead PO Meeting (2026-11-07) · GitHub #1241
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-11-13
layer: volatile
affects:
  - docs/data/schema.md §9.1 `public_shelters` (+ `occupancy_by_zone`) — Mongo read model, ไม่ bump `schema_v`
  - docs/data/api-contract.md — `GET /public/v1/shelters/{code}` (`ShelterZoneDetail` + `code`, `status`, `present`) · `GET /external/v1/shelters/{code}` ยังไม่เปลี่ยน (ตาม D3)
  - docs/data/couchdb-mongodb-sync.md — `refresh_occupancy` เขียน `occupancy_by_zone` เพิ่ม
  - docs/task-breakdown/12-public.md — งานใหม่ (ต่อจาก T-58) หน้า `/shelters/[id]`
  - worker/src/worker/projectors/occupancy.py (+ `count_zone_stay_statuses`)
  - packages/tent-model/src/tent_model/public_shelter.py (Beanie model `PublicShelter` + `occupancy_by_zone` — แพ็กเกจกลางที่ worker และ backend ใช้ร่วมกัน)
  - worker/src/worker/mongo/shelter.py (`refresh_occupancy`)
  - worker/src/worker/projection_version.py (`PROJECTION_VERSION` 18 → 19 — ถ้ามี PR อื่น bump ก่อน merge ให้ใช้เลขถัดจากเลขล่าสุดบน `develop`)
  - backend/apiapp/modules/shelter/schemas.py (`ShelterZoneDetail`) + use_case.py (map zones) + tests
  - frontend/src/lib/api/fastapi.json + openapi.d.ts (`pnpm openapi:update`)
  - frontend/src/lib/features/public-portal/domain (+ ฟังก์ชันคำนวณ `percent`/`level` ต่อโซน)
  - frontend/src/lib/components/shelter-zones.svelte + i18n `PUBLIC_SHELTER_DETAILS_I18N`
---

# CR-254 — Public shelter detail ยอดคนต่อโซน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** หน้า public รายละเอียดศูนย์ (`/shelters/[id]`) แสดงยอดคนในแต่ละโซนเทียบ capacity (`N / capacity`) พร้อมสีตามความเต็ม และป้ายโซนปิด
> - **เพื่อใคร:** ประชาชนและญาติที่ต้องการรู้ว่าศูนย์ยังมีที่ว่างในโซนที่ต้องการไหม (เช่นโซนครอบครัว โซนสัตว์เลี้ยง) โดยไม่ต้องโทรถามศูนย์
> - **build:** worker นับ `occupancy_by_zone` ลง `public_shelters` → FastAPI เพิ่ม `code`/`status`/`present` ใน `ShelterZoneDetail` → frontend แสดงยอดใน `shelter-zones.svelte` · นับด้วยนิยาม **Present** เหมือน CR-226
> - **กระทบ:** `PROJECTION_VERSION` 18 → 19 (bootstrap เติมค่า) · ไม่ bump `schema_v` · ไม่แตะ CouchDB / `_design/app` · ไม่แตะ partner API `/external/v1/shelters/{code}` (ตาม D3)

---

## Requirements

**นิยาม**

- FR-1 — ยอดคนในโซน = จำนวน evacuee ใน `shelter_{code}` ที่ `current_stay.zone = <zone code>` และ `current_stay.status` ∈ **Present** (`active`, `room_confirmed`, `temporary_leave`) ตาม `docs/data/schema.md` §1.1 — นิยามเดียวกับ CR-226 FR-1
- FR-2 — นับจาก evacuee **ทุกคน** ในศูนย์ โดยไม่สนใจ `privacy.search_excluded` (กติกาเดียวกับ PDPA D8) ห้ามนับจาก `public_persons`
- FR-3 — evacuee ที่ `current_stay.zone = null` หรือ zone code ไม่ตรงกับโซนใดใน `zones[]` ของศูนย์ ไม่นับในโซนใด

**Worker (projection)**

- FR-4 — `refresh_occupancy` เขียน field ใหม่ `public_shelters.occupancy_by_zone`: `{zone_code: {stay_status: count}}` จาก evacuee ชุดเดียวกับที่ใช้นับ `occupancy_by_status` (ไม่ query เพิ่ม)
- FR-5 — เก็บทุก stay status ที่มี zone (ไม่กรองเฉพาะ Present ตอน project) — การกรองตามนิยามทำที่ FastAPI
- FR-6 — bump `PROJECTION_VERSION` +1 จากเลขล่าสุดบน `develop` ตอน merge (ณ 2026-11-13 = 18 → 19; 18 เป็นของ CR-245) พร้อมคอมเมนต์อ้าง CR นี้ เพื่อให้ bootstrap เติม `occupancy_by_zone` ให้ทุกศูนย์

**FastAPI**

- FR-7 — `ShelterZoneDetail` เพิ่ม field (additive ทั้งหมด):
  - `code: str | None` — จาก `zones[].code`
  - `status: "active" | "closed"` — จาก `zones[].status` (ไม่มีค่า → `active`)
  - `present: int | None` — ยอดตาม FR-1 จาก `occupancy_by_zone[code]` รวมเฉพาะสถานะ Present
- FR-8 — `present = 0` เมื่อ `occupancy_by_zone` มีค่าแต่ไม่มี key ของโซนนั้น (โซนว่าง)
- FR-9 — `present = null` ทุกโซนเมื่อ `public_shelters.occupancy_by_zone` เป็น `null` (แถวยังไม่ถูก re-project) — ห้าม fallback ไปนับจาก `public_persons` (ขัด FR-2)
- FR-10 — response ห้ามมี PII (ไม่มี id หรือชื่อ evacuee) — ส่งเฉพาะยอดรวมต่อโซน
- FR-11 — list endpoint `GET /public/v1/shelters` (`ShelterItem`) ไม่เปลี่ยน

**Frontend**

- FR-12 — รัน `pnpm openapi:update` และ commit `fastapi.json` + `openapi.d.ts`
- FR-13 — เพิ่มฟังก์ชัน pure ใน `features/public-portal/domain` รับ zone (`present`, `capacity`, `status`) แล้วคืน `percent` (`round(present / capacity × 100)`, ไม่ clamp) และ `level` (`normal` | `warning` | `full`) ด้วยเกณฑ์เดียวกับ CR-226 FR-12 (`full` ≥ 100%, `warning` ≥ 80%) · `capacity ≤ 0` → `percent = 0`, `level = 'full'` (CR-226 FR-12b) · `capacity = null` (ไม่ระบุ) → `percent = null`, `level = null` — ห้ามหารด้วย null/0 จนได้ `NaN`
- FR-14 — `shelter-zones.svelte` แสดงต่อโซน: `present / capacity คน` + แท่งความเต็ม (ความกว้าง clamp 100%) สีตาม `level` · โซนที่ `capacity = null` แสดงเฉพาะ `present คน` โดยไม่มีแท่งและป้ายระดับ
- FR-15 — โซน `status = closed` แสดงจางพร้อมป้าย "ปิด" และไม่แสดงสีเตือน
- FR-16 — เมื่อ `present = null` ซ่อนยอดและแท่ง แสดงเฉพาะข้อมูลโซนเดิม (ชื่อ ประเภท capacity พื้นที่)
- FR-17 — ข้อความใหม่ทั้งหมดอยู่ใน `PUBLIC_SHELTER_DETAILS_I18N` ครบทุกภาษาที่ไฟล์รองรับ

## Acceptance

- [ ] ยอดต่อโซนบนหน้า public ตรงกับการ์ดความเต็มรายโซนฝั่ง back-office (CR-226) ของศูนย์เดียวกัน หลัง worker sync แล้ว
- [ ] evacuee ที่ `search_excluded` ยังถูกนับในยอดของโซน
- [ ] โซนที่ไม่มีคนแสดง `0 / capacity` · โซนปิดแสดงจางพร้อมป้าย "ปิด"
- [ ] แถว `public_shelters` ที่ยังไม่มี `occupancy_by_zone` → API คืน `present: null` และหน้า public ไม่แสดงยอด (ไม่ error)
- [ ] response ของ `/public/v1/shelters/{code}` ไม่มี PII
- [ ] Tests:
  - worker: นับ `{zone: {status: count}}` ถูก, ข้าม `zone = null`, นับคน `search_excluded`, `refresh_occupancy` เขียน field
  - backend: `present` กรองเฉพาะ Present, โซนว่าง = 0, `occupancy_by_zone = null` → `null`, zone code ไม่ตรง = ไม่นับ, `status` default `active`
  - frontend domain: `percent`/`level` (80/100%, ล้นเกิน 100, `capacity ≤ 0`, `capacity = null`, โซนปิด)
  - frontend component (dom test): แสดงยอด, ซ่อนเมื่อ `present = null`, ไม่มีแท่งเมื่อ `capacity = null`, โซนปิด
- [ ] ทุกไฟล์ `.svelte` ที่แก้ผ่าน `svelte-autofixer`

## เรื่องที่ต้องตัดสิน

- **D1 — ขอบเขตของ "dashboard evacuee ต่อ zone" (#1241)**
  - **ตัดสินแล้ว 2026-11-13 (Soravit Sukkarn, Team Lead):** ยืนยันค่าเริ่มต้น — section ยอดคนต่อโซนในหน้ารายละเอียดศูนย์ `/shelters/[id]` เท่านั้น (ไม่ทำ dashboard รวมทุกศูนย์ในรอบนี้)
- **D2 — แสดงตัวเลขเป๊ะทุกประเภทโซนหรือไม่ (PDPA)**
  - **ตัดสินแล้ว 2026-11-13 (Soravit Sukkarn, Team Lead):** ยืนยันค่าเริ่มต้น — ขยาย OP-9 ครอบคลุมยอดต่อโซน แสดงเป๊ะทุกโซน
- **D3 — field ใหม่ออกทาง partner API ด้วยหรือไม่**
  - **ตัดสินแล้ว 2026-11-13 (Soravit Sukkarn, Team Lead):** ยังไม่ต้องทำก่อน — คง response ของ `/external/v1/shelters/{code}` ไว้ตามเดิม ไม่ส่ง field ใหม่ (`present`) ออกไปทาง partner API ในรอบนี้ (แยก response model หรือคงโมเดลเดิมของ partner API ไว้ก่อน ไม่กระทบ partner)

## Why

- หน้า public มีแค่ยอดรวมทั้งศูนย์ (Forecast / Present / In-zone) และรายการโซนที่ไม่มียอดคน ประชาชนจึงไม่รู้ว่าโซนที่ต้องการ (ครอบครัว สัตว์เลี้ยง กลุ่มเปราะบาง) ยังว่างอยู่ไหม (#1241)
- **ใช้ Present:** ให้ตรงกับการ์ดฝั่ง back-office (CR-226) และหน้า `onsite/zoning` คนที่ `temporary_leave` ยังจองที่นอนในโซน
- **นับใน worker ตอน `refresh_occupancy`:** ฟังก์ชันนี้ไล่ evacuee ทั้งศูนย์อยู่แล้วทุกครั้งที่ evacuee เปลี่ยน นับเพิ่มในรอบเดียวกันจึงไม่เพิ่มภาระ และ FastAPI อ่านแค่ Mongo ตาม topology ของ public plane
- **เก็บ `{zone: {status: count}}` แทนเก็บเฉพาะยอด Present:** ถ้านิยามเปลี่ยนภายหลัง แก้แค่ FastAPI โดยไม่ต้อง bump `PROJECTION_VERSION` อีกรอบ (เหตุผลเดียวกับ CR-226 ที่ emit `[zone, status]`)
- **join กับ `zones[]` ตอน FastAPI อ่าน:** โครงโซน (ชื่อ capacity สถานะ) อยู่ใน `raw_data.zones` ที่ projector ของ shelter อัปเดตอยู่แล้ว การเปิด/ปิด/แก้โซนจึงไม่ต้องนับคนใหม่

**ทางเลือกที่ตัดทิ้ง**

- นับจาก `public_persons` ใน FastAPI: ไม่นับคน `search_excluded` (ขัด PDPA D8) และ `public_persons` ไม่ใช่ที่สำหรับ aggregate
- ให้ BFF ฝั่ง SvelteKit อ่าน CouchDB view `occupancy_by_zone` (ของ CR-226) แล้วส่งให้ public: ขัด topology public plane (public อ่าน Mongo ผ่าน FastAPI เท่านั้น) และต้องใช้ admin credential ในเส้นทาง anonymous
- เพิ่มยอดต่อโซนใน list `/public/v1/shelters`: payload ของ list โตขึ้นทุกศูนย์ ทั้งที่ใช้แค่ในหน้า detail

## Impact

| ส่วน     | กระทบ                                                                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs     | `schema.md` §9.1 (+ `occupancy_by_zone`) · `api-contract.md` แถว `GET /public/v1/shelters/{code}` · `couchdb-mongodb-sync.md` (`refresh_occupancy`) · `task-breakdown/12-public.md` (งานใหม่ต่อจาก T-58) |
| Model    | `packages/tent-model/src/tent_model/public_shelter.py` (`PublicShelter` + field `occupancy_by_zone`) — แพ็กเกจกลางที่ worker และ backend ใช้ร่วมกัน                                                      |
| Worker   | `projectors/occupancy.py` (+ ฟังก์ชันนับ `{zone: {status: count}}`) · `mongo/shelter.py` `refresh_occupancy` · `projection_version.py` 18 → 19 · pytest                                                  |
| Backend  | `modules/shelter/schemas.py` `ShelterZoneDetail` (+ `code`, `status`, `present`) · `use_case.py` map zones · tests ใน `backend/tests/`                                                                   |
| Frontend | `fastapi.json` + `openapi.d.ts` · `features/public-portal/domain` (+ `percent` / `level` ต่อโซน) · `lib/components/shelter-zones.svelte` · `PUBLIC_SHELTER_DETAILS_I18N` · dom test                      |
| ไม่กระทบ | Partner API `/external/v1/shelters/{code}` (ตาม D3 ยังไม่ทำ) · CouchDB doc / `schema_v` · `_design/app` view manifest · list `GET /public/v1/shelters` · back-office dashboard (CR-226)                  |

## Migration

- CouchDB: ไม่มี doc ต้องแก้ ไม่ bump `schema_v` ไม่แตะ `_design/app`
- Mongo `public_shelters`: field ใหม่ `occupancy_by_zone` (`{str: {str: int}} | null`, default `null`) additive · bump `PROJECTION_VERSION` 18 → 19 → bootstrap re-project เติมค่าให้ทุกศูนย์ · ระหว่างรอ แถวที่ยังเป็น `null` ได้ `present: null` (FR-9) และหน้า public ซ่อนยอด (FR-16)
- ลำดับ deploy: worker ก่อน (หรือพร้อมกัน) แล้วค่อย backend + frontend — ถ้า backend ขึ้นก่อน ทุกศูนย์จะได้ `present: null` ชั่วคราว ไม่ error

## Decision log

- 2026-11-11 — proposed (#1241; track ด้วย CR ไฟล์ตามที่เจ้าของงานสั่ง) · D1–D3 รอเจ้าของโครงการตัดสิน
- 2026-11-13 — review PR #1354: แก้ path ของ model `PublicShelter` เป็น `packages/tent-model/` (affects + Impact) · เพิ่มกรณี `capacity = null` ใน FR-13 / FR-14 / Acceptance (`percent` / `level` = `null`, ไม่แสดงแท่งและป้ายระดับ)
- 2026-11-13 — `PROJECTION_VERSION` 17 → 18 เปลี่ยนเป็น 18 → 19: #1319 (CR-245 `public_volunteers.occupation`) merge เข้า `develop` ด้วยเลข 18 ก่อน · FR-6 เขียนเป็น "+1 จากเลขล่าสุด" แบบเดียวกับ CR-246 FR-6
- 2026-11-13 — approved โดย Soravit Sukkarn (Team Lead) กำหนดหมายเลข CR-254 (ต่อจาก CR-253) · ย้ายเข้า `12-public/` · ยืนยันค่าเริ่มต้น D1, D2 และ D3 ตัดสินยังไม่ต้องทำก่อน (ไม่กระทบ partner API)
