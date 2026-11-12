---
id: CR-249
title: การมอบหมายอาสาสมัครเข้าหลายกะพร้อมกัน (Bulk Shift Assignment)
status: approved
date: 2026-11-10
updated: 2026-11-12
requested_by: Field study / Issue #1164
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-11-12
layer: volatile
affects:
  - frontend/src/lib/features/volunteers/ui/job-assign-page.svelte (การ์ดกะ multi-select, สรุปผลรายคน)
  - frontend/src/lib/features/volunteers/domain/bulk-assign.ts (planBulkAssign ตรวจเวลาชน/โควตา)
  - frontend/src/lib/features/volunteers/domain/bulk-assign.test.ts
  - frontend/src/lib/features/volunteers/ui/job-assign-page.dom.test.ts
---

# CR-249 — การมอบหมายอาสาสมัครเข้าหลายกะพร้อมกัน (Bulk Shift Assignment)

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เลือกหลายกะในหน้าจัดการงานจิตอาสา (`job-assign-page`) แล้วมอบหมายอาสาเข้าหลายกะได้ในครั้งเดียว
> - **เพื่อใคร/ทำไม:** Volunteer Coordinator (VC) และ Shelter Manager (SM) ไม่ต้องสลับเลือกกะทีละรอบ
> - **dev ต้อง build อะไร:** การ์ดกะแบบ multi-select (กะเต็ม disabled), `planBulkAssign` ตรวจเวลาชน/โควตา, dialog สรุปผลรายคน
> - **กระทบ schema/scope:** ไม่กระทบ schema (ใช้ `shift_assignment` เดิม) · กระทบ UI/domain ของ Module A (Volunteer)

## Why

ในหน้าจัดการงานจิตอาสา (`/back-office/volunteers?tab=jobs`) เจ้าหน้าที่มักต้องมอบหมายอาสาสมัครหลายคนเข้าปฏิบัติงานในหลายกะของงานเดียวกันพร้อมกัน (เช่น กะเช้าและกะบ่ายของวันเดียวกัน หรือกะต่อเนื่องตลอดช่วงกิจกรรม)
เดิมระบบรองรับเพียงการเลือกกะเดียวครั้งละ 1 กะ แล้วมอบหมายทีละคนหรือเลือกหลายคนเข้ากะนั้น ทำให้เจ้าหน้าที่ต้องสลับกะไปมาและทำซ้ำหลายรอบ

## Change

- **FR-1 โหมดการเลือกหลายกะ (Multi-Shift Selection):**
   - เจ้าหน้าที่สามารถคลิกเลือกการ์ดกะงานย่อยได้มากกว่า 1 กะ โดยมีตัวแสดงจำนวนกะที่เลือกชัดเจน
   - กะที่โควตาเต็มแล้ว (`enrolled >= capacity`) จะถูก disabled เพื่อป้องกันการเลือก
   - สามารถคลิกซ้ำเพื่อยกเลิกการเลือกกะนั้นได้ หากยกเลิกจนไม่เหลือกะที่เลือก ให้แสดงข้อความแนะนำให้เลือกกะแทนการแจ้งเตือนผิดพลาด

- **FR-2 การคำนวณความพร้อมและการชนเวลา (Eligibility & Overlap Detection):**
   - คำนวณความพร้อมของอาสาสมัครแต่ละคนกับทุกกะที่เลือกไว้
   - หากอาสาสมัครมีกะงานอื่นที่เวลาทับซ้อน (รวมถึงกะที่คาบเกี่ยวข้ามเที่ยงคืน) หรือเคยเข้ากะนั้นแล้ว ระบบจะระบุเหตุผลและข้ามการลงทะเบียนในกะนั้น
   - หากเวลาของกะที่เลือกซ้ำกันในงานเดียวกัน ระบบต้องระบุ `shiftId` เพื่อป้องกัน key ชนกันในการแสดงผล

- **FR-3 กลไกการบันทึกการมอบหมาย (Assignment Execution):**
   - ดำเนินการมอบหมายทีละคู่ (คน × กะ) ที่ผ่านเกณฑ์
   - หากพบข้อผิดพลาดโควตาเต็มระหว่างดำเนินการ (`QuotaError`) ระบบจะข้ามคู่ที่เหลือของกะนั้นทันทีเพื่อลดภาระการเรียกฐานข้อมูลซ้ำซ้อน
   - แสดงความคืบหน้า (Progress) และผลการมอบหมายรายคนผ่าน Dialog สรุปผลชัดเจน

- **FR-4 การแสดงผลทักษะ (Skill Rendering):**
   - แสดงชื่อทักษะ (Skill Labels) จาก Master Data แคตตาล็อกเท่านั้น หากไม่พบข้อมูลในแคตตาล็อกให้ข้ามการแสดงผลเพื่อไม่ให้รั่วไหลรหัสดิบสู่หน้าจอ

### Acceptance Criteria

- [ ] AC-1 (FR-1): เลือกได้หลายกะ แสดงจำนวนกะที่เลือก; กะที่ `enrolled >= capacity` เป็น disabled; ยกเลิกจนไม่เหลือกะแสดงข้อความแนะนำ ไม่ขึ้น error
- [ ] AC-2 (FR-2): คน × กะที่เวลาทับซ้อน (รวมคาบเกี่ยวเที่ยงคืน) หรือเคยเข้ากะนั้นแล้ว ถูกข้ามพร้อมเหตุผล; กะเวลาเดียวกันในงานเดียวกันไม่ทำให้ key ชนกัน (ใช้ `shiftId`)
- [ ] AC-3 (FR-3): เมื่อเจอ `QuotaError` ข้ามคู่ที่เหลือของกะนั้น; dialog แสดงความคืบหน้าและผลรายคน
- [ ] AC-4 (FR-4): แสดงเฉพาะชื่อทักษะที่พบในแคตตาล็อก ไม่แสดงรหัสดิบ
- [ ] AC-5: มี unit test (`bulk-assign.test.ts`) และ DOM test (`job-assign-page.dom.test.ts`) ครอบคลุม AC-1–AC-4

## Impact

- **UI:** `frontend/src/lib/features/volunteers/ui/job-assign-page.svelte` รองรับการเลือกหลายกะและสรุปผล
- **Domain:** `frontend/src/lib/features/volunteers/domain/bulk-assign.ts` จัดการคำนวณการชนเวลาและการจัดสรรกะ
- **Tests:** `frontend/src/lib/features/volunteers/domain/bulk-assign.test.ts`, `frontend/src/lib/features/volunteers/ui/job-assign-page.dom.test.ts`
- **Schema:** ไม่กระทบ schema ของฐานข้อมูล (ใช้เอกสาร `shift_assignment` รูปแบบเดิม)

## Migration

N/A (ไม่มีการเปลี่ยนแปลงโครงสร้างเอกสารที่จัดเก็บถาวร)

## Decision Log

- 2026-11-10 — proposed สำหรับ [Issue #1164](https://github.com/r202-coe-psu/tent/issues/1164) (อ้างอิงโค้ดจาก [PR #1289](https://github.com/r202-coe-psu/tent/pull/1289))
- 2026-11-11 — แก้ตาม review PR #1324: เพิ่ม TL;DR, FR/AC รายข้อ, ปรับหัวข้อตามแม่แบบ, แก้พาธเป็น `frontend/…`, ล้าง `decided_by`
- 2026-11-12 — approved โดย Soravit Sukkarn (Team Lead) ([PR #1324](https://github.com/r202-coe-psu/tent/pull/1324))
