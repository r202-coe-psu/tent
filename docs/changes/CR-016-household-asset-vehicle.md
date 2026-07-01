id: CR-016
title: "Household Schema — เพิ่มฟิลด์ทรัพย์สินมีค่า/สัมภาระ (assets) และยานพาหนะ (vehicles) + ขยายฟิลด์สัตว์เลี้ยง (pets) + Shelter feature flags"
status: approved
date: 2026-06-29
requested_by: dev team-B
layer: volatile
affects:

- docs/data/schema.md §1.3 — schema_v 2 → 3 (เพิ่ม assets, vehicles[] และขยายโครงสร้าง pets)
- docs/data/schema.md §1.x — shelter schema (เพิ่ม feature_flags)
- frontend/src/lib/features/people/domain/people.ts
- frontend/src/lib/features/people/domain/people.test.ts
- frontend/src/lib/features/people/ui/evacuee-pet-asset-vehicle.svelte
- frontend/src/lib/features/operations/domain/ (shelter domain — เพิ่ม feature_flags)

---

# CR-016 — Household Schema & UI: Assets, Vehicles, and Expanded Pets Fields

## Why

### 1. ปัญหาที่เจอ (Problem Encountered)

ในหน้าลงทะเบียนขั้นตอนที่ 5 (ทรัพย์สินและสัตว์เลี้ยง) ใน UI Component `evacuee-pet-asset-vehicle.svelte` มีการเก็บข้อมูลทรัพย์สิน สัมภาระ และยานพาหนะ รวมถึงข้อมูลกรง แต่โครงสร้างข้อมูล `household` ใน `docs/data/schema.md` §1.3 ยังไม่รองรับฟิลด์เหล่านี้ ส่งผลให้ข้อมูลส่วนนี้ไม่สามารถบันทึกลง PouchDB/CouchDB หรือทำ Persistence ได้จริง

### 2. เหตุผลที่เปลี่ยน (Reason for Change)

- **Data Consistency:** เพื่อให้ฟอร์มในหน้าจอ UI สามารถบันทึกข้อมูลและดึงข้อมูลมาใช้งานได้จริงตามที่กรอก
- **Asset Tracking & Safety:** ข้อมูลทรัพย์สินสัมภาระและยานพาหนะ
- **Pet Management:** การขยายโครงสร้างข้อมูลสัตว์เลี้ยงให้ครอบคลุม "กรง"

## Change

### 3. วิธีการเปลี่ยนแปลง

- **Before (schema_v: 2):**
  - ไม่มีฟิลด์สำหรับเก็บข้อมูลทรัพย์สิน (`assets`) และยานพาหนะ (`vehicle`)
  - โครงสร้างใน `pets` เก็บเฉพาะ `species`, `count` และ `notes`
- **After (schema_v: 3):**
  - เพิ่มฟิลด์ `assets` (เก็บรายละเอียดสัมภาระ และ URL รูปภาพ)
  - เปลี่ยน `vehicle` (object เดี่ยว) เป็น `vehicles` (array) รองรับหลายคันต่อครัวเรือน
  - ขยายฟิลด์ `pets` ให้เก็บสถานะการมีกรง (`has_cage`) และ URL รูปภาพสัตว์เลี้ยง (`image_url`)

#### การปรับปรุง Database Schema ใน `docs/data/schema.md` §1.3 (household):

| Field      | ชนิด                                                                                                          | req | หมายเหตุ                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------- |
| `pets`     | [{`species`:enum(`dog`,`cat`,`bird`,`other`), `count`:int, `notes`:str?, `has_cage`:bool?, `image_url`:str?}] | opt | default `[]` — เพิ่ม `has_cage` และ `image_url`          |
| `assets`   | {`description`:str, `image_url`:str\|null} \| null                                                            | opt | รายละเอียดทรัพย์สินมีค่า / สัมภาระ                       |
| `vehicles` | [{`type`:enum(`car`,`motorcycle`,`other`), `license_plate`:str\|null}]                                        | opt | default `[]` — รายการยานพาหนะที่นำมาด้วย (รองรับหลายคัน) |

#### การปรับปรุง Domain Layer (`frontend/src/lib/features/people/domain/people.ts`):

```typescript
export interface HouseholdAsset {
  description: string;
  image_url: string | null;
}

export interface HouseholdVehicle {
  type: "car" | "motorcycle" | "other";
  license_plate: string | null;
}

export interface PetGroup {
  species: "dog" | "cat" | "bird" | "other";
  count: number;
  notes?: string;
  has_cage?: boolean;
  image_url?: string | null;
}

export interface Household extends BaseDoc {
  type: "household";
  label: string;
  head_evacuee_id: string | null;
  municipality_zone: string | null;
  community: string | null;
  pets: PetGroup[];
  assets?: HouseholdAsset | null;
  vehicles: HouseholdVehicle[]; // เปลี่ยนจาก vehicle (object) เป็น vehicles (array) — CR-016
  notes?: string;
  address_no: string | null;
  village_no: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
}
```

#### การเพิ่ม Shelter Feature Flags ใน `docs/data/schema.md` (shelter schema):

ศูนย์พักพิงแต่ละแห่งมีนโยบายแตกต่างกัน — บางศูนย์ไม่รับผิดชอบและไม่ต้องการบันทึกข้อมูลเกี่ยวกับสัตว์เลี้ยง ยานพาหนะ หรือทรัพย์สิน ให้เพิ่ม `feature_flags` ใน shelter document เพื่อควบคุมว่าขั้นตอนเหล่านี้จะปรากฏในฟอร์มลงทะเบียนหรือไม่

