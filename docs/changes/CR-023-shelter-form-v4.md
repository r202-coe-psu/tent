---
id: CR-023
title: "Shelter form v4 — shelter_type→master_data + structured address (CR-011 style) + key personnel + zone area/specifics + WASH supported count + common-area expansion + secondary muster point + section 6 (admission & pet policy)"
status: proposed        # proposed | approved | done | rejected | superseded
date: 2026-06-30
requested_by: project owner (session 2026-06-30) — UI mock v5 (spec/section_1.png, section_3.png, section_3_2.png, section_5.png, section_6.png)
decided_by: project owner (pending)
layer: volatile         # เพิ่ม field ใน doc type เดิม (shelter) + enum ใหม่ 2 ตัว + section ใหม่ — volatile spec
affects:
  - docs/data/schema.md §3.1 — shelter extend (sections 1/3/5 + section 6 ใหม่); zones[] extend (area_m2, specifics); shelter_type free-text → master_data code; area_type free-text → enum; เพิ่ม municipality_zone + community + ที่อยู่ 6 ฟิลด์ (CR-011 style)
  - schema_v shelter 3 → 4
  - dependency — CR-019 (master_type `shelter_type` + /shelter-config) ต้อง done ก่อน wire dropdown; CR-012 (master_data municipality_zone + community) ต้อง done ก่อน wire address dropdown
  - frontend/src/lib/features/shelters/domain/schema.ts — shelter_type → master_data code; area_type → areaTypeSchema enum; เพิ่ม municipality_zone/community + ที่อยู่ 6 ฟิลด์; keyPersonnelSchema, projectLevel, zone area_m2/specifics, facilities.car_toilet_supported, commonAreas (isolation_room, women_child_friendly_space, logistics_area_m2, sub_storage[].area_m2), risk.secondary_muster_point, admissionPolicySchema (supported_vulnerable_groups = master_data vulnerable_group codes + petPolicySchema enum)
  - frontend/src/lib/features/shelters/domain/schema.test.ts — new cases
  - frontend/src/lib/features/shelters/domain/schema.ts — migrateShelterV2ToCurrent → v3→v4 default fill
  - frontend/src/lib/features/shelters/ui/basic-info-section.svelte — shelter_type dropdown (master_data) + project_level + key personnel block + municipality_zone/community dropdown + ที่อยู่ 6 ฟิลด์
  - frontend/src/lib/features/shelters/ui/capacity-section.svelte — area_type free text → enum dropdown
  - frontend/src/lib/features/shelters/ui/zones-facilities-section.svelte — zone area/specifics + car_toilet_supported + 3c common-area additions
  - frontend/src/lib/features/shelters/ui/risk-section.svelte — secondary_muster_point
  - frontend/src/lib/features/shelters/ui/admission-policy-section.svelte — NEW (section 6)
  - frontend/src/lib/features/shelters/ui/shelter-form-page.svelte — render section 6
  - frontend/src/routes/api/back-office/shelter/+server.ts — POST schema_v 4 + GET pass-through new fields
  - frontend/src/routes/api/back-office/shelter/[code]/+server.ts — PATCH extend
  - frontend/src/routes/public/v1/shelters/[code]/risk/+server.ts — add secondary_muster_point (EOC, ถ้า decision 6 = yes)
---

# CR-023 — Shelter form v4

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ต่อยอด shelter form v3 (CR-008) ตาม **UI mock v5** — (a) `shelter_type` free-text → **dropdown จาก master_data** (master_type จาก CR-019); (b) `area_type` free-text → **enum dropdown** (indoor/outdoor/hybrid); (c) เพิ่ม **ที่อยู่แบบ structured** (municipality_zone + community + ที่อยู่ 6 ฟิลด์) ล้อตาม CR-011; (d) เพิ่ม field ใน section 1/3/5; (e) เพิ่ม **section 6 ใหม่** (นโยบายรับผู้อพยพ + สัตว์เลี้ยง). นอกจาก `shelter_type`/`area_type` (เปลี่ยน free-text → choice) ที่เหลือ **additive** ล้วน.
- **เพื่อใคร/ทำไม:** UI mock v5 เพิ่มข้อมูลที่ EOC/SM ต้องใช้จริง + standardize `shelter_type` ผ่าน master_data (filter/report ได้) + เก็บที่อยู่ศูนย์แบบ structured สำหรับติดตาม/รายงาน.
- **dev ต้อง build อะไร:** ขยาย Zod domain schema + เปลี่ยน `shelter_type` เป็น master_data code + เพิ่ม address fields + 3 section component เดิม + 1 component ใหม่ (section 6) + wire dropdown จาก live master_data query (pattern CR-019) + POST/PATCH/GET API + v3→v4 default-fill migrate.
- **กระทบ schema/scope:** shelter `schema_v 3 → 4`; volatile; ไม่มี real data → migration ต้นทุนต่ำ. **Depends on CR-019 + CR-012** (master_data types).

> ⚠️ **CR นี้ยัง `proposed`** — เหลือ 1 open decision (`supported_vulnerable_groups`: choice จาก master_data หรือ static enum) + owner **approve การ bump `schema_v 3→4`** ก่อนเริ่ม implement.

---

## Why

