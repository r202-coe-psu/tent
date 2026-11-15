---
id: CR-038
title: Decimal qty strings — ความแม่นปริมาณก่อนขึ้นจริง
status: done
date: 2026-07-14
updated: 2026-11-14
requested_by: engineering
decided_by: Soravit Sukkarn (Team Lead)
layer: volatile
affects:
  - docs/data/schema.md §2.1–2.6, §2.7.1, §4.2–4.3
  - schema_v stock_ledger 1→2, stock_transfer 1→2, donation 2→3,
    donation_campaign 2→3, kitchen_requisition 1→2, gas_cylinder_type 1→2,
    item_master 2→3, recipe 2→3
  - frontend/src/lib/utils/qty.ts (+ decimal.js)
  - frontend/CONVENTIONS.md (qty / Decimal section)
  - frontend/CONTRIBUTING.md §4 (do-not-bypass qty rule)
  - features/operations, kitchen, donations, catalog
  - scripts/seed.ts, public/back-office donation APIs (item qty only)
---

# CR-038 — Decimal qty strings

## Why

JSON/JS `number` เป็น IEEE-754 — qty เพี้ยนตอนบวกสะสมและเทียบ stock
(`0.1+0.2`). ระบบยังไม่ขึ้นจริง ควรแก้ที่ชั้นเก็บค่า + คำนวณตาม best practice
ไม่ใช่แค่ปัด float ตอน runtime (`qty.ts` แบบเดิม)

## Change

### ชนิดใหม่

- **`qty_str`**: string `^-?\d+(\.\d{1,4})?$` — ปริมาณในหน่วยที่ field ระบุ
  (ledger = `base_unit`); canonical persist ผ่าน Decimal `toDecimalPlaces(4)`

### ค่าที่ผู้ใช้พิมพ์ในช่องจำนวน (form input) — amend 2026-11-14 (#938)

ช่องกรอกจำนวนในฟอร์มต่อไปนี้ต้องผ่าน `parseQtyInput` (`$lib/utils/qty`) ก่อนใช้งาน
(ขอบเขตของ #938 — `features/operations/ui`):

- `adjust-stock-form.svelte` (ปรับยอดสต็อก)
- `distribute-line-card.svelte` (แจกจ่าย)
- `donation-batch-receive.svelte` (รับของบริจาคแบบ batch)
- `transfer-form.svelte` (โอนสต็อก)

ฟอร์มจำนวนอื่น (เช่น `receive-stock-form.svelte` และฟอร์มนอก operations) **ยังไม่อยู่ในกฎนี้**
และยังรับค่าผ่าน `qtyStrCoerce*Schema` ซึ่งปัดเป็น 4 ตำแหน่งโดยไม่แจ้ง — ยกไปทำเป็น follow-up

กฎนี้ใช้กับ **input เท่านั้น** — รูปแบบ `qty_str` ที่ persist ข้างบนไม่เปลี่ยน

- regex: `^-?(\d{1,15}(\.\d{0,4})?|\.\d{1,4})$`
- ถ้าค่าที่อ่านได้จากช่องเป็น `.5` หรือ `5.` ให้ถือว่าถูกต้องและ normalize เป็น canonical
  `qty_str` เช่น `.5` → `0.5`, `5.` → `5` (บางเบราว์เซอร์อาจคืนค่าเหล่านี้จากช่อง
  `type="number"` เป็น `""` + `badInput` แทน ซึ่งจะเข้ากรณีปฏิเสธด้านล่าง)
- ส่วนจำนวนเต็มไม่เกิน **15 หลัก** — เผื่อ headroom ให้ค่าทศนิยม 4 ตำแหน่งยัง**เก็บและบวก/ลบได้ตรง**
  ภายใน precision 20 significant digits ของ decimal.js (การคูณ เช่นแปลงหน่วยด้วย multiplier
  ยังอาจถูกปัดได้ — ไม่อยู่ในขอบเขตของกฎนี้)
- ไม่รับ exponent (`1e3`), ทศนิยมเกิน 4 ตำแหน่ง, หรือค่าที่เบราว์เซอร์อ่านไม่ได้
  (`validity.badInput`) — ฟอร์มในรายการข้างบนต้องแสดง hint และไม่บันทึก ห้ามปัดเศษเงียบ

### Before → after (persist)

| Field | Before | After |
| --- | --- | --- |
| stock_ledger.qty | num | qty_str |
| donation.items[].qty | num | qty_str |
| donation_campaign.needs[].qty_target | num | qty_str |
| kitchen_requisition qty_* | num | qty_str |
| recipe.ingredients[].quantity + standard_* | num | qty_str |
| item_master.conversions[].multiplier, consumption_rate | num | qty_str |
| gas_cylinder_type capacity/burn/time_multiplier | num | qty_str |

### Runtime

- เพิ่ม `decimal.js`; `$lib/utils/qty` เป็น facade เดียวสำหรับบวก/ลบ/เทียบ/persist
- สร้าง Decimal จาก **string** เป็นหลัก; UI ส่ง string ไม่ใช่ `Number(x)` ก่อน
- `stock_balance` = client sum ด้วย Decimal (ไม่พึ่ง `_sum` ของ float ใน view)

### Team conventions

- [`frontend/CONVENTIONS.md`](../../../frontend/CONVENTIONS.md) — section Quantity arithmetic (§6)
- [`frontend/CONTRIBUTING.md`](../../../frontend/CONTRIBUTING.md) §4 — do-not-bypass bullet + Do not list

### คงเดิม / นอกขอบเขต

- `meal_plan.recipes[].planned_qty` เป็น **int กรัม**
- **เงิน:** ระบบไม่เก็บเงิน — CR นี้ไม่แตะ `amount_thb` / `kind=money` (ลบเงินออกจาก domain = CR แยกถ้าต้องการ)
- `sop_profile` / `sop_override` ratios และ `daily_calc` snapshots — follow-up

## Impact

- Spec: schema.md, data-model.md, schema-er-diagram.md (qty fields)
- Team docs: CONVENTIONS.md, CONTRIBUTING.md
- Code: operations, kitchen, donations item qty (+ public APIs), catalog, seed, qty utils/tests
- Breaking สำหรับ client/API ที่ส่ง qty เป็น JSON number

## Migration

ไม่มี production data → re-seed / wipe local CouchDB หลัง merge
ไม่มี lazy dual-read บังคับใน CR นี้

## Decision log

- 2026-07-14 — proposed (draft ในแผน refactor)
- 2026-07-14 — ตัดเงิน/satang ออกจากขอบเขต (ระบบไม่เก็บเงิน)
- 2026-07-14 — เพิ่ม team docs CONVENTIONS + CONTRIBUTING
- 2026-07-14 — done (implemented: decimal.js + qty_str migration + docs)
- 2026-11-14 — amend: เพิ่มกฎ form input (`parseQtyInput`) — รับ `.5`/`5.`, เพดาน 15 หลัก,
  ปฏิเสธ exponent/badInput แทนการปัดเศษเงียบ (#938, PR #1345) — ใช้กับ 4 ฟอร์มใน operations
  ที่ PR นี้แก้เท่านั้น ฟอร์มอื่นเป็น follow-up; แนวทางนี้เลือกโดย Soravit Sukkarn (Team Lead)
