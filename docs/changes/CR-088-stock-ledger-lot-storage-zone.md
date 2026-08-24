---
id: CR-088
title: stock_ledger.lot — เพิ่ม lot_no (L-YYMMDD-XXX) และ storage_zone สำหรับขั้นตรวจรับบริจาค (T-16 R-16.5)
status: proposed
date: 2026-08-25
requested_by: Team A (T-16 implementation) / Kunanon Nusaeng
decided_by: <รอเจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §2.1 stock_ledger (field `lot`)
  - schema_v stock_ledger 3 → 4
  - frontend/src/lib/features/operations/domain/operations.ts (StockLot, stockLedgerInputSchema, stockLedgerDocSchema)
  - frontend/src/routes/(protected)/back-office/stock-donations/components/scan-station.svelte
  - frontend/src/routes/api/back-office/donations/[query]/+server.ts
---

# CR-088 — stock_ledger.lot: lot_no + storage_zone

## Why

`docs/task-breakdown/04-donation.md` §T-16 ("CR-048 UI Split" — จริงๆ คือ CR-052 Design V8, ดู
B-3 ในบันทึกสถานะ T-16) ระบุว่าแท็บ "กำลังตรวจรับ (Verifying Drop-off)" ต้องกระทบยอดพัสดุจริงโดย
กรอกจำนวนจริง, เลือก**โซนจัดเก็บ**, วันหมดอายุ, และ Gen **เลขล็อต** `L-YYMMDD-XXX` — แต่ระบุไว้แค่ใน
เนื้อหา task DoD กับ glossary ของ CR-052 (`docs/changes/CR-052-donation-system-design-v8.md`,
"Technical Terms & Footnotes" ข้อ 4) เท่านั้น ไม่เคยถูกสเปคเป็น field จริงใน `schema.md` เลย —
`StockLot` ตอนนี้มีแค่ `{ expiry?, note? }` ไม่มีที่เก็บสองอย่างนี้เป็น field

## Change

เพิ่ม 2 field ใน `StockLot`, optional ทั้งคู่เหมือน `expiry`/`note` เดิม:

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `lot_no` | `str` | opt | รูปแบบ `L-YYMMDD-XXX` — `YYMMDD` จากวันที่รับจริง, `XXX` = ลำดับ 3 หลัก ต่อวันต่อศูนย์ นับจาก `stock_ledger` ที่มีอยู่แล้ว +1 (label อ้างอิงเฉยๆ ไม่ผูกกับ business rule ใด ชนกันได้ในเคสรับพร้อมกันแบบหายาก ยอมรับความเสี่ยงนี้ได้) |
| `storage_zone` | `str` | opt | ชื่อโซนจัดเก็บ — free text, ยังไม่มี master data โซนแยกต่างหาก |

## Impact

- **Docs**: `schema.md` §2.1 (`lot` object เพิ่ม 2 field, schema_v bump)
- **Code**: `StockLot`/`stockLedgerInputSchema`/`stockLedgerDocSchema` เพิ่ม field, `scan-station.svelte`
  เพิ่ม input โซน + แสดงเลขล็อตที่ระบบ gen ให้, `[query]/+server.ts` gen `lot_no` ฝั่ง server ตอนเขียน
  ledger
- **Test**: format ของ `lot_no` ตรง `L-YYMMDD-XXX` เสมอ

## Migration

`stock_ledger` เดิมไม่มี `lot.lot_no`/`lot.storage_zone` — field ใหม่ optional ทั้งคู่ ไม่ต้อง backfill

## Decision log

- 2026-08-25 — proposed