**UI mock v5** (`spec/section_1.png`, `section_3.png`, `section_3_2.png`, `section_5.png`, `section_6.png`, รอบ 2026-06-30) เพิ่มเติมจาก form v3 (CR-008 — อิง UI mock v3). ความต้องการที่เพิ่ม:

- **`shelter_type` → master_data** — CR-008 ตั้ง `shelter_type` เป็น free text; UI mock v5 + CR-019 (เพิ่ม master_type `shelter_type` + route `/shelter-config`) ต้องการให้ `shelter_type` เป็น dropdown เลือกจาก master_data (เก็บ **code**, lookup label ตอน render — pattern เดียวกับ CR-019/CR-011) เพื่อ standardize ค่า + filter/report ได้. CR นี้ **supersede** decision "shelter_type = free text" ของ CR-008.
- **`area_type` → enum** — CR-008 ตั้ง `area_type` เป็น free text; UI mock v5 ต้องการ dropdown ค่าตายตัว 3 ค่า (`indoor`/`outdoor`/`hybrid`) เพื่อ standardize. hardcoded enum (value set นิ่ง ไม่ต้อง master_data). CR นี้ **supersede** decision "area_type = free text" ของ CR-008.
- **ที่อยู่ศูนย์แบบ structured** — ปัจจุบันมีแค่ `location.address` (free text = ชื่อ อปท.). ต้องเก็บที่อยู่ทางกายภาพแบบ structured สำหรับติดตาม/รายงาน — **ล้อตาม CR-011** (household): `municipality_zone` + `community` (code จาก master_data) + ที่อยู่ flat 6 ฟิลด์.
- **บุคลากรหลักต่อศูนย์ (Key Personnel)** — EOC/SM ต้องรู้ผู้ประสานงาน EOC, หัวหน้าแพทย์, หัวหน้าครัว ของแต่ละศูนย์เพื่อ coordinate (ปัจจุบันมีแค่ `contact` = ผู้จัดการศูนย์เดียว).
- **ระดับโครงการ (Project Level)** — แยกระดับศูนย์ (อปท. / จังหวัด / ฯลฯ) สำหรับ reporting.
- **ข้อมูลราย zone ละเอียดขึ้น** — ขนาดพื้นที่ (ตร.ม.) + ข้อจำกัด/สิ่งอำนวยความสะดวกเฉพาะ zone.
- **WASH** — บันทึกจำนวน "รถสุขาเคลื่อนที่ที่ได้รับการสนับสนุนแล้ว" (ของจริงในพื้นที่ ไม่ใช่แค่ flag เข้าถึงได้).
- **พื้นที่ส่วนกลางเพิ่ม** — ห้องแยกกักโรค, พื้นที่เด็ก/สตรี (Sphere), พื้นที่โลจิสติกส์รวม (Drop-off/Sorting), ขนาดราย sub-storage.
- **จุดรวมพลสำรอง (Secondary Muster Point)** — ข้อมูลความปลอดภัย/อพยพ ต่อจาก section 5 (risk).
- **Section 6 ใหม่** — นโยบายรับกลุ่มเปราะบาง + สัตว์เลี้ยง (multi-select) เพื่อ match suggestion engine ตอน assign + public portal filter. **กลุ่มเปราะบางดึงจาก master_data `vulnerable_group`** (admin จัดการเอง, vocabulary เดียวกับ `evacuee.special_needs`) — ไม่ hardcode; pet policy เป็น enum นิ่ง.

**Continuation จาก CR-008:** CR-008 = form v3 (sections 1–5 + EOC public risk endpoint). CR-023 = form v4 ต่อยอด field เพิ่ม + section 6. คง envelope/auth/sync/layer เดิมทั้งหมด (ไม่แตะ stable core).

---

## Gap analysis (image vs current v3 schema)

ตรวจกับ `frontend/src/lib/features/shelters/domain/schema.ts` (schema_v 3 ปัจจุบัน — canonical).

