---
id: CR-016
title: "Household Schema — เพิ่มฟิลด์ทรัพย์สินมีค่า/สัมภาระ (assets) และยานพาหนะ (vehicle) + ขยายฟิลด์สัตว์เลี้ยง (pets)"
status: proposed
date: 2026-06-28
requested_by: dev team-B
layer: volatile
affects:
  - docs/data/schema.md §1.3 — schema_v 2 → 3 (เพิ่ม assets, vehicle และขยายโครงสร้าง pets)
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/src/lib/features/people/domain/people.test.ts
  - frontend/src/lib/features/people/ui/evacuee-pet-asset-vehicle.svelte
---

# CR-016 — Household Schema & UI: Assets, Vehicles, and Expanded Pets Fields

## Why

### 1. ปัญหาที่เจอ (Problem Encountered)

ในหน้าลงทะเบียนขั้นตอนที่ 5 (ทรัพย์สินและสัตว์เลี้ยง) ใน UI Component `evacuee-pet-asset-vehicle.svelte` มีการเก็บข้อมูลทรัพย์สิน สัมภาระ และยานพาหนะ รวมถึงข้อมูลกรง แต่โครงสร้างข้อมูล `household` ใน `docs/data/schema.md` §1.3 ยังไม่รองรับฟิลด์เหล่านี้ ส่งผลให้ข้อมูลส่วนนี้ไม่สามารถบันทึกลง PouchDB/CouchDB หรือทำ Persistence ได้จริง

### 2. เหตุผลที่เปลี่ยน (Reason for Change)

* **Data Consistency:** เพื่อให้ฟอร์มในหน้าจอ UI สามารถบันทึกข้อมูลและดึงข้อมูลมาใช้งานได้จริงตามที่กรอก
* **Asset Tracking & Safety:** ข้อมูลทรัพย์สินสัมภาระและยานพาหนะ
* **Pet Management:** การขยายโครงสร้างข้อมูลสัตว์เลี้ยงให้ครอบคลุม "กรง" 
## Change

### 3. วิธีการเปลี่ยนแปลง

* **Before (schema_v: 2):**
  - ไม่มีฟิลด์สำหรับเก็บข้อมูลทรัพย์สิน (`assets`) และยานพาหนะ (`vehicle`)
  - โครงสร้างใน `pets` เก็บเฉพาะ `species`, `count` และ `notes`
* **After (schema_v: 3):**
  - เพิ่มฟิลด์ `assets` (เก็บรายละเอียดสัมภาระ และ URL รูปภาพ)
  - เพิ่มฟิลด์ `vehicle` (เก็บประเภทรถ และเลขทะเบียน)
  - ขยายฟิลด์ `pets` ให้เก็บสถานะการมีกรง (`has_cage`) และ URL รูปภาพสัตว์เลี้ยง (`image_url`)

#### การปรับปรุง Database Schema ใน `docs/data/schema.md` §1.3:

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `pets` | [{`species`:enum(`dog`,`cat`,`bird`,`other`), `count`:int, `notes`:str?, `has_cage`:bool?, `image_url`:str?}] | opt | default `[]` — เพิ่ม `has_cage` และ `image_url` |
| `assets` | {`description`:str, `image_url`:str\|null} \| null | opt | รายละเอียดทรัพย์สินมีค่า / สัมภาระ |
| `vehicle` | {`type`:enum(`car`,`motorcycle`,`other`), `license_plate`:str\|null} \| null | opt | ยานพาหนะที่นำมาด้วย |

#### การปรับปรุง Domain Layer (`frontend/src/lib/features/people/domain/people.ts`):

```typescript
export interface HouseholdAsset {
	description: string;
	image_url: string | null;
}

export interface HouseholdVehicle {
	type: 'car' | 'motorcycle' | 'other';
	license_plate: string | null;
}

export interface PetGroup {
	species: 'dog' | 'cat' | 'bird' | 'other';
	count: number;
	notes?: string;
	has_cage?: boolean;
	image_url?: string | null;
}

export interface Household extends BaseDoc {
	type: 'household';
	label: string;
	head_evacuee_id: string | null;
	municipality_zone: string | null;
	community: string | null;
	pets: PetGroup[];
	assets?: HouseholdAsset | null; // เพิ่มเข้ามาตาม CR-016
	vehicle?: HouseholdVehicle | null; // เพิ่มเข้ามาตาม CR-016
	notes?: string;
	address_no: string | null;
	village_no: string | null;
	subdistrict: string | null;
	district: string | null;
	province: string | null;
	postal_code: string | null;
}
```

## Impact

### 4. ไฟล์ที่ได้รับผลกระทบ

* **`docs/data/schema.md`** §1.3 — อัปเดตตารางฟิลด์และรายละเอียดโครงสร้างของ `household` พร้อม bump `schema_v` 2 → 3
* **`docs/changes/_index.md`** — เพิ่มดัชนี CR-016
* **`frontend/src/lib/features/people/domain/people.ts`** — อัปเดต Zod Schemas (`householdInputSchema`), interface types และ `createHousehold` factory ให้สอดคล้องกับ schema_v 3
* **`frontend/src/lib/features/people/domain/people.test.ts`** — อัปเดตยูนิตเทสต์ที่เกี่ยวกับ Household ให้ครอบคลุมฟิลด์และเวอร์ชันใหม่
* **`frontend/src/lib/features/people/ui/evacuee-pet-asset-vehicle.svelte`** — ทำ Data binding ข้อมูลจากฟอร์มเข้ากับ state/props เพื่อส่งข้อมูลออกไปยังตัวแปร/ฟังก์ชันภายนอกเมื่อกด "ถัดไป" หรือเมื่อ Submit

## Migration

### 5. Migration Strategy

* **Schema version bump:** `household` schema_v 2 → 3
* **Backward Compatibility:** เอกสารเก่าทั้งหมด (schema_v 1 และ 2) จะไม่มีฟิลด์ `assets` และ `vehicle` (มีค่าเป็น `undefined` หรือ `null`) ซึ่งระบบและ UI สามารถจัดการกับฟิลด์เหล่านี้แบบ Optional ได้อย่างปลอดภัยโดยไม่ต้องรัน Migration Script บน Database

## Decision log
- 2026-06-28 — proposed (เสนอจัดทำ CR-016 เพื่อแก้ไขปัญหาสเปกข้อมูล Household ไม่ครอบคลุมฟอร์มสัมภาระ สัตว์เลี้ยง และยานพาหนะ)
- 2026-06-28 — เลือกใช้ Nested Object ใน `assets` และ `vehicle` เพื่อความเป็นระเบียบของหมวดหมู่ข้อมูล
- 2026-06-28 — ขยายฟิลด์ในแต่ละรายการย่อยของ `pets` อาร์เรย์เดิม เพื่อรองรับคุณสมบัติกรงและรูปถ่ายรายประเภทสัตว์เลี้ยง
