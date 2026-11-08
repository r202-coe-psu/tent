---
id: CR-234
title: ติ๊ก "ซื้อเอง" ตอนรับเข้า — stock_ledger.lot.self_purchased (schema_v 6 → 7)
status: approved
date: 2026-11-05
requested_by: GitHub #1187
decided_by: kong
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

# CR-234 — ติ๊ก "ซื้อเอง" ตอนรับเข้าคลัง

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `stock_ledger.lot.self_purchased` (bool, optional) บนแถวรับเข้าที่ฟอร์มรับเข้าหน้า supply บันทึก (โหมด "กรอกเอง" = `reason='adjust'` + `adjust_reason='found'`, CR-156 FR-C7) เท่านั้น; bump `stock_ledger` schema_v **6 → 7**
> - **ทำไม:** แยกของที่ศูนย์ซื้อเองออกจากของบริจาค/หน่วยงาน เพื่อดูยอดซื้อเองและของซื้อเองที่คงเหลือ
> - **Dev ต้อง build:** checkbox ในฟอร์มรับเข้า, ป้าย/ตัวกรองในหน้า supply (ตารางคลัง, ledger, detail sheet), สรุปยอดซื้อเองตามช่วงวัน
> - **กระทบ:** schema.md §2.1 เท่านั้น. ไม่แตะ worker projector, ไม่ bump `PROJECTION_VERSION`, ไม่ต้อง redeploy `_design/*`
> - **ไม่ใช่ระบบจัดซื้อ:** ไม่มี PO / ราคา / ผู้ขาย — ไม่ขัดหลัก A6 และไม่ย้อน CR-138

---

## 1. Requirements