| Section | Field | Current v3 | Image 2026-06-30 | Action |
| --- | --- | --- | --- | --- |
| 1 | `name`, `operation_status`, `location.*`, `contact.*` | ✓ | ✓ | exists |
| 1 | `shelter_type` | `str` free text (CR-008) | dropdown "โรงเรียน" | **CHANGE** — free text → master_data code (master_type จาก CR-019) |
| 1 | `municipality_zone` | ❌ | (CR-011 style address) | **ADD** — code จาก master_data |
| 1 | `community` | ❌ | (CR-011 style address) | **ADD** — code จาก master_data (filter by zone) |
| 1 | `address_no`, `village_no`, `subdistrict`, `district`, `province`, `postal_code` | ❌ | (CR-011 style address) | **ADD** — flat str ×6 |
| 1 | `project_level` | ❌ | "ระดับ อปท. (ศูนย์พักพิงหลักของเทศบาล)" | **ADD** — enum 3 ค่า (community/lao/provincial) |
| 1 | `key_personnel.eoc_liaison` | ❌ | "ผู้ประสานงาน EOC (EOC Liaison)" — ชื่อ/เบอร์ | **ADD** |
| 1 | `key_personnel.medical_lead` | ❌ | "หัวหน้าทีมแพทย์/พยาบาล (Medical Lead)" — ชื่อ/เบอร์ | **ADD** |
| 1 | `key_personnel.kitchen_lead` | ❌ | "หัวหน้าโรงครัว (Kitchen Lead)" — ชื่อ/เบอร์ | **ADD** |
| 2 | `area_type` | `str` free text (CR-008) | dropdown "อาคารปิด (Indoor)" | **CHANGE** — free text → enum 3 ค่า (indoor/outdoor/hybrid) |
| 3a | `zones[].code/name/capacity/type/status/...` | ✓ | ✓ | exists |
| 3a | `zones[].area_m2` | ❌ | "ขนาดพื้นที่ … ตร.ม." (ต่อ zone) | **ADD** |
| 3a | `zones[].specifics` | ❌ | "ข้อจำกัดหรือสิ่งอำนวยความสะดวกเฉพาะโซน (ZONE SPECIFICS)" | **ADD** |
| 3b | `facilities.car_toilet_accessible` | ✓ (bool) | "✅ รถสุขาเคลื่อนที่สามารถเข้าถึงได้" | exists |
| 3b | `facilities.car_toilet_supported` | ❌ | "ระบุจำนวนที่ได้รับการสนับสนุนแล้ว (ห้อง)" | **ADD** (gated บน `car_toilet_accessible`) |
| 3c | `common_areas.central_kitchen/helipad/parking_capacity` | ✓ | ✓ | exists |
| 3c | `common_areas.sub_storage[].name/type` | ✓ | ✓ | exists |
| 3c | `common_areas.isolation_room` | ❌ | "🔴 ห้องแยกกักโรค (Isolation Room)" | **ADD** (bool) |
| 3c | `common_areas.women_child_friendly_space` | ❌ | "🧸 พื้นที่สำหรับเด็ก/สตรี (Women & Child Friendly Space)" — Sphere | **ADD** (bool) |
| 3c | `common_areas.logistics_area_m2` | ❌ | "📦 พื้นที่จัดการโลจิสติกส์รวม (Drop-off & Sorting Area)" 150 ตร.ม. | **ADD** (num≥0) |
| 3c | `common_areas.sub_storage[].area_m2` | ❌ | sub-storage row มีช่อง "ตร.ม." | **ADD** (num≥0 ต่อ entry) |
| 5 | `risk.elevation_m/entrance_description/constraints` | ✓ | ✓ | exists |
| 5 | `risk.secondary_muster_point` | ❌ | "จุดรวมพลสำรอง (Secondary Muster Point)" | **ADD** (str) |
| 6 | `admission_policy.supported_vulnerable_groups[]` | ❌ (section ใหม่) | 5 checkbox (multi) | **ADD** — code[] จาก master_data `vulnerable_group` (ไม่ hardcode) |
| 6 | `admission_policy.pet_policy[]` | ❌ (section ใหม่) | 4 checkbox (multi) | **ADD** (enum[]) |

> **หมายเหตุ pre-existing gap:** `docs/data/schema.md §3.1` ยังเป็น shape v2 (`status` enum) ไม่ตรง v3 ที่ CR-008 approved ไปแล้ว (Zod เป็น canonical). การอัปเดต doc ใน CR นี้ต้อง **reconcile §3.1 ให้เป็น v4** (รวม field v3 ที่ค้างอยู่ด้วย) ไม่ใช่ diff จาก v2.

---

## Requirements (atomic / testable)

ทั้งหมดเป็น field **opt** (เว้นว่างได้) — form ต้อง submit ผ่านได้แม้ไม่กรอก field ใหม่ใด ๆ เลย.

### Section 1/2 — shelter_type, area_type, Address, Key Personnel & Project Level
- **FR-23-0a** — `shelter_type` ต้องเป็น **dropdown** เลือกจาก `master_data` (master_type `shelter_type`, CR-019); persist เป็น **code string**, lookup label ตอน render. เว้นว่างได้ (`null`).
- **FR-23-0d** — `area_type` (section 2) ต้องเป็น **dropdown** (enum: `indoor`/`outdoor`/`hybrid`). เว้นว่างได้ (`null`). ค่านอก enum → reject.
- **FR-23-0b** — form section 1 ต้องมี **dropdown `municipality_zone`** (code จาก `master_data:municipality_zone`) + **dropdown `community`** (code จาก `master_data:community`, filter ตาม zone ที่เลือก) — pattern เดียวกับ household-form (CR-011/CR-019). เว้นว่างได้.
- **FR-23-0c** — form section 1 ต้องมีช่องที่อยู่ flat 6 ฟิลด์ (text): `address_no`, `village_no`, `subdistrict`, `district`, `province`, `postal_code`. ทุกช่องเว้นว่างได้.
- **FR-23-1** — form section 1 ต้องมี **dropdown** `project_level` (enum: `community`/`lao`/`provincial`). เว้นว่างได้ (`null`). ค่านอก enum → reject.
- **FR-23-2** — form section 1 ต้องมีบล็อก "ข้อมูลบุคลากรหลัก (Key Personnel)" 3 รายการ: EOC Liaison, Medical Lead, Kitchen Lead — แต่ละรายการมี `name` + `phone`. ทุกช่องเว้นว่างได้.
- **FR-23-3** — `key_personnel` persist เป็น object: `{ eoc_liaison:{name,phone}, medical_lead:{name,phone}, kitchen_lead:{name,phone} }`; ช่องที่เว้นว่าง = `null`.

