---
id: CR-117
title: "Master Data — เพิ่ม `volunteer_skills` (master_type ที่ 9) + schema items category & description + หน้าตั้งค่าทักษะอาสาสมัคร"
status: approved
date: 2026-08-31
updated: 2026-09-12
requested_by: Chino (FR-VOL-08.5 ย้ายทักษะอาสาเป็น Master Data)
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §3.3 (`master_data`)
  - docs/changes/CR-104-volunteer-backoffice-and-user-management-v10.md §3, §4 (Volunteer Domain & Job Architecture)
  - frontend/src/lib/features/master-data/domain/master-data.ts · master-data.test.ts · index.ts
  - frontend/src/lib/features/volunteers/ui/volunteer-skill-master-page.svelte
  - frontend/src/lib/components/backoffice-navbar/static.ts · system-management-navbar/static.ts
  - frontend/src/routes/(protected)/back-office/volunteer-skills/+page.svelte
  - frontend/src/routes/(protected)/portal/system-management/volunteer-config/+page.svelte
  - frontend/scripts/seed.ts
why: ย้ายรายการทักษะอาสาสมัครจาก hardcoded constant สู่ Master Data Engine สองชั้น และเพิ่ม category ('general' | 'controlled') เพื่อรองรับเงื่อนไขการคัดกรองใบสมัครงานจิตอาสาตาม CR-104
migration: N/A — schema_v master_data คงที่ 3; fields category และ description บน items[] เป็น optional (Backward-compatible)
---

# CR-117 — Master Data: `volunteer_skills` + Schema Items Category & Description

## สรุป (TL;DR)

- **เปลี่ยนอะไร:**
  1. เพิ่ม `master_type` ค่าใหม่: `volunteer_skills` (เป็น master_type ลำดับที่ 9 ในระบบ `master_data`)
  2. ขยาย Schema ของ `master_data.items[]` ให้รองรับ `category` (`'general'` | `'controlled'`) และ `description` (คำอธิบายทักษะ/ใบอนุญาตที่ต้องใช้) โดยกำหนดใช้ตัวพิมพ์เล็ก (lowercase) ทั้งหมดตามมาตรฐานของระบบ
  3. กำหนดความสัมพันธ์กับ CR-104 (Volunteer V10): แยกบทบาทชัดเจนระหว่าง Job Tier (`operational` / `staff-capable`) กับ Skill Category (`general` / `controlled`) และใช้ `controlled` เป็นเงื่อนไขส่งใบสมัครเข้าสู่สถานะ `pending_review`
  4. เพิ่ม UI จัดการทักษะอาสาสมัครทั้งระดับศูนย์พักพิง (`/back-office/volunteer-skills`) และระดับส่วนกลาง SA (`/portal/system-management/volunteer-config`)
  5. เพิ่ม seed ข้อมูลเริ่มต้น 9 ทักษะมาตรฐานใน `scripts/seed.ts`
- **เพื่อใคร/ทำไม:**
  - รองรับ FR-VOL-08.5 และยกระดับรายการทักษะจากค่าคงที่ในโค้ดสู่ Master Data Engine ให้ System Admin และ Shelter Manager/Volunteer Coordinator สามารถจัดการทักษะตามบริบทพื้นที่ได้จริง โดยยังคงกลไกคัดกรองทักษะควบคุม (Controlled Skills Gate) เพื่อความปลอดภัย
- **กระทบ schema/scope:**
  - `master_data` (schema_v 3) — ขยาย enum `master_type` และเพิ่ม optional fields `category`, `description` บน `items[]` (Backward compatible, ไม่ bump `schema_v`)

---

## 1. Why

