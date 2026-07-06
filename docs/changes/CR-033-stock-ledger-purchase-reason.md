---
id: CR-033
title: "Add purchase reason to stock_ledger"
status: proposed
date: 2026-07-05
updated: 2026-07-06
requested_by: development team C
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.1
  - schema_v stock_ledger 1 → 2
  - frontend/src/lib/features/operations/domain/operations.ts
  - frontend/src/lib/features/operations/data/operations.pouch.ts
  - frontend/src/lib/features/operations/ui/ReceiveStockForm.svelte
---

# CR-033 — Add purchase reason to stock_ledger

> [!NOTE]
> **สรุป (TL;DR):** เพิ่ม `purchase` เข้าไปใน enum `reason` ของ `stock_ledger` เพื่อรองรับการรับสต็อกจากแหล่ง "จัดซื้อจัดจ้าง" แยกจากเงินบริจาค · schema_v stock_ledger 1→2 · **ยังไม่ merge เข้าโค้ด — รอ sign-off จริงจาก @net-lynx**

## Why

Task T-11 (Stock receive + ledger write) ต้องรองรับการรับสต็อกจากแหล่ง "จัดซื้อจัดจ้าง" (purchase) เพิ่มจากเดิมที่มีแค่บริจาคและโอนย้าย แต่ `stock_ledger.reason` ใน `docs/data/schema.md` มีแค่ `donation`, `transfer_in`, `receive`, และ `adjust` เท่านั้น

## Change

1. เพิ่ม `purchase` เข้าไปในค่า `reason` ที่อนุญาตของ `stock_ledger` schema
2. Bump `schema_v` ของ `stock_ledger` จาก `1` เป็น `2`
3. Map ค่า `purchase` source ตรงไปยัง reason `purchase`

### Alternatives considered

- **Map ไปที่ `receive` แทน**: ตอนแรก map `purchase` ไปที่ `receive` แต่จะทำให้เสียข้อมูลเชิงประวัติ ทำให้ dashboard/BI (T-14) แยกไม่ออกระหว่างเงินบริจาคกับการจัดซื้อ

## Impact

- **Data Model:** `docs/data/schema.md` §2.1 — `stock_ledger` `schema_v` 1→2 พร้อม reason ใหม่
- **Domain Layer:** `receiveSourceSchema` และ `createReceiveEntry` ต้องรองรับ `purchase`; `createStockLedger` ต้อง stamp `schema_v 2`
- **UI Layer:** ตัวเลือกใน `ReceiveStockForm` เพิ่ม "จัดซื้อ / หน่วยงานรัฐ"

## Migration

schema_v 1→2 เป็นการเพิ่ม enum value ใหม่เท่านั้น ไม่มีการเปลี่ยนโครงสร้างฟิลด์ — เอกสารเดิมที่มี `schema_v: 1` ยังอ่าน/ใช้งานได้ปกติ ไม่ต้อง backfill

## Decision log

- 2026-07-05 — proposed; renumbered CR-031 → CR-032 (CR-031 ถูกใช้โดย develop สำหรับ item master schema reconciliation)
- 2026-07-05 — มาร์กเป็น accepted ในโค้ดโดยไม่มีหลักฐาน sign-off จริงจาก @net-lynx
- 2026-07-06 — ตรวจพบว่าไม่มี sign-off จริง; revert สถานะกลับเป็น proposed และถอนโค้ด/schema.md ที่ ship ไปแล้ว (`purchase` reason, `schema_v 2`) ออกจนกว่าจะอนุมัติจริง
- 2026-07-06 — renumbered CR-032 → CR-033 (ชนกับ CR-032 donation-campaign-cutoff-rules)