### Section 3a — Zone
- **FR-23-4** — แต่ละ zone ต้องมีช่อง `area_m2` (number ≥ 0, ตร.ม.). เว้นว่างได้.
- **FR-23-5** — แต่ละ zone ต้องมีช่อง `specifics` (text, ข้อจำกัด/สิ่งอำนวยความสะดวกเฉพาะ zone). เว้นว่างได้.

### Section 3b — WASH
- **FR-23-6** — เมื่อ `facilities.car_toilet_accessible = true` form ต้องแสดงช่อง `facilities.car_toilet_supported` (int ≥ 0, "จำนวนที่ได้รับการสนับสนุนแล้ว").
- **FR-23-7** — invariant: ถ้า `car_toilet_accessible` ไม่ใช่ `true` → `car_toilet_supported` ต้องเป็น `null` (validate; UI hide+clear). [ขึ้นกับ Decision 4]

### Section 3c — Common Areas
- **FR-23-8** — section 3c ต้องมี checkbox `common_areas.isolation_room` (ห้องแยกกักโรค).
- **FR-23-9** — section 3c ต้องมี checkbox `common_areas.women_child_friendly_space` (พื้นที่เด็ก/สตรี).
- **FR-23-10** — section 3c ต้องมีช่อง `common_areas.logistics_area_m2` (number ≥ 0, ตร.ม.).
- **FR-23-11** — แต่ละ sub-storage entry ต้องมีช่อง `area_m2` (number ≥ 0, ตร.ม.) เพิ่มจาก `name` + `type` เดิม. เว้นว่างได้.

### Section 5 — Risk
- **FR-23-12** — section 5 ต้องมีช่อง `risk.secondary_muster_point` (text). เว้นว่างได้.

### Section 6 — Admission & Pet Policy (ใหม่)
- **FR-23-13** — เพิ่ม section 6 "นโยบายการรับผู้อพยพและกลุ่มเปราะบาง" render ต่อจาก section 5 ใน `shelter-form-page.svelte`.
- **FR-23-14** — section 6 ต้องมีกลุ่ม checkbox **multi-select** `admission_policy.supported_vulnerable_groups[]`. **[ขึ้นกับ Open Decision 1]** — option A: render จาก live master_data (`vulnerable_group`, persist code[]); option B: hardcoded enum 5 ค่า. (เนื้อหา CR ร่างตาม option A.)
- **FR-23-15** — section 6 ต้องมีกลุ่ม checkbox **multi-select** `admission_policy.pet_policy[]` จาก whitelist (hardcoded enum): `no_pets`, `small_only`, `all_with_restraint`, `livestock`.
- **FR-23-16** — `pet_policy` ค่านอก whitelist → reject (Zod enum). `supported_vulnerable_groups` เก็บ code string; source of truth = master_data `vulnerable_group` (UI เลือกได้เฉพาะค่าที่มีใน master_data).
- **FR-23-17** — `pet_policy` เป็น multi-select **อิสระ** (ไม่บังคับ mutual-exclusion) — `[no_pets]`, `[no_pets, livestock]` ฯลฯ บันทึกได้ทั้งหมด. *(Decided 2026-06-30 — option B)*

### Schema / persistence
- **FR-23-18** — bump shelter `schema_v 3 → 4`; doc ใหม่/แก้ → เขียน `schema_v: 4`.
- **FR-23-19** — `migrateShelterV2ToCurrent` ขยายเป็น v3→v4 default-fill (ดู §Migration); read path ต้องไม่พังกับ doc v3 ที่ขาด field ใหม่.

### Acceptance / DoD
- **AC-1** — สร้าง shelter โดยไม่กรอก field ใหม่ใด ๆ → submit ผ่าน, doc มี `schema_v:4` + field ใหม่เป็น default (`null`/`[]`/`false` ตาม §Migration).
- **AC-2** — กรอกครบทุก section (1/3/5/6) → persist ครบ, GET คืนค่าเป๊ะ (round-trip).
- **AC-3** — `supported_vulnerable_groups`/`pet_policy` เลือกหลายค่า persist ครบ; ค่านอก whitelist ถูก reject.
- **AC-4** — doc v3 เดิม (ไม่มี field ใหม่) อ่านผ่าน GET ได้ไม่ error (default-fill).
- **AC-5** — `pnpm lint` + `pnpm check` + `pnpm test` ผ่าน; ทุก `.svelte` ที่แตะผ่าน `svelte-autofixer` (CLAUDE.md DoD).
- **AC-6** — domain schema test ครอบคลุม enum ใหม่ + default + conditional (FR-23-7, FR-23-17 ตามผล decision).

---

## Proposed Change (before → after)

### Domain schema — enum/object ใหม่
```
// ใหม่
areaTypeSchema        = z.enum(['indoor','outdoor','hybrid'])     // อาคารปิด / ลานเปิด / ผสม
projectLevelSchema    = z.enum(['community','lao','provincial'])  // ชุมชน / อปท. / เมือง-จังหวัด
petPolicySchema       = z.enum(['no_pets','small_only','all_with_restraint','livestock'])
// supported_vulnerable_groups = code จาก master_data:vulnerable_group (dynamic, admin จัดการ — ไม่ hardcode enum)

keyPersonContactSchema = z.object({ name: z.string().trim().nullish(), phone: z.string().trim().nullish() })
keyPersonnelSchema = z.object({
  eoc_liaison:  keyPersonContactSchema.nullish(),
  medical_lead: keyPersonContactSchema.nullish(),
  kitchen_lead: keyPersonContactSchema.nullish()
}).nullish()

admissionPolicySchema = z.object({
  supported_vulnerable_groups: z.array(z.string()).optional().default([]),  // master_data:vulnerable_group codes
  pet_policy: z.array(petPolicySchema).optional().default([])               // multi อิสระ (decision 2=B)
})
```