1. **ยกระดับทักษะจาก Hardcoded Constant สู่ Master Data Engine**: เดิมทักษะอาสาสมัครถูกฝังเป็นค่าคงที่ (Constant) ทำให้ผู้ดูแลระบบไม่สามารถเพิ่ม แก้ไข หรือเปิด-ปิดการใช้งานทักษะให้สอดคล้องกับภัยพิบัติในแต่ละพื้นที่ได้
2. **กลไกการคัดกรองทักษะควบคุม (Controlled Skills Gate)**: จำเป็นต้องมีฟิลด์ `category` เพื่อจำแนกทักษะทั่วไป (`general`) ออกจากทักษะควบคุม (`controlled`) ที่ต้องมีการตรวจสอบใบประกอบวิชาชีพหรือใบอนุญาต (เช่น งานปฐมพยาบาล/การแพทย์) เพื่อใช้เป็นเงื่อนไขในการพิจารณาอนุมัติใบสมัครงานจิตอาสา
3. **ความสม่ำเสมอของข้อกำหนด Enum (Lowercase Standard)**: กำหนด convention สำหรับค่า enum `category` ให้เป็นตัวพิมพ์เล็ก (`'general'` | `'controlled'`) ทั้งหมด สอดคล้องกับมาตรฐานข้อมูลของ Smart Shelter ทั้งระบบ (เช่น `status: 'active' | 'inactive'`, `tier: 'operational' | 'staff-capable'`) ป้องกันความสับสนและข้อผิดพลาดในการทำ Validation
4. **ความชัดเจนของคำอธิบายทักษะ (`description`)**: ทั้งผู้สมัครและเจ้าหน้าที่ต้องการคำอธิบายเพิ่มเติม เช่น เอกสารหลักฐานหรือใบอนุญาตที่ต้องแสดงหน้างาน

---

## 2. Interaction with CR-104 (Volunteer Backoffice & User Management V10)

เอกสารฉบับนี้ทำงานประสานกับสถาปัตยกรรมงานอาสาสมัครใน **CR-104** ดังนี้:

### 2.1 การแยกมิติระหว่าง Job Tier กับ Skill Category (Orthogonal Separation)
ระบบแบ่งการจำแนกประเภทงานและทักษะออกจากกันอย่างเด็ดขาด:
- **Job Tier ใน CR-104 (`tier: 'operational' | 'staff-capable'`):** เป็นการจัดระดับ **"สิทธิ์การเข้าถึงระบบสารสนเทศ (System Access Privilege)"**
  - `operational`: งานภาคสนาม/งานกายภาพทั่วไป (ไม่ต้องสร้างบัญชีผู้ใช้ CouchDB `_users`)
  - `staff-capable`: งานช่วยบันทึกข้อมูลหลังบ้าน (ระบบต้องเปิดสิทธิ์บัญชีผู้ใช้ชั่วคราวและผูก Scoped Roles ให้ตามกะงาน)
- **Skill Category ในเอกสารนี้ (`category: 'general' | 'controlled'`):** เป็นการจัดระดับ **"คุณสมบัติและใบอนุญาตของบุคคล (Individual Competency & Licensure)"**
  - `general`: ทักษะงานทั่วไป ไม่ต้องตรวจสอบใบอนุญาตหรือวุฒิบัตรวิชาชีพ
  - `controlled`: ทักษะควบคุมที่ต้องมีใบประกอบวิชาชีพหรือผ่านการรับรองความปลอดภัย
- *การทำงานร่วมกัน:* ทั้งสองมิติเป็นอิสระต่อกัน เช่น:
  - งานปฐมพยาบาลภาคสนาม: `tier: 'operational'` (ทำงานกายภาพ ไม่ใช้คอมพิวเตอร์) แต่ต้องการทักษะ `medical` ซึ่งเป็น `category: 'controlled'` (ต้องตรวจใบอนุญาตพยาบาล/เวชกิจฉุกเฉิน)
  - งานช่วยคีย์ข้อมูลหน้าประตู: `tier: 'staff-capable'` (ต้องออกสิทธิ์ระบบ) แต่ต้องการทักษะคอมพิวเตอร์พื้นฐานซึ่งเป็น `category: 'general'`

### 2.2 ผลต่อขั้นตอนการสมัครงานจิตอาสา (Public Apply Flow & `job_application.status`)
ใน CR-104 Flow 2 การสมัครงานทั่วไปเป็น No-SMS Fast Registration ที่สามารถยืนยันตั๋วได้ทันที (`status: 'confirmed'`):
- **เมื่อทักษะที่งานต้องการหรือผู้สมัครระบุเป็น `category: 'controlled'`:**
  - ระบบจะไม่อนุมัติตั๋วอัตโนมัติ และตั้งค่าสถานะใบสมัครเป็น `status: 'pending_review'`
  - หน้าจอหลังบ้าน `/back-office/volunteers` จะแสดงรายการใบสมัครนี้ในคิวรอการตรวจสอบ เพื่อให้ `volunteer_coordinator` หรือ `shelter_manager` ตรวจสอบหลักฐานวิชาชีพก่อนกดยืนยัน (`confirmed`)
- **เมื่อทักษะทั้งหมดเป็น `category: 'general'`:**
  - สามารถอนุมัติตั๋วอัตโนมัติ (`status: 'confirmed'`) ตามเงื่อนไข `auto_accept` ของงานนั้น ๆ