| Field                          | ชนิด | req | หมายเหตุ                                           |
| ------------------------------ | ---- | --- | -------------------------------------------------- |
| `feature_flags.allow_pets`     | bool | opt | default `false` — เปิด/ปิดขั้นตอนบันทึกสัตว์เลี้ยง |
| `feature_flags.allow_vehicles` | bool | opt | default `false` — เปิด/ปิดขั้นตอนบันทึกยานพาหนะ    |
| `feature_flags.allow_assets`   | bool | opt | default `false` — เปิด/ปิดขั้นตอนบันทึกทรัพย์สิน   |

**หมายเหตุ:** default `false` ทุก flag — ศูนย์ที่ต้องการบันทึกข้อมูลเหล่านี้ต้องเปิด flag เองตอนสร้างศูนย์ สะท้อนความเป็นจริงที่ศูนย์ส่วนใหญ่ไม่รับผิดชอบด้านสัตว์เลี้ยง ยานพาหนะ และทรัพย์สิน

**ไฟล์ที่เพิ่มเติม:**

- `frontend/src/lib/features/operations/domain/` — เพิ่ม `feature_flags` ใน shelter interface และ Zod schema
- หน้า create/edit shelter UI — เพิ่ม toggle สำหรับ 3 flags นี้
- `evacuee-pet-asset-vehicle.svelte` — อ่าน `feature_flags` จาก context ศูนย์ปัจจุบัน แสดง/ซ่อนส่วนที่เกี่ยวข้อง

## Impact

### 4. ไฟล์ที่ได้รับผลกระทบ

- **`docs/data/schema.md`** §1.3 — อัปเดตตารางฟิลด์ `household`: เปลี่ยน `vehicle` → `vehicles[]`, bump `schema_v` 2 → 3
- **`docs/data/schema.md`** §shelter — เพิ่ม `feature_flags` (allow_pets, allow_vehicles, allow_assets) ในโครงสร้างของ shelter document
- **`docs/changes/_index.md`** — เพิ่มดัชนี CR-016
- **`frontend/src/lib/features/people/domain/people.ts`** — อัปเดต Zod Schemas (`householdInputSchema`), interface types (`vehicles: HouseholdVehicle[]`) และ `createHousehold` factory
- **`frontend/src/lib/features/people/domain/people.test.ts`** — อัปเดตยูนิตเทสต์ให้ครอบคลุม `vehicles[]` และ schema_v 3
- **`frontend/src/lib/features/people/ui/evacuee-pet-asset-vehicle.svelte`** — Data binding ฟอร์ม + อ่าน `feature_flags` จาก context ศูนย์ แสดง/ซ่อนส่วน pets/vehicles/assets
- **`frontend/src/lib/features/operations/domain/`** — เพิ่ม `feature_flags` interface + Zod schema ใน shelter domain
- **shelter create/edit UI** — เพิ่ม toggle 3 flags ตอนสร้าง/แก้ไขศูนย์

## Migration

### 5. Migration Strategy

- **Schema version bump:** `household` schema_v 2 → 3
- **Backward Compatibility (household):** เอกสารเก่า (schema_v 1–2) ไม่มีฟิลด์ `assets`, `vehicles` — ระบบจัดการได้ปลอดภัยเพราะทั้งหมด optional/default-empty-array ไม่ต้องรัน migration script
- **Rename migration (vehicle → vehicles):** เอกสาร schema_v 2 ที่มี `vehicle` (object เดี่ยว) ควร read-on-open แปลงเป็น `vehicles: [vehicle]` แล้ว save กลับ หรือ ignore ค่าเก่าและเริ่มต้น `vehicles: []` ขึ้นอยู่กับ policy (ยังไม่มีข้อมูล production จึงเลือก ignore ได้)
- **Shelter feature_flags:** เอกสาร shelter เก่าที่ไม่มี `feature_flags` — ถือว่าทุก flag เป็น `false` (ไม่แสดง step เหล่านี้) ซึ่งสอดคล้องกับ default ใหม่และนโยบายที่ศูนย์ต้องเปิดใช้งานเองอย่างชัดเจน

## Decision log

- 2026-06-28 — proposed (เสนอจัดทำ CR-016 เพื่อแก้ไขปัญหาสเปกข้อมูล Household ไม่ครอบคลุมฟอร์มสัมภาระ สัตว์เลี้ยง และยานพาหนะ)
- 2026-06-28 — เลือกใช้ Nested Object ใน `assets` และ `vehicle` เพื่อความเป็นระเบียบของหมวดหมู่ข้อมูล
- 2026-06-28 — ขยายฟิลด์ในแต่ละรายการย่อยของ `pets` อาร์เรย์เดิม เพื่อรองรับคุณสมบัติกรงและรูปถ่ายรายประเภทสัตว์เลี้ยง
- 2026-06-29 — เปลี่ยน `vehicle` (object เดี่ยว) → `vehicles` (array) เพราะครัวเรือนอาจมีรถหลายคัน
- 2026-06-29 — เพิ่ม `feature_flags` ใน shelter document: `allow_pets`, `allow_vehicles`, `allow_assets` — เพราะในความเป็นจริงศูนย์พักพิงหลายแห่งไม่รับผิดชอบด้านสัตว์เลี้ยง ยานพาหนะ และทรัพย์สิน การบังคับให้กรอกทุกขั้นตอนจึงไม่สมเหตุสมผล; ให้ Admin ตั้งค่า flag ตอนสร้างศูนย์แทน