### Field-by-field (Zod nested object)

| Object | Field | Before (v3) | After (v4) |
| --- | --- | --- | --- |
| shelter (top) | `shelter_type` | `str` free text | `str \| null` — **code จาก master_data** (semantic change; UI = dropdown) |
| shelter (top) | `area_type` | `str` free text | `areaTypeSchema \| null` — enum 3 ค่า (UI = dropdown) |
| shelter (top) | `municipality_zone` | ❌ | `str \| null` — code จาก `master_data:municipality_zone` |
| shelter (top) | `community` | ❌ | `str \| null` — code จาก `master_data:community` |
| shelter (top) | `address_no`/`village_no`/`subdistrict`/`district`/`province`/`postal_code` | ❌ | `str \| null` ×6 (flat, ล้อตาม CR-011 §1.3) |
| shelter (top) | `project_level` | ❌ | `projectLevelSchema \| null` — enum 3 ค่า (UI = dropdown) |
| shelter (top) | `key_personnel` | ❌ | `keyPersonnelSchema` (opt) |
| shelter (top) | `admission_policy` | ❌ | `admissionPolicySchema` (opt) |
| `zoneSchema` | `area_m2` | ❌ | `coerce.number().min(0).nullish()` |
| `zoneSchema` | `specifics` | ❌ | `string().trim().nullish()` |
| `facilitiesSchema` | `car_toilet_supported` | ❌ | `coerce.number().int().min(0).nullish()` |
| `commonAreasSchema` | `isolation_room` | ❌ | `boolean().nullish()` |
| `commonAreasSchema` | `women_child_friendly_space` | ❌ | `boolean().nullish()` |
| `commonAreasSchema` | `logistics_area_m2` | ❌ | `coerce.number().min(0).nullish()` |
| `subStorageItemSchema` | `area_m2` | ❌ | `coerce.number().min(0).nullish()` |
| `riskSchema` | `secondary_muster_point` | ❌ | `string().trim().nullish()` |

### Enum label mapping (UI)

**Area type (section 2):**

| Label | enum |
| --- | --- |
| อาคารปิด (Indoor) | `indoor` |
| ลานเปิด (Outdoor) | `outdoor` |
| แบบผสม (Hybrid) | `hybrid` |

**Project level (section 1):**

| Label | enum |
| --- | --- |
| ระดับชุมชน (จุดพักพิงย่อย/บ้านพี่เลี้ยง) | `community` |
| ระดับ อปท. (ศูนย์พักพิงหลักของเทศบาล) | `lao` |
| ระดับเมือง/จังหวัด (ศูนย์บัญชาการขนาดใหญ่/จุดยุทธศาสตร์) | `provincial` |

**Vulnerable groups (section 6) — จาก master_data `vulnerable_group` (ไม่ hardcode ใน CR นี้):**

ตัวเลือก render จาก live master_data; เก็บ `code`, map `label` ตอน render (เหมือน shelter_type/zone/community). seed ปัจจุบัน (master-data.ts `SLUG_DICT`) มี `elderly` (ผู้สูงอายุ), `disabled` (ผู้พิการ), `pregnant` (หญิงตั้งครรภ์), `infant` (เด็กเล็ก). **Action:** ให้ owner/SA เพิ่ม code ที่ spec ต้องการแต่ยังไม่ seed — `bedridden` (ผู้ป่วยติดเตียง) + `children` (เด็ก/มีเด็กทารก) — ผ่านหน้า `/registration-config` ก่อน demo (form จะ render เฉพาะค่าที่มีใน master_data). ใช้ vocabulary เดียวกับ `evacuee.special_needs` → match shelter capability vs ความต้องการผู้อพยพได้.

**Pet policy (section 6) — hardcoded enum:**

| Label | enum |
| --- | --- |
| ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าศูนย์ (No Pets Allowed) | `no_pets` |
| อนุญาตเฉพาะสัตว์ขนาดเล็ก (แมว, นก, สุนัขพันธุ์เล็ก) | `small_only` |
| อนุญาตทุกขนาด แต่ต้องมีกรง/สายจูง | `all_with_restraint` |
| มีพื้นที่ปศุสัตว์รองรับ (วัว, ควาย) | `livestock` |

---

## Open decisions

> decisions อื่น ๆ ที่เคาะแล้ว (project_level/area_type = enum, pet_policy = multi อิสระ, key_personnel = free-form, car_toilet_supported = gated, migration = default-fill, EOC endpoint = เพิ่ม) ย้ายไปบันทึกใน §Decision log แล้ว. เหลือ open อยู่ข้อเดียว:

