---
id: draft
title: แก้ไขเพิ่มเติม MealService — โครงสร้างผลผลิตครัวรายสายการผลิต (Kitchen Yield Lines) และการบันทึกสต็อกล็อตอาหาร
status: proposed
date: 2026-09-13
requested_by: Kitchen Operations & Inventory Architecture Working Group
decided_by: <รออนุมัติจาก Project Owner>
layer: volatile
affects:
  - docs/data/schema.md §2.7 (`meal_service` schema_v 2 → 3)
  - docs/changes/CR-045-referral-full-dod-alignment.md
  - docs/changes/CR-084-catalog-schema-reconciliation.md
  - frontend/src/lib/features/kitchen/
---

# draft-meal-service-kitchen-yield-amendment — แก้ไขเพิ่มเติม MealService: โครงสร้างผลผลิตครัวรายสายการผลิต (Kitchen Yield Lines)

> [!NOTE]
> **สรุป (TL;DR):**
> ปรับปรุงเอกสาร `meal_service` จาก `schema_v: 2` เป็น **`schema_v: 3`** โดยเพิ่มอาเรย์ **`yield_items: KitchenYieldItem[]`** เพื่อรองรับการรายงานผลผลิตจริงของครัวที่มีหลายสายการผลิต (Production Lines) หรือหลายเมนูในมื้อเดียวกัน แต่ละบรรทัดระบุด้วย `yield_line_id` ที่เสถียร.
>
> เชื่อมโยงผลผลิตครัวเข้าสู่คลังพัสดุผ่านบัญชีคุมสต็อก `stock_ledger` ด้วยเหตุผล `kitchen_yield` (+บวก) โดยใช้รหัสเอกสารแบบกำหนดได้:
> **`stock_ledger:kitchen_yield:{meal_service_id}:{yield_line_id}`**
> กำหนดให้ **`lot_ref` คือ `_id` ของแถว ledger รับเข้า (Inbound Ledger ID)** เป็น Physical Lot Identity ที่แท้จริง, โดย `lot_no` เป็นเพียงป้ายแสดงผลสำหรับมนุษย์ (Display Label).
> คงฟิลด์ scalar เดิม (`actual_yield`, `served`, `waste`) ไว้เพื่อความเข้ากันได้ย้อนหลัง 100%

---

## 1. Why (เหตุผลและปัญหาของโครงสร้างเดิม)

ใน [CR-084](CR-084-catalog-schema-reconciliation.md) มีการเพิ่มฟิลด์ `actual_yield` เป็นเลขเดี่ยว (Scalar Integer) ใน `meal_service`:
1. **ไม่รองรับหลายเมนูในมื้อเดียว:** หากมื้อนั้นครัวปรุงทั้ง "ข้าวกะเพรา" และ "ข้าวต้ม" ยอด `actual_yield` รวมจะไม่สามารถบอกได้ว่าแต่ละเมนูผลิตได้กี่กล่อง
2. **ไม่รองรับหลายสายการผลิต (Split Batches/Lines):** หากเมนูเดียวกันปรุง 2 กระทะแยกกัน (เช่น รอบเช้าตรู่ กับ รอบสาย) การมีตัวตนระดับล็อตจะทำไม่ได้
3. **การผูกกับ recipe_id ผิดหลัก:** การใช้ `recipe_id` เป็นคีย์นำเข้าสต็อกทำให้ไม่สามารถรองรับสินค้าสำเร็จรูปที่ไม่มีสูตร หรือสินค้าเมนูเดียวกันที่ปรุงแยกกะได้
4. **ความสับสนระหว่าง lot_no และ physical identity:** `lot_no` (เช่น `L-260913-001`) เป็นเพียงสตริงป้ายกำกับ อาจมีการออกซ้ำได้ตาม CR-088 จึงห้ามนำมาใช้เป็น Identity ของระบบ

---

## 2. โครงสร้างสกีมา MealService (schema_v: 3)

เอกสารในฐานข้อมูล `shelter_{shelter_code}`:
- **รหัสเอกสาร:** `meal_service:{ulid}`
- **เวอร์ชันสกีมา:** `schema_v: 3`

