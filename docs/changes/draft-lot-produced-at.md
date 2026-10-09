---
id: draft
title: stock_ledger.lot.produced_at — วัน/เวลาผลิต (shares schema_v 5 with CR-139)
status: proposed
date: 2026-09-26
requested_by: Inventory & Warehouse UX (stock movement clocks)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.1
  - schema_v stock_ledger 4 → 5 (shared with CR-139 storage_point_id)
  - frontend/src/lib/features/operations/domain (StockLot, createStockLedger, lot-age helpers)
  - frontend/src/lib/features/operations/ui (receive/distribute/adjust + stock-table clocks)
why: >
  แสดงนาฬิกา "จากผลิต" บนแถวคลัง / lot picker / ledger ต้องมี timestamp ผลิตบน lot;
  default = เวลาเข้าคลัง (occurred_at) เมื่อผู้ใช้ไม่แก้ตอนรับเข้า
migration: >
  Additive optional field — แถว schema_v≤4 อ่านได้ตามปกติโดยไม่มี produced_at (ไม่โชว์นาฬิกาจากผลิต).
  ไม่ backfill. Writer ใหม่ stamp schema_v 5 และใส่ produced_at ตอนรับเข้าถ้าไม่ระบุ.
  schema_v 5 ใช้ร่วมกับ CR-139 (storage_point_id) — ไม่ bump เป็น 6
---

# draft-lot-produced-at — `lot.produced_at` + `stock_ledger` schema_v 5

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `lot.produced_at` (ts, opt) บน `stock_ledger.lot` และใช้
>   `stock_ledger` `schema_v` **5** ร่วมกับ [CR-139](00-baseline/CR-139-shelter-storage-points.md)
>   (`storage_point_id`) — ไม่ bump เป็น 6
> - **เพื่อใคร/ทำไม:** UX คลังต้องการนาฬิกาอายุ — ในคลัง / เหลือหมดอายุ / จากผลิต
> - **Default รับเข้า:** ถ้าผู้ใช้ไม่กรอก → `produced_at = occurred_at`
> - **Expiry:** คง conditional ตาม schema เดิม (บังคับเมื่อ perishable / รับจาก `meal_service`);
>   ของทั่วไป UI ไม่บังคับ
> - **Migration:** ไม่ backfill; แถวเก่าอ่านได้; writer ใหม่ stamp 5

---

## 1. Spec delta (`docs/data/schema.md` §2.1)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `lot.produced_at` | ts | opt | วัน/เวลาผลิต; ตอนรับเข้าถ้าไม่ส่ง → default = `occurred_at` |

- `lot` object shape: `{ expiry?, note?, lot_no?, storage_zone?, storage_point_id?, produced_at? }`
- schema_v banner: **schema_v 5** — `storage_point_id` (CR-139) + `produced_at` (draft นี้)

## 2. Expiry policy note (ไม่เปลี่ยน invariant)

- `lot.expiry` ยัง **conditional req** เมื่อ `item_master`/`supply_item` perishable หรือ
  `reason='receive'` จาก `meal_service:` (CR-121)
- UI ของทั่วไป (non-perishable) **ไม่บังคับ** กรอกวันหมดอายุ — สอดคล้อง schema เดิม

## 3. Writer / reader

- `createStockLedger` (และ receive helpers ที่ผ่านมัน) stamp `schema_v: 5`
- แถว inbound ใหม่: ถ้ามี `lot` หรือสร้าง lot เปล่าสำหรับ inbound และไม่มี `produced_at` →
  เติม `produced_at` จาก `occurred_at`
- `stockLedgerDocSchema` อ่านได้ทั้ง schema_v 2|3|4|5

## 4. Out of scope

- Rename draft → `CR-NNN-…` + `_index.md` จนกว่า owner อนุมัติเลข
- Batch backfill `produced_at` บนแถวเก่า
- Bumping `produced_at` alone to schema_v 6 (shares v5 with CR-139)