1. **`supported_vulnerable_groups` (section 6) — choice (master_data) หรือ static (hardcoded enum)?** — ⏳ **pending owner**

   | Option | รูปแบบ | ผล |
   |---|---|---|
   | **A — choice จาก master_data `vulnerable_group`** | เก็บ `code[]`, render checkboxes จาก live master_data query, map label ตอน render (pattern CR-019) | admin เพิ่ม/แก้กลุ่มได้เองที่ `/registration-config`; vocabulary เดียวกับ `evacuee.special_needs` → match shelter vs ผู้อพยพ; **ต้อง seed `bedridden`/`children` เพิ่ม** ก่อน demo |
   | **B — static hardcoded enum** | `z.enum(['elderly','disabled','pregnant','bedridden','children'])` ตรงตาม UI mock v5 | ค่าตรง spec เป๊ะ ไม่ต้องพึ่ง master_data; แต่เพิ่ม/แก้กลุ่มต้องแก้ code + CR ใหม่; ไม่ sync กับ `evacuee.special_needs` |

   **ผลต่อ schema/code:** A → `supported_vulnerable_groups: z.array(z.string())` + wire master_data + dependency seed; B → `vulnerableGroupSchema = z.enum([...5 ค่า])` hardcoded เหมือน area_type/project_level. ส่วนอื่นของ section 6 (`pet_policy` enum) ไม่กระทบ. **เนื้อหา CR ปัจจุบันร่างไว้ตาม option A** — ถ้าเลือก B ต้องสลับ schema/FR-23-14/16/label-mapping/dependency กลับเป็น hardcoded enum.

---

## Impact

### Dependency
- **CR-019** (master_type `shelter_type` + route `/shelter-config`) — ต้อง **done** ก่อน wire `shelter_type` dropdown.
- **CR-012** (master_data `municipality_zone` + `community`) — ต้อง **done** ก่อน wire address dropdown (เหมือน household-form). ถ้ายังไม่ done → ทำ field แบบ free-input ชั่วคราว หรือรอ.
- **master_data `vulnerable_group`** (มีอยู่แล้วใน `REGISTRATION_MASTER_TYPES`, จัดการที่ `/registration-config`) — ต้อง seed code ที่ spec ต้องการให้ครบ (`elderly`/`disabled`/`pregnant` มีแล้ว; เพิ่ม `bedridden`/`children`) ก่อน wire section 6 vulnerable-group checkboxes.

### Doc
- `docs/data/schema.md §3.1` — reconcile เป็น v4: `shelter_type` free-text → master_data code; เพิ่ม `municipality_zone` + `community` + ที่อยู่ 6 ฟิลด์ (ล้อ §1.3 household / CR-011); เพิ่ม `project_level`, `key_personnel`, `admission_policy`, zone `area_m2`/`specifics`, `facilities.car_toilet_supported`, common-area 3 field + sub_storage `area_m2`, `risk.secondary_muster_point`; bump `schema_v 3→4` + migration note. (รวมการ sync field v3 ที่ §3.1 ยังค้างเป็น v2 ด้วย.)
- `docs/data/data-model.md` — note: section 6 (admission policy) → input ให้ assignment/suggestion engine + public filter; secondary muster point → EOC use case.
- `docs/data/api-contract.md` — extend POST/PATCH /api/v1/shelters body (v4); public risk payload (ถ้า decision 6=A).
- `docs/data/schema-er-diagram.md` — SHELTER + SHELTER_ZONE extend.
- cross-ref CR-008 (form v3) + CR-016 (`feature_flags.allow_pets` ↔ pet_policy).

### Code
- `frontend/src/lib/features/shelters/domain/schema.ts` — enum/object ใหม่ (ดู §Proposed Change) + ขยาย `zoneSchema`/`facilitiesSchema`/`commonAreasSchema`/`subStorageItemSchema`/`riskSchema`/`shelterSchema` + `ShelterMaster` interface `schema_v: 3 → 4` + extend `migrateShelterV2ToCurrent` (v3→v4 default fill).
- `frontend/src/lib/features/shelters/domain/schema.test.ts` — enum ใหม่, default, conditional, mutual-exclusion (ตามผล decision), v3→v4 migrate.
- `frontend/src/lib/features/shelters/ui/basic-info-section.svelte` — `shelter_type` dropdown (live master_data query, pattern CR-019); `municipality_zone`/`community` dropdown + ที่อยู่ 6 ฟิลด์ (ล้อ household-form CR-011); `project_level` + key personnel block (3×{name,phone}).
- master_data wiring — ใช้ barrel `$lib/features/master-data` (live query) สำหรับ `shelter_type`/`municipality_zone`/`community`/`vulnerable_group` (ห้าม hardcode constant — เหมือน CR-019).
- `frontend/src/lib/features/shelters/ui/zones-facilities-section.svelte` — zone `area_m2`/`specifics`; `car_toilet_supported` (conditional); 3c: `isolation_room`, `women_child_friendly_space`, `logistics_area_m2`, sub_storage `area_m2`.
- `frontend/src/lib/features/shelters/ui/capacity-section.svelte` — `area_type` free text → enum dropdown (3 ค่า).
- `frontend/src/lib/features/shelters/ui/risk-section.svelte` — `secondary_muster_point`.
- `frontend/src/lib/features/shelters/ui/admission-policy-section.svelte` — **NEW** (section 6): vulnerable-group checkboxes จาก live master_data query (`vulnerable_group`, via `$lib/features/master-data`); pet-policy checkboxes จาก hardcoded enum.
- `frontend/src/lib/features/shelters/ui/shelter-form-page.svelte` — import + render section 6 ต่อจาก section 5.
- `frontend/src/routes/api/back-office/shelter/+server.ts` — POST ใช้ `createShelterSchema` (auto ครอบ field ใหม่); master doc `schema_v: 4`; GET pass-through field ใหม่ (เพิ่มใน object mapping).
- `frontend/src/routes/api/back-office/shelter/[code]/+server.ts` — PATCH extend (ใช้ `updateShelterSchema.partial()`).
- `frontend/src/routes/public/v1/shelters/[code]/risk/+server.ts` — เพิ่ม `secondary_muster_point` (ถ้า decision 6=A).

