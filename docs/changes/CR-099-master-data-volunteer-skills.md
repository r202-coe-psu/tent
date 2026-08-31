---
id: CR-099
title: "Master Data — เพิ่ม `volunteer_skills` (master_type ที่ 9) + schema items category & description + หน้าตั้งค่าทักษะอาสาสมัคร"
status: proposed
date: 2026-08-31
requested_by: Chino (FR-VOL-08.5 ย้ายทักษะอาสาเป็น Master Data)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §3.3 (`master_data`)
  - docs/changes/CR-097-volunteer-job-shifts-personnel-type.md §1.5 (ยกระดับจาก constant สู่ Master Data)
  - frontend/src/lib/features/master-data/domain/master-data.ts · master-data.test.ts · index.ts
  - frontend/src/lib/features/volunteers/ui/volunteer-skill-master-page.svelte
  - frontend/src/lib/components/backoffice-navbar/static.ts · system-management-navbar/static.ts
  - frontend/src/routes/(protected)/back-office/volunteer-skills/+page.svelte
  - frontend/src/routes/(protected)/portal/system-management/volunteer-config/+page.svelte
  - frontend/scripts/seed.ts
---

# CR-099 — Master Data: `volunteer_skills` + Schema Items Category & Description

## สรุป (TL;DR)

- **เปลี่ยนอะไร:**
  1. เพิ่ม `master_type` ค่าใหม่: `volunteer_skills` (เป็น master_type ลำดับที่ 9 ของระบบ `master_data`)
  2. ขยาย Schema ของ `master_data.items[]` ให้รองรับ `category` (`GENERAL` | `CONTROLLED` / `operational` | `controlled`) และ `description` (คำอธิบายทักษะ/ใบอนุญาตที่ต้องใช้)
  3. เพิ่ม UI จัดการทักษะอาสาสมัครทั้งระดับศูนย์พักพิง (`/back-office/volunteer-skills`) และระดับส่วนกลาง SA (`/portal/system-management/volunteer-config`)
  4. เพิ่ม seed ข้อมูลเริ่มต้น 9 ทักษะมาตรฐานใน `scripts/seed.ts`
- **เพื่อใคร/ทำไม:**
  - CR-097 §1.5 ระบุไว้ว่า `domain/skill-master.ts` เดิมเป็นเพียง hardcoded constant และต้องยกระดับเป็น Master Data ตาม FR-VOL-08.5 เพื่อให้ System Admin และ Shelter Manager สามารถเพิ่ม/แก้ไข/เปิด-ปิดทักษะเฉพาะพื้นที่ได้ โดยยังคงความสามารถในการแยกทักษะควบคุม (Controlled Skills) ที่ต้องตรวจใบประกอบวิชาชีพ
- **กระทบ schema/scope:**
  - `master_data` (schema_v 1) — เพิ่ม enum `volunteer_skills` ใน `master_type` และเพิ่ม optional fields `category`, `description` บน `items[]` (Backward compatible)

---

## 1. Why

1. **CR-097 §1.5 ตกค้างการเป็น Master Data**: ใน CR-097 ทักษะอาสายังฝังเป็นค่าคงที่ (Constant) ใน `skill-master.ts` ทำให้ไม่สามารถปรับแต่งตามบริบทภัยพิบัติหรือเพิ่มทักษะเฉพาะกิจหน้างานได้
2. **การคัดกรองทักษะควบคุม (Controlled Skills Gate)**: จำเป็นต้องมีฟิลด์ `category` เพื่อระบุว่าทักษะใดเป็นทักษะทั่วไป (`operational` / `GENERAL`) หรือทักษะควบคุม (`controlled` / `CONTROLLED`) ซึ่งส่งผลต่อการบังคับสถานะ `pending_review` ใน `job_application` (Story 3.3 / CR-041 D-APP)
3. **ความชัดเจนของคำอธิบายทักษะ**: ผู้สมัครและเจ้าหน้าที่ต้องการคำอธิบาย (`description`) เช่น เอกสารประกอบวิชาชีพที่ต้องใช้สำหรับแพทย์/พยาบาล

