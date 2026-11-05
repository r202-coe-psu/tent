---
id: draft
title: ติ๊ก "ซื้อเอง" ตอนรับเข้า — stock_ledger.lot.self_purchased (schema_v 6 → 7)
status: proposed
date: 2026-11-05
requested_by: GitHub #1187
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §2.1 `stock_ledger.lot` (เพิ่ม `self_purchased`, schema_v 7 note, migration note)
  - schema_v stock_ledger 6 → 7 (additive, ไม่ backfill)
  - frontend/src/lib/features/operations/domain (Zod lot schema + superRefine, `createStockLedger`, ฟังก์ชันจัดประเภท lot, ฟังก์ชันสรุปยอดซื้อเอง)
  - frontend/src/lib/features/operations/ui (receive-stock-form, ledger table, stock table filter, item detail sheet, สรุปยอดซื้อเอง)
  - frontend/src/lib/server/shelter-access-design.ts — ไม่เปลี่ยน (`_design/access` ไม่ตรวจ `schema_v` ของ stock_ledger แบบเท่ากับ และไม่จำกัด key ของ `lot` นอก flow คืนของยืม)
  - worker projectors — ไม่เปลี่ยน, ไม่ bump `PROJECTION_VERSION`
why: เจ้าหน้าที่คลังแยกไม่ออกว่า lot ไหนศูนย์ซื้อมาเอง lot ไหนได้จากบริจาค/หน่วยงาน
migration: additive — แถว schema_v ≤ 6 ไม่มี field = ไม่ใช่ซื้อเอง; ไม่ backfill; ไม่ต้อง redeploy `_design/*`
---

# draft-self-purchased-lot-flag — ติ๊ก "ซื้อเอง" ตอนรับเข้าคลัง

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `stock_ledger.lot.self_purchased` (bool, optional) บนแถว `reason='receive'` ที่บันทึกจากฟอร์มรับเข้าหน้า supply เท่านั้น; bump `stock_ledger` schema_v **6 → 7**
> - **ทำไม:** แยกของที่ศูนย์ซื้อเองออกจากของบริจาค/หน่วยงาน เพื่อดูยอดซื้อเองและของซื้อเองที่คงเหลือ
> - **Dev ต้อง build:** checkbox ในฟอร์มรับเข้า, ป้าย/ตัวกรองในหน้า supply (ตารางคลัง, ledger, detail sheet), สรุปยอดซื้อเองตามช่วงวัน
> - **กระทบ:** schema.md §2.1 เท่านั้น. ไม่แตะ worker projector, ไม่ bump `PROJECTION_VERSION`, ไม่ต้อง redeploy `_design/*`
> - **ไม่ใช่ระบบจัดซื้อ:** ไม่มี PO / ราคา / ผู้ขาย — ไม่ขัดหลัก A6 และไม่ย้อน CR-138

---

## 1. Requirements

