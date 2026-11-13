---
id: CR-245
title: เก็บข้อมูลอาชีพ (occupation) ใน volunteer doc แบบไม่บังคับกรอก และแสดงผลในโปรไฟล์จิตอาสา
status: approved
date: 2026-11-08
updated: 2026-11-10
requested_by: "#1152 (@Mhapong) — ผล grill เมื่อ 2026-11-04 เรื่องการเก็บข้อมูลอาชีพของอาสาสมัคร"
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-11-10
layer: volatile
affects:
  - docs/data/schema.md §2.8 (เพิ่ม `occupation?: string | null`, bump `schema_v` 5 → 6, migration note)
  - frontend/src/lib/features/volunteers/domain/volunteer.schema.ts (`volunteerSchema`, `volunteerInputSchema`, `walkInVolunteerFormSchema`)
  - frontend/src/lib/features/volunteers/server/public-application.ts
  - frontend/src/lib/features/volunteers/ui/public-quick-apply-modal.svelte
  - frontend/src/lib/features/volunteers/ui/walk-in-registration-dialog.svelte
  - frontend/src/lib/features/volunteers/ui/volunteer-manage-dialog.svelte
  - frontend/src/lib/features/volunteer-portal/domain/volunteer.ts (`volunteerApplySchema`, `VolunteerProfile`)
  - frontend/src/lib/features/volunteer-portal/i18n/profile-edit.i18n.ts
  - frontend/src/lib/features/volunteer-portal/ui/profile-edit-dialog.svelte
  - worker/src/worker/projection_version.py (bump `PROJECTION_VERSION`)
  - worker/src/worker/projectors/volunteer.py
  - packages/tent-model/src/tent_model/public_volunteer.py
  - backend/apiapp/modules/volunteers/schemas.py
  - backend/apiapp/modules/volunteers/use_case.py
  - frontend/scripts/seed/volunteers.ts
  - tests: `volunteer.schema.test.ts`, `public-application.test.ts`, `volunteer.test.ts`, `profile-edit-dialog.dom.test.ts`
---

# CR-245 — เก็บข้อมูลอาชีพ (occupation) ใน volunteer doc แบบไม่บังคับกรอก และแสดงผลในโปรไฟล์จิตอาสา

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม field `occupation` (`string | null`, opt, trim, max 100) ในเอกสาร `volunteer` · กรอก/แก้ได้ผ่าน public apply, walk-in, volunteer manage · จิตอาสาดูได้ใน portal แบบ read-only (แก้เองไม่ได้)
> - **เพื่อใคร / ทำไม:** ช่วยเจ้าหน้าที่จัดสรรภารกิจได้ตรงความถนัด · ไม่ผูก master data และไม่เกี่ยวกับระบบส่งเสริมอาชีพที่ถูกตัดออกจาก scope
> - **build:** Zod/Pydantic schema รับ field ใหม่ · ปรับ 3 ฟอร์ม (apply, walk-in, manage) · worker projector + FastAPI backend ส่งผ่าน public plane ไปยัง portal profile view
> - **schema / layer:** bump `volunteer` `schema_v` 5 → 6 (additive change รองรับ v3/v4/v5 เดิม) · `layer: volatile`

---

## Why

- **ไม่มีที่เก็บอาชีพในปัจจุบัน:** เอกสาร `volunteer` (`docs/data/schema.md` §2.8, `schema_v` 5) ยังไม่มี field สำหรับเก็บข้อมูลอาชีพของอาสาสมัคร
- **field เดิมไม่ตรงกับอาชีพ:**
  - `organization` = หน่วยงาน/องค์กรต้นสังกัด (และไม่มีฟอร์มให้กรอก)
  - `skills[]` = รหัสทักษะตาม master data `volunteer_skills` (CR-100) ไม่ใช่อาชีพ
  - `_users.position` = ตำแหน่ง/วิชาชีพของบัญชีผู้ใช้ระบบ (CR-105) ไม่ใช่ข้อมูลของจิตอาสาในระดับศูนย์