### 2.3 การทำงานในโมเดล Two-Tier และ Compound Scoped Roles
- **Global Tier (`master_data:volunteer_skills`):** จัดการโดย `system_admin` ที่ `/portal/system-management/volunteer-config` เพื่อกำหนดทักษะมาตรฐานที่ทุกศูนย์พักพิงใช้งานร่วมกัน
- **Shelter-Local Tier (`master_data:volunteer_skills:{shelter_code}`):** จัดการโดยผู้ถือบทบาทระบุศูนย์ เช่น `SH001:volunteer_coordinator` หรือ `SH001:shelter_manager` ที่หน้า `/back-office/volunteer-skills` สามารถเพิ่มทักษะเฉพาะกิจของศูนย์นั้น ๆ (เช่น ขับเรือยนต์กู้ภัย, ผู้ช่วยดูแลสัตว์เลี้ยง, ล่ามภาษาถิ่น) โดยไม่กระทบรายการส่วนกลาง

---

## 3. Change Specification

### 3.1 `master_data.master_type` Enum (docs/data/schema.md §3.3)

ขยายรายการประเภท Master Data จาก 8 ประเภทเป็น 9 ประเภท:
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
	'volunteer_skills' // ลำดับที่ 9 (draft)
] as const;
```

### 3.2 `master_data.items[]` Schema Extension

ขยาย schema ของแต่ละ item ใน `master_data`:
```ts
export const volunteerSkillCategorySchema = z.enum(['general', 'controlled']);
export type VolunteerSkillCategory = z.infer<typeof volunteerSkillCategorySchema>;

