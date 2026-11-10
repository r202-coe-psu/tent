---
id: CR-246
title: shelter_stocks — เก็บ quantity_on_hand / reorder_threshold เป็น Decimal128 และ EXT-004/006 ส่ง JSON number จาก Decimal
status: approved
date: 2026-11-09
updated: 2026-11-10
requested_by: Dev Team B #940 (parent #794) — ต่อเนื่องจาก POdecision 2026-10-27 (Mongo projection เก็บเป็น Decimal128)
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-11-10
layer: volatile
affects:
  - docs/data/schema.md §9.3 (shelter_stocks — quantity_on_hand, reorder_threshold)
  - PROJECTION_VERSION 17 → 18 (ถ้า #934 ยังไม่ merge ให้ต่อจากเลขที่ merge ก่อน)
  - packages/tent-model/src/tent_model/shelter_stock.py
  - worker/src/worker/projectors/stock.py
  - worker/src/worker/projection_version.py
  - backend/apiapp/modules/thirdparty_stock/{schemas.py,use_case.py}
  - backend/apiapp/modules/thirdparty_summary/{schemas.py,use_case.py}
why: projection shelter_stocks รวมยอดด้วย Decimal แต่แปลงเป็น float ตอนเขียน Mongo และ reorder_threshold คืน float → EXT-004 / EXT-006 ได้ค่าเพี้ยน (0.30000000000000004) และ alert level ตัดสินด้วย float
migration: ไม่ bump schema_v (Mongo projection ไม่ใช่ doc ใน CouchDB) — bump PROJECTION_VERSION ให้ worker bootstrap เขียนแถว double เดิมทับเป็น Decimal128
---

# CR-246 — shelter_stocks — เก็บเป็น Decimal128 และ EXT-004/006 ส่ง JSON number จาก Decimal

อ้างอิง: issue #940, parent #794, [CR-038](../01-core/CR-038-decimal-qty-strings.md),
[CR-111](CR-111-partner-api-ext004-007.md), sibling [draft-public-needs-decimal](../draft-public-needs-decimal.md) (#934)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** `shelter_stocks.quantity_on_hand` / `reorder_threshold` จาก `double` → `Decimal128`; EXT-004 / EXT-006 ยังส่ง **JSON number** แต่สร้างจาก Decimal ที่ปัด 4 ตำแหน่ง; `stock_alert_level` เทียบด้วย Decimal
- **เพื่อใคร/ทำไม:** หน่วยงานภายนอกที่เรียก EXT-004/006 ได้ตัวเลขเพี้ยนจาก float และ alert level พลิกที่ขอบ threshold
- **dev ต้อง build:** projector + model + 2 module backend + bump `PROJECTION_VERSION` + test
- **กระทบ:** `docs/data/schema.md` §9.3 (ชนิด field, ไม่ bump `schema_v`); contract ของ EXT-004/006 **ไม่เปลี่ยน** (ยังเป็น number)

## Why

CR-038 ย้าย qty ใน CouchDB เป็น `qty_str` และ #934 ย้าย `public_needs` เป็น `Decimal128` แล้ว แต่ projection
`shelter_stocks` (EXT-004 / EXT-006) ยังมีเส้นทาง float:

- `worker/src/worker/projectors/stock.py` รวมยอดด้วย `Decimal` ถูกต้อง แต่เขียน `"quantity_on_hand": float(qty)`
  และ `calculate_reorder_threshold` คืน `float`
- `tent_model/shelter_stock.py` ประกาศ `quantity_on_hand`, `reorder_threshold` เป็น `float`
- `thirdparty_stock` ส่ง double ตรง ๆ → ledger `0.1 + 0.2` ออกเป็น `0.30000000000000004`
- `thirdparty_summary.stock_alert_level` เทียบ `<= 0` และ `< reorder_threshold` ด้วย float → ยอดเท่า threshold พอดี
  (ทศนิยม) อาจถูกตัดสินเป็น `low` ผิด

ทางเลือกที่ตัด: ส่งเป็น string (`qty_str`) — **breaking** กับหน่วยงานที่ผูก number ไว้แล้ว (นอกขอบเขตของ issue)

## Change

### Before → after

| ชั้น | Before | After |
| --- | --- | --- |
| worker `compute_shelter_stocks` → `quantity_on_hand` | `float(qty)` | `Decimal` (ปัด 4 ตำแหน่ง half-up ผ่าน `tent_model.qty.canonical_qty`) |
| worker `calculate_reorder_threshold` / `resolve_reorder_threshold` | คืน `float \| None` | คืน `Decimal \| None` (4 ตำแหน่ง) |
| `ShelterStock.quantity_on_hand` / `reorder_threshold` | `float` | `DecimalAnnotation` (`Decimal128` ใน Mongo) |
| Mongo `shelter_stocks.quantity_on_hand` / `reorder_threshold` | `double` | `Decimal128` |
| EXT-004 `items[].quantity_on_hand` | double จาก Mongo ตรง ๆ | JSON **number** จาก `Decimal` ที่ปัด 4 ตำแหน่ง เช่น `0.3` |
| EXT-006 `critical_items[].quantity_on_hand` | double ตรง ๆ | JSON **number** จาก `Decimal` ที่ปัด 4 ตำแหน่ง |
| `stock_alert_level` | เทียบ float | เทียบ `Decimal` |

### Requirements

- **FR-1** `stock.py` เขียน `quantity_on_hand` และ `reorder_threshold` เป็น `Decimal` (ไม่แปลงเป็น `float` ที่จุดใด)
- **FR-2** `calculate_reorder_threshold` / `resolve_reorder_threshold` คืน `Decimal | None`; ค่า `reorder_level` จาก override / catalog แปลงด้วย `Decimal(str(x))`
- **FR-3** `ShelterStock.quantity_on_hand` และ `reorder_threshold` ใช้ `DecimalAnnotation`; `unit_ratio` คง `float` (ค่าคงที่ `1`)
- **FR-4** EXT-004 และ EXT-006 serialize `quantity_on_hand` เป็น JSON number จาก Decimal ที่ `quantize_qty` แล้ว — ห้ามผ่าน `float` ที่ไม่ผ่านการปัด; ห้ามส่งเป็น string / exponent
- **FR-5** `stock_alert_level` รับ/เทียบเป็น `Decimal` โดยไม่ปัดก่อนเทียบ (`<= 0` → `critical`; `< reorder_threshold` → `low`; ไม่มี threshold → ไม่ส่ง)
- **FR-6** bump `PROJECTION_VERSION` (+1) พร้อมคอมเมนต์ที่มา; ถ้า OpenAPI schema เปลี่ยนให้รัน `pnpm openapi:update` แล้ว commit `fastapi.json` + `openapi.d.ts`
- **FR-7** แก้ `docs/data/schema.md` §9.3: ชนิด `quantity_on_hand` / `reorder_threshold` เป็น Decimal128 (ไม่ใช่ `num`) + อัปเดต `updated:`

### Acceptance

- **AC-1** ledger `"0.1"` + `"0.2"` → EXT-004 `quantity_on_hand` = `0.3` (JSON number ไม่ใช่ string)
- **AC-2** ยอดเท่า `reorder_threshold` พอดี (ทศนิยม เช่น `0.3` vs `0.1+0.2`) → ไม่เป็น `low`; ยอด `0` → `critical`
- **AC-3** bootstrap แล้วแถว `double` เดิมเป็น `Decimal128`
- **AC-4** pytest worker (stock projector) และ backend (`test_thirdparty_stock.py`, `test_thirdparty_summary.py`) ผ่าน

### กติกา

- `stock_alert_level` เทียบ `Decimal` **ตรง ๆ ไม่ปัดก่อน** (เจ้าของโครงการตัดสิน 2026-11-09: ทั้งระบบเป็น Decimal จึงไม่ต้องปัด) — ปัด 4 ตำแหน่งเฉพาะตอน serialize ค่าใน EXT-004/006 ตาม issue
- ตัว format/ปัด ใช้ `tent_model.qty` ร่วมกัน (`quantize_qty`, `canonical_qty`) — ไม่เขียน helper ใหม่
- `projectors/stock.py::_to_decimal` ยังไม่มี finite guard (`NaN` / `Infinity` ใน ledger)
  > [NEEDS DECISION: #934 ผลักเรื่องนี้มาที่ #940 — ให้นับ non-finite เป็น 0 แบบ `compute_needs` ใน PR นี้ หรือแยก issue]
  >
  > **ทำไมต้องตัดสิน:** `_to_decimal` (`Decimal(str(value))`) รับ `"NaN"` / `"Infinity"` ได้ ทำให้ยอดของ item นั้นใน `_stock_balances`
  > เป็น `NaN` / `inf`. ปัจจุบัน (float) ค่านี้ไม่ทำให้ request พัง แต่หลังเปลี่ยนเป็น Decimal การเทียบ `NaN <= 0` ใน
  > `stock_alert_level` อาจ raise `InvalidOperation` (ยังไม่ได้รันยืนยัน) → EXT-006 อาจ 500 ทั้ง endpoint จากแถวเดียว และ EXT-004 อาจส่ง
  > `NaN` ซึ่งไม่ใช่ JSON number ที่ valid. จึงเป็นผลข้างเคียงของ CR นี้เอง ไม่ใช่ปัญหาเดิมที่แยกได้ทั้งหมด
  > **ความเสี่ยงจริงต่ำ:** qty ในแอปถูก validate เป็น `qty_str` — เกิดได้เฉพาะข้อมูลเสียที่เขียนตรงเข้า CouchDB
  > **ทางเลือก:** (A) ใส่ finite guard ใน PR นี้ — นับ non-finite เป็น 0 แบบ `compute_needs` (#934) ; (B) แยก issue — PR เล็กลง แต่ช่วงระหว่างนั้นมีช่องโหว่ข้างต้น
  > **ที่ยังไม่ตัดสินเพราะ:** เป็นการเลือกว่านับ non-finite เป็น 0 (พฤติกรรมใหม่ที่ partner API เห็น) และกำหนด scope ของ PR — เป็นของเจ้าของโครงการ

### คงเดิม / นอกขอบเขต

- เปลี่ยน EXT-004/006 เป็น string (breaking)
- `public_needs` — #934
- `unit_ratio` (ค่าคงที่ 1)

## Impact

- Spec: `docs/data/schema.md` §9.3 (ชนิด 2 field)
- Code: `tent-model` (`shelter_stock.py`), `worker/src/worker/projectors/stock.py`, `projection_version.py`,
  backend `thirdparty_stock/{schemas,use_case}.py`, `thirdparty_summary/{schemas,use_case}.py`
- Test: worker `tests/projectors/` (stock projector — เพิ่มเคส `0.1+0.2`, threshold ทศนิยม); backend
  `tests/test_thirdparty_stock.py`, `tests/test_thirdparty_summary.py` (เปลี่ยน fixture เป็น `Decimal`, เพิ่มเคสขอบ threshold)
- Contract ภายนอก: EXT-004/006 ยังเป็น number — หน่วยงานไม่ต้องแก้; ค่าเปลี่ยนเฉพาะที่เคยเพี้ยน (`0.30000000000000004` → `0.3`)
- **Deploy worker + backend พร้อมกัน**: backend เก่า (field `float`) อ่าน `Decimal128` ไม่ได้ → 500 บน EXT-004/006 ชั่วคราวถ้า worker ใหม่ bootstrap ก่อน; backend ใหม่อ่านได้ทั้ง `double` และ `Decimal128` จึงต้อง deploy backend ก่อนหรือพร้อม worker
  (ประเด็นเดียวกับ #934 — pipeline `docker compose up -d --build --force-recreate` ไม่มีลำดับ worker/fastapi)

## Migration

ไม่ bump `schema_v`. bump `PROJECTION_VERSION` (+1; ปัจจุบัน 17 → 18 — ถ้า #934 ยังไม่ merge ให้ต่อจากเลขที่ merge ก่อน):
worker เริ่มแล้วเห็นเลขต่ำกว่าจึง bootstrap เต็ม เขียนทับแถว `double` เป็น `Decimal128`. ระหว่างนั้นแถว `double`
ยังอ่านได้ (pydantic แปลง double → Decimal).

**Rollback:** ไม่อัตโนมัติ — หยุด worker ใหม่ → `db.shelter_stocks.deleteMany({})` → รัน worker เก่าด้วย
`--bootstrap-only` → ค่อยเริ่ม backend เก่า (ขั้นตอนเดียวกับ draft-public-needs-decimal §Rollback; backend เก่า
อ่าน `Decimal128` ไม่ได้).

## Decision log

- 2026-10-27 — PO decision (#794): Mongo projection เก็บเป็น Decimal128 + bump PROJECTION_VERSION + bootstrap
- 2026-11-09 — เจ้าของโครงการ: เทียบ alert level ด้วย Decimal ตรง ๆ ไม่ปัดก่อน
- 2026-11-09 — proposed (draft; ติดตามด้วย draft CR ไม่ลงเลข CR และไม่ลง `_index.md` ตามแนว #934)
- 2026-11-10 — Approved โดย Soravit Sukkarn (Team Lead) กำหนดหมายเลข CR-246
