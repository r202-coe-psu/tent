---
id: draft
title: public_needs — เก็บปริมาณเป็น Decimal128 และส่ง API เป็น qty_str
status: proposed
date: 2026-11-05
requested_by: "PO decision 2026-10-27 (#794) — Mongo projection คำนวณและเก็บเป็น Decimal128; issue #934"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/couchdb-mongodb-sync.md §3.2 (public_needs)
  - PROJECTION_VERSION 16 → 17
  - packages/tent-model/src/tent_model/{public_need.py,qty.py}
  - worker/src/worker/projectors/{compute_needs.py,needs.py}
  - worker/src/worker/{donation_ledger.py,mongo/on_hand.py,projection_version.py}
  - backend/apiapp/modules/needs/use_case.py
why: projection public_needs บวก/เทียบยอดคงคลังด้วย float แล้วเก็บเป็น double ทำให้ค่าเพี้ยน (0.1+0.2) และ API ส่ง "5.0" / "1e-05" ไม่ตรง qty_str ของ CR-038
migration: ไม่ bump schema_v (Mongo projection ไม่ใช่ doc ใน CouchDB) — bump PROJECTION_VERSION 16 → 17 ให้ worker bootstrap เขียนแถว double เดิมทับเป็น Decimal128
---

# public_needs — เก็บปริมาณเป็น Decimal128 และส่ง API เป็น qty_str

อ้างอิง: [CR-038](01-core/CR-038-decimal-qty-strings.md) (qty_str), issue #934, parent #794

## Why

CR-038 ย้าย qty ทุกตัวใน CouchDB เป็น `qty_str` และคำนวณด้วย Decimal แล้ว แต่ projection `public_needs`
(ยอดที่ศูนย์ต้องการรับบริจาค) ยังหลงเหลือเส้นทาง float:

- worker (`compute_needs.py`) บวก `stock_ledger.qty` ด้วย `float` ทั้งที่มี Decimal อยู่แล้วใน
  `donation_ledger` → `0.1 + 0.2 = 0.30000000000000004`; need ที่ target `1` กับ on-hand `0.9 + 0.1`
  เหลือ `1.1e-16` จึง**ไม่ถูกลบ** (การลบแถวที่ `≤ 0` ตัดสินด้วย float)
- Mongo เก็บ `qty_needed` / `qty_target` / `on_hand` / `reserved` เป็น `double`
- FastAPI `GET /public/v1/needs` ส่ง `str(float)` → `"5.0"`, `"1e-05"` ไม่ตรง `qty_str`
  (`^-?\d+(\.\d{1,4})?$`)

PO ตัดสินใจ (2026-10-27, #794): **"Mongo projection คำนวณและเก็บเป็น Decimal128 (ไม่ใช่แค่ปัดตอนส่ง API)
+ bump PROJECTION_VERSION + bootstrap"**

## Change

### Before → after

| ชั้น | Before | After |
| --- | --- | --- |
| worker คำนวณ (`compute_needs`, `need_breakdown`) | `float` (`on_hand_by_item`, `_to_float`) | `Decimal` (`on_hand_decimals` ย้ายไป `worker.donation_ledger`) |
| Mongo `public_needs.qty_needed/qty_target/on_hand/reserved` | `double` | `Decimal128` (`DecimalAnnotation` แบบเดียวกับ `donation_need_counter`) |
| ลบแถวเมื่อ `qty_needed ≤ 0` | เทียบ float | ปัด 4 ตำแหน่ง (ROUND_HALF_UP) **ก่อน** แล้วเทียบ Decimal |
| API `qty_needed/qty_target/on_hand/reserved` | `str(float)` เช่น `"5.0"`, `"1e-05"` | `qty_str` — ปัด 4 ตำแหน่ง ไม่มี exponent ไม่มี trailing zero เช่น `"5"`, `"0.3"` |
| API `status` open/closed | `qty_needed > 0` (float) | เทียบค่าที่ปัดแล้ว (ตรงกับตัวเลขที่พิมพ์) |
| `/external/v1/needs` (รวมการ์ดกลับเป็นรายการต่อ item) | บวก float | บวก Decimal แล้วปัดตอนส่ง |

### กติกา

- ปัด 4 ตำแหน่งก่อนตัดสิน `≤ 0` และ open/closed เพื่อให้ status กับตัวเลขที่แสดงตรงกัน
  (เศษ `0.00001` พิมพ์เป็น `"0"` จึงต้องเป็น `closed` / ไม่คงแถว)
- ค่า non-finite (`NaN`, `Infinity`) ใน ledger / target / donation qty นับเป็น 0 — ไม่ raise
- ตัว format `qty_str` ใช้ร่วมกัน worker + backend ที่ `tent_model.qty` (`quantize_qty`, `format_qty`,
  `canonical_qty`) ให้ semantics ตรง `persistQty` (`frontend/src/lib/utils/qty.ts`) และ
  `_persist_qty` ของ `worker/donation_close.py`
- ไม่เปลี่ยนชนิดใน OpenAPI (field เป็น `string` อยู่แล้ว) → ไม่ต้อง `pnpm openapi:update`

### คงเดิม / นอกขอบเขต

- `shelter_stocks` / EXT-004 / EXT-006 — #940
- `donations/use_case.py` ที่ใช้ `str(Decimal)` — แยกต่างหาก
- สูตร shortage (`target − (on_hand + reserved)`) ไม่เปลี่ยน — ยังตรงกับ `packages/needs-fixtures`

## Impact

- Spec: `docs/data/couchdb-mongodb-sync.md` §3.2 (`public_needs` ชนิด field)
- Code: `tent-model` (`public_need.py`, `qty.py` ใหม่), worker projector + `projection_version.py`,
  backend `needs/use_case.py`
- Test: worker `test_projectors.py`, `test_retention.py`, `test_ledger_schema_v6.py`,
  `projectors/test_needs_decimal.py` (ใหม่); backend `test_needs_cards.py`
- Frontend: parse string ด้วย decimal.js อยู่แล้ว — `"5"` แทน `"5.0"` ไม่กระทบ
- **Deploy worker + backend พร้อมกัน**: backend เก่า (field `float`) อ่าน `Decimal128` ไม่ได้
- ทับซ้อนกับ [draft-public-needs-inventory-terms](draft-public-needs-inventory-terms.md)
  (ซึ่งเปิด `qty_target` / `on_hand` / `reserved` ออกสู่ public) — ฉบับนั้นกำหนด field ที่ส่งออก
  ส่วนฉบับนี้กำหนดชนิด/การเก็บ/การ format ของ field เดียวกัน ไม่ขัดกัน

## Migration

ไม่ bump `schema_v`. bump `PROJECTION_VERSION` 16 → 17: worker เริ่มแล้วเห็นเลขต่ำกว่าจึง bootstrap เต็ม
ซึ่งเขียนทับแถวที่เก็บเป็น `double` เดิมเป็น `Decimal128` (`apply_document` get → set → save). แถวที่ยังเป็น
`double` ระหว่างนั้นยังอ่านได้ (pydantic แปลง double → Decimal) และ API ปัดเป็น `qty_str` ให้. ถ้า #940
merge ก่อน ให้ bump ต่อจากเลขนั้น.

## Decision log

- 2026-10-27 — PO decision (#794): เก็บเป็น Decimal128 + bump PROJECTION_VERSION + bootstrap
- 2026-11-05 — proposed (draft; เจ้าของโครงการเลือกติดตามด้วย draft CR ไม่ลงเลข CR และไม่ลง `_index.md`)
