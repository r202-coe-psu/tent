---
id: CR-178
title: ตั๋วเบิกวัตถุดิบครัว — เลือก lot ตอนปล่อยของ และตัดสต็อกราย lot (แนวเดียวกับ CR-175)
status: approved
date: 2026-10-21
requested_by: kong
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md §2.1 (`stock_ledger` — `lot_ref` บังคับสำหรับ `reason='requisition'` ที่อ้าง `requisition_ticket`)
  - docs/data/schema.md §2.29 (kitchen carve-out — dispatch ราย lot)
  - schema_v ไม่ bump (`stock_ledger` 6, `requisition_ticket` 1 — ไม่เปลี่ยนรูปร่าง doc)
  - frontend/src/lib/features/tickets/** (dispatch domain/data/application/ui)
  - frontend/src/lib/features/distribution/index.ts (export lot validation ผ่าน barrel)
  - frontend/src/lib/server/shelter-access-design.ts (`stock_ledger` reason `requisition`)
  - frontend/e2e/kitchen-meal.test.ts
---

# ตั๋วเบิกวัตถุดิบครัว — เลือก lot ตอนปล่อยของ และตัดสต็อกราย lot

**สรุป (TL;DR)**
- ตอนตั๋วครัวอยู่ `READY_FOR_DISPATCH` คลังต้องระบุว่าตัดแต่ละรายการจาก lot ไหน ก่อนกด "ปล่อยของและตัดสต็อก"
- ระบบเติม lot ให้อัตโนมัติตามลำดับ CR-143 และห้ามเลือก lot ที่หมดอายุ
- dispatch เขียน `stock_ledger` (`reason='requisition'`) หนึ่งแถวต่อ lot พร้อม `lot_ref` และใช้ `_id` แบบ deterministic
- ไม่เปลี่ยนรูปร่าง `requisition_ticket` และไม่ bump `schema_v`; เพิ่มกฎ VDU ให้แถว `requisition` ที่อ้างตั๋วต้องมี `lot_ref`

## Requirements

- **FR-1** — หน้าตั๋วครัวสถานะ `READY_FOR_DISPATCH` แสดงตัวเลือก lot ต่อรายการที่ `allocated_qty > 0` ให้ผู้ที่ปล่อยของได้ (`warehouse_staff` / `system_admin`) ใช้ `PhysicalLotPicker` ของ distribution ผ่าน barrel
- **FR-2** — ค่าเริ่มต้นของแต่ละรายการ = แผนจัดสรรอัตโนมัติจาก `rankLotsForIssue` + `planLotSplit` (ลำดับ CR-143 §A) จาก lot ที่ยังไม่หมดอายุ; คลังแก้ได้
- **FR-3** — lot ที่หมดอายุ (`isLotExpired`) เลือกไม่ได้ (CR-143 FR-A4)
- **FR-4** — ปุ่ม "ปล่อยของและตัดสต็อก" กดได้เมื่อทุกรายการที่ `allocated_qty > 0` ผ่าน `validateDispatchLotAllocations` (ผลรวม lot = `allocated_qty`, ไม่เกินยอดคงเหลือราย lot, ไม่ซ้ำ, ไม่หมดอายุ, lot มีจริง)
- **FR-5** — รายการ `allocated_qty = '0'` ไม่ต้องเลือก lot และไม่สร้าง ledger (คงตาม §2.29)
- **FR-6** — dispatch ตรวจซ้ำทุกรายการก่อนเขียน (อ่านยอดราย lot จริงด้วย `projectStockLotBalances`, ตัดแถวของตั๋วนี้เองออกเพื่อให้ retry ผ่าน) แล้วจึงเขียน; ไม่ผ่าน = ไม่เขียนอะไรเลย
- **FR-7** — เขียน `stock_ledger` หนึ่งแถวต่อ (รายการ, lot): `reason='requisition'`, `ref_id=requisition_ticket:{ulid}`, `qty` ลบ, `lot_ref` = lot ที่เลือก
- **FR-8** — `_id` ของแถว dispatch เป็น deterministic จาก (ticket, item, lot_ref) — กดซ้ำหรือ retry ต้องไม่ตัดสต็อกซ้ำ (แนวเดียวกับ CR-175 `deriveDeterministicLedgerId`)
- **FR-9** — VDU: `stock_ledger` `reason='requisition'` ที่ `ref_id` เป็น `requisition_ticket:` ต้องมี `lot_ref` รูปแบบ `stock_ledger:.+` และ `qty` เป็นทศนิยมลบ; แถวอ้าง `kitchen_requisition:` (legacy) ไม่บังคับ
- **FR-10** — stepper ขั้น "พร้อมจัดส่ง" อธิบายเป็น "คลังเลือก lot ปล่อยของ ตัดสต็อก"

## Acceptance

- ตั๋ว `READY_FOR_DISPATCH` เปิดมามี lot เติมไว้แล้วตามลำดับ CR-143; กดปล่อยของได้ทันทีเมื่อสต็อกพอ
- lot หมดอายุแสดงแต่เลือกไม่ได้; ถ้า lot ที่ยังใช้ได้ไม่พอ ปุ่มปล่อยของกดไม่ได้พร้อมข้อความเหตุผล
- ปล่อยของแล้วได้ ledger ต่อ lot ที่มี `lot_ref` ถูกต้อง; ยอดราย lot ในหน้าคลังลดตรง lot ที่เลือก
- retry dispatch ซ้ำไม่สร้างแถวซ้ำ
- VDU ปฏิเสธแถว `requisition` อ้างตั๋วที่ไม่มี `lot_ref` และยอมรับแถว legacy อ้าง `kitchen_requisition:`
- e2e `kitchen-meal` ผ่าน (ปล่อยของด้วย lot ที่ระบบเติมให้)

## Why

- dispatch ครัวเดิมเขียนแถว `requisition` ไม่มี `lot_ref` — ยอดราย lot ถูก replay แบบเดา (FEFO→FIFO legacy) อาจไม่ตรง lot ที่หยิบจริง และไม่ตามลำดับ CR-143
- ไม่มีการเช็กวันหมดอายุ — ตัดของหมดอายุให้ครัวได้
- `_id` สุ่ม — กดซ้ำอาจตัดสต็อกซ้ำ
- ระบบเบิกจ่ายพัสดุและอาหาร (CR-175) แก้ปัญหาเดียวกันแล้ว — ใช้กลไกเดียวกันให้คลังทำงานแบบเดียวทั้งสองระบบ

## Change

| | Before | After |
| --- | --- | --- |
| เลือก lot | ไม่มี | ขั้น `READY_FOR_DISPATCH` ตอนปล่อยของ (ค่าเริ่มต้น auto CR-143) |
| ledger ตอน dispatch | 1 แถว/รายการ, ไม่มี `lot_ref`, `_id` สุ่ม | 1 แถว/(รายการ, lot), มี `lot_ref`, `_id` deterministic |
| ตรวจหมดอายุ | ไม่ตรวจ | ห้าม lot หมดอายุ |
| VDU `requisition` | เช็ก prefix `ref_id` | + บังคับ `lot_ref` และ qty ลบ เมื่ออ้าง `requisition_ticket:` |
| `requisition_ticket` shape | — | ไม่เปลี่ยน (lot ไม่เก็บบนตั๋ว — แนว CR-175) |

## Impact

- **Docs:** `schema.md` §2.1 ตาราง reason + แถว `lot_ref`, §2.29 kitchen carve-out
- **Code:** tickets dispatch (domain/data/application/ui), distribution barrel export (`validateDispatchLotAllocations`, `sumDispatchAllocations`, `DispatchLotAllocation`), VDU + tests, e2e
- **Deploy:** ต้อง redeploy `_design/access`
- **นอกขอบเขต:** reservation claim กันแย่ง lot พร้อมกัน (เหมือน CR-175 Q5); การเลือก lot ตอนอนุมัติ (CR-058/CR-059/CR-118 เดิม) — ใช้ตอนปล่อยของแทน

## Migration

- ไม่ bump `schema_v`; แถว `requisition` เดิมที่ไม่มี `lot_ref` ยังอ่านได้และ replay แบบ legacy ตามข้อยกเว้น CR-143 §A (ยอดราย lot ของประวัติไม่เปลี่ยน)
- ตั๋วที่ค้าง `READY_FOR_DISPATCH` ก่อน deploy ปล่อยของได้ด้วย flow ใหม่ทันที (ไม่มีข้อมูลบนตั๋วต้อง migrate)

## Decision log

- 2026-10-21 — proposed: เลือก lot ที่ขั้นที่ 2 "พร้อมจัดส่ง" (ตอนปล่อยของ) เพราะเป็นคนหยิบของจริง (`warehouse_staff`), ผู้อนุมัติอาจเป็น `shelter_manager`; ค่าเริ่มต้นเติม lot อัตโนมัติเพื่อลดงานคลัง
- 2026-10-21 — approved โดย kong
