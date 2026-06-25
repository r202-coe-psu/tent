---
id: CR-008
title: "Shelter form v3 — comprehensive (sections 1-5: basic info + capacity + zones + utilities + risk)"
status: approved
date: 2026-06-23
requested_by: project owner (session 2026-06-22) — based on spec mockup `spec/section_1.png` … `spec/section_5.png`
decided_by: project owner (2026-06-23)
layer: volatile         # เพิ่ม field ใน doc type เดิม (shelter) + enum ใหม่หลายตัว — volatile spec
affects:
  - docs/data/schema.md §3.1 — registry/shelter extend (sections 1+2+3+4+5); zones[] extend (type/status/closed_*)
  - schema_v registry/shelter 2 → 3
  - docs/data/schema-er-diagram.md — SHELTER_ZONE fix + extend; SHELTER extend
  - docs/data/data-model.md — invariant: closed zone block assignment; EOC real-time use case (section 5)
  - docs/data/api-contract.md — POST/PATCH /api/v1/shelters extend (5 sections); close/reopen zone endpoint
  - docs/prd/role-permission-matrix.md §3 — close/reopen zone row
  - docs/task-breakdown/02-people.md T-08 (zone def + type) + T-09 (assignment gate + suggestion filter by type)
  - docs/task-breakdown/05-D.md (Module D: Kitchen) — T-25/T-56 อ่าน `common_areas.central_kitchen` + `sub_storage[food_dry]`
  - docs/features/* — note ใหม่: EOC real-time risk/structure visibility (section 5)
  - frontend/src/lib/features/shelters/domain/schema.ts — เพิ่ม shelterTypeSchema, areaTypeSchema, powerSourceSchema, waterSourceSchema, communicationsSchema, vhfChannelSchema, elevationMSchema, entranceDescriptionSchema, constraintsSchema, zoneStatusSchema, zoneTypeSchema, commonAreasSchema, facilitiesAccessibleSchema
  - frontend/src/lib/features/shelters/domain/schema.test.ts — new cases
  - frontend/src/lib/features/shelters/data/shelters.api.ts — closeZone/reopenZone; extend create/update body (5 sections)
  - frontend/src/lib/features/shelters/application/queries.ts — useCloseZone/useReopenZone
  - frontend/src/lib/features/shelters/ui/edit-shelter-form.svelte — 5 sections render
  - frontend/src/routes/(protected)/back-office/shelters/+page.svelte — render form
  - frontend/src/routes/api/back-office/shelter/+server.ts — extend POST Zod
  - frontend/src/routes/api/back-office/shelter/[code]/+server.ts — extend PATCH
  - frontend/src/routes/api/back-office/shelter/[code]/zones/[zoneCode]/+server.ts — ใหม่ (close/reopen)
---

# CR-008 — Shelter form v3: comprehensive (sections 1-5)

## Why

`spec/section_1.png` … `section_5.png` แสดง UI form ครบ **5 sections** ของ shelter management
แต่ปัจจุบัน `docs/data/schema.md §3.1` + `frontend/src/lib/features/shelters/domain/schema.ts`
มี field ไม่ครบ + บาง field diverged กับ image. CR นี้ align ให้ตรงกันเป็น **shelter form v3**
(single schema_v 2→3) เพื่อ:
- ปิด spec gap ทั้ง 5 sections ใน CR เดียว
- single migration story (v2 → v3)
- joint review (UI/UX + data model + business rules + EOC use case พร้อมกัน)

**Gap analysis (image vs current spec):**

| Section | Field | Current spec | Image | Action |
| --- | --- | --- | --- | --- |
| 1 | `name` | ✓ | ✓ | exists |
| 1 | `operation_status` | `status: enum('open','closed')` per CR-004 | radio "Active" | **REPLACE** — 4-value enum: `standby\|active\|full_capacity\|closed` |
| 1 | `shelter_type` | ❌ | text "โรงเรียน" | **ADD** as `str` (free text per owner 2026-06-22) |
| 1 | `address_admin` | `location.address` (free text) | "เทศบาลเมืองคอหงส์" (admin boundary) | **NO CHANGE** — keep `location.address` as free text per owner 2026-06-22 (SM/SA กรอกมือ) |
| 1 | `location.lat/lng` | ✓ | ✓ | exists |
| 1 | `contact.name/phone` | ✓ | "ผู้จัดการศูนย์ / เบอร์โทร" | exists (UI label = "ผู้จัดการศูนย์") |
| 2 | `capacity` | ✓ | ✓ | exists |
| 2 | `area_m2` | ✓ | "0 ตร.ม." | exists |
| 2 | `area_type` | ❌ | text "อาคารปิด (Indoor)" | **ADD** as `str` (free text per owner 2026-06-22) |
| 3 | zones, WASH, common_areas | (CR-008 v2) | ✓ | (covered in this CR) |
| 4 | `power_source` | ❌ | "City Grid" | **ADD** enum (3 value per owner 2026-06-22) |
| 4 | `water_source` | ❌ | "City Water" | **ADD** enum (3 value per owner 2026-06-22) |
| 4 | `communications[]` | ❌ | [cellular, vhf_radio] | **ADD** (static list per owner 2026-06-22) |
| 4 | `vhf_channel` | ❌ | "CH-16 / KHO-01" | **ADD** (conditional บน vhf_radio) |
| 5 | `elevation_m` | ❌ | "8 เมตร" | **ADD** |
| 5 | `entrance_description` | ❌ | "ถนนคอนกรีต 2 เลน" | **ADD** |
| 5 | `constraints` | ❌ | textarea | **ADD** |

**Cross-cutting (Section 5 note in image):**
> "ข้อมูลส่วนนี้จะถูกใช้เพื่อช่วย EOC กราบถึงข้อจำกัดของศูนย์แบบ Real-time"

→ section 5 fields (`elevation_m`, `entrance_description`, `constraints`) ต้อง expose ผ่าน public
API สำหรับ EOC consumption — feature ใหม่, cross-link ไป feature spec

**Capacity accounting เป็น derived เสมอ** — ระบบต้องรองรับ assignment/check-in แม้ zone เต็ม
(เช่น override โดย SM, เต็มแล้วย้ายคนออกเพิ่มได้). `remaining` เป็นแค่ display metric
คำนวณจาก `household.current_stay` aggregation ไม่เก็บเป็น field

## Proposed Change

### Section 1 — Basic Info & Location

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ชื่อศูนย์ |
| `operation_status` | `enum('standby', 'active', 'full_capacity', 'closed')` | req | default `'standby'`; per owner 2026-06-22 (เลิกใช้ CR-004 `open/closed`) |
| `shelter_type` | str | opt | **free text** (per owner 2026-06-22); image แสดง "โรงเรียน" |
| `location.address` | str | opt | **free text** (per owner 2026-06-22 — กรอกมือ); ไม่ restructure |
| `location.lat` | `num?` | opt | image แสดง 7.0251 |
| `location.lng` | `num?` | opt | image แสดง 100.4851 |
| `contact.name` | str | opt | "ผู้จัดการศูนย์" |
| `contact.phone` | str | opt | "เบอร์โทร" |

**Operation status state machine:**
```
standby → active        (เริ่มเปิดรับ)
active → full_capacity  (เต็มแล้ว)
active → standby        (พร้อมรับแต่ยังไม่เปิด — เช่น standby ระหว่างวัน)
full_capacity → active  (ย้ายคนออก → active อีกครั้ง)
* → closed              (ปิดศูนย์ — เริ่ม retention timer)
closed → (terminal)     (open decision 1: reopen ได้มั้ย — เดิม)
```

**Migration note (operation_status):** v2 `status: 'open'` → v3 `operation_status: 'active'`; v2 `status: 'closed'` → v3 `operation_status: 'closed'`

**Migration note (address):** ไม่เปลี่ยน — `location.address` ยังเป็น free text เดิม (per owner 2026-06-22)

### Section 2 — Capacity & Structure

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `capacity` | `int>0` | req | ความจุสูงสุด (คน) |
| `area_m2` | `num>0` | opt | พื้นที่ใช้สอยรวม (ตร.ม.) |
| `area_type` | str | opt | **free text** (per owner 2026-06-22); image "อาคารปิด (Indoor)" แต่ field เปิดให้พิมพ์อะไรก็ได้ |

### Section 3 — Zone & Facility Management (existing CR-008 content)

**3a. Zone schema — เพิ่ม 5 field (state 4 + type 1)**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `zones[].type` | `enum('general', 'male', 'female', 'vulnerable', 'pet', 'quarantine')` | req | default `'general'` |
| `zones[].status` | `enum('active', 'closed')` | req | default `'active'`; **ห้าม** `open/closed` (ชนกับ shelter.status) |
| `zones[].closed_at` | `ts \| null` | sys | set เมื่อ transition active → closed |
| `zones[].closed_by` | `user_id \| null` | sys | actor per "override บันทึก actor" pattern |
| `zones[].reason` | `enum('sanitation','capacity','safety','seasonal','other') \| null` | opt | **DECIDED 2026-06-23 — option C**; dropdown หลัก สำหรับ filter/dashboard |
| `zones[].reason_note` | `str \| null` | opt | free text เสริม; meaningful เมื่อ `reason='other'` (อธิบาย edge case) |

**Zone `type` enum mapping** (per owner 2026-06-22):

| Label | enum key | image example |
| --- | --- | --- |
| โซนทั่วไป | `general` | "ทั่วไป" ✓ |
| โซนชายล้วน | `male` | — |
| โซนหญิงล้วน | `female` | — |
| โซนเปราะบาง | `vulnerable` | "เปราะบาง" ✓ |
| โซนสัตว์เลี้ยง | `pet` | — |
| โซนกักโรค | `quarantine` | — |

**`quarantine` semantics (DECIDED 2026-06-23 — option B, soft warn + override):**
- `quarantine` เป็นแค่ **zone type** ที่ SM/SA เลือก config ให้ shelter ตัวเองได้ — shelter อาจมีแค่ zone เดียวก็ได้ ไม่บังคับว่าต้องมี quarantine zone
- assignment ใช้ **soft warn + override เหมือน type อื่น** (vulnerable, pet): ระบบ **suggest** ให้ตาม `quarantine_flag`/zone type แล้วบันทึก override ใน audit — ไม่ hard block
- household with `quarantine_flag=true` → suggest `quarantine` zone (ไม่ใช่ hard restrict)
- household ปกติเข้า `quarantine` zone → soft warn dialog + SM/SA confirm ได้
- ⚠️ **MARK / pending external integration:** spec ส่วน "กักโรค" (quarantine) อาจต้องเชื่อมต่อกับระบบอื่น (ระบบสาธารณสุข/ควบคุมโรค) — **อย่า finalize behavior ละเอียดของ quarantine ใน CR นี้** จนกว่า integration scope จะชัด; ตอนนี้ implement แค่ระดับ zone type + soft-warn เท่านั้น

**3b. Shelter `facilities` — extend 1 field (per-shelter ตาม image)**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `facilities.toilets_male/female/accessible` | `int≥0` | opt | image |
| `facilities.showers` | `int≥0` | opt | image |
| `facilities.water_points/handwashing_stations` | `int≥0` | opt | existing v2 |
| `facilities.accessible` | `bool \| null` | opt | **NEW** — image checkbox "รองรับการเข้าถึงได้" |

**3c. Shelter `common_areas` — section ใหม่**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `common_areas.central_kitchen` | `bool` | opt | ลานประกอบอาหาร / ครัวกลาง (T-25 ใช้) |
| `common_areas.helipad` | `bool` | opt | พื้นที่จอดเฮลิคอปเตอร์ |
| `common_areas.parking_capacity` | `int≥0` | opt | พื้นที่จอดรถ (คัน); per owner 2026-06-22 `0` = ค่าปกติ (ไม่มี semantic พิเศษ) |
| `common_areas.sub_storage` | `[{name: str, type: enum('general', 'food_dry', 'drinking_water', 'medical_supplies')}]` | opt | type ตาม owner 2026-06-22 (4 value) |

### Section 4 — Utilities

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `power_source` | `enum('city_grid', 'generator', 'solar')` | opt | per owner 2026-06-22 (3 value); default `null`; ไม่มี `mixed`/`none` (ใช้ `null` ถ้าไม่มี) |
| `water_source` | `enum('city_water', 'water_tank', 'groundwater')` | opt | per owner 2026-06-22 (3 value); default `null`; ไม่มี `mixed`/`none` |
| `communications` | `enum[]` (subset of `['cellular', 'wifi', 'vhf_radio']`) | opt | **static list per owner 2026-06-22**; multi-select 3 option (Cellular, Wi-Fi, VHF); image [cellular, vhf_radio] |
| `vhf_channel` | `str \| null` | opt | **free text string** (per owner 2026-06-22 — ไม่ใช่ enum, ไม่ใช่ single-choice dropdown); conditional — meaningful เมื่อ `'vhf_radio'` ∈ `communications`; image "CH-16 / KHO-01" (ตัวอย่างเดียว — user พิมพ์ค่าอะไรก็ได้) |

**Invariant:** ถ้า `'vhf_radio'` ∉ `communications` → `vhf_channel` ต้อง `null` (validate)

### Section 5 — Risk & Structure Assessment (EOC use case)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `elevation_m` | `num ≥ 0` | opt | ระดับความสูงจากทะเล (เมตร); image "8 เมตร" |
| `entrance_description` | `str` | opt | ลักษณะโรงสร้างทางเข้า; image "ถนนคอนกรีต 2 เลน" |
| `constraints` | `str` (textarea) | opt | ข้อจำกัดพิเศษ; image "อายุผู้คุ้มได้สะดวก ไม่มีน้ำท่วมขัง" |

**EOC real-time use case** (per image red callout):
- 3 field นี้ต้อง expose ผ่าน public API สำหรับ EOC (Emergency Operation Center) อ่าน real-time
- trigger: live-sync changes feed → invalidate public query
- visibility scope: **public** (EOC + ศูนย์อื่นที่เกี่ยวข้อง) — เป็น transparency ไม่ใช่ PII
- เป็น **feature concern ใหม่** — link feature spec (TBD) เพื่อ implement public endpoint
- ไม่กระทบ schema โดยตรง (เพิ่ม field ใน shelter, public endpoint อ่านจาก shelter เดิม)

### Cascading business rules (section 3 + 5)

| Rule | Detail |
| --- | --- |
| Zone assignment gate | `zone.status=closed` → block assign; suggestion engine skip |
| Close gate (occupants) | **DECIDED option B (hard block)** — close ได้เฉพาะเมื่อ `zone.current_count == 0`; ถ้ายังมี occupants → `409`, SM ต้องย้ายออกให้หมดก่อน (ไม่มี override) |
| Existing occupants | ไม่ kick out — check-in/out/move-out ทำต่อได้ |
| Pre-registration | `pre-registered` assign เข้า `closed` zone → **block** |
| Audit | ทุก status change → append `audit` doc (per `data-model.md:131`) |
| Reopen | **proposed: allow** (symmetric) — **open decision 1** |
| Type filter | T-09 suggestion engine filter ตาม `zone.type` (vulnerable→vulnerable, pet→pet) — soft warn + override สำหรับ most type |
| Quarantine gate | **DECIDED option B** — soft warn + override (เหมือน vulnerable/pet); ระบบ suggest ตาม `quarantine_flag`/zone type, SM/SA override ได้, บันทึก audit; ⚠️ detailed behavior **marked pending** external (สาธารณสุข/ควบคุมโรค) integration |
| EOC visibility | section 5 fields → public endpoint, live-sync — feature spec TBD |

### Permission

- Close / reopen zone: `SA ✓ · SM scope · VOL —` (เหมือน T-08 zone definition)
- Create/edit zone + shelter: เหมือนเดิม SA + SM
- เพิ่ม row ใน `docs/prd/role-permission-matrix.md §3`:
  > | ปิด/เปิด zone | (ใหม่) | ✓ | scope | — | — | — |

### API contract (ใหม่ + extend)

| Method | Purpose |
| --- | --- |
| `POST /api/v1/shelters/{code}/zones/{zoneCode}/close` | body: `{ reason?: enum, reason_note?: str }` (reason = enum หลัก, reason_note = free text เสริมเมื่อ `other` — DECIDED 2026-06-23 option C) → set `status=closed, closed_at, closed_by, reason, reason_note`; **409 ถ้า `zone.current_count > 0`** (hard block — DECIDED 2026-06-23 option B; ต้องย้าย occupants ออกให้หมดก่อน, ไม่มี override path) |
| `POST /api/v1/shelters/{code}/zones/{zoneCode}/reopen` | body: `{}` → set `status=active, closed_at=null, closed_by=null, reason=null, reason_note=null` |
| `POST /api/v1/shelters` | extend body: sections 1+2+3+4+5 (full v3 schema) |
| `PATCH /api/v1/shelters/{code}` | extend body: zone array diff (add/edit/remove + status) + sections 1/2/4/5 diff + `common_areas` diff; dev = batch-migrated (v3), production = lazy migrate v2→v3 (per decision 5) |
| `GET /public/v1/shelters/{code}/risk` (NEW — feature concern) | return section 5 fields for EOC consumption; live-sync driven |

### Schema_v bump: 2 → 3

**Shelter-level:**

| Field | Before (v2) | After (v3) |
| --- | --- | --- |
| `name` | str | unchanged |
| `status` (rename to `operation_status`) | `enum('open','closed')` | **REPLACE** `enum('standby','active','full_capacity','closed')` |
| `shelter_type` | ไม่มี | `str` (free text) |
| `location.address` | `str` (free text) | **NO CHANGE** — เก็บ free text เดิม (per owner 2026-06-22) |
| `capacity` | `int>0` | unchanged |
| `area_m2` | `num>0` | unchanged |
| `area_type` | ไม่มี | `str` (free text) |
| `power_source` | ไม่มี | enum (3 value) |
| `water_source` | ไม่มี | enum |
| `communications` | ไม่มี | enum[] (static list) |
| `vhf_channel` | ไม่มี | `str \| null` |
| `elevation_m` | ไม่มี | num |
| `entrance_description` | ไม่มี | str |
| `constraints` | ไม่มี | str |
| `facilities.accessible` | ไม่มี | `bool \| null` |
| `common_areas.*` | ไม่มี | object (5 field) |
| `facilities.toilets_*/showers/water_points/handwashing_stations` | `int≥0` | unchanged (per-shelter per image) |

**Zone-level (`zones[]` element):**

| Field | Before (v2) | After (v3) |
| --- | --- | --- |
| `type` | ไม่มี | `enum(...)`, default `'general'` |
| `status` | ไม่มี | `enum('active','closed')`, default `'active'` |
| `closed_at` / `closed_by` | ไม่มี | `ts\|null` / `user_id\|null` |
| `reason` / `reason_note` | ไม่มี | `enum(...)\|null` / `str\|null` (option C) |

## Open decisions (ต้อง owner ตัดสินก่อน approve)

1. ~~**Reopen allowed?**~~ ✅ **DECIDED 2026-06-23 — yes (symmetric)**
   `closed → active` allowed; endpoint `POST /…/zones/{zoneCode}/reopen` clears `closed_at`, `closed_by`, `reason`
   → reopen แล้ว zone กลับ `status=active` ทันที; assignment gate ยกเลิก

2. ~~**Quarantine zone gate**~~ ✅ **DECIDED 2026-06-23 — option B (soft warn + override)**

   | Option | พฤติกรรม | ผล |
   |---|---|---|
   | **A — Hard block** | system ปฏิเสธ; SM/SA ไม่สามารถ override ได้เลย | infection control เข้มงวด; UX ชัดเจน; ต้องมี UI error message ที่อธิบายชัด |
   | **B — Soft warn + override** ✅ **เลือก** | แสดง dialog เตือน "zone นี้สำหรับผู้ถูกกักโรค ต้องการดำเนินการต่อ?" SM กด confirm ได้ | ยืดหยุ่นกว่า; risk ด้านสุขภาพถ้า SM ผิดพลาด; ต้องบันทึก override ใน audit |

   **Decision (owner 2026-06-23):** เลือก option B — quarantine เป็นแค่ zone type ที่ SM/SA config เองได้ (shelter อาจมี zone เดียว), ระบบ **suggest** ให้เฉยๆ ไม่ hard block
   **ผลต่อ code:** soft warn = `override_reason` field เพิ่มใน assign request body + audit event; เหมือน path `vulnerable`/`pet`
   **⚠️ MARK:** detailed quarantine behavior ยังไม่ finalize — spec ส่วนกักโรคอาจต้องเชื่อมต่อ external system (สาธารณสุข/ควบคุมโรค); CR นี้ implement แค่ zone type + soft-warn, ค่อย revisit เมื่อ integration scope ชัด

3. ~~**Close zone ที่ยังมี checked_in occupants**~~ ✅ **DECIDED 2026-06-23 — option B (hard block)**

   | Option | พฤติกรรม | ผล |
   |---|---|---|
   | **A — Soft warn** | แจ้งจำนวนคนที่ค้างอยู่ "Zone มี X คน checked-in อยู่ ต้องการปิดต่อ?" SM confirm ได้ | ยืดหยุ่น; occupant ยังอยู่ใน closed zone ได้ (check-out/move-out ทำต่อได้ตาม rule เดิม); อาจสับสนว่า "ปิดแล้วคนยังอยู่" |
   | **B — Hard block** ✅ **เลือก** | API 409 ถ้า `zone.current_count > 0`; SM ต้องย้ายทุกคนออกก่อน | ข้อมูล clean; UX อาจติดขัดถ้าต้องย้ายหลายครัวเรือนพร้อมกัน; เพิ่ม workflow ย้ายคนออก batch |

   **Decision (owner 2026-06-23):** เลือก option B — ถ้า zone ยังมี occupants ต้องย้ายออกให้หมดก่อน ไม่งั้นปิดไม่ได้ (ไม่อนุญาตให้ปิด zone ที่ยังมีคน checked-in อยู่)
   **ผลต่อ code:** close handler query `zone.current_count` ก่อน → ถ้า `> 0` ตอบ `409` พร้อมจำนวน occupant ที่ค้างอยู่; client แสดง error + นำไปสู่ move-out workflow (ไม่มี confirm/override path); ปิดได้เฉพาะเมื่อ `current_count == 0`

4. ~~**`reason` field ของการปิด zone — enum vs free text**~~ ✅ **DECIDED 2026-06-23 — option C (enum + free text)**

   | Option | รูปแบบ | ตัวอย่าง value |
   |---|---|---|
   | **A — Free text** | `str \| null` พิมพ์ได้อิสระ | "ห้องน้ำพัง", "น้ำท่วม zone", "ซ่อมแซม" |
   | **B — Enum** | dropdown: `sanitation \| capacity \| safety \| seasonal \| other` | เลือก "sanitation" |
   | **C — Enum + free text** ✅ **เลือก** | enum หลัก + optional `reason_note: str` เมื่อเลือก `other` | "other" + "โครงสร้างร้าว" |

   **Tradeoff:**
   - Free text = ยืดหยุ่น ไม่ต้อง maintain enum; แต่ report/filter ยาก ข้อมูลไม่ consistent
   - Enum = filter dashboard ได้, API validate ได้; แต่ต้องครอบคลุม case จริง
   - C = best of both — enum ทำ dashboard, free text รับ edge case; แต่ implement ซับซ้อนกว่า

   **Decision (owner 2026-06-23):** เลือก option C — `reason` เป็น enum (`sanitation\|capacity\|safety\|seasonal\|other`) สำหรับ filter/dashboard + `reason_note: str \| null` รับ free text edge case (meaningful เมื่อ `reason='other'`)
   **ผลต่อ code:** close request body = `{ reason?: enum, reason_note?: str }`; domain schema เพิ่ม `zones[].reason` (enum) + `zones[].reason_note` (str); validate `reason_note` พิมพ์ได้เมื่อ `reason='other'`

5. ~~**Migration timing — lazy vs batch**~~ ✅ **DECIDED 2026-06-23 — batch now (dev phase), switch to lazy (A) at go-live**

   | Option | วิธี | ผล |
   |---|---|---|
   | **A — Lazy on read/write** | PATCH/GET handler ตรวจ `schema_v < 3` → apply migration rule inline; ไม่มี script | zero downtime; doc migrate ทีละ record ตามที่ถูกแตะ; ช่วงเปลี่ยนผ่าน db มีทั้ง v2 และ v3 doc อยู่ด้วยกัน (ต้อง handle ทั้งสอง format ในทุก query) |
   | **B — Batch script** ✅ **เลือกใช้ตอนนี้ (dev phase)** | script วิ่งครั้งเดียว อัปเดตทุก shelter doc พร้อมกัน | db consistent ทันที; risk = downtime + script พัง = partial migration; ต้องมี rollback plan |

   **Context (CR-004 pattern):** lazy ถูกใช้แล้วใน v1→v2 ไม่มีปัญหา; shelter doc ปัจจุบันมีไม่มาก (< 100 ในสภาพแวดล้อม dev) → batch ก็ feasible
   **ผลต่อ code:** lazy = ทุก repository method ต้อง handle v2 shape; batch = clean read path แต่ต้องเขียน script + test

   **Decision (owner 2026-06-23):** ตอนนี้ **ใช้ batch script (option B)** — ยังเป็น **development phase** ยังไม่มีข้อมูลจริง, batch ทีเดียวจบได้ db clean ไม่ต้องแบก dual-shape handling. **เมื่อขึ้น production (go-live) แล้วต้องเปลี่ยนเป็น lazy (option A)** — เพราะ production มีข้อมูลจริง + ต้องการ zero downtime, ปลอดภัยกว่าการ batch ทับ live data
   **ผลต่อ code:**
   - **ตอนนี้ (dev):** เขียน batch migration script (v2→v3) + test; read path ถือว่า doc เป็น v3 ทั้งหมดหลัง run
   - **ก่อน go-live:** ต้อง implement lazy migration ใน repository methods (handle v2 shape on read/write) ก่อนเปิด production — **action item / pre-go-live gate**

6. ~~**EOC public endpoint (section 5) — fold vs แยก CR**~~ ✅ **DECIDED 2026-06-23 — option A (fold เข้า CR-008)**

   | Option | scope ใน CR นี้ | ผล |
   |---|---|---|
   | **A — Fold เข้า CR-008** ✅ **เลือก** | build `GET /public/v1/shelters/{code}/risk` + `frontend/src/lib/features/public-portal/` risk widget เป็นส่วนหนึ่ง | review ครั้งเดียว; endpoint เป็น thin read layer ของ field ที่เพิ่มอยู่แล้ว; ไม่มี partial-schema state |
   | **B — แยก CR** | CR-008 = schema + internal UI เท่านั้น; CR-009 = public endpoint + EOC widget | scope CR-008 เล็กลง; สามารถ approve schema ก่อน implement EOC; แต่ risk = schema merge แล้วยัง expose ไม่ได้ → EOC ต้องรอ |

   **ปัจจัยเพิ่มเติม:**
   - endpoint เป็น read-only ไม่มี auth (public) → security risk ต่ำ แต่ต้องตัดสินใจ rate-limit policy
   - ถ้า fold: ต้องมี task breakdown สำหรับ EOC widget ใน CR นี้ด้วย
   - ถ้าแยก: ตกลง CR number ใหม่ + owner approve CR-008 ก่อนได้ทันที

   **Decision (owner 2026-06-23):** เลือก option A — fold public risk endpoint + EOC widget เข้า CR-008 (review รอบเดียว, endpoint เป็น thin read layer ของ section 5 field ที่เพิ่มอยู่แล้ว)
   **ผลต่อ code:** build `GET /public/v1/shelters/{code}/risk` + `frontend/src/lib/features/public-portal/` risk widget ใน CR นี้; ต้องเพิ่ม task breakdown สำหรับ EOC widget
   **⚠️ FOLLOW-UP:** endpoint เป็น public (no auth) → **rate-limit policy ยังต้องตัดสิน** ก่อน implement (กัน abuse / request ถี่เกิน)

## Impact

### Doc
- `docs/data/schema.md` §3.1 — zones row extend + shelter row major extend (sections 1+2+3+4+5) + schema_v bump
- `docs/data/data-model.md` — invariant section เพิ่ม + EOC use case note
- `docs/data/api-contract.md` — 2 endpoint ใหม่ + extend POST/PATCH + public risk endpoint (NEW)
- `docs/data/schema-er-diagram.md` — SHELTER_ZONE fix + extend; SHELTER extend (5 sections)
- `docs/prd/role-permission-matrix.md` §3 — close/reopen row
- `docs/task-breakdown/02-people.md` T-08 + T-09 (type filter)
- `docs/task-breakdown/05-D.md` — T-25/T-56 cross-ref `common_areas.central_kitchen` + `sub_storage[food_dry]`
- `docs/features/*` — note ใหม่: EOC real-time risk/structure visibility (section 5)

### Code
- `frontend/src/lib/features/shelters/domain/schema.ts` — 15 Zod schema ใหม่ (zone status/type + zone reason enum + shelter type/area_type/power/water/comm/vhf_channel/elevation/entrance/constraints + facilities.accessible + common_areas); `zones[].reason_note` (str) คู่กับ reason enum (option C); `location.address` ไม่ restructure
- `frontend/scripts/migrate-shelter-v2-to-v3.ts` (NEW — dev batch migration; decision 5) — วิ่งครั้งเดียวใน dev; **ก่อน go-live ต้องเพิ่ม lazy migrate ใน repository methods** (pre-go-live gate)
- `frontend/src/lib/features/shelters/domain/schema.test.ts` — new cases
- `frontend/src/lib/features/shelters/data/shelters.api.ts` — `closeZone`/`reopenZone`; extend create/update body
- `frontend/src/lib/features/shelters/application/queries.ts` — `useCloseZone`/`useReopenZone`
- `frontend/src/lib/features/shelters/ui/edit-shelter-form.svelte` — **5 sections render**
- `frontend/src/routes/(protected)/back-office/shelters/+page.svelte` — render form
- `frontend/src/routes/api/back-office/shelter/+server.ts` — extend POST Zod
- `frontend/src/routes/api/back-office/shelter/[code]/+server.ts` — extend PATCH (v2→v3 migrate)
- `frontend/src/routes/api/back-office/shelter/[code]/zones/[zoneCode]/+server.ts` — **ใหม่** (close + reopen)
- `frontend/src/routes/public/v1/shelters/[code]/risk/+server.ts` (NEW — feature concern) — public EOC endpoint
- `frontend/src/lib/features/public-portal/` — ใหม่: risk widget

### Test
- Domain: ทุก enum (shelter_type, area_type, power_source, water_source, communications, zone_type, zone_status); default values; `vhf_channel` conditional
- Data: create/update with 5 sections; close/reopen round-trip; type filter; quarantine gate
- Application: `useCloseZone`/`useReopenZone` invalidate `useShelters`
- UI: 5 sections render; form submit round-trip
- E2E: shelter create form (5 sections) + zone close/reopen + EOC public endpoint
- Resource: T-25/T-31 still consistent

## Migration (schema_v 2 → 3)

**Shelter-level:**
- v2 → v3 add: `shelter_type` (str, default `null`), `area_type` (str, default `null`), `power_source`/`water_source`/`communications` (default `null`/empty), `vhf_channel`/`elevation_m`/`entrance_description`/`constraints` (default `null`)
- v2 `status: 'open'` → v3 `operation_status: 'active'`; v2 `status: 'closed'` → v3 `operation_status: 'closed'`
- `location.address` ไม่เปลี่ยน — ยังเป็น free text เดิม (per owner 2026-06-22)
- v2 `facilities` → add `accessible: null`; ที่เหลือ unchanged
- v2 ไม่มี `common_areas` → absent

**Zone-level:**
- v2 zone ไม่มี `type` → default `'general'`
- v2 zone ไม่มี `status/closed_at/closed_by/reason/reason_note` → default `'active'` + `null`

**Migration strategy (DECIDED 2026-06-23 — open decision 5):**
- **ตอนนี้ (dev phase):** **batch script** v2→v3 วิ่งครั้งเดียว — ยังไม่มีข้อมูลจริง, db clean หลัง run, ไม่ต้องแบก dual-shape
- **ก่อน go-live (production):** เปลี่ยนเป็น **lazy** (CR-004 pattern) — PATCH/GET handler ตรวจ `schema_v` → migrate on read/write; zero downtime กับ live data — **pre-go-live gate**

## Decision log

- 2026-06-22 — proposed (per `change-management.md` §5)
- 2026-06-22 — CR tracking method: file in `docs/changes/` (CR-008)
- 2026-06-22 — source: `spec/section_1.png` … `section_5.png` (5 sections comprehensive)
- 2026-06-22 — `location.address` ไม่ restructure — เก็บ free text เดิม (per owner 2026-06-22)
- 2026-06-22 — drop `remaining`/`reserved_count` stored field (rationale: ระบบต้องรองรับแม้เต็ม)
- 2026-06-22 — drop per-zone `facilities` (image confirms all WASH at shelter-level)
- 2026-06-22 — zone `type` enum: `general|male|female|vulnerable|pet|quarantine` (refined labels, added quarantine)
- 2026-06-22 — section 4 (utilities) + section 5 (risk/structure) เพิ่มใหม่ทั้งหมด
- 2026-06-22 — section 5 → EOC public endpoint (fold into CR-008, thin read layer)
- 2026-06-22 — `shelter_type`, `area_type` → free `str` (อัปเดต owner 2026-06-22; rationale: ไม่ต้องการ enum — ให้ SM/SA พิมพ์อะไรก็ได้)
- 2026-06-22 — `location.address` ไม่ restructure — เก็บ free text เดิม (อัปเดต owner 2026-06-22; rationale: SM/SA กรอกมือ ไม่ต้องบังคับ structured)
- 2026-06-22 — `operation_status` expanded: `open/closed` → `standby|active|full_capacity|closed` (อัปเดต owner 2026-06-22; rationale: เพิ่ม `standby` + `full_capacity` ให้ตรง business reality — ไม่ใช่แค่ on/off)
- 2026-06-22 — `power_source` → 3 value (`city_grid|generator|solar`) drop `mixed`/`none` (อัปเดต owner 2026-06-22; rationale: image แสดง 3 option, `null` ใช้แทน none)
- 2026-06-22 — `water_source` → 3 value (`city_water|water_tank|groundwater`) drop อื่นๆ (อัปเดต owner 2026-06-22; rationale: image แสดง 3 option ตามจริง — น้ำประปา/แท็งก์สำรอง/บ่อบาดาล)
- 2026-06-22 — `communications` confirmed 3 value (Cellular/Wi-Fi/VHF) + `vhf_channel` = free text `str` (ยืนยัน owner 2026-06-22; rationale: ไม่ใช่ single-choice dropdown, user พิมพ์ channel อะไรก็ได้)
- 2026-06-22 — drop `donation_point_area_m2` (อัปเดต owner 2026-06-22; rationale: ไม่จำเป็น ใช้ free-form ใน `constraints` (section 5) แทนได้)
- 2026-06-22 — `sub_storage.type` → 4 value (`general|food_dry|drinking_water|medical_supplies`) (อัปเดต owner 2026-06-22; rationale: focused บน T-25 kitchen)
- 2026-06-22 — `parking_capacity = 0` เป็นค่าปกติ ไม่มี semantic พิเศษ (อัปเดต owner 2026-06-22; rationale: ไม่ต้องแยก absent vs 0)
- 2026-06-22 — proposed close+reopen symmetric
- 2026-06-22 — proposed migration: lazy (CR-004 pattern)
- 2026-06-22 — sub-task: fix er-diagram SHELTER_ZONE missing capacity
- 2026-06-23 — open decision 1 RESOLVED: reopen allowed = yes (symmetric); `closed → active` via reopen endpoint
- 2026-06-23 — open decision 2 RESOLVED: quarantine gate = **option B (soft warn + override)**; quarantine เป็น zone type ที่ SM/SA config เองได้ (shelter อาจมี zone เดียว), ระบบ suggest ไม่ hard block; ⚠️ detailed quarantine behavior **marked pending** external (สาธารณสุข/ควบคุมโรค) integration — CR นี้ทำแค่ zone type + soft-warn
- 2026-06-23 — open decision 3 RESOLVED: close zone ที่มี occupants = **option B (hard block)**; close ได้เฉพาะเมื่อ `zone.current_count == 0`, ถ้ายังมีคน checked-in ต้องย้ายออกให้หมดก่อน (API `409`, ไม่มี override path)
- 2026-06-23 — open decision 4 RESOLVED: zone close `reason` = **option C (enum + free text)**; `reason` enum (`sanitation\|capacity\|safety\|seasonal\|other`) + `reason_note: str\|null` (meaningful เมื่อ `other`)
- 2026-06-23 — open decision 5 RESOLVED: migration timing = **batch script ตอนนี้ (dev phase, ยังไม่มีข้อมูลจริง)**, **เปลี่ยนเป็น lazy (option A) เมื่อ go-live (production)** — lazy migration เป็น **pre-go-live gate** (zero downtime กับ live data)
- 2026-06-23 — open decision 6 RESOLVED: EOC public endpoint = **option A (fold เข้า CR-008)**; build `GET /public/v1/shelters/{code}/risk` + public-portal risk widget ใน CR นี้; ⚠️ rate-limit policy เป็น follow-up ก่อน implement
- 2026-06-23 — **APPROVED** by project owner — open decisions ครบทั้ง 6 ข้อ; `status: proposed → approved`, พร้อมเริ่ม implement (rate-limit policy + EOC widget task breakdown เป็น follow-up ก่อน build public endpoint)