- **ขอบเขตชัดเจน:** PRD ได้ตัด "ระบบส่งเสริมอาชีพ" ออกจากขอบเขตของโครงการแล้ว การเพิ่ม field นี้จึงเป็นเพียงการเก็บข้อมูลประวัติอาชีพเพิ่มเติมในโปรไฟล์อาสาเพื่อช่วยให้เจ้าหน้าที่วางแผนจัดสรรงานได้ตรงความถนัดยิ่งขึ้น ไม่เกี่ยวข้องกับระบบส่งเสริมอาชีพ
- **ผลการ Grill (2026-11-04):** ตกลงให้เก็บเป็น free text ไม่ผูกกับ master data, ไม่บังคับกรอก, เจ้าหน้าที่เป็นผู้บันทึก/แก้ไขได้, อาสาดูได้ทาง portal แต่แก้เองไม่ได้ (ป้องกันการกรอกข้อมูลไม่ถูกต้องเพื่ออ้างสิทธิ์)

---

## Change

### Functional requirements

- **FR-1 (Schema & Model):** เพิ่ม field `occupation` (`string | null`, optional, trim, max 100 ตัวอักษร, default `null`) ในเอกสาร `volunteer` (`docs/data/schema.md` §2.8)
- **FR-2 (Schema Version):** Bump `schema_v` จาก 5 เป็น 6:
  - Zod parser รับ `schema_v: 3 | 4 | 5 | 6`
  - ฟังก์ชัน factory `makeVolunteer()` stamp `schema_v: 6` เป็นค่าเริ่มต้น
- **FR-3 (Public Quick Apply):**
  - `public-quick-apply-modal.svelte` เพิ่มช่องกรอก "อาชีพ" (ไม่บังคับ)
  - `volunteerApplySchema` ใน `volunteer.ts` รองรับ `occupation` (optional, trim, max 100)
  - `public-application.ts` บันทึก `occupation` ลง doc: กรณี reapply หากค่าใหม่เป็นสตริงว่างให้คงค่าเดิมไว้ (`occupation: input.occupation?.trim() || existing.occupation || null`)
- **FR-4 (Walk-in Registration):**
  - `walkInVolunteerFormSchema` ใน `volunteer.schema.ts` และ `walk-in-registration-dialog.svelte` เพิ่มช่องกรอก "อาชีพ" (ไม่บังคับ) โดยเจ้าหน้าที่
- **FR-5 (Volunteer Manage Dialog):**
  - `volunteer-manage-dialog.svelte` เพิ่มช่องแก้ไข "อาชีพ" ในข้อมูลส่วนตัวของอาสาสมัคร ให้เจ้าหน้าที่แก้ไขข้อมูลได้
- **FR-6 (Public Plane Projection):**
  - `volunteer.py` ดึง field `occupation` จาก CouchDB `volunteer` doc ส่งเข้า MongoDB collection `public_volunteers`
  - Bump `PROJECTION_VERSION` ใน `worker/src/worker/projection_version.py`
- **FR-7 (Tent Model & Backend API):**
  - เพิ่ม `occupation: Optional[str] = None` ในโมเดล `PublicVolunteer` (`tent-model`)
  - เพิ่ม `occupation: Optional[str] = None` ใน schema `VolunteerProfile` (`schemas.py`) และ map จาก MongoDB document ใน `use_case.py`
  - อัปเดต OpenAPI client ผ่าน `pnpm openapi:update`
- **FR-8 (Volunteer Portal Profile):**
  - `VolunteerProfile` ใน `volunteer.ts` รองรับ `occupation: string | null`
  - `profile-edit-dialog.svelte` แสดงค่าอาชีพ (occupation) ในหน้าข้อมูลส่วนตัวแบบ read-only (ข้อความระบุอาชีพ หรือแสดง "-" หากไม่ได้ระบุ) พร้อม translation ใน `profile-edit.i18n.ts`
  - `volunteerProfileUpdateSchema` ยังคงอนุญาตให้อาสาสมัครแก้ไขได้เฉพาะ `skills` เท่านั้น ไม่อนุญาตให้แก้ `occupation` เอง