### โครงสร้างฟิลด์ `KitchenYieldItem`

```ts
export interface KitchenYieldItem {
  yield_line_id: string;      // รหัสประจำบรรทัดผลิต unique ภายใน MealService (เช่น "line-1", "line-2")
  item_id: string;            // รหัสสินค้าอาหารปรุงสุก -> item_master:{ulid|sku} ใน item_category:ready_meal (Per-Dish ItemMaster)
  recipe_id?: string | null;  // รหัสสูตรอาหาร (ถ้ามี) สำหรับอ้างอิง metadata เท่านั้น (ไม่ใช่ identity)
  actual_yield: string;       // ปริมาณผลผลิตที่ได้จริง (qty_str ตาม CR-038)
  unit: string;               // หน่วยนับ (ตรงกับ item_master.base_unit เช่น "กล่อง", "ที่")
  storage_zone?: string;      // โซนจัดเก็บชั่วคราว (เช่น "โต๊ะพักอาหาร A")
  lot_no?: string;            // ป้ายแสดงผลสำหรับมนุษย์ L-YYMMDD-XXX (CR-088) — metadata เท่านั้น
  expiry: number;             // เวลาหมดอายุอาหารปรุงสุกพร้อมทาน (Timestamp: cooking_completed_at + 4 ชั่วโมง) — บังคับสำหรับเอกสารเขียนใหม่ schema_v3
}
```

### การเปลี่ยนแปลงในเอกสาร `meal_service` (schema_v: 3)
- เพิ่มฟิลด์: `yield_items: KitchenYieldItem[]` (optional สำหรับเอกสารเก่า, required สำหรับการบันทึกใหม่) — เป็น **แหล่งความจริงทางธุรกิจของการผลิต (Production Authority)** สำหรับเอกสาร v3
- **กฎความเป็นหนึ่งเดียวของยอดรวม (Aggregate Authority for v3 Writes):**
  - ฟิลด์ `actual_yield` ระดับบนสุดในเอกสาร v3 ถือเป็น **Derived Aggregate** ที่ต้องคำนวณจาก $\sum \text{yield\_items}[].\text{actual\_yield}$ เสมอ ห้ามปล่อยให้ `actual_yield` ด้านบนและ `yield_items[]` กลายเป็นความจริงสองชุดที่แยกจากกันได้
  - `served`: บันทึกจำนวนเสิร์ฟที่แจกจ่ายจริงในศูนย์พักพิง (Operational Metric) ซึ่งสามารถกระทบยอดกับผลรวมของ `MealDistributionLog` ได้
  - `waste`: บันทึกปริมาณของเหลือทิ้งจากการผลิตของครัว (Operational Kitchen Waste Metric)
- ฟิลด์ประวัติศาสตร์เดิม: คง `actual_yield: int`, `served: int`, `waste: int`, `external` ไว้เพื่อความเข้ากันได้ย้อนหลัง

---

## 3. กฎความสัมพันธ์กับ StockLedger และ Physical Lot Identity

เมื่อครัวยืนยันยอดผลผลิตรอบการปรุง (Kitchen Production Completion):
1. **การบันทึกเข้าบัญชีสต็อกคลัง (`stock_ledger`):**
   ระบบจะสร้างแถวรับเข้าใน `stock_ledger` โดยมีคุณสมบัติดังนี้:
   - **`_id` แบบ Deterministic:**
     `stock_ledger:kitchen_yield:{meal_service_id}:{yield_line_id}`
   - **`reason`:** `'kitchen_yield'` (ตาม [draft-stock-ledger-reasons-cr055-amendment](draft-stock-ledger-reasons-cr055-amendment.md))
   - **`ref_id`:** `meal_service:{ulid}` (รหัสของ `meal_service` นี้)
   - **`qty`:** ค่าบวก (+) ตาม `actual_yield` ของบรรทัดนั้น
   - **`lot_ref` (Physical Lot Identity):** กำหนดให้มีค่าเท่ากับ `_id` ของแถว ledger นี้ (Self-Referential Inbound Row)
   - **`lot.lot_no`:** นำค่าจาก `yield_item.lot_no` มาบันทึกเป็น metadata
