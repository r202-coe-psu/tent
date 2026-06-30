---
id: CR-021
title: "SOP ratio scope — sop_profile.ratios = 19 handbook keys + volunteer ratio; remove rice from SOP (egg already belongs to kitchen) → item_master/recipe"
status: proposed
date: 2026-06-29
requested_by: T-18 — SOP ratio source audit (development team D)
decided_by: project owner
layer: stable          # เปลี่ยน ratio key whitelist (amend CR-006) + cross-module ownership
affects:
  - docs/changes/CR-006-sop-profile-master-override.md — แก้ canonical key list (rice → volunteer); ยัง 20 keys
  - docs/data/schema.md §4.2.1 — sop_profile.ratios whitelist
  - Module B (SOP/Resource Calc) — T-30/T-31/T-32 (volunteer = หมวดทรัพยากรใน sop_profile)
  - Module C/D (Supply/Kitchen) — rice/egg consumption ผ่าน item_master.consumption_rate / recipe (CR-013)
  - schema_v — No schema version bump. No document envelope changes are introduced. Ratio acceptance rules and validation behavior are coordinated through CR-006 application and CR-015 synchronization before deployment.
---

# CR-021 — SOP ratio scope: 19 handbook keys + volunteer ratio

**สรุป:** จัดขอบเขต `sop_profile.ratios` ตาม **ownership** — เก็บเฉพาะ SOP planning ratios.
ถอด `rice_g_per_person_meal` ออก (= food consumption domain ของครัว ไม่ใช่ SOP standard);
egg ไม่เคยเป็น SOP ratio key อยู่แล้ว — ทั้งคู่คำนวณที่ Module C/D ผ่าน
`item_master.consumption_rate` / `recipe` (CR-013). เพิ่ม `people_per_volunteer` (staffing ratio).
จำนวนคีย์สุทธิ = **19 handbook + อัตราอาสา = 20** (เป็น *ผลลัพธ์* ของการจัด ownership ไม่ใช่เป้าหมายที่ตั้งไว้).
No schema version bump.

## Why

T-18 ตรวจ source ของ 20 keys ใน CR-006 พบว่า **คละ 2 ประเภท:**
- **19 keys** = มาตรฐานจาก handbook จริง (น้ำ/ส้วม/พื้นที่/จุดบริการ/ระยะ — มีเลขใน ปภ.2565 + Sphere 2018)
- **`rice_g_per_person_meal`** = **ไม่มีใน handbook ทั้งคู่** (CR-006 ระบุเอง "derived") → เป็น food consumption

ปัญหา:
1. ข้าว/ไข่ = วัตถุดิบครัว ("ต่อเตาประกอบอาหาร" ตาม source Module B/D + P-01 §4.2.2) — มีที่เก็บแล้วใน
   `item_master.consumption_rate` + `recipe.ingredients` (CR-013, Module C) → เก็บใน `sop_profile.ratios`
   ด้วย = **ซ้ำซ้อน** (CR-013 boundary)
2. **อัตราอาสา (อาสาต่อผู้พักพิง)** เป็นทรัพยากรที่ design SOP ระบุชัด (T-30 "อาสาต่อผู้พักพิง", T-31/T-32
   หมวด "อาสา") แต่ **CR-006 20 keys ไม่มี** → ขาด

→ จัดใหม่: `sop_profile.ratios` = **SOP standard/planning ratios เท่านั้น** (facility/space/quality + อาสา);
food materials ย้ายไปครัว.

## Change

### Scope (normative)

`sop_profile.ratios` SHALL contain only planning ratios used to derive shelter capacity, facility
requirements, staffing requirements, or service quality constraints at SOP planning level.

Consumption coefficients for materials, ingredients, or inventory depletion MUST NOT be stored in
`sop_profile` (→ `item_master.consumption_rate` / `recipe`).

### sop_profile.ratios — จัดตาม ownership (ถอด rice / เพิ่ม volunteer)
- **ถอด** `rice_g_per_person_meal` (consumption domain → ครัว)
- **เพิ่ม** `people_per_volunteer` (kind `divide`) — จำนวนอาสาที่ต้องการ = `ceil(occupancy / people_per_volunteer)`
  - ownership ของคีย์นี้ (project-owned, ไม่ใช่ handbook):
    ```yaml
    owner:
      key: people_per_volunteer
      source: project_policy
      authority: P-02 / domain expert
      overridable: true
    ```
- ผล (ผลลัพธ์ของการจัด ownership ไม่ใช่เป้า): **19 handbook keys + `people_per_volunteer` = 20**

| กลุ่ม | keys |
| --- | --- |
| 19 handbook (มี source ปภ./Sphere) | water/drinking/cooking/hygiene/kcal · people_per_(tap/handpump/open_well/laundry/bathing/toilet_female/toilet_male/dining_point_adult/dining_point_child) · m2_per_person_(living/living_cold/total) · max_(waterpoint_distance_m/queue_minutes) |
| +1 project (อาสา) | `people_per_volunteer` (divide) |

