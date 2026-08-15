---
id: CR-076
title: Onsite registration บังคับเลือกหรือสร้าง household ก่อนบันทึก pet/asset/vehicle และจัดโซน
status: done
date: 2026-08-14
requested_by: project owner
decided_by: project owner (ยืนยัน 2026-08-14)
layer: volatile
affects:
  - docs/prd/phase-r2-foundation.md FR-21, FR-24
  - docs/task-breakdown/02-people.md T-04, T-07
  - docs/changes/CR-029-household-status-field.md R-29-4 (flow clarification)
  - frontend/src/lib/features/people/ui/evacuee-form.svelte
  - frontend/e2e/register-evacuee*.test.ts
supersedes_slice_of: CR-029 R-29-4 (solo household ต้องเลือกสร้างใน Stage 3 แทนการสร้างอัตโนมัติโดยข้าม Stage)
---

# CR-076 — Onsite registration ต้องมี Household

> **สรุป (TL;DR):** Onsite registration ทุกคนต้องเลือก household เดิมหรือสร้างใหม่ใน Stage 3 · ผู้ที่มา
> คนเดียวสร้าง household 1 คนและเป็น head · ขั้น pet/asset/vehicle ต้องตาม Stage 3 และมาก่อนจัดโซน
> เสมอ · pets ยังคงเก็บที่ household · ไม่เปลี่ยน persisted shape และไม่ bump `schema_v`

## Why

หน้าลงทะเบียนปัจจุบันมี action “ลงทะเบียนโดยไม่ผูกครัวเรือน” ซึ่งบันทึก person แล้วข้ามจาก Stage 3
ไปจัดโซนทันที ทำให้เกิด person ที่ไม่มี household และข้ามการบันทึก pet/asset/vehicle ทั้งที่
CR-009 amendment กำหนดให้ทุก person ต้องมี household และ schema ปัจจุบันเก็บ pets ที่ household

## Change

1. Stage 3 ต้องมี 2 ทางเลือกเท่านั้น: เลือก household เดิม หรือส่งฟอร์มสร้าง household ใหม่สำเร็จ
2. ปุ่มดำเนินต่อจาก Stage 3 ต้อง disabled จนเลือก household เดิม; การส่งฟอร์มสร้างใหม่สำเร็จจึงไป
   ขั้น pet/asset/vehicle
3. ผู้ที่มาเพียงคนเดียวต้องเลือกสร้าง household 1 คน โดย person นั้นเป็น `head_evacuee_id`
4. ลำดับ onsite flow ต้องเป็น Household → Pet/Asset/Vehicle → Zoning เสมอ ไม่มี skip path
5. `pets`, `assets`, และ `vehicles` ของ flow นี้เก็บที่ household ตาม schema ปัจจุบัน
6. เมื่อแก้ข้อมูล household เดิมในขั้น pet/asset/vehicle ให้บันทึก collection ที่แสดงในฟอร์มกลับไปที่
   household โดยไม่ทำรายการเดิมซ้ำ

## Acceptance

- [x] Stage 3 ไม่มี action ลงทะเบียนโดยไม่ผูก household
- [x] ยังไปขั้นถัดไปไม่ได้จนกว่าจะเลือก household เดิมหรือส่งฟอร์มสร้างใหม่สำเร็จ
- [x] Copy อธิบายชัดว่าผู้มาเพียงคนเดียวต้องสร้าง household 1 คน
- [x] ทุก path ผ่านขั้น pet/asset/vehicle ก่อน zoning และย้อนกลับจาก zoning มาขั้นนี้
- [x] Person ที่บันทึกสำเร็จมี `household_id`
- [x] Pet data persist ที่ household

## Impact

- Binding PRD/WBS เปลี่ยน household จาก optional เป็น required สำหรับ onsite registration และตัด
  ความกำกวม “person หรือ household” ของ pet/asset/vehicle
- Svelte wizard ตัด skip action เพิ่ม guard ก่อน final submit และคงลำดับ back navigation
- E2E registration assertions ครอบ household gate และลำดับ Stage 3 → pet/asset/vehicle

## Migration

N/A — ไม่เปลี่ยน persisted document shape และไม่ bump `schema_v` เอกสาร person เดิมที่
`household_id = null` ไม่ถูก backfill ใน CR นี้

## Decision log

- 2026-08-14 — project owner ยืนยัน household required, solo = household 1 คน, ห้ามข้ามขั้น
  pet/asset/vehicle, pets คงเก็บที่ household และเลือก tracking = CR file
- 2026-08-14 — done: spec + onsite Svelte flow + focused E2E assertions