### Test
- Domain: `pet_policy` enum + multi อิสระ (decision 2=B); `supported_vulnerable_groups` = `string[]` (master_data codes, ไม่ใช่ enum); default `[]`; `car_toilet_supported` gate (decision 4=A); `area_type`/`project_level` enum; zone area/specifics; migrate v3→v4.
- Data/API: create+GET round-trip ครบ section; PATCH diff field ใหม่.
- UI: 6 sections render; submit ว่าง (AC-1) + ครบ (AC-2); multi-select persist.
- E2E: shelter create form (6 sections).

---

## Migration (schema_v 3 → 4)

**ส่วนใหญ่ additive (default-fill).** ข้อยกเว้น = `shelter_type` (free-text → master_data code) + `area_type` (free-text → enum) — semantic change, ไม่ rename key. v3 doc ที่ขาด field ใหม่ → default-fill บน read:

| Field | default (v3 → v4) |
| --- | --- |
| `shelter_type` | คงค่าเดิม (v3 = free text). dev ไม่มี real data → ค่าเดิม (ถ้ามี) ที่ไม่ match master_data code ถือว่า dirty; UI dropdown จะไม่ map — แก้ด้วยมือ. ไม่มี backfill อัตโนมัติ |
| `area_type` | คงค่าเดิม (v3 = free text). ค่าเดิมที่ไม่ตรง enum (`indoor`/`outdoor`/`hybrid`) ถือว่า dirty → แก้ด้วยมือ; ไม่มี backfill (dev ไม่มี real data) |
| `municipality_zone` / `community` | `null` |
| `address_no`/`village_no`/`subdistrict`/`district`/`province`/`postal_code` | `null` |
| `project_level` | `null` |
| `key_personnel` | `null` (หรือ `{eoc_liaison:null, medical_lead:null, kitchen_lead:null}`) |
| `admission_policy` | `{ supported_vulnerable_groups: [], pet_policy: [] }` |
| `zones[].area_m2` | `null` |
| `zones[].specifics` | `null` |
| `facilities.car_toilet_supported` | `null` |
| `common_areas.isolation_room` | `false` (หรือ `null`) |
| `common_areas.women_child_friendly_space` | `false` (หรือ `null`) |
| `common_areas.logistics_area_m2` | `null` |
| `common_areas.sub_storage[].area_m2` | `null` |
| `risk.secondary_muster_point` | `null` |

**Strategy (เสนอ — Decision 5):** dev phase ยังไม่มี real data → ขยาย `migrateShelterV2ToCurrent` ให้ default-fill v3→v4 บน read; ไม่ต้องเขียน batch script. ก่อน go-live ใช้กติกา lazy migrate เดียวกับ CR-008.

---

## Implementation Plan

> เริ่มหลัง owner approve open decisions. ทำตามลำดับ schema-first (CLAUDE.md / spec-authoring §3: doc → domain → ui → api). 1 PR = CR-023 ทั้งก้อน (additive feature เดียว); ถ้าใหญ่เกินแยกได้ตาม phase ด้านล่าง.

### Phase 0 — Decisions, dependency & doc (gate)
1. owner เคาะ open decision 1 (`supported_vulnerable_groups`: choice จาก master_data vs static enum) + approve การ bump `schema_v 3→4`.
2. ยืนยัน dependency: **CR-019** (master_type `shelter_type`) + **CR-012** (municipality_zone/community) done; ถ้ายังไม่ → วาง fallback (free input ชั่วคราว).
3. อัปเดต `docs/data/schema.md §3.1` เป็น v4 (reconcile field v3 ที่ค้าง + `shelter_type`→master_data code + address fields ล้อ §1.3) + bump `schema_v 3→4` + migration note; update `updated:` = วันจริง.
4. set CR `status: proposed → approved` (owner).

### Phase 1 — Domain (schema-first)
5. `domain/schema.ts`:
   - เพิ่ม `areaTypeSchema`, `projectLevelSchema`, `petPolicySchema`, `keyPersonContactSchema`, `keyPersonnelSchema`, `admissionPolicySchema` (`supported_vulnerable_groups: z.array(z.string())` = master_data codes, ไม่ hardcode enum).
   - ขยาย `zoneSchema` (`area_m2`,`specifics`), `facilitiesSchema` (`car_toilet_supported`), `subStorageItemSchema` (`area_m2`), `commonAreasSchema` (`isolation_room`,`women_child_friendly_space`,`logistics_area_m2`), `riskSchema` (`secondary_muster_point`), `shelterSchema` (`shelter_type` คง `str` แต่ semantic = master_data code; `area_type` → `areaTypeSchema`; `municipality_zone`,`community`, ที่อยู่ 6 ฟิลด์, `project_level`,`key_personnel`,`admission_policy`).
   - conditional `car_toilet_supported` gate บน `car_toilet_accessible` (decision 4=A). `pet_policy` = array อิสระ ไม่ refine (decision 2=B).
   - `ShelterMaster` interface: `schema_v: 4` + field ใหม่; extend `migrateShelterV2ToCurrent` (v3→v4 default-fill ตาม §Migration).