> **ขอบเขต `people_per_volunteer`** = base/general staffing ratio (อาสาทั่วไป ต่อผู้พักพิง) เท่านั้น
>
> การดูแลกลุ่มเปราะบาง (เด็ก / ทารก / ผู้สูงอายุ / ผู้ป่วย / ผู้บาดเจ็บ) = skill-based volunteer demand
> ที่ Module A / T-29 (จับคู่ทักษะ เช่น พยาบาล/ดูแลเด็ก × จำนวนกลุ่มเปราะบางจาก `evacuee.special_needs`)
> — ไม่เก็บเป็น ratio ใน `sop_profile` (ตาม Scope normative)
>
> **ห้ามสร้าง care-key ใน `sop_profile`** เช่น `caregiver_per_elderly`, `nurse_per_patient`,
> `childcare_per_infant`, `special_volunteer_ratio` → care allocation = responsibility ของ T-29
>
> - Base staffing (`people_per_volunteer`) supports capacity planning (Module B)
> - Care demand supports skill matching (Module A / T-29)
> - Capacity estimation and skill allocation are intentionally modeled separately.

### Handbook ratio policy (19 keys)

```
19 handbook-derived ratios:
- default values originate from handbook
- local override allowed only through sop_override
- original handbook baseline must remain preserved
  (overrides do not mutate handbook baseline)
```

### rice/egg → Module C/D (ครัว)
- **rice** = remove from SOP (เคยอยู่เป็น `rice_g_per_person_meal`) → ครัว
- **egg** = confirm already belongs to kitchen (egg was never a SOP ratio key — ไม่ใช่การย้าย)
- food consumption คำนวณผ่าน `item_master.consumption_rate` (per item, CR-013) + `recipe.ingredients`
- T-25 (meal plan) อ่านจากครัว (recipe/item_master) ไม่ใช่ `sop_profile.ratios`

### ค่า (value)
- **19 handbook keys** = มีค่าจาก source ครบ (ดู `sop-ratio-reference-table.md`) → sign-off ได้เลย
- **`people_per_volunteer`** = **ไม่มีใน handbook** → ค่า = pending **P-02 / expert** (Q-T18-3)
- **rice/egg** = ไม่ใช่ scope SOP แล้ว → ค่าอยู่ที่ครัว (P-02/expert) ฝั่ง Module C/D

## Reconciliation (CR-006 ↔ CR-015 ↔ schema)

CR-021 ปรับ canonical ratio set จึงมี **alignment requirement** กับงานที่มีอยู่แล้ว (ไม่ใช่การ enforce
ลำดับแทนเจ้าของ CR อื่น):

- **CR-006** เป็นตัวกำหนด canonical ratio set; CR-021 ตั้ง **sequencing assumption** ว่า CR-006
  ถูก apply ลง `schema.md §4.2.1` ก่อนหรือพร้อมกัน — `schema alignment is expected during implementation`
- **CR-015 (`done`)** ผูก validation (Zod) กับ `rice_g_per_person_meal` อยู่ — การถอด rice **ไม่ใช่
  silent change**; `CR-021 assumes synchronization with existing CR-015 validation rules.` (ไม่ reopen/override CR-015)
- ลำดับ coordinated rollout (dependency, ไม่ใช่คำสั่ง): (1) align CR-006 → (2) apply CR-021 (remove rice /
  add volunteer) → (3) schema + CR-015 validation alignment ก่อน deployment

## Impact

- **CR-006:** amend canonical key list — ถอด `rice_g_per_person_meal`, เพิ่ม `people_per_volunteer` (+ kind); จำนวนคีย์สุทธิ = 20 (ผลลัพธ์)
- **schema.md §4.2.1:** sop_profile.ratios whitelist ตามรายการใหม่
- **Module B:** T-30 config / T-31 calc / T-32 dashboard — อาสา = key ใน sop_profile (เดิม design มีอยู่แล้ว)
- **Module C/D:** rice/egg/วัตถุดิบ = item_master.consumption_rate / recipe (CR-013) — ไม่อ้าง sop_profile
- **schema_v:** No schema version bump. No document envelope changes are introduced. Ratio acceptance rules and validation behavior are coordinated through CR-006 application and CR-015 synchronization before deployment.
- **ปลด blocker:** Q-T18-3 ฝั่ง handbook (19 ค่า sign-off ได้) + CR-013 boundary ฝั่งอาหาร (ชัดว่าครัวเป็นเจ้าของ)

## Migration

N/A — ไม่มี persisted `sop_profile`/`sop_override` จริง · ถ้ามี seed/test เดิมใช้
`rice_g_per_person_meal`: ลบคีย์ออก (ย้าย logic ไปครัว), เพิ่ม `people_per_volunteer`

```
Validation:
- reject `rice_g_per_person_meal` in sop_profile.ratios
- reject unknown / food-consumption keys inside SOP payload
- people_per_volunteer MAY remain unset until baseline values are approved.
- If a consuming workflow requests volunteer planning, the effective value MUST
  resolve from baseline or override.
- Activation criteria remain owned outside this CR.
```

## Decision log

- 2026-06-29 — proposed; ต้องผ่าน PO + เห็นชอบข้าม module (Module B ↔ C/D ↔ A) ก่อน approve