export const masterDataItemSchema = z.object({
	code: z
		.string()
		.trim()
		.min(1)
		.regex(/^[a-z0-9_]+$/, 'Code must be lower_snake'),
	label: z.string().trim().min(1),
	is_default: z.boolean(),
	status: z.enum(['active', 'inactive']).default('active'),
	parent_code: z.string().trim().min(1).optional(),
	category: volunteerSkillCategorySchema.optional(), // 'general' | 'controlled' (lowercase ทั้งหมด)
	description: z.string().trim().optional()          // คำอธิบายทักษะ / รายละเอียดใบอนุญาต
});
```

> **ข้อตกลงเรื่อง Casing:** กำหนดให้ค่า `category` ใช้ตัวพิมพ์เล็กทั้งหมด (`'general'` และ `'controlled'`) เพื่อความสม่ำเสมอทั้งระบบ ห้ามใช้ตัวพิมพ์ใหญ่หรือคำกำกวม

### 3.3 Master Data Groups & Navbars

- เพิ่มกลุ่ม `VOLUNTEER_MASTER_TYPES = ['volunteer_skills']` ใน `master-data.ts`
- เพิ่มเมนูใน Backoffice Navbar: `4. ตั้งค่าระบบ > จัดการข้อมูลหลัก > 6. ทักษะอาสาสมัคร` (`/back-office/volunteer-skills`)
- เพิ่มเมนูใน System Management Navbar: `2. ตั้งค่าระบบส่วนกลาง > ตั้งค่าระบบ > 7. อาสาสมัคร` (`/portal/system-management/volunteer-config`)

### 3.4 Seed Master Data (`scripts/seed.ts`)

Seed รายการทักษะตั้งต้น 9 รายการ โดยระบุ `category` เป็นตัวพิมพ์เล็ก:
1. `cooking` — ประกอบอาหาร / ครัวสนาม (`category: 'general'`, `is_default: true`)
2. `logistics` — ขนย้ายสิ่งของ / พลาธิการ (`category: 'general'`)
3. `screening` — คัดกรองและสแกนประวัติ (`category: 'general'`)
4. `medical` — การแพทย์ / ปฐมพยาบาล (`category: 'controlled'`, `description: 'ต้องมีใบอนุญาตประกอบวิชาชีพเวชกรรมหรือพยาบาล'`)
5. `reception` — ประสานงาน / ต้อนรับ (`category: 'general'`)
6. `distribution` — แจกจ่ายของยังชีพ (`category: 'general'`)
7. `sanitation` — ทำความสะอาด / สุขอนามัย (`category: 'general'`)
8. `childcare` — สันทนาการ / ดูแลเด็ก (`category: 'general'`)
9. `transport` — ขับขี่ยานพาหนะ / ขนส่ง (`category: 'general'`, `description: 'ต้องมีใบขับขี่ที่ถูกต้องตามประเภทรถ'`)

---

## 4. Impact

| ที่ | ผลกระทบ |
| --- | --- |
| `docs/data/schema.md` §3.3 | อัปเดตรายการ `master_type` เพิ่ม `volunteer_skills` และระบุ optional fields `category` (`'general'` \| `'controlled'`), `description` บน `items[]` |
| `docs/changes/CR-104...md` | อ้างอิงทักษะจาก Master Data แทนค่าคงที่เดิม และเชื่อมโยง `category: 'controlled'` กับ `job_application.status: 'pending_review'` |
| `frontend/src/lib/features/master-data/` | เพิ่ม `volunteer_skills`, `VOLUNTEER_MASTER_TYPES`, ขยาย `masterDataItemSchema` ให้รองรับ `category` และ `description` |
| `frontend/src/lib/features/volunteers/ui/` | สร้าง `volunteer-skill-master-page.svelte` สำหรับจัดการ Master Data ทักษะ |
| `frontend/src/routes/(protected)/...` | เพิ่มเส้นทาง `/back-office/volunteer-skills` และ `/portal/system-management/volunteer-config` |
| `frontend/scripts/seed.ts` | เพิ่มฟังก์ชัน seed สำหรับ `master_data:volunteer_skills` |

---

## 5. Migration

- **Non-breaking Change:**
  - ฟิลด์ `category` และ `description` เป็น optional บน `items[]`
  - เอกสาร `master_data` ชนิดอื่น ๆ ที่มีอยู่เดิม (เช่น `vulnerable_group`, `shelter_type`) ไม่ได้รับผลกระทบ
  - ไม่มีการ bump `schema_v` ของ `master_data` (คงที่รุ่น 3)
- **Backward Compatibility:**
  - Consumer เดิมที่ไม่ได้อ่านฟิลด์ `category` หรือ `description` ยังคงทำงานได้ตามปกติ
  - สำหรับ items ที่ไม่ได้ระบุ `category` ให้ถือเสมือนว่าเป็น `'general'` โดยปริยาย

---

## 6. Definition of Done & Acceptance Criteria

- [ ] **AC-01 (Master Type Registration):** `MASTER_DATA_TYPES` มี `'volunteer_skills'` เป็นสมาชิกลำดับที่ 9 และผ่าน Zod schema validation
- [ ] **AC-02 (Schema Extension & Casing):** `masterDataItemSchema` รองรับ `category` ที่รับเฉพาะ `'general'` หรือ `'controlled'` (lowercase เท่านั้น) และ `description` (string optional)
- [ ] **AC-03 (CR-104 Gate Alignment):** มีข้อกำหนดชัดเจนว่าทักษะที่มี `category === 'controlled'` จะส่งผลให้ใบสมัครงานจิตอาสาเข้าสู่สถานะ `pending_review` ในระบบรับสมัคร
- [ ] **AC-04 (Two-Tier UI Access):**
  - เจ้าหน้าที่ระดับศูนย์เข้าถึง `/back-office/volunteer-skills` เพื่อเพิ่ม/แก้ไขทักษะเฉพาะศูนย์พักพิงได้
  - System Admin เข้าถึง `/portal/system-management/volunteer-config` เพื่อจัดการทักษะมาตรฐานส่วนกลางได้
- [ ] **AC-05 (Seed Integrity):** สคริปต์ `seed.ts` สร้างข้อมูลทักษะตั้งต้น 9 รายการ โดยมี `medical` เป็น `category: 'controlled'` และรายการอื่นเป็น `category: 'general'` ถูกต้องตาม format

---

## 7. Decision Log

- **2026-08-31 — proposed (draft):** เปิดร่าง CR (Draft-First) เพื่อเสนอการเพิ่ม `volunteer_skills` ลงใน Master Data Engine และขยาย schema `items`
- **2026-09-11 — revision:** ปรับโครงสร้างเอกสารเข้าสู่กระบวนการ Draft-First (`id: draft`, ไฟล์ `draft-master-data-volunteer-skills.md`), สรุปข้อตกลงเรื่อง Casing เป็น lowercase (`'general'` | `'controlled'`) ทั้งหมด, และระบุความสัมพันธ์กับสถาปัตยกรรมอาสาสมัครใน CR-104
- **2026-09-12 — approved:** Project Owner อนุมัติผ่าน PR #195 และกำหนดรหัสเอกสารเป็น CR-117

