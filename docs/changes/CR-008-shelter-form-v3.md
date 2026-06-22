---
id: CR-008
title: "Shelter form v3 — comprehensive (sections 1-5: basic info + capacity + zones + utilities + risk)"
status: proposed
date: 2026-06-22
requested_by: project owner (session 2026-06-22) — based on spec mockup `spec/section_1.png` … `spec/section_5.png`
decided_by: <pending>
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
| `zones[].reason` | `str \| null` | opt | sanitation / capacity / safety / seasonal / other |

**Zone `type` enum mapping** (per owner 2026-06-22):

| Label | enum key | image example |
| --- | --- | --- |
| โซนทั่วไป | `general` | "ทั่วไป" ✓ |
| โซนชายล้วน | `male` | — |
| โซนหญิงล้วน | `female` | — |
| โซนเปราะบาง | `vulnerable` | "เปราะบาง" ✓ |
| โซนสัตว์เลี้ยง | `pet` | — |
| โซนกักโรค | `quarantine` | — |

**`quarantine` semantics:**
- household with `quarantine_flag=true` → only `quarantine` zone
- household ปกติ → **hard block** เข้า quarantine zone (strict safety — ไม่ใช่ warning)
- แตกจาก type อื่น (vulnerable, pet = soft warn + override) — **open decision 2**

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
| Existing occupants | ไม่ kick out — check-in/out/move-out ทำต่อได้ |
| Pre-registration | `pre-registered` assign เข้า `closed` zone → **block** |
| Audit | ทุก status change → append `audit` doc (per `data-model.md:131`) |
| Reopen | **proposed: allow** (symmetric) — **open decision 1** |
| Type filter | T-09 suggestion engine filter ตาม `zone.type` (vulnerable→vulnerable, pet→pet) — soft warn + override สำหรับ most type |
| Quarantine gate | household with `quarantine_flag=true` → only `quarantine` zone; household ปกติ → **hard block** เข้า quarantine — **open decision 2** |
| EOC visibility | section 5 fields → public endpoint, live-sync — feature spec TBD |

### Permission

- Close / reopen zone: `SA ✓ · SM scope · VOL —` (เหมือน T-08 zone definition)
- Create/edit zone + shelter: เหมือนเดิม SA + SM
- เพิ่ม row ใน `docs/prd/role-permission-matrix.md §3`:
  > | ปิด/เปิด zone | (ใหม่) | ✓ | scope | — | — | — |

### API contract (ใหม่ + extend)

| Method | Purpose |
| --- | --- |
| `POST /api/v1/shelters/{code}/zones/{zoneCode}/close` | body: `{ reason? }` → set `status=closed, closed_at, closed_by, reason`; 409 ถ้ามี checked_in occupants (เลือกได้: soft warn vs hard block — **open decision 3**) |
| `POST /api/v1/shelters/{code}/zones/{zoneCode}/reopen` | body: `{}` → set `status=active, closed_at=null, closed_by=null, reason=null` |
| `POST /api/v1/shelters` | extend body: sections 1+2+3+4+5 (full v3 schema) |
| `PATCH /api/v1/shelters/{code}` | extend body: zone array diff (add/edit/remove + status) + sections 1/2/4/5 diff + `common_areas` diff; lazy migrate v2→v3 |
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
| `closed_at` / `closed_by` / `reason` | ไม่มี | `ts\|null` / `user_id\|null` / `str\|null` |

## Open decisions (ต้อง owner ตัดสินก่อน approve)

1. **Reopen allowed?** — proposed: yes (symmetric, flexible) vs one-way (data hygiene)
2. **Quarantine zone gate** — household ปกติเข้า quarantine = hard block (proposed) vs soft warn
3. **Close ที่มี checked_in occupants** — soft warn vs hard block (force SM ย้ายคนออกก่อน)
4. **`reason` as enum vs free text** — proposed: free text ก่อน
5. **Migration timing** — lazy on read/write (CR-004 pattern, proposed) vs batch script
6. **EOC public endpoint (section 5)** — เป็น feature ใหม่, แยก CR หรือ fold เข้า CR นี้? (proposed: fold — เพราะ schema change อยู่แล้ว, endpoint เป็น thin read layer)

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
- `frontend/src/lib/features/shelters/domain/schema.ts` — 14 Zod schema ใหม่ (zone status/type + shelter type/area_type/power/water/comm/vhf_channel/elevation/entrance/constraints + facilities.accessible + common_areas); `location.address` ไม่ restructure
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
- v2 zone ไม่มี `status/closed_at/closed_by/reason` → default `'active'` + `null`

**Lazy migration** (CR-004 pattern): PATCH handler ตรวจ `schema_v` → migrate on read/write; ไม่ batch

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
- <pending> — owner approval (6 open decisions)
