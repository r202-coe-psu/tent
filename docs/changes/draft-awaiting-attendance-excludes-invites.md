---
id: draft
title: แท็บผู้สมัคร — "รอยืนยันการเข้างาน" ไม่นับคำเชิญที่จิตอาสายังไม่ตอบ (`assigned` + `dispatched`)
status: proposed
date: 2026-11-02
updated: 2026-11-02
requested_by: "review ของ @Jackyzaz ใน PR #1032 (#849)"
decided_by: "รอ @Jackyzaz approve"
layer: volatile
amends: CR-207 (FR-1, FR-2)
affects:
  - docs/changes/06-A-volunteer/CR-207-applicant-tab-filters-and-counts.md (FR-1 bullet แรก, FR-2 — ใส่หมายเหตุ "แก้โดย CR นี้" เมื่อ approve)
  - frontend/src/lib/features/volunteers/domain/applicant-attendance.ts (`awaitingAttendanceConfirmation`)
  - frontend/src/lib/features/volunteers/domain/applicant-attendance.test.ts, applicant-filter.test.ts
  - ไม่เปลี่ยน schema / ไม่ bump `schema_v` (คำนวณตอนแสดงผล)
---

# "รอยืนยันการเข้างาน" ไม่นับคำเชิญที่ยังไม่ตอบ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** กะ `status = assigned` + `dispatch_status = dispatched` (เจ้าหน้าที่ส่งคำเชิญ จิตอาสายังไม่ตอบ) ไม่เข้าสถานะ "รอยืนยันการเข้างาน" แม้พ้นเวลาจบกะ + 30 นาที — อยู่ใน "ยังไม่เช็คอิน"
> - **ทำไม:** CR-207 FR-1 เขียน "`status = assigned`" ทุกแบบ แต่ decision log ของ CR-207 (2026-10-29) และ #849 ข้อ 4 บอกว่าตัวกรองนี้ใช้กับกะที่**รับแล้ว**เท่านั้น
> - **build:** เพิ่มเงื่อนไข `dispatch_status ≠ dispatched` ให้กะ `assigned` ใน `awaitingAttendanceConfirmation` · แสดงผลอย่างเดียว ไม่เปลี่ยน schema

## Why

- **review #1032 (@Jackyzaz):** test ใหม่ล็อกให้กะ `assigned` + `dispatched` นับเป็น "รอยืนยันการเข้างาน" ทั้งที่ `shift-assignment.remote.ts` เขียน `assigned` + `dispatched` ตอนเจ้าหน้าที่ส่งคำเชิญ และหน้าเช็คอินแสดงสถานะนี้ว่า "รอยืนยันการมอบหมาย"
  - ตัวอย่าง: เจ้าหน้าที่ส่งคำเชิญกะเช้าให้ V-013 แต่ V-013 ไม่ตอบ พ้นเวลาจบกะ 30 นาที → V-013 ขึ้นใน "รอยืนยันการเข้างาน" ทั้งที่ไม่เคยรับงาน
- **spec ขัดกันเอง:** CR-207 FR-1 ("`status = assigned` หรือ …") กับ decision log 2026-10-29 ("`assigned` + `dispatched` คือคำเชิญที่ยังไม่ตอบ") และ #849 ข้อ 4 ("ใช้กับกะที่รับแล้วเท่านั้น")
- **owner (@mhapong) 2026-11-02:** ไม่นับคำเชิญที่ยังไม่ตอบ

## Change

- **FR-1 (แก้ CR-207 FR-1 bullet แรก):** "รอยืนยันการเข้างาน" = `shift_assignment` ที่ยังไม่เช็คอิน, ไม่ใช่กะ `flex`, `now ≥ duty_window.end_ts + 30 นาที` และ (
  - `status = assigned` **และ `dispatch_status ≠ dispatched`** (รวม `accepted`, `declined`, ไม่มีค่า) หรือ
  - `status = standby` และ `dispatch_status = accepted` (เดิม)
  )
- **FR-2 (แก้ CR-207 FR-2):** กะ `assigned` + `dispatched` อยู่ใน "ยังไม่เช็คอิน" เสมอจนกว่าจะเช็คอิน (เหมือนกะ `standby` ที่ `dispatch_status ≠ accepted`)
- **ไม่เปลี่ยน:** ปุ่มเช็คอินในแท็บผู้สมัคร / ตารางกะ (`assignmentAttendance`) ใช้กฎของตัวเอง ไม่ได้ใช้ predicate นี้ · ไม่มีการเขียนเอกสาร · ตัวนับบนการ์ดด้านบนไม่ใช้ predicate นี้

### CR-207 (before → after)

| ข้อ | ก่อน | หลัง |
| --- | --- | --- |
| FR-1 | `status = assigned` หรือ (`status = standby` และ `dispatch_status = accepted`) | (`status = assigned` และ `dispatch_status ≠ dispatched`) หรือ (`status = standby` และ `dispatch_status = accepted`) |
| FR-2 | กะ `standby` ที่ `dispatch_status ≠ accepted` อยู่ใน "ยังไม่เช็คอิน" เสมอ | + กะ `assigned` + `dispatched` อยู่ใน "ยังไม่เช็คอิน" เสมอ |

## Acceptance

- [ ] กะ `assigned` + `dispatched` ที่พ้น `end_ts` + 30 นาทีและยังไม่เช็คอิน: ตัวกรอง "รอยืนยันการเข้างาน" ไม่แสดง · ตัวกรอง "ยังไม่เช็คอิน" แสดง
- [ ] กะ `assigned` ที่ `dispatch_status` เป็น `accepted` / `declined` / ไม่มีค่า: เข้า "รอยืนยันการเข้างาน" ที่ `end_ts` + 30 นาทีเหมือนเดิม
- [ ] กะ `standby` + `accepted`: เหมือนเดิม

## Impact

- แสดงผลอย่างเดียว ไม่เปลี่ยนข้อมูล · ไม่กระทบตัวนับบนการ์ดด้านบนของแท็บผู้สมัคร
- คำเชิญที่ไม่มีใครตอบจะค้างใน "ยังไม่เช็คอิน" — เจ้าหน้าที่ตามคำเชิญได้จากหน้ามอบหมายกะตามเดิม

## Migration

- ไม่มี — ไม่เปลี่ยน field / `schema_v`

## Decision log

- 2026-10-29 — CR-207 แก้ FR-1 ให้นับ `standby` + `accepted` · decision log ระบุ `assigned` + `dispatched` คือคำเชิญที่ยังไม่ตอบ
- 2026-11-02 — review ของ @Jackyzaz ใน #1032 ชี้ว่า FR-1 ยังนับ `assigned` ทุกแบบ · owner (@mhapong) เลือกไม่นับคำเชิญที่ยังไม่ตอบ และเลือกบันทึกเป็น draft CR ใหม่ (ไม่แก้ไฟล์ CR-207 ตรง)