| ID    | Requirement                                                                                                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | `stock_ledger.lot.self_purchased`: `bool`, optional. ไม่มีค่า = ไม่ใช่ซื้อเอง                                                                                                                                                                                                       |
| FR-2  | มีค่านี้ได้เฉพาะแถว `reason='receive'` ที่เขียนจากฟอร์มรับเข้าหน้า supply (`receive-stock-form`). ฟอร์มครัวรับของ, การรับบริจาค (`reason='donation'`) และ scan-station ไม่มี checkbox และไม่เขียน field นี้                                                                              |
| FR-3  | Zod lot schema + `superRefine` (`operations/domain/operations.ts`) รับ `self_purchased` เฉพาะ `reason='receive'`; reason อื่นที่ส่ง field นี้มา — implement ตัดสินว่า strip หรือ reject แล้วเขียนเทสต์ล็อกพฤติกรรม (CR นี้ไม่บังคับทางใดทางหนึ่ง แต่ต้องไม่ persist ค่าลง reason อื่น)   |
| FR-4  | `createStockLedger` stamp `schema_v: 7`. ผู้เขียน ledger ทุกที่ที่ผ่าน factory นี้ stamp 7 (รวมแถวที่ไม่มี `self_purchased`)                                                                                                                                                          |
| FR-5  | **การจัดประเภท lot ว่า "ซื้อเอง"** (ตาม physical lot, `lot_ref`): (a) แถว `receive` ที่ `lot.self_purchased === true` → ซื้อเอง; (b) `distribution_return` ที่คืนเข้า `lot_ref` ของแถว (a) → ยังนับเป็นซื้อเองตาม `lot_ref`; (c) `transfer_in` ที่ศูนย์ปลายทาง → **ไม่** นับเป็นซื้อเอง (นับเฉพาะศูนย์ที่ซื้อ ไม่พก flag ข้ามศูนย์); (d) แถวที่ไม่มี field (รวมแถว schema_v ≤ 6) → ไม่ใช่ซื้อเอง |
| FR-6  | **Append-only:** แก้ flag หลังบันทึกไม่ได้. ติ๊กผิด → ใช้ flow ปรับยอด (`adjust`) แล้วรับเข้าใหม่ เหมือนข้อผิดพลาดอื่นของ ledger                                                                                                                                                       |
| FR-7  | UI (หน้า supply, `requireWarehouseAccess`, ศูนย์ตนเองเท่านั้น): (1) item detail sheet ป้าย "ซื้อเอง" ราย lot; (2) ตัวกรองตารางคลัง "ซื้อเอง" = สินค้าที่มี lot ซื้อเองคงเหลือ (qty > 0), เก็บใน URL state; (3) ledger: ป้าย/คอลัมน์ "ซื้อเอง" บนแถวรับเข้า + ตัวกรอง "รับเข้าที่ซื้อเอง"; (4) สรุปยอดซื้อเอง |
| FR-8  | **สรุปยอดซื้อเอง:** เลือกช่วงวันได้ โดยอิง `occurred_at`/`received_at` ของแถวรับเข้า ตามเวลา **Asia/Bangkok** (ขอบวัน 00:00 Asia/Bangkok); ตารางต่อสินค้า: สินค้า, ยอดรับเข้าที่ซื้อเองในช่วง, คงเหลือปัจจุบันจาก lot ซื้อเอง; หน่วย `base_unit`; นับเฉพาะศูนย์ตนเอง; ตำแหน่ง UI (แท็บ/section) ให้ dev เลือก |

## 2. Acceptance

- **AC-1** รับเข้าจากฟอร์ม supply โดยติ๊ก "ซื้อเอง" → แถว ledger มี `lot.self_purchased: true` และ `schema_v: 7`; ไม่ติ๊ก → ไม่มี field (ไม่เขียน `false`)
- **AC-2** แถว `reason` อื่นที่ส่ง `self_purchased` มา ไม่ถูก persist ด้วยค่านี้ (strip หรือ reject ตามที่ implement เลือก) — unit test
- **AC-3** ฟังก์ชันจัดประเภท: receive ที่ติ๊ก → ซื้อเอง; `distribution_return` เข้า `lot_ref` ซื้อเอง → ซื้อเอง; `transfer_in` → ไม่ใช่
- **AC-4** ฟังก์ชันสรุป: ขอบวัน Asia/Bangkok (เช่น 23:59 และ 00:00 ติดกัน) ถูกฝั่ง, `now` คงที่ใน test, ไม่นับ `transfer_in`
- **AC-5** `filterRows` ตัวเลือก "ซื้อเอง" คืนเฉพาะสินค้าที่มี lot ซื้อเองคงเหลือ > 0
- **AC-6** แถวเก่าไม่มี field อ่านได้ ไม่ throw และนับเป็นไม่ใช่ซื้อเอง

## 3. ทำไมไม่ขัด A6 / CR-138

- **A6** ([CR-058](05-D-kitchen/CR-058-food-warehouse-nutrition-kitchen-overhaul.md)) = ไม่มีระบบจัดซื้อ (Purchase Order) ในแอป. CR นี้ไม่มี PO, ราคา, ผู้ขาย, ใบเสร็จ หรือ workflow อนุมัติ — เป็นแค่ **ป้ายบอกที่มา** (provenance tag) บน lot ที่รับเข้าตามปกติ
- **CR-138** ถอน doc type `purchase` + `reason='purchase'` + UI ใบจัดซื้อ. CR นี้ **ไม่เพิ่ม `reason: purchase` กลับมา**, ไม่เพิ่ม doc type, ไม่เพิ่ม route จัดซื้อ; `reason` enum ไม่เปลี่ยน — ของซื้อเองยังเป็น `reason='receive'` เหมือนรับเข้าด้วยมือทั่วไป
- ผลคือ ledger ยังไม่ทราบว่าซื้อจากใคร/ราคาเท่าไร ทราบเพียงว่า "ศูนย์ซื้อเอง" หรือไม่