| ID    | Requirement                                                                                                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | `stock_ledger.lot.self_purchased`: `bool`, optional; เขียนเป็น `true` หรือไม่เขียน (ไม่เขียน `false`). ไม่มีค่า = ไม่ใช่ซื้อเอง                                                                                                                                                                                                    |
| FR-2  | มีค่านี้ได้เฉพาะแถว **`reason='adjust'` + `adjust_reason='found'`** ที่เพิ่มยอด (qty > 0) ซึ่งเป็นสิ่งที่ฟอร์มรับเข้าหน้า supply โหมด "กรอกเอง" บันทึก (CR-156 FR-C7). **ฟอร์มรับเข้านี้เป็นที่เดียวที่แสดง checkbox และส่ง flag** — dialog ปรับยอด (แม้เลือก `found` ตอนนับสต็อก) ไม่มี checkbox และไม่เขียน field นี้. แถว `reason='receive'` ทุกแบบ (ผลผลิตครัว, ของเหลือคืนจากตั๋ว CR-208, ของยืมคืน CR-161, กองรวม) **ห้าม**มี field นี้ — ของคืนนับซื้อเองผ่าน `lot_ref` ตาม FR-5 แทน. โหมดรับบริจาค (`reason='donation'`), ฟอร์มครัวรับของ และ scan-station ไม่มี checkbox และไม่เขียน field นี้ |
| FR-3  | Zod (`stockLedgerInputSchema.superRefine`) **reject** `lot.self_purchased: true` เมื่อ reason/qty ไม่เข้าเงื่อนไข FR-2 (ตัดสินแล้ว: reject ไม่ strip — ตามแบบ `adjust_reason`/`note` ที่ห้ามบน reason อื่น); `self_purchased: false` ถูกตัดทิ้งโดย `createStockLedger` (ไม่ persist `false`). `receiveInputSchema` สะท้อนกติกาเดียวกันเพื่อ UX (ใช้ได้เฉพาะ `source='manual'`) |
| FR-4  | `createStockLedger` stamp `schema_v: 7`. ผู้เขียน ledger ทุกที่ที่ผ่าน factory นี้ stamp 7 (รวมแถวที่ไม่มี `self_purchased`)                                                                                                                                                          |
| FR-5  | **การจัดประเภท lot ว่า "ซื้อเอง"** (ตาม physical lot, `lot_ref`): (a) แถวรับเข้าตาม FR-2 ที่ `lot.self_purchased === true` → ซื้อเอง (นับจากแถวต้นทางของ lot เท่านั้น แถว `transfer_in` ที่มี flag หลุดมาก็ไม่นับ); (b) `distribution_return` ที่คืนเข้า `lot_ref` ของแถว (a) → ยังนับเป็นซื้อเองตาม `lot_ref`; (c) `transfer_in` ที่ศูนย์ปลายทาง → **ไม่** นับเป็นซื้อเอง (นับเฉพาะศูนย์ที่ซื้อ ไม่พก flag ข้ามศูนย์); (d) แถวที่ไม่มี field (รวมแถว schema_v ≤ 6) → ไม่ใช่ซื้อเอง |
| FR-6  | **Append-only:** แก้ flag หลังบันทึกไม่ได้. ติ๊กผิด → ใช้ flow ปรับยอด (`adjust`) แล้วรับเข้าใหม่ เหมือนข้อผิดพลาดอื่นของ ledger                                                                                                                                                       |
| FR-7  | UI (หน้า supply, `requireWarehouseAccess`, ศูนย์ตนเองเท่านั้น): (1) item detail sheet ป้าย "ซื้อเอง" ราย lot; (2) ตัวกรองตารางคลัง "ซื้อเอง" = สินค้าที่มี lot ซื้อเองคงเหลือ (qty > 0), เก็บใน URL state; (3) ledger: แถวรับเข้าที่ซื้อเองเป็นกลุ่ม "ซื้อเอง" ของตัวเอง — ดู FR-9 (A1); (4) สรุปยอดซื้อเอง |
| FR-8  | **สรุปยอดซื้อเอง:** เลือกช่วงวันได้ โดยอิง `occurred_at`/`received_at` ของแถวรับเข้า ตามเวลา **Asia/Bangkok** (ขอบวัน 00:00 Asia/Bangkok); ตารางต่อสินค้า: สินค้า, ยอดรับเข้าที่ซื้อเองในช่วง, คงเหลือปัจจุบันจาก lot ซื้อเอง; หน่วย `base_unit`; นับเฉพาะศูนย์ตนเอง; ตำแหน่ง UI (แท็บ/section) ให้ dev เลือก |
| FR-9 (A1) | **กลุ่ม "ซื้อเอง" ใน ledger (แท็บความเคลื่อนไหว):** แถวที่เป็นการรับเข้าซื้อเองตาม FR-5(a) (`adjust`/`found` + `lot.self_purchased === true` + qty > 0) จัดเป็นกลุ่มที่ 5 **"ซื้อเอง"** แทนกลุ่ม "ปรับยอด": (a) การ์ดสรุปเพิ่มใบ "ซื้อเอง" (นับจำนวนรายการ) และแถวเหล่านี้**ไม่นับ**ในการ์ด "ปรับยอด"; (b) ป้ายประเภทของแถวเป็น "ซื้อเอง" แทน "ปรับปรุงคลัง"; (c) ตัวกรองประเภทมีตัวเลือก "ซื้อเอง" และตัวกรอง "รับเข้าที่ซื้อเอง" (`lsp=1`) ถูกแทนที่ด้วยตัวกรองประเภทนี้ (`type=self_purchased`). **ไม่เปลี่ยน** `reason`/`adjust_reason` ที่บันทึก (ยัง `adjust`/`found` ตาม CR-156 FR-C7), ไม่เปลี่ยนยอดคงเหลือ, ไม่เปลี่ยน schema_v. แถว `adjust`/`found` ที่ไม่ได้ติ๊กซื้อเองยังเป็น "ปรับยอด" |

## 2. Acceptance