6. `domain/schema.test.ts` — cases ตาม AC-6 + migrate v3→v4.
7. `pnpm test` (domain) เขียว.

### Phase 2 — UI (sections)
8. `basic-info-section.svelte` — `shelter_type` dropdown (live master_data query via `$lib/features/master-data`, pattern CR-019); `municipality_zone`/`community` dropdown (filter community by zone) + ที่อยู่ 6 ฟิลด์ (ล้อ household-form CR-011); `project_level` dropdown (enum 3 ค่า, hardcoded) + Key Personnel block (3 row × {name,phone}).
9. `capacity-section.svelte` — `area_type` free text → enum dropdown (3 ค่า).
10. `zones-facilities-section.svelte` — per-zone `area_m2`+`specifics`; `car_toilet_supported` (conditional บน `car_toilet_accessible`); 3c: `isolation_room`, `women_child_friendly_space`, `logistics_area_m2`, sub_storage `area_m2`.
11. `risk-section.svelte` — `secondary_muster_point`.
12. `admission-policy-section.svelte` (**NEW**) — 2 กลุ่ม checkbox multi-select (vulnerable groups + pet policy) ใช้ label mapping §Proposed Change.
13. `shelter-form-page.svelte` — import + render section 6 ต่อจาก section 5.
14. ทุก `.svelte` ที่แตะ → `svelte-autofixer` จนสะอาด (DoD).

### Phase 3 — API
15. `api/back-office/shelter/+server.ts` — POST master doc `schema_v: 4`; GET object mapping เพิ่ม pass-through (`shelter_type`, `area_type`, address fields, `project_level`, `key_personnel`, `admission_policy`, + nested ใหม่).
16. `api/back-office/shelter/[code]/+server.ts` — PATCH ใช้ `updateShelterSchema` (ครอบ field ใหม่อัตโนมัติ).
17. `public/v1/shelters/[code]/risk/+server.ts` — เพิ่ม `secondary_muster_point` (decision 6=A).

### Phase 4 — Verify & close
18. `pnpm lint` + `pnpm check` + `pnpm test` เขียว (AC-5).
19. E2E: create form 6 sections (AC-1/AC-2); GET round-trip v3 doc (AC-4).
20. ปิด CR `status: approved → done`; ลงแถวใน `docs/changes/_index.md`; update `updated:` ของ doc ที่แก้.

---

## Decision log
- 2026-06-30 — proposed (per `change-management.md` §5); source: **UI mock v5** (spec/section_1.png, section_3.png, section_3_2.png, section_5.png, section_6.png)
- 2026-06-30 — tracking method: file ใน `docs/changes/` (CR-023) — owner สั่ง "เขียน change request เป็น md file"
- 2026-06-30 — source ยืนยัน = **UI mock v5**
- 2026-06-30 — owner เพิ่ม scope: `shelter_type` free-text → **master_data dropdown** (master_type จาก CR-019; supersede CR-008 free-text decision); `area_type` free-text → **enum** `indoor`/`outdoor`/`hybrid` (supersede CR-008 free-text decision); เพิ่ม **ที่อยู่ structured** (municipality_zone + community + 6 ฟิลด์) ล้อตาม CR-011
- 2026-06-30 — decision 2 RESOLVED: `pet_policy` = multi-select **อิสระ** (option B), `[no_pets]`/ผสม บันทึกได้; `feature_flags.allow_pets` ไม่ auto-sync (follow-up)
- 2026-06-30 — decision 3 RESOLVED: `key_personnel` = free-form `{name, phone}` (option A)
- 2026-06-30 — decision 4 RESOLVED: `car_toilet_supported` = gated บน `car_toilet_accessible` (option A)
- 2026-06-30 — decision 5 RESOLVED: migration = default-fill บน read (ไม่มี batch script; lazy ก่อน go-live)
- 2026-06-30 — decision 6 RESOLVED: เพิ่ม `secondary_muster_point` เข้า EOC public risk endpoint (option A)
- 2026-06-30 — decision 1 RESOLVED: `project_level` = **enum 3 ค่า** (`community`/`lao`/`provincial`), hardcoded ใน domain (option B)
- 2026-06-30 — `area_type` = enum 3 ค่า (`indoor`/`outdoor`/`hybrid`), hardcoded
- 2026-06-30 — `supported_vulnerable_groups` (section 6) **เปิดเป็น open decision** (A = choice จาก master_data `vulnerable_group` / B = static hardcoded enum 5 ค่า) — CR ร่างตาม A ไว้ก่อน; **pending owner**. `pet_policy` ยัง hardcoded enum
- 2026-06-30 — รวบ resolved decisions ออกจาก §Open decisions (เก็บประวัติใน log นี้); เหลือ open เดียว = `supported_vulnerable_groups` source; รอ owner เคาะ + approve `schema_v 3→4`
