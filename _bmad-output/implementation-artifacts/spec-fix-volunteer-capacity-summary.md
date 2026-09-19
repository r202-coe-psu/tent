---
title: 'แก้ตัวนับ KPI ความจุกะในหน้าจัดการอาสาสมัคร'
type: 'bugfix'
created: '2026-09-04'
status: 'in-review'
baseline_commit: '993f808b2f2b20efe9a08f93384b547c708a3b3d'
review_loop_iteration: 0
context: ['{project-root}/docs/changes/CR-094-volunteer-backoffice-v10-reconcile.md', '{project-root}/docs/plans/volunteer-backoffice/01-tab-job-board.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** KPI บน `/back-office/volunteers` นับกะของงานสถานะ `paused` เป็นกะที่ขาดแคลน ทั้งที่งานถูกพักรับสมัครแล้ว จึงทำให้ตัวเลข “ขาดแคลนหนัก” และอัตราจองรวมสูง/ต่ำกว่าข้อมูลที่ควรสื่อถึง capacity ที่เปิดใช้งานอยู่ (จากโค้ดปัจจุบัน `capacityJobs` ตัดเฉพาะ `draft`, `closed`, `cancelled` แต่ไม่ได้ตัด `paused`).

**Approach:** กำหนดสถานะที่มีสิทธิ์เข้า KPI capacity ให้เป็นสถานะที่ยังติดตาม capacity ได้ (`open`, `almost_full`, `full`) ผ่าน domain helper เดียว แล้วให้ summary ใช้ helper นี้ พร้อมเพิ่ม unit tests ครอบคลุมสถานะที่รวมและไม่รวม เพื่อป้องกันตัวเลขบนการ์ดคลาดเคลื่อนอีก.

## Boundaries & Constraints

**Always:** คงการคำนวณระดับกะและสูตรเดิมของ `overallBookingRate`/`bucketCounts`; งาน `paused`, `draft`, `closed`, `cancelled` ต้องไม่ถูกนับใน KPI; งาน `open`, `almost_full`, `full` ต้องถูกนับ; ต้องไม่กระทบตัวกรองรายการงานหรือ quota mutation.

**Ask First:** หากพบว่าความหมายของ “อัตราจองกะรวม” ต้องนับ `slots_dispatched` รวมกับ `slots_confirmed` ด้วย ให้หยุดและถามเจ้าของงานก่อน เพราะเป็นการเปลี่ยนนิยามตัวเลขนอกเหนือจาก bug ที่พบ.

**Never:** ห้ามแก้ข้อมูลใน CouchDB/seed เพื่อทำให้ตัวเลขดูถูกต้อง; ห้ามคำนวณ KPI ซ้ำใน component; ห้ามเปลี่ยนเกณฑ์ `<50%`, `50–99%`, `100%` หรือการนับแบบระดับกะ.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ACTIVE_STATUSES | jobs มี `open`, `almost_full`, `full` | ทุกกะของทั้งสามสถานะเข้า KPI | N/A |
| INACTIVE_STATUSES | jobs มี `paused`, `draft`, `closed`, `cancelled` | ไม่มีสักกะของสถานะเหล่านี้เข้า KPI | N/A |
| EMPTY | ไม่มีงานหรือไม่มี capacity job | KPI แสดง 0% และทุก bucket เป็น 0 | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/lib/features/volunteers/domain/capacity.ts` -- นิยามสถานะงานที่นับใน capacity KPI
- `frontend/src/lib/features/volunteers/domain/capacity.test.ts` -- unit tests ของ helper และการคง behavior ของ bucket calculation
- `frontend/src/lib/features/volunteers/ui/job-capacity-summary.svelte` -- กรองงานก่อนส่งเข้า KPI cards

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/lib/features/volunteers/domain/capacity.ts` -- เพิ่ม helper สำหรับสถานะที่นับใน capacity KPI -- ทำให้กติกาอยู่ใน domain และใช้ซ้ำได้
- [x] `frontend/src/lib/features/volunteers/domain/capacity.test.ts` -- เพิ่ม tests สำหรับสถานะ active/paused/terminal และ empty state -- ยืนยัน edge cases ของตัวนับ
- [x] `frontend/src/lib/features/volunteers/ui/job-capacity-summary.svelte` -- ใช้ domain helper แทน inline status exclusion -- ตัดงาน paused ออกจากการ์ดโดยไม่เปลี่ยน filter กระดาน

**Acceptance Criteria:**
- Given งานสถานะ `paused`, `draft`, `closed` หรือ `cancelled`, when หน้า job board คำนวณ KPI, then กะของงานเหล่านั้นไม่ถูกนับในอัตราจองรวมและ bucket ใด ๆ.
- Given งานสถานะ `open`, `almost_full` หรือ `full`, when หน้า job board คำนวณ KPI, then กะของงานเหล่านั้นถูกนับตามสูตรระดับกะเดิม.
- Given ไม่มีงานที่เข้าเกณฑ์, when summary แสดงผล, then แสดง `0%`, `0`, `0`, `0`.
- Given ผู้ใช้คลิก bucket filter, when รายการงานถูกกรอง, then behavior ของ job board ยังเหมือนเดิมและไม่เกิด error จากการเปลี่ยน helper ของ summary.

## Spec Change Log

## Design Notes

`paused` หมายถึงพักรับสมัคร จึงไม่ควรทำให้ศูนย์ดูเหมือนมี shortage ที่กำลังเปิดรับอยู่ แม้ยังคงเก็บ quota ของงานไว้เพื่อกลับมาเปิดต่อได้ ส่วน `full` ยังนับเพราะเป็น capacity ที่เปิดใช้งานและต้องแสดงใน bucket 100%.

## Verification

**Commands:**
- `pnpm --dir frontend test -- src/lib/features/volunteers/domain/capacity.test.ts` -- expected: all capacity tests pass
- `pnpm --dir frontend check` -- expected: 0 Svelte/TypeScript errors