- **FR-9 (User Account Isolation):**
  - ยืนยันตามข้อตัดสินใจ: เมื่อสร้างบัญชีผู้ใช้จากโปรไฟล์อาสาสมัคร **จะไม่** คัดลอกค่า `occupation` ไปใส่ใน `_users.position` เนื่องจาก `position` เป็นบทบาทการทำงานในระบบ ไม่ใช่อาชีพจริงของบุคคล

---

## Acceptance

- [ ] มี CR และ `docs/data/schema.md` §2.8 เพิ่ม `occupation` + `schema_v: 6` + migration note
- [ ] `volunteerSchema` / `volunteerInputSchema` / `walkInVolunteerFormSchema` รองรับ `occupation` (opt, nullable, trim, max 100)
- [ ] Zod parser รับ `schema_v: 3 | 4 | 5 | 6` และ `makeVolunteer()` stamp `schema_v: 6`
- [ ] เอกสารเดิม v3/v4 ที่ไม่มี field `occupation` ยังสามารถ parse และแสดงผลได้ตามปกติ (เป็น `null` หรือค่าว่าง)
- [ ] ฟอร์มรับสมัครสาธารณะ, walk-in, และ volunteer manage รองรับการบันทึก/แก้ไขอาชีพ
- [ ] Worker projector ส่ง `occupation` เข้า MongoDB และ bump `PROJECTION_VERSION`
- [ ] FastAPI backend คืนค่า `occupation` ใน `GET /public/v1/volunteer/profile`
- [ ] Portal Profile Edit Dialog แสดงอาชีพแบบ read-only และไม่อนุญาตให้แก้ไขเองผ่าน mutation
- [ ] การสร้าง `_users` ไม่มีการนำ `occupation` ไปใส่ใน `position`
- [ ] Unit tests, DOM tests, และ E2E tests ที่เกี่ยวข้องผ่านทั้งหมด

---

## Impact

| ส่วนที่กระทบ           | รายละเอียดผลกระทบ                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `docs/data/schema.md`  | §2.8 เพิ่ม `occupation` และ bump `schema_v` เป็น 6 พร้อม Migration note              |
| `frontend` (domain)    | `volunteer.schema.ts` เพิ่ม Zod validation รองรับ `occupation`, `schema_v` 3-6       |
| `frontend` (ui/server) | ฟอร์ม public apply, walk-in, volunteer manage, และ portal profile view               |
| `worker`               | projector ส่ง field `occupation`, bump `PROJECTION_VERSION`                          |
| `backend`              | schema และ use case ของ public volunteer profile รองรับ field ใหม่                   |
| `seed`                 | script `volunteers.ts` ใส่ค่าตัวอย่างอาชีพและปรับ `schema_v: 6`                      |
| Tests                  | Unit tests ของ schema, public application, projector, FastAPI backend, และ E2E tests |

---

## Migration

- **Compatibility:** เป็น Additive change ไม่กระทบเอกสารเดิมในฐานข้อมูล
- **Existing Documents:** เอกสารเดิมที่เป็น `schema_v` 3, 4 หรือ 5 ที่ไม่มี field `occupation` ให้ถือว่ามีค่าเป็น `null` (หรือสตริงว่าง) ไม่จำเป็นต้องรัน batch script เพื่อ backfill ข้อมูลเก่า
- **Parsing:** Zod schema ใน frontend และ Pydantic schema ใน backend/worker ต้องรองรับทั้งกรณีที่ field ไม่มีอยู่, เป็น `null`, หรือเป็น `string`

---

## Decision log

- 2026-11-04 — สรุปการ Grill requirements (#1152): เก็บใน volunteer doc, เป็น free text ไม่บังคับกรอก, แก้ไขได้โดย staff, อาสาดูได้ใน portal แต่แก้เองไม่ได้, bump `schema_v: 6`
- 2026-11-08 — Proposed draft CR ใน PR #1291
- 2026-11-10 — Approved โดย Soravit Sukkarn (Team Lead) กำหนดหมายเลข CR-245
