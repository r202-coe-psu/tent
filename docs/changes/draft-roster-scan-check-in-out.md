---
id: draft # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: Volunteer check-in / check-out — ทุกทางผ่าน dialog สแกน QR เดียว (roster + แท็บผู้สมัคร)
status: proposed
updated: 2026-11-02
date: 2026-11-02
requested_by: @mhapong (#1089 / PR #1090)
decided_by: รอ @Jackyzaz approve
layer: volatile
affects:
  - docs/changes/06-A-volunteer/CR-094-volunteer-backoffice-v10-reconcile.md §2.5 FR-VOL-11.1 (amend)
  - docs/changes/06-A-volunteer/CR-116-volunteer-shift-checkout-actor-reason.md Decisions 4–5 (amend)
  - frontend/src/lib/features/volunteers/ui/applicant-check-in-dialog.svelte
  - frontend/src/lib/features/volunteers/ui/roster-row.svelte
  - frontend/src/lib/features/volunteers/ui/roster-attendance-tab.svelte
  - frontend/src/lib/features/volunteers/data/shift-assignment.remote.ts
  - no schema_v bump (shift_assignment ยัง v5; ใช้ฟิลด์ §2.9 เดิม)
---

# Volunteer check-in / check-out ผ่าน dialog สแกน QR เดียว

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เช็คอิน/เช็คเอาต์จากแท็บ "ตารางกะและเช็คอิน" และแท็บ "ผู้สมัคร" ของงาน ใช้ dialog สแกน QR ตัวเดียวกัน — สแกน QR ของอาสาคนนั้น → `method: 'qr'`; ไม่สแกน → `manual_override` + เหตุผลบังคับ
> - **เลิกใช้:** ปุ่มเช็คอิน/เช็คเอาต์ 1 คลิกในแถว roster และปุ่ม "เช็คอินแทน / เช็คเอาต์แทน" แยก; เช็คเอาต์ในแท็บผู้สมัครไม่ใช่แค่ confirm อีกต่อไป
> - **เพิ่ม guard:** repository ไม่เขียนทับถ้า status ไม่ถูก (กันเช็คเอาต์ซ้ำ) และ roster เช็คอินได้เฉพาะกะของวันนี้
> - **ไม่ bump `schema_v`** — ไม่มีฟิลด์ใหม่

---

## Why

- แท็บ roster บันทึกเช็คอิน/เช็คเอาต์ทันทีด้วย 1 คลิกและเขียน `method: 'qr'` โดยไม่มีการสแกนจริง — audit บอกว่าสแกนแล้วแต่ไม่ได้สแกน
- เช็คเอาต์ในแท็บผู้สมัครเป็นแค่ dialog ยืนยัน ไม่ตรวจว่าเป็นตัวอาสาคนนั้น
- repository เขียนทับ `check_out_*` ได้เมื่อสองเครื่องกดพร้อมกัน audit ของคนแรกหาย
- roster ไม่จำกัดวันที่ เลือกวันอื่นแล้วเช็คอินกะของวันอื่นได้ (แท็บผู้สมัครจำกัดแล้ว)

## Change

### Functional requirements

1. **FR-1 dialog เดียว:** เช็คอินและเช็คเอาต์ทั้งใน roster (`roster-row.svelte`) และแท็บผู้สมัคร (`job-applicant-row.svelte`) เปิด `applicant-check-in-dialog.svelte` (`mode: 'check_in' | 'check_out'`) การกดปุ่มไม่บันทึกอะไร
2. **FR-2 สแกน:** QR ที่ resolve เป็น `volunteer_id` ของ assignment นั้นเท่านั้น → บันทึก `method: 'qr'`; QR ของคนอื่นหรือหาไม่เจอ → แสดงข้อความ + toast และไม่บันทึก; lookup ล้มเหลวจากเครือข่าย/repo → ข้อความแยกจาก "ไม่พบ QR"
3. **FR-3 ไม่สแกน:** บันทึก `method: 'manual_override'` ได้เมื่อกรอกเหตุผลไม่ว่าง (trim) เท่านั้น — ใช้ทั้งเช็คอินและเช็คเอาต์ ค่า `*_by`, `*_reason` ตาม schema §2.9 / CR-116 เดิม
4. **FR-4 เอาปุ่มเดิมออก:** ลบปุ่ม 1 คลิกใน roster และปุ่ม "เช็คอินแทน / เช็คเอาต์แทน" (`roster-manual-checkin-dialog.svelte` ถูกลบ)
5. **FR-5 guard ใน repository:** `ShiftAssignmentRepository#checkIn` รับเฉพาะ `status` `assigned` | `standby`; `#checkOut` รับเฉพาะ `checked_in`; นอกนั้น throw error ภาษาไทย (เช่น "อาสาสมัครเช็คเอาต์ไปแล้ว" / "ยังไม่ได้เช็คอิน") และไม่เขียนอะไร
6. **FR-6 date gate ใน roster:** `roster-row.svelte` เสนอ "เช็คอินเข้างาน" เฉพาะ `assignment.date === วันนี้ (Asia/Bangkok)` ใช้กฎเดียวกับแท็บผู้สมัคร (`assignmentAttendance`); เช็คเอาต์ของ `checked_in` ทำได้ทุกวัน (กะข้ามคืน)

### Amends (before → after)

| รายการ                       | Before                                                                     | After                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR-094 FR-VOL-11.1           | จนท. "กดปุ่ม" เช็คอินแทน (Manual Override) เมื่อสแกน QR ไม่สำเร็จ          | ไม่มีปุ่มแยก — manual override คือทางเลือก "ไม่สแกน + เหตุผล" ใน dialog สแกน (FR-1, FR-3) ผลที่บันทึก (`check_in_method = manual_override`, เหตุผล, actor, เวลา) เท่าเดิม |
| CR-094 FR-VOL-11.2           | บันทึก actor/เหตุผล/timestamp ทุก override                                 | ไม่เปลี่ยน                                                                                                                                                                |
| CR-116 Decision 4            | `roster-manual-checkin-dialog.svelte` โหมดเช็คเอาต์เก็บเหตุผล              | dialog นั้นถูกลบ ช่องเหตุผลอยู่ใน dialog สแกน (FR-3)                                                                                                                      |
| CR-116 Decision 5 / Why      | roster 1 คลิก = `method: 'qr'`; เช็คเอาต์ในแท็บผู้สมัครเป็น confirm ธรรมดา | ทั้งสองทางต้องสแกน QR ของอาสาคนนั้น หรือกรอกเหตุผล (FR-1–FR-3)                                                                                                            |
| CR-116 repository `checkOut` | ไม่ตรวจ status ก่อนเขียน                                                   | ต้องเป็น `checked_in` (FR-5)                                                                                                                                              |

## Acceptance

- [ ] roster: "เช็คอินเข้างาน"/"เช็คเอาต์ออกงาน" เปิด dialog สแกน; สแกน QR ของคนนั้นแล้วบันทึก `qr`; QR คนอื่นไม่บันทึก; ไม่สแกนต้องมีเหตุผลจึงบันทึก `manual_override`
- [ ] แท็บผู้สมัคร: "เช็คเอาต์ออกงาน" ทำแบบเดียวกัน (ไม่มี confirm dialog เดิม)
- [ ] roster: แถวของวันอื่นที่ยัง `assigned`/`standby` ไม่มีปุ่มเช็คอิน; แถว `checked_in` ของวันก่อนยังเช็คเอาต์ได้
- [ ] เช็คเอาต์ซ้ำ → error และ `check_out_by/at/method/reason` ของครั้งแรกไม่เปลี่ยน; เช็คเอาต์ก่อนเช็คอิน → error
- [ ] unit/dom test ครอบ FR-1–FR-6 (repository, dialog ทั้งสอง mode, roster-row)

## Impact

- โค้ด: `applicant-check-in-dialog.svelte`, `roster-row.svelte`, `roster-attendance-tab.svelte` (ส่ง `today`), `shift-assignment.remote.ts`, ลบ `roster-manual-checkin-dialog.svelte` + export ใน `volunteers/index.ts`
- Test: `shift-assignment.remote.test.ts`, `applicant-check-in-dialog.dom.test.ts`, `roster-row.dom.test.ts`
- Docs: CR-094 §2.5 และ CR-116 ต้องมีหมายเหตุอ้างถึง CR นี้เมื่อ approve (ไม่แก้ตัวเนื้อหา CR เดิมตอนนี้)
- ไม่กระทบ API/BFF, worker, MongoDB projection

## Migration

none — ไม่เปลี่ยน shape ที่ persist; เอกสารเดิมใช้ต่อได้

## Decision log

- 2026-11-02 — proposed โดย owner @mhapong (เลือกทำเป็น draft CR ใหม่ แทน amend CR-116); รอ @Jackyzaz approve และเลข CR
