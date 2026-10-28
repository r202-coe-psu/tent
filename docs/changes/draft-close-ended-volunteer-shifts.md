---
id: draft
title: กะงานอาสาที่จบแล้วปิดรับสมัคร ไม่แสดงบนกระดาน public และงานที่ไม่เหลือกะแสดงว่า "ปิดรับแล้ว"
status: proposed
date: 2026-10-28
requested_by: "ผู้รับงาน (@Mhapong) จากการทดสอบ 2026-10-28 (#972)"
decided_by: project owner
layer: volatile
affects:
  - docs/changes/06-A-volunteer/CR-180-volunteer-multi-shift-apply.md FR-6 (เพิ่มรหัส `SHIFT_CLOSED`)
  - docs/changes/12-public/CR-185-public-jobs-is-urgent.md FR-3/FR-4/FR-5 (สูตรการ์ดหน้าแรกนับจากกะที่ยังเปิด)
  - draft-ticket-cancel-rules (PR #999, #967) FR-2 — dependency ของ FR-7
  - ไม่เปลี่ยน schema และไม่ bump `schema_v`
  - frontend/src/lib/features/volunteers/domain/shift-closing.ts (กฎปิดรับกะ export ผ่าน barrel `$lib/features/volunteers`)
  - frontend/src/lib/features/volunteers/i18n/jobs.i18n.ts (ป้าย "ปิดรับแล้ว")
  - frontend/src/lib/features/volunteer-portal (กระดานงาน, quick apply, ตัวนับหน้าแรก)
  - frontend/src/routes/api/public/v1/volunteer/jobs/[id]/apply/+server.ts
  - frontend/src/routes/api/public/v1/volunteer/apply/+server.ts (compat) และ apply/preflight/+server.ts
  - frontend/src/lib/features/volunteers/server/public-application.ts
---

# draft-close-ended-volunteer-shifts — กะที่จบแล้วปิดรับสมัคร

> **สรุป (TL;DR):**
>
> - **ปัญหา:** กระดานงาน public แสดงกะที่จบไปแล้วและยังสมัครได้ ประชาชนเข้าใจผิดว่ายังไปช่วยได้
> - **กฎใหม่:** กะเปิดรับจนถึงเวลาจบกะ (เวลาไทย) BFF ปฏิเสธกะที่จบแล้วด้วย `SHIFT_CLOSED`
> - **งานที่ไม่เหลือกะเปิดรับ:** ยังแสดง แต่มีป้าย "ปิดรับแล้ว" สมัครไม่ได้ และอยู่ท้ายรายการ
> - **ไม่เปลี่ยน:** หลังบ้าน, schema, `job.status`

---

## Why

- พบระหว่างทดสอบ 2026-10-28 (#972): กะที่หมดเวลาแล้วยังแสดงบนกระดานจิตอาสาและยังกดสมัครได้
- ไม่มี spec ข้อไหนกำหนดเรื่องนี้
  - CR-180 FR-6 มีรหัส error รายกะ แต่ไม่มีกรณีกะที่ผ่านไปแล้ว
  - CR-185 นับจากงานที่ `status = open` อย่างเดียว
- มีแค่ตัวเลือกกะของเจ้าหน้าที่ (`job-shift-picker.svelte`) ที่ตัดกะก่อนวันนี้ออก

## Change

### FR

- **FR-1:** กะเปิดรับสมัครจนถึงเวลาจบกะ คิดจาก `end_date` + `end_time` ตามเวลา Asia/Bangkok
  - แถวเก่าที่ไม่มี `end_date` ให้ derive แบบเดียวกับ `defaultShiftEndDate` (กะข้ามเที่ยงคืนจบวันถัดไป)
  - แถวที่ไม่มี `start_time` / `end_time` (projection public ที่เป็น null) ปิดรับตอนสิ้นวันของ `end_date` (หรือ `date`)
  - แถวกะที่ข้อมูลเสียจนคำนวณเวลาจบไม่ได้ ให้ถือว่า **เปิด** (ซ่อนงานเพราะข้อมูลเสียแย่กว่าแสดง)
  - ระหว่างกะยังสมัครได้
- **FR-2:** กฎ FR-1 เป็น pure function ตัวเดียวใน `volunteers/domain/shift-closing.ts` (ข้าง `duty-window.ts`) export ผ่าน barrel `$lib/features/volunteers` ให้ UI, BFF และตัวนับหน้าแรกใช้ร่วมกัน
  - route และ feature อื่น import ผ่าน barrel เท่านั้น
  - ยกเว้นไฟล์ใน `volunteer-portal/domain` ที่ import `volunteers/domain/shift-closing` ตรง (แบบเดียวกับ `schedule-view.ts` → `duty-window.ts`) เพราะ barrel ของ volunteers export UI ที่ import `volunteer-portal/domain` กลับมา จะเกิด import cycle
  - งานที่ไม่มีแถวกะเลย (projection เก่า) ถือว่า **เปิด**
- **FR-3:** กระดานงาน public, แท็บงานใน portal และ quick apply ไม่แสดงกะที่ปิดรับแล้ว และเลือกไม่ได้
- **FR-4:** งานที่ `status = open` แต่ไม่เหลือกะเปิดรับ
  - แสดงป้าย "ปิดรับแล้ว" และสมัครไม่ได้
  - เรียงไว้ท้ายรายการ ถัดจากงานที่ยังเปิดรับทั้งหมด
  - งานที่เปิดรับยังเรียงตามกะที่ใกล้ที่สุดเหมือนเดิม
  - ป้าย "ปิดรับแล้ว" คำนวณตอนแสดงผลจาก FR-1 เท่านั้น ไม่ได้มาจาก `job.status` · ข้อความอยู่ที่ `volunteers/i18n/jobs.i18n.ts` (`tagClosed`)
- **FR-5:** BFF apply ตรวจ FR-1 ฝั่ง server ทั้ง `POST /api/public/v1/volunteer/jobs/{id}/apply` และ compat `POST /api/public/v1/volunteer/apply`
  - กะที่ปิดรับแล้วได้ผลรายกะ `{ ok: false, shift_id, error: "SHIFT_CLOSED" }` (เพิ่มในรายการรหัสของ CR-180 FR-6) และใช้ HTTP **409** เมื่อเป็นกะแรกที่ไม่ผ่าน (CR-180 FR-7)
  - คำขอหลายกะบันทึกเฉพาะกะที่ยังเปิด
  - preflight (`/apply/preflight`) คงตาม CR-180 FR-10: ตรวจรายกะเฉพาะตอนเลือกกะเดียว ตอนเลือกหลายกะตรวจระดับงาน `SHIFT_CLOSED` ของกะในชุดนั้นมาจากขั้น apply (UI กรองกะที่ปิดแล้วออกอยู่แล้วตาม FR-3)
- **FR-6:** การ์ดจิตอาสาหน้าแรก (CR-185 FR-3/FR-4/FR-5) นับจากกะที่ยังเปิดรับเท่านั้น
  - ต้องการอีก / มีแล้ว / โควตา = ผลรวม `slots_remaining` / `slots_confirmed` / `quota` รายกะของกะที่เปิด
  - งานที่ไม่มีแถวกะ (projection เก่า) ใช้ตัวนับระดับงานเหมือนเดิม
  - งานที่ไม่เหลือกะเปิดไม่แสดงเป็นการ์ด
- **FR-7:** หน้าหลังบ้านของเจ้าหน้าที่ไม่เปลี่ยน ยังเห็นกะที่ผ่านไปแล้ว
  - การยกเลิกจากบัตรใช้กฎ "ยกเลิกได้เฉพาะก่อนกะเริ่ม" ของ `draft-ticket-cancel-rules` (PR #999) ซึ่งเป็น dependency ของ draft นี้
  - ผลรวม: **สมัครได้ถึงตอนจบกะ แต่ยกเลิกจากบัตรได้ถึงตอนเริ่มกะ** คนที่สมัครระหว่างกะจึงยกเลิกจากบัตรไม่ได้ ต้องให้เจ้าหน้าที่ยกเลิก / mark no-show (CR-104 §3.5) — ยอมรับพฤติกรรมนี้

## Acceptance

- **AC-1:** งานที่มีกะเมื่อวาน, วันนี้ (ยังไม่จบ) และพรุ่งนี้ แสดงเฉพาะกะวันนี้กับพรุ่งนี้บนกระดาน public และ quick apply
- **AC-2:** ยิง BFF apply ด้วยกะที่จบแล้ว ได้ `SHIFT_CLOSED` และไม่มี `job_application` ถูกสร้าง คำขอที่ปนกันบันทึกเฉพาะกะที่เปิด
- **AC-3:** งานที่กะจบหมดแล้วอยู่ท้ายรายการ มีป้าย "ปิดรับแล้ว" สมัครไม่ได้ และไม่ถูกนับในการ์ดหน้าแรก
- **AC-4:** หลังบ้านยังเห็นกะที่ผ่านไปแล้ว
- **AC-5:** กะข้ามเที่ยงคืนที่ไม่มี `end_date` ยังเปิดถึงเวลาจบในวันถัดไป แถวที่ไม่มีเวลาเปิดถึงสิ้นวัน และแถวข้อมูลเสียกับงานที่ไม่มีแถวกะยังเปิด
- **AC-6:** การ์ดหน้าแรกของงานที่มีกะจบแล้ว 1 กะและกะเปิด 1 กะ แสดงตัวเลขของกะที่เปิดเท่านั้น

## Impact

- **code:** ตาม `affects:` ข้างบน (#972)
- **test:** unit test ของกฎปิดรับ (ก่อนเริ่ม, ระหว่างกะ, หลังจบ, ข้ามเที่ยงคืน, ไม่มีเวลา, ข้อมูลเสีย), ตัวเรียงงาน, BFF apply/preflight และตัวนับหน้าแรก
- **ข้อมูล:** ไม่มีการเขียนหรือแก้เอกสาร `job.status` ยังเป็น `open` จนกว่าเจ้าหน้าที่จะปิดเอง

## Migration

ไม่มี

## Decision log

- 2026-10-28 — ผู้รับงานพบปัญหาระหว่างทดสอบ และตัดสินว่า
  - ปิดรับเมื่อกะจบ (ไม่ใช่เมื่อกะเริ่ม)
  - งานที่ไม่เหลือกะแสดงป้าย "ปิดรับแล้ว" และเรียงไว้ท้ายรายการ
- 2026-10-28 — proposed ใน PR #997 (#972)
- 2026-10-28 — Soravit Sukkarn (Team Lead) ตัดสินใน review PR #997:
  - D2 preflight หลายกะคงตาม CR-180 FR-10 (FR-5)
  - D3 ยอมรับ: สมัครได้ถึงตอนจบกะ ยกเลิกจากบัตรได้ถึงตอนเริ่มกะ (FR-7)
  - D4 การ์ดหน้าแรกใช้ผลรวมรายกะของกะที่เปิด (FR-6)
  - D5 ข้อมูลกะเสีย / งานไม่มีแถวกะ ถือว่าเปิด (FR-1, FR-2)
  - D6 ฟังก์ชันกฎอยู่ `volunteers/domain` export ผ่าน barrel (FR-2)
  - D1 อนุมัติหลังแก้ B1–B6 แล้วรันเลข CR ย้ายไป `06-A-volunteer/` พร้อมแก้ CR-180 FR-6 และ CR-185 FR-3/4/5