- **AC-1** รับเข้าจากฟอร์ม supply (โหมดกรอกเอง) โดยติ๊ก "ซื้อเอง" → แถว ledger (`adjust`/`found`) มี `lot.self_purchased: true` และ `schema_v: 7`; ไม่ติ๊ก → ไม่มี field (ไม่เขียน `false`)
- **AC-2** `self_purchased: true` บน reason อื่น (receive, donation, transfer_in, distribute, distribution_return, adjust ที่ไม่ใช่ found) ถูก reject (reject) — unit test
- **AC-3** ฟังก์ชันจัดประเภท: แถวรับเข้า `adjust`/`found` ที่ติ๊ก → ซื้อเอง; `distribution_return` เข้า `lot_ref` ซื้อเอง → ซื้อเอง; `transfer_in` → ไม่ใช่
- **AC-4** ฟังก์ชันสรุป: ขอบวัน Asia/Bangkok (เช่น 23:59 และ 00:00 ติดกัน) ถูกฝั่ง, `now` คงที่ใน test, ไม่นับ `transfer_in`
- **AC-5** `filterRows` ตัวเลือก "ซื้อเอง" คืนเฉพาะสินค้าที่มี lot ซื้อเองคงเหลือ > 0
- **AC-6** แถวเก่าไม่มี field อ่านได้ ไม่ throw และนับเป็นไม่ใช่ซื้อเอง
- **AC-7 (A1)** แถว `adjust`/`found` ที่ติ๊กซื้อเอง → กลุ่ม "ซื้อเอง" (การ์ด "ซื้อเอง" +1, การ์ด "ปรับยอด" ไม่เพิ่ม, ป้ายแถว "ซื้อเอง"); `adjust`/`found` ที่ไม่ติ๊ก → "ปรับยอด" เหมือนเดิม; ตัวกรองประเภท "ซื้อเอง" คืนเฉพาะแถวกลุ่มนี้ และ round-trip ผ่าน `type=self_purchased` — unit test

## 3. ทำไมไม่ขัด A6 / CR-138

- **A6** ([CR-058](../05-D-kitchen/CR-058-food-warehouse-nutrition-kitchen-overhaul.md)) = ไม่มีระบบจัดซื้อ (Purchase Order) ในแอป. CR นี้ไม่มี PO, ราคา, ผู้ขาย, ใบเสร็จ หรือ workflow อนุมัติ — เป็นแค่ **ป้ายบอกที่มา** (provenance tag) บน lot ที่รับเข้าตามปกติ
- **CR-138** ถอน doc type `purchase` + `reason='purchase'` + UI ใบจัดซื้อ. CR นี้ **ไม่เพิ่ม `reason: purchase` กลับมา**, ไม่เพิ่ม doc type, ไม่เพิ่ม route จัดซื้อ; `reason` enum ไม่เปลี่ยน — ของซื้อเองยังบันทึกเป็นรับเข้าด้วยมือตามเดิม (`adjust`/`found`)
- ผลคือ ledger ยังไม่ทราบว่าซื้อจากใคร/ราคาเท่าไร ทราบเพียงว่า "ศูนย์ซื้อเอง" หรือไม่

## 4. Spec delta — `docs/data/schema.md` §2.1 (pending CR นี้)

- `lot` เพิ่ม `self_purchased`: bool, opt, เฉพาะแถว `adjust`+`found` (qty > 0) จากฟอร์มรับเข้า supply ตาม FR-2 (schema_v 7)
- เพิ่ม note **schema_v 7** + **Migration (schema_v 6 → 7)** ใน §2.1
- `updated:` → 2026-11-05

## 5. Impact

- **Docs:** `docs/data/schema.md` §2.1
- **Code:** `operations` domain (Zod schema/refine, `createStockLedger`, classify + summary), data/application (receive mutation ส่ง flag), UI (form checkbox, tables, sheet, summary)
- **Tests:** unit (schema แถว `adjust`/`found` จากฟอร์มรับเข้า vs reason อื่น รวม `receive`; classify; summary + ขอบวัน Asia/Bangkok; `filterRows`), API (`POST` receive ที่ติ๊ก → `lot.self_purchased: true`, `schema_v: 7`)
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

- 2026-11-05 — proposed (GitHub #1187)
- 2026-11-06 — approved โดย kong (เลข CR-234: CR-233 ถูกจองโดย PR #1221)
- 2026-11-06 — kong ตัดสิน (review PR #1194): flag มีเฉพาะจากฟอร์มรับเข้าหน้า supply → FR-2 ตัด `reason='receive'` ออก (ตรงกับ VDU ที่จำกัด key `lot` ของแถวคืนของยืม) และ dialog ปรับยอดไม่มี checkbox
- 2026-11-07 — **Amendment A1** approved โดย kong (review PR #1195): การ์ดสรุป ledger "รับเข้า 0 / ปรับยอด 1" สับสนเมื่อรับเข้าซื้อเอง → เพิ่มกลุ่ม/การ์ด "ซื้อเอง" (FR-9) ไม่เปลี่ยน `reason` ที่บันทึก; แทนที่ตัวกรอง `lsp=1`
