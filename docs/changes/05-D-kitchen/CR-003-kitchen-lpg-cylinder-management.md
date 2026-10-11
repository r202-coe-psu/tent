---
id: CR-003
title: "เพิ่ม task T-56 — LPG cylinder management ใน Module D (Kitchen & Food)"
status: approved
date: 2026-06-18
requested_by: project owner (session 2026-06-18)
decided_by: project owner (session 2026-06-18)
layer: volatile
affects:
  - docs/task-breakdown/05-D-kitchen.md — เพิ่ม task T-56 + update effort table
  - docs/task-breakdown/_index.md — update module 5 task count (4 → 5) และ Adj MD (15.5 → 18.5)
---

# CR-003 — เพิ่ม task T-56 — LPG cylinder management ใน Module D

## Why

Module D ปัจจุบัน (T-17, T-25, T-26, T-27) ครอบคลุมแผนอาหาร → เบิกวัตถุดิบ → บันทึกผลเสิร์ฟ
แต่ยังขาด **การจัดการถังแก๊สหุงต้ม (LPG cylinder)** ซึ่งเป็น consumable หลักที่ใช้ประกอบอาหาร
ในศูนย์พักพิง — stock ถังแก๊สต้องติดตามแยกต่างหากจากวัตถุดิบทั่วไปเนื่องจากรูปแบบการใช้
(นับถัง เต็ม/เปล่า) แตกต่างจาก stock อาหาร (kg/unit)

## Change

เพิ่ม task ใหม่ **T-56 — LPG cylinder management** เข้า Module D ใน `docs/task-breakdown/05-D-kitchen.md`:

- ติดตาม stock ถังแก๊ส (เต็ม/เปล่า/ใช้งาน) ใน kitchen context
- บันทึกการใช้งานต่อมื้อ/วัน (ถังที่เปิดใช้ + ประมาณการหน่วยที่ใช้)
- ออกใบขอเติม/เบิกถังใหม่เมื่อ stock เหลือน้อยกว่า threshold
- ผูกกับ Inventory Module C (T-12) ผ่าน outbound ledger — เช่นเดียวกับ T-26

**Before:** Module D มี 4 tasks (T-17, T-25, T-26, T-27), Raw MD 22, Adj MD 15.5  
**After:** Module D มี 5 tasks (T-17, T-25, T-26, T-27, T-56), Raw MD 27, Adj MD 18.5

## Impact

- `docs/task-breakdown/05-D-kitchen.md` — เพิ่มแถว T-56 ในตาราง Features/Tasks, เพิ่ม task detail section,
  อัปเดต effort table (R3 +5/+3, รวม Raw 22→27, Adj 15.5→18.5)
- `docs/task-breakdown/_index.md` — อัปเดต module 5 row: Tasks 4→5, Adj MD 15.5→18.5;
  อัปเดตยอดรวม 250→253

## Migration

N/A — ไม่มีการเปลี่ยนรูปร่าง persisted doc; เป็นการเพิ่ม task ในเอกสาร planning เท่านั้น
ไม่ bump `schema_v`

## Decision log

- 2026-06-18 — proposed และ approved โดย project owner; tracking method = CR file
- 2026-06-18 — implemented: 05-D-kitchen.md + _index.md updated