2. **การแยกสายการผลิตสินค้าเดียวกัน:**
   หากสินค้าเมนูเดียวกัน (`item_id` เดียวกัน) ถูกปรุง 2 รอบในมื้อเดียวกัน:
   - รอบที่ 1: `yield_line_id = "line-1"` $\rightarrow$ สร้าง `stock_ledger:kitchen_yield:{ms_id}:line-1`
   - รอบที่ 2: `yield_line_id = "line-2"` $\rightarrow$ สร้าง `stock_ledger:kitchen_yield:{ms_id}:line-2`
   ทั้งสองรอบจะได้แถว ledger คนละแถว และได้ `lot_ref` คนละตัวกันอย่างเป็นอิสระ

---

## 4. ความเข้ากันได้ย้อนหลังและการแปลงชนิดข้อมูล (Backward Compatibility & Legacy Reader Strategy)

1. **การอ่านเอกสารประวัติศาสตร์ (`schema_v: 2` เดิม):**
   - เอกสารเดิมมีเฉพาะค่าสเกลาร์รวม `actual_yield`, `served`, `waste` โดย**ไม่มีข้อมูล `item_id`, อัตลักษณ์เมนู, หรือยอดผลผลิตรายจาน**
   - **ห้ามประดิษฐ์หรือสังเคราะห์ `ItemMaster` ปลอม (Do NOT fabricate an ItemMaster association):** ระบบตัวอ่าน (Reader) จะต้องไม่สร้าง `KitchenYieldItem` เสมือนที่มี `item_id` สมมติขึ้นมาเอง
   - กลยุทธ์ความเข้ากันได้ที่ถูกต้อง:
     - แสดงผลยอดรวมเชิงสถิติเดิม `actual_yield`, `served`, `waste` ตามค่าที่บันทึกไว้ในอดีต
     - ทำการแปลงชนิดข้อมูลตัวเลข (Numeric Decimal Coercion) อย่างปลอดภัยเมื่อจำเป็น
     - ระบุว่ารายละเอียดผลผลิตระดับรายจาน/สายการผลิต (Per-dish yield lines) "ไม่มีข้อมูลในประวัติเดิม (Unavailable for legacy records)"
2. **การบันทึกเอกสารใหม่ (`schema_v: 3`):**
   - อาเรย์ `yield_items[]` เป็นสิทธิอำนาจเด็ดขาด แต่ละรายการต้องมี `yield_line_id` ที่เสถียร และผูกกับ `item_id` ในแคตตาล็อกจริง
   - ไม่มีการเขียนแปลงเอกสารเก่าในฐานข้อมูล (No destructive backfill rewrite)

---

## 5. เกณฑ์การยอมรับ (Acceptance Criteria)

- **AC-KY-01 (Multiple Yield Lines):** เจ้าหน้าที่ครัวสามารถบันทึกผลผลิตอาหารปรุงสุกมากกว่า 1 รายการในบันทึกบริการมื้อเดียว (`meal_service`) ได้ โดยแต่ละรายการมี `yield_line_id` ประจำบรรทัด
- **AC-KY-02 (Deterministic Ledger Row):** เมื่อยืนยันผลผลิต ระบบต้องสร้างแถว `stock_ledger` ที่มี `_id` ตรงตามรูปแบบ `stock_ledger:kitchen_yield:{meal_service_id}:{yield_line_id}`
- **AC-KY-03 (Lot Ref Minting):** แถวรับเข้าสต็อกที่เกิดจากผลผลิตครัวต้องมี `lot_ref === _id` ของแถว ledger นั้น โดยไม่ใช้ `recipe_id` หรือ `lot_no` เป็น identity
- **AC-KY-04 (Legacy Reader):** เอกสาร `meal_service` เดิมที่มี `schema_v: 2` ต้องสามารถเปิดดูในระบบได้โดยไม่เกิดข้อผิดพลาด แสดงยอดสถิติเดิมถูกต้อง โดยระบบไม่สร้าง ItemMaster ปลอมหรือ virtual yield line ที่ไม่มีอยู่จริง