---

## 2. Change Specification

### 2.1 `master_data.master_type` Enum (schema.md §3.3)

ขยายจาก 8 ประเภทเป็น 9 ประเภท:
```ts
export const MASTER_DATA_TYPES = [
	'vulnerable_group',
	'health_condition',
	'dietary_restrictions',
	'pet_types',
	'house_damage',
	'municipality_zone',
	'community',
	'shelter_type',
	'volunteer_skills' // ใหม่ (CR-099)
] as const;
```

### 2.2 `master_data.items[]` Schema Extension

```ts
export const masterDataItemSchema = z.object({
	code: z.string().trim().min(1),
	label: z.string().trim().min(1),
	is_default: z.boolean(),
	status: z.enum(['active', 'inactive']).default('active'),
	parent_code: z.string().trim().min(1).optional(),
	category: z.enum(['GENERAL', 'CONTROLLED', 'operational', 'controlled']).optional(),
	description: z.string().trim().optional()
});
```

### 2.3 Master Data Groups & Navbars

- เพิ่ม `VOLUNTEER_MASTER_TYPES = ['volunteer_skills']` ใน `master-data.ts`
- เพิ่มเมนูใน Backoffice Navbar: `4. ตั้งค่าระบบ > จัดการข้อมูลหลัก > 6. ทักษะอาสาสมัคร` (`/back-office/volunteer-skills`)
- เพิ่มเมนูใน System Management Navbar: `2. ตั้งค่าระบบส่วนกลาง > ตั้งค่าระบบ > 7. อาสาสมัคร` (`/portal/system-management/volunteer-config`)

### 2.4 Seed Master Data (`scripts/seed.ts`)

Seed ทักษะตั้งต้น 9 รายการ:
1. `cooking` (ประกอบอาหาร / ครัวสนาม, default: true)
2. `logistics` (ขนย้ายสิ่งของ / พลาธิการ)
3. `screening` (คัดกรองและสแกนประวัติ)
4. `medical` (การแพทย์ / ปฐมพยาบาล, category: controlled)
5. `reception` (ประสานงาน / ต้อนรับ)
6. `distribution` (แจกจ่ายของยังชีพ)
7. `sanitation` (ทำความสะอาด / สุขอนามัย)
8. `childcare` (สันทนาการ / ดูแลเด็ก)
9. `transport` (ขับขี่ยานพาหนะ / ขนส่ง)

---

## 3. Impact

| ที่ | ผลกระทบ |
| --- | --- |
| `docs/data/schema.md` §3.3 | อัปเดตตาราง `master_data` เพิ่ม `volunteer_skills` ใน `master_type` |
| `frontend/src/lib/features/master-data/` | เพิ่ม `volunteer_skills`, `VOLUNTEER_MASTER_TYPES`, ขยาย `masterDataItemSchema` และ `applyItemOp` |
| `frontend/src/lib/features/volunteers/ui/` | สร้าง `volunteer-skill-master-page.svelte` จัดการ Master Data ทักษะ |
| `frontend/src/routes/(protected)/...` | เพิ่ม routes `/back-office/volunteer-skills` และ `/portal/system-management/volunteer-config` |
| `frontend/scripts/seed.ts` | เพิ่ม seed สำหรับ `master_data:volunteer_skills` |

---

## 4. Migration

- **Non-breaking change:** ฟิลด์ `category` และ `description` เป็น optional บน `items[]`
- เอกสารเดิมที่มี `master_data` ชนิดอื่น ๆ ไม่ได้รับผลกระทบ

---

## 5. Decision Log

- **2026-08-31 — proposed:** เปิด CR-099 บันทึกการเพิ่ม `volunteer_skills` ลงใน Master Data Engine และขยาย schema `items` เพื่อรองรับหมวดหมู่ทักษะและคำอธิบาย
