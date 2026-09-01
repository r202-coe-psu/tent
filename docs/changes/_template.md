---
id: draft                  # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: <สรุปสั้นๆ ว่าจะเปลี่ยนอะไร>
status: proposed           # proposed | approved | done | rejected | superseded
date: 2026-09-01
requested_by: <ผู้ใหญ่ / field study / ทีม>
decided_by: <เจ้าของโครงการ>
layer: volatile            # stable | volatile
affects:
  - docs/data/schema.md §<n>
  - schema_v <a> → <b>
  - frontend/src/lib/features/<name>/<layer>
---

<!-- 
คำแนะนำการใช้งาน:
1. ตอนร่าง (proposed): ให้บันทึกไฟล์เป็น `docs/changes/draft-<slug>.md` และคง `id: draft` ไว้ (ยังไม่รันเลข CR-NNN)
2. เมื่อเจ้าของโครงการ Approve:
   - ตรวจสอบหมายเลข CR ล่าสุดจาก `docs/changes/_index.md` (บน branch หลัก)
   - รันเลขถัดไป และ rename ไฟล์เป็น `docs/changes/CR-NNN-<slug>.md`
   - เปลี่ยน `id: draft` -> `id: CR-NNN`, `status: proposed` -> `status: approved`
   - เพิ่มแถวใน `docs/changes/_index.md`
-->

# <title>

## Why
<เหตุผล — ทำไมต้องเปลี่ยน, มาจากไหน>

## Change
<อะไรเปลี่ยนเป็นอะไร — before → after>

## Impact
<กระทบ doc/code/test ไหนบ้าง>

## Migration
<ถ้า bump schema_v: ทำกับ doc ที่ persist แล้วยังไง; ไม่มีก็ใส่ N/A>

## Decision log
- 2026-09-01 — proposed

