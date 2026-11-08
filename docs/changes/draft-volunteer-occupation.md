---
id: draft
title: เก็บข้อมูลอาชีพ (occupation) ใน volunteer doc แบบไม่บังคับกรอก และแสดงผลในโปรไฟล์จิตอาสา
status: proposed
date: 2026-11-08
requested_by: "#1152 (@Mhapong) — ผล grill เมื่อ 2026-11-04 เรื่องการเก็บข้อมูลอาชีพของอาสาสมัคร"
decided_by: "@Jackyzaz"
layer: volatile
affects:
  - docs/data/schema.md §2.8 (เพิ่ม `occupation?: string | null`, bump `schema_v` 4 → 5, migration note)
  - frontend/src/lib/features/volunteers/domain/volunteer.schema.ts
  - frontend/src/lib/features/volunteers/server/public-application.ts
  - frontend/src/lib/features/volunteers/ui/public-quick-apply-modal.svelte
  - frontend/src/lib/features/volunteers/ui/walk-in-registration-dialog.svelte
  - frontend/src/lib/features/volunteers/ui/volunteer-manage-dialog.svelte
  - frontend/src/lib/features/volunteer-portal/domain/volunteer.ts
  - frontend/src/lib/features/volunteer-portal/ui/profile-edit-dialog.svelte
  - worker/src/worker/projectors/volunteer.py
  - packages/tent-model/src/tent_model/public_volunteer.py
  - backend/apiapp/modules/volunteers/schemas.py
  - backend/apiapp/modules/volunteers/use_case.py
  - frontend/scripts/seed/volunteers.ts
---

# เก็บข้อมูลอาชีพ (occupation) ใน volunteer doc แบบไม่บังคับกรอก และแสดงผลในโปรไฟล์จิตอาสา

## สรุปย่อ

เพิ่ม field `occupation` (`string | null`, optional, trim) ในเอกสาร `volunteer` เพื่อเก็บข้อมูลอาชีพ/วิชาชีพของจิตอาสาเป็นข้อความอิสระ (free text) โดยไม่บังคับกรอก เพื่อประโยชน์ในการจัดสรรภารกิจที่เหมาะสม โดย:

1. อนุญาตให้กรอก/แก้ไขผ่านฟอร์มรับสมัครสาธารณะ, ฟอร์ม walk-in ของเจ้าหน้าที่, และฟอร์มแก้ไขข้อมูลจิตอาสาของเจ้าหน้าที่
2. จิตอาสาสามารถดูอาชีพของตนเองในหน้าโปรไฟล์ของ Volunteer Portal ได้แบบอ่านอย่างเดียว (read-only) โดยจิตอาสาไม่สามารถแก้ไขเองได้
3. ส่งผ่านข้อมูลไปยัง public plane (`public_volunteers`) เพื่อให้ระบบ portal เรียกแสดงผลได้
4. Bump `schema_v` ของเอกสาร `volunteer` จาก 4 เป็น 5 (additive change รองรับเอกสารเดิม v3 และ v4 ได้สมบูรณ์)

---

## Why

- **ไม่มีที่เก็บอาชีพในปัจจุบัน:** เอกสาร `volunteer` (`docs/data/schema.md` §2.8, `schema_v` 4) ยังไม่มี field สำหรับเก็บข้อมูลอาชีพของอาสาสมัคร
- **field เดิมไม่ตรงกับอาชีพ:**
  - `organization` = หน่วยงาน/องค์กรต้นสังกัด (และไม่มีฟอร์มให้กรอก)
  - `skills[]` = รหัสทักษะตาม master data `volunteer_skills` (CR-100) ไม่ใช่อาชีพ
  - `_users.position` = ตำแหน่ง/วิชาชีพของบัญชีผู้ใช้ระบบ (CR-105) ไม่ใช่ข้อมูลของจิตอาสาในระดับศูนย์
- **ขอบเขตชัดเจน:** PRD ได้ตัด "ระบบส่งเสริมอาชีพ" ออกจากขอบเขตของโครงการแล้ว การเพิ่ม field นี้จึงเป็นเพียงการเก็บข้อมูลประวัติอาชีพเพิ่มเติมในโปรไฟล์อาสาเพื่อช่วยให้เจ้าหน้าที่วางแผนจัดสรรงานได้ตรงความถนัดยิ่งขึ้น ไม่เกี่ยวข้องกับระบบส่งเสริมอาชีพ
- **ผลการ Grill (2026-11-04):** ตกลงให้เก็บเป็น free text ไม่ผูกกับ master data, ไม่บังคับกรอก, เจ้าหน้าที่เป็นผู้บันทึก/แก้ไขได้, อาสาดูได้ทาง portal แต่แก้เองไม่ได้ (ป้องกันการกรอกข้อมูลไม่ถูกต้องเพื่ออ้างสิทธิ์)

---

## Change

### 1. Schema & Data Model (`docs/data/schema.md` §2.8)

- เพิ่ม field ใน `volunteer` doc:
  - `occupation`: `string | null` (optional, trim whitespace, ค่าเริ่มต้น `null` หากไม่ระบุ)