## 4. Spec delta — `docs/data/schema.md` §2.1 (pending CR นี้)

- `lot` เพิ่ม `self_purchased`: bool, opt, เฉพาะ `reason='receive'` จากฟอร์มรับเข้า supply (schema_v 7)
- เพิ่ม note **schema_v 7** + **Migration (schema_v 6 → 7)** ใน §2.1 (ทำเครื่องหมาย "รอ CR approve")
- `updated:` → 2026-11-05

## 5. Impact

- **Docs:** `docs/data/schema.md` §2.1
- **Code:** `operations` domain (Zod schema/refine, `createStockLedger`, classify + summary), data/application (receive mutation ส่ง flag), UI (form checkbox, tables, sheet, summary)
- **Tests:** unit (schema receive vs reason อื่น; classify; summary + ขอบวัน Asia/Bangkok; `filterRows`), API (`POST` receive ที่ติ๊ก → `lot.self_purchased: true`, `schema_v: 7`)
- **Worker / projection:** ตรวจ `worker/src/worker/projectors/*`, `donation_ledger.py`, `quota/reconcile.py`, `packages/tent-model` — ผู้อ่าน `stock_ledger` ใช้เฉพาะ `item_id`, `qty`, `reason`, `ref_id` (`compute_needs.py`, `needs.py`, `donation_ledger.py`); **ไม่มีที่ใดอ่าน `lot`** ⇒ output projection ไม่เปลี่ยน ⇒ **ไม่ต้อง bump `PROJECTION_VERSION`**
- **CouchDB `_design/access`:** `validate_doc_update` ของ `stock_ledger` ตรวจ `schema_v` แบบ `>= 6` เฉพาะเงื่อนไข adjust_reason และจำกัด key ของ `lot` เฉพาะแถวคืนของยืม (`counter_loan_return`) ⇒ แถว schema_v 7 ที่มี `lot.self_purchased` ผ่านเดิม ไม่ต้องแก้/redeploy
- **Ops:** ไม่ต้อง redeploy `_design/*`; deploy client ใหม่ได้ทันที (client เก่าที่ stamp 6 ยังอ่านได้)

## 6. Migration

**schema_v 6 → 7 (additive):** เพิ่ม `lot.self_purchased` (opt). **ไม่ backfill** — แถว schema_v ≤ 6 ที่ไม่มี field ถือเป็น "ไม่ใช่ซื้อเอง". Reader ต้องไม่ throw เมื่อไม่มี field. `stock_ledger` เป็น append-only จึงแก้แถวเดิมไม่ได้; ถ้าต้องการให้ของเดิมเป็น "ซื้อเอง" ต้องใช้ flow ปรับยอด/รับเข้าใหม่ (นอก scope)

## 7. Out of scope

- ราคา, ผู้ขาย, ใบเสร็จ, PO ทุกแบบ
- checkbox ในฟอร์มครัว, การรับบริจาค, scan-station
- การแก้ flag ย้อนหลัง
- การพก flag ข้ามศูนย์ตอนโอน (`transfer_in`)
- สรุปข้ามศูนย์หรือระดับกลาง

## Why

- ศูนย์ซื้อของเองเป็นบางครั้ง แต่ ledger ไม่บอกที่มา จึงตอบไม่ได้ว่าของไหนซื้อเอง/ได้จากบริจาค
- ใช้ flag บน lot (ไม่ใช่ reason ใหม่) เพื่อไม่ย้อน CR-138 และไม่กระทบสูตรยอดคงเหลือ

## Decision log

- 2026-11-05 — proposed (GitHub #1187) — รอเจ้าของโครงการเลือกวิธี track และ approve