- Bump `schema_v`: `4` → `5`
  - การเปลี่ยนแปลงเป็นแบบ additive (เอกสารเก่าที่ยังไม่มี field นี้ หรือเป็น `null` ยังคงอ่านได้ตามปกติ)
  - Zod parser รับ `schema_v` 3 | 4 | 5
  - ฟังก์ชัน factory (`makeVolunteer()`) จะประทับตรา `schema_v: 5` เป็นค่าเริ่มต้น

### 2. Back-Office & Registration Flow

- **Public Quick Apply Modal (`public-quick-apply-modal.svelte` & `public-application.ts`):**
  - เพิ่มช่องกรอก "อาชีพ" (ไม่บังคับ)
  - `public-application.ts` บันทึกค่า `occupation` ลงใน doc ทั้งกรณีสร้างโปรไฟล์ใหม่ และกรณีอัปเดตโปรไฟล์เดิมที่พบ
- **Walk-in Registration Dialog (`walk-in-registration-dialog.svelte`):**
  - เพิ่มช่องกรอก "อาชีพ" ในฟอร์มลงทะเบียน walk-in โดยเจ้าหน้าที่
- **Volunteer Manage Dialog (`volunteer-manage-dialog.svelte`):**
  - เพิ่มช่องแก้ไข "อาชีพ" ในข้อมูลส่วนตัวของอาสาสมัคร ให้เจ้าหน้าที่แก้ไขข้อมูลได้

### 3. Public Plane & Sync Worker

- **Projector (`worker/src/worker/projectors/volunteer.py`):**
  - ดึง field `occupation` จาก CouchDB `volunteer` doc ส่งเข้า MongoDB collection `public_volunteers`
  - Bump `PROJECTION_VERSION` ใน `worker/src/worker/projection_version.py`
- **Tent Model (`packages/tent-model/src/tent_model/public_volunteer.py`):**
  - เพิ่ม field `occupation: Optional[str] = None` ในโมเดล `PublicVolunteer`
- **FastAPI Backend (`backend/apiapp/modules/volunteers/schemas.py` & `use_case.py`):**
  - เพิ่ม field `occupation: Optional[str] = None` ใน schema `VolunteerProfile` และ map จาก MongoDB document
  - Regenerate `openapi.d.ts` ผ่าน `pnpm openapi:update`

### 4. Volunteer Portal

- **Domain (`volunteer.ts`):**
  - รองรับ field `occupation: string | null` ใน type/schema ของ portal volunteer profile
- **Profile Edit Dialog (`profile-edit-dialog.svelte`):**
  - แสดงค่าอาชีพ (occupation) ในหน้าข้อมูลส่วนตัวแบบ read-only (ข้อความระบุอาชีพ หรือแสดง "-" หากไม่ได้ระบุ)
  - `volunteerProfileUpdateSchema` ยังคงอนุญาตให้อาสาสมัครแก้ไขได้เฉพาะ `skills` เท่านั้น ไม่อนุญาตให้แก้ `occupation` เอง

### 5. การเปิดบัญชีผู้ใช้ (_users)

- ยืนยันตามข้อตัดสินใจ: เมื่อสร้างบัญชีผู้ใช้จากโปรไฟล์อาสาสมัคร **จะไม่** คัดลอกค่า `occupation` ไปใส่ใน `_users.position` เนื่องจาก `position` เป็นบทบาทการทำงานในระบบ ไม่ใช่อาชีพจริงของบุคคล

---

## Impact

| ส่วนที่กระทบ           | รายละเอียดผลกระทบ                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `docs/data/schema.md`  | §2.8 เพิ่ม `occupation` และ bump `schema_v` เป็น 5 พร้อม Migration note              |
| `frontend` (domain)    | `volunteer.schema.ts` เพิ่ม Zod validation รองรับ `occupation`, `schema_v` 3-5       |
| `frontend` (ui/server) | ฟอร์ม public apply, walk-in, volunteer manage, และ portal profile view               |
| `worker`               | projector ส่ง field `occupation`, bump `PROJECTION_VERSION`                          |
| `backend`              | schema และ use case ของ public volunteer profile รองรับ field ใหม่                   |
| `seed`                 | script `volunteers.ts` ใส่ค่าตัวอย่างอาชีพและปรับ `schema_v: 5`                      |
| Tests                  | Unit tests ของ schema, public application, projector, FastAPI backend, และ E2E tests |

---

## Migration

- **Compatibility:** เป็น Additive change ไม่กระทบเอกสารเดิมในฐานข้อมูล
- **Existing Documents:** เอกสารเดิมที่เป็น `schema_v` 3 หรือ 4 ที่ไม่มี field `occupation` ให้ถือว่ามีค่าเป็น `null` (หรือสตริงว่าง) ไม่จำเป็นต้องรัน batch script เพื่อ backfill ข้อมูลเก่า
- **Parsing:** Zod schema ใน frontend และ Pydantic schema ใน backend/worker ต้องรองรับทั้งกรณีที่ field ไม่มีอยู่, เป็น `null`, หรือเป็น `string`

---

## Decision log

- 2026-11-04 — สรุปการ Grill requirements (#1152): เก็บใน volunteer doc, เป็น free text ไม่บังคับกรอก, แก้ไขได้โดย staff, อาสาดูได้ใน portal แต่แก้เองไม่ได้, bump `schema_v: 5`
- 2026-11-08 — Proposed draft CR ใน PR
