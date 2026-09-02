---
id: draft
title: Kitchen 2-Tier Meal Sessions, Production Setup Board (Stages A/B/C) & TKT-KITCHEN Flow 3
status: proposed
date: 2026-09-02
requested_by: Field Kitchen Operations, Logistics & Nutrition Management (CR-058 หมวด 3 & CR-059 Flow 3)
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §2.5, §2.6, §2.7, §2.8
  - docs/task-breakdown/05-D-kitchen.md T-16, T-25, T-26, T-27, T-42, T-50
  - frontend/src/lib/features/kitchen/domain/
  - frontend/src/lib/features/kitchen/data/
  - frontend/src/lib/features/kitchen/application/
  - frontend/src/lib/features/kitchen/ui/
  - frontend/src/routes/(protected)/back-office/kitchen/
---

# CR-Draft — Kitchen 2-Tier Meal Sessions, Production Setup Board (Stages A/B/C) & TKT-KITCHEN Flow 3

> **สรุป (TL;DR):** ปรับโครงสร้างระบบครัวเป็น 2 ชั้น (`meal_session` ➔ `meal_plan` / Production Batch) เพื่อติดตามเป้าหมาย 5 กลุ่มผู้พักพิง · ปรับกระบวนการสั่งผลิตอาหารเป็น Wizard 3 ขั้นตอน (A-วางแผน BOM/แก๊ส, B-รอคลังอนุมัติตั๋ว `TKT-KITCHEN`, C-รายงานผลผลิตจริง Actual Yield) · ประมวลผลสถานะความครบถ้วนรายกลุ่มแบบ Reactive · กระทบ `docs/data/schema.md` §2.5, §2.6, §2.7, §2.8 และ UI โรงครัวทั้งหมด.

---

## Why (เหตุผลและที่มา)

1. **ปัญหาการจัดการมื้ออาหารเดิม:** หน้าจอครัวเดิมมีเพียงรายการ `meal_plan` แยกเดี่ยว ไม่สามารถจัดสรรและติดตามได้ว่าในหนึ่งมื้อ (เช่น มื้อเช้า) มีการผลิตอาหารครอบคลุมผู้พักพิงทุกกลุ่มเป้าหมาย (ฮาลาล, เด็ก/ทารก, ผู้ป่วย/อาหารอ่อน, ปกติ, อาสาสมัคร) ครบถ้วนตามยอดทะเบียนจริงแล้วหรือไม่
2. **ปัญหาการตัดสต็อกวัตถุดิบและแก๊ส (CR-059 Flow 3):** เดิมการเบิกวัตถุดิบเป็นการตัดสต็อกตรงจากหน้าจอครัวทันที ข้ามกระบวนการตรวจสอบของเจ้าหน้าที่คลังสินค้า ทำให้ขาดระบบตั๋วคำขอเบิก (`TKT-KITCHEN-XXXX`) ที่คลังต้องตรวจสอบสต็อกและอนุมัติตาม FEFO
3. **ปัญหาการบันทึกผลผลิตจริงและการควบคุมโควตา (CR-058 หมวด 3 & CR-085):** ขาดขั้นตอนรายงาน Actual Yield (จำนวนจานที่ปรุงได้จริง) หลังการปรุงอาหารเสร็จ เพื่อใช้เป็นเพดาน (Ceiling) ในการแจกจ่ายอาหารหน้างาน และขาดการคำนวณการใช้แก๊สจริงเทียบกับแผน

---

## Requirements

### 1. โครงสร้างข้อมูลมื้ออาหาร 2 ชั้น (2-Tier Meal Structure)

- **FR-K01 — เอกสารระดับมื้ออาหาร (`meal_session`):**
  - ระบบต้องรองรับการสร้างเอกสาร `meal_session` เพื่อคุมภาพรวมของแต่ละมื้อ (เช่น มื้อเช้า, มื้อกลางวัน, มื้อเย็น)
  - ต้องมีฟิลด์เก็บเป้าหมายรายกลุ่ม 5 มิติ (`target_headcount`):
    1. อาหารฮาลาล (`halal`: int)
    2. อาหารเด็ก/ทารก (`infant`: int)
    3. เปราะบาง/อาหารอ่อน (`soft_food`: int)
    4. ปกติ (`regular`: int)
    5. อาสาสมัคร (`volunteer`: int)
    6. เป้าหมายรวม (`total`: int)
  - ค่าเริ่มต้นของเป้าหมายทั้ง 5 กลุ่มต้องดึงอัตโนมัติจากทะเบียนผู้พักพิงที่มีสถานะ `active` ในศูนย์ และยอมรับการแก้ไขปรับแต่งด้วยมือ (Override) ก่อนบันทึก
- **FR-K02 — เอกสารระดับชุดการผลิต (`meal_plan` / Production Batch):**
  - `meal_plan` ต้องมีฟิลด์ `meal_session_id` (UUID/ULID) เชื่อมโยงกลับไปยัง `meal_session` ต้นทาง
  - ต้องมีฟิลด์ `target_tags` (`string[]`) ระบุกลุ่มผู้รับที่เมนูนี้จัดสรรให้ (เช่น `['everyone']`, `['halal']`, `['regular']`, `['soft_food']`, `['infant']`, `['volunteer']`)
  - ต้องมีฟิลด์ `allocated_target` (int) ระบุจำนวนจาน/กล่องเป้าหมายของชุดการผลิตนี้

### 2. กระดานจัดสรรการผลิตอาหาร (Production Setup Board Wizard 3 ช่วง)

- **FR-K03 — ช่วง A: วางแผนเมนู คำนวณวัตถุดิบ (BOM) และแก๊สหุงต้ม (Plan):**
  - ผู้ใช้เลือกสูตรอาหาร (BOM Recipe) จาก Catalog หรือระบุรายการวัตถุดิบเอง
  - ระบบคำนวณปริมาณวัตถุดิบที่ต้องใช้ตามสัดส่วน `allocated_target` เทียบกับยอดคงเหลือในคลัง (`on_hand_stock`) และแสดงยอดส่วนขาด (`shortage`) พร้อมสถานะความพร้อม (`พร้อม` / `วัตถุดิบขาด`)
  - ระบบแสดงแผงจัดสรรเครื่องครัวและแก๊สหุงต้ม:
    - ให้เลือกถังแก๊ส (`gas_cylinder_type`)
    - คำนวณปริมาณการใช้แก๊ส: $\text{Gas (kg)} = \text{Cooking Time (hrs)} \times \text{Burn Rate (kg/hr)} \times \text{Multiplier}$
    - แสดงระดับแก๊สคงเหลือในถังปัจจุบัน ยอดที่คาดว่าจะใช้ และยอดคงเหลือสุทธิหลังปรุง
  - เมื่อตรวจสอบความถูกต้อง ผู้ใช้กดปุ่ม **"สร้างใบเบิกวัตถุดิบ"** เพื่อเปลี่ยนสถานะเป็นช่วง B
- **FR-K04 — ช่วง B: ระบบตั๋วคำขอเบิกคลังและตัดสต็อก (`TKT-KITCHEN-XXXX` Flow 3):**
  - เมื่อกดสร้างใบเบิก ระบบต้องสร้างเอกสาร `kitchen_requisition` ในสถานะ `status: 'pending'` พร้อมรหัสตั๋ว `ticket_no` ในรูปแบบ `TKT-KITCHEN-XXXX`
  - หน้ารอคลังอนุมัติต้องแสดงป้ายสถานะ (Banner) รอคลังตรวจสอบและตัดจ่ายวัตถุดิบจริง
  - ระบบต้องมีปุ่ม **"ดูรายละเอียดใบเบิก"** เพื่อเปิดดูรายการวัตถุดิบและเชื้อเพลิงในตั๋ว
  - ระบบต้องมีปุ่ม **"[สำหรับทดสอบ] จำลองคลังอนุมัติและตัดสต็อก"** (Testing Helper):
    - เมื่ออนุมัติ ระบบจะเขียนรายการ `stock_ledger` (ตัดจ่ายวัตถุดิบตาม FEFO) และ `gas_ledger` (reason=`consumption`) แบบ Atomic Transaction
    - อัปเดตสถานะตั๋ว `kitchen_requisition` เป็น `status: 'approved'`
    - เปลี่ยนสถานะฝั่งครัวเป็น **"วัตถุดิบพร้อม เริ่มปรุงได้"** และอนุญาตให้ก้าวสู่ช่วง C
- **FR-K05 — ช่วง C: รายงานผลผลิตจริง (Actual Yield & Service Record):**
  - ผู้ใช้กรอก **Actual Yield (จำนวนจาน/กล่องที่ปรุงได้จริง)**
  - ผู้ใช้สามารถบันทึกยอดการแจกจ่ายจริง (`served`), อาหารเหลือทิ้ง (`waste`), และแจกจ่ายนอกศูนย์ (`external: {volunteers, outside_evacuees}`)
  - ผู้ใช้สามารถบันทึกปริมาณแก๊สที่ใช้จริง (`actual_gas_used_kg`)
  - บันทึกเอกสาร `meal_service` (CR-085) ที่ผูกกับ `meal_plan_id` และ `meal_session_id`

### 3. การติดตามความคืบหน้าของมื้ออาหาร (Session Progress Tracking)

- **FR-K06 — การคำนวณยอด "ทำแล้ว" และสถานะ "ครบแล้ว/ยังไม่ครบ" รายกลุ่ม:**
  - ยอด "ทำแล้ว (จาน)" ของแต่ละกลุ่มเป้าหมายใน `meal_session` ต้องคำนวณแบบ Reactive (Read-time Derived) จากผลรวม `actual_yield` (หรือ `served`) ของทุก `meal_service` ที่เชื่อมโยงกับ `meal_plan` ที่เลือก TAGS กลุ่มนั้นๆ
  - หากยอด "ทำแล้ว" $\ge$ "จำนวนเป้าหมาย" ของกลุ่มนั้น ให้แสดงป้ายสถานะ **"ครบแล้ว"** (สีเขียว)
  - หากยอดยังไม่ถึงเป้า ให้แสดงป้ายสถานะ **"ยังไม่ครบ"** (สีส้ม/เหลือง)
  - การ์ดมื้ออาหารต้องแสดงผลสรุปรวม เช่น `1/5 กลุ่มครบ` หรือ `5/5 กลุ่มครบ`

---

## Schema Changes (docs/data/schema.md)

สรุปสถานะการเปลี่ยนแปลงฟิลด์ของทุกเอกสารที่เกี่ยวข้อง:

### 1. [NEW] §2.8 `meal_session` — `meal_session:{ulid}` · **schema_v 1**
> เอกสารระดับมื้ออาหารใหม่สำหรับควบคุมภาพรวมและเป้าหมายผู้รับ 5 กลุ่ม

| Field | ชนิด | req | สถานะ | คำอธิบายและหมายเหตุ |
| :--- | :---: | :---: | :---: | :--- |
| `_id` | str | req | **[เพิ่มใหม่]** | Primary key รูปแบบ `meal_session:{ulid}` |
| `type` | `'meal_session'` | req | **[เพิ่มใหม่]** | Discriminator doc type |
| `schema_v` | `1` | req | **[เพิ่มใหม่]** | Schema version เริ่มต้น 1 |
| `name` | str | req | **[เพิ่มใหม่]** | ชื่อมื้ออาหาร เช่น `"เมื่อเช้า 28 ส.ค. 2569"`, `"มื้อเย็น 23/7/2569"` |
| `date` | str | req | **[เพิ่มใหม่]** | วันที่จัดมื้ออาหาร `YYYY-MM-DD` |
| `meal` | enum(`breakfast`,`lunch`,`dinner`,`snack`) | req | **[เพิ่มใหม่]** | ช่วงเวลาของมื้อ |
| `status` | enum(`active`,`completed`,`cancelled`) | req | **[เพิ่มใหม่]** | สถานะมื้ออาหาร (default `"active"`) |
| `target_headcount` | object | req | **[เพิ่มใหม่]** | เป้าหมายผู้รับอาหารแยกตามกลุ่มคุณสมบัติ 5 กลุ่ม (ดูตารางย่อย) |
| `notes` | str | opt | **[เพิ่มใหม่]** | หมายเหตุเพิ่มเติมประจำมื้อ |
| `created_at` / `updated_at` | ts | req | **[เพิ่มใหม่]** | เวลาสร้าง/แก้ไขเอกสาร (Envelope BaseDoc) |
| `created_by` / `updated_by` | str | req | **[เพิ่มใหม่]** | ผู้สร้าง/แก้ไขเอกสาร (Envelope BaseDoc) |

**ตารางย่อย `target_headcount`:**

| Sub-field | ชนิด | req | สถานะ | คำอธิบายและหมายเหตุ |
| :--- | :---: | :---: | :---: | :--- |
| `halal` | int $\ge 0$ | req | **[เพิ่มใหม่]** | เป้าหมายกลุ่มอาหารฮาลาล (มุสลิม) |
| `infant` | int $\ge 0$ | req | **[เพิ่มใหม่]** | เป้าหมายกลุ่มเด็ก/ทารก |
| `soft_food` | int $\ge 0$ | req | **[เพิ่มใหม่]** | เป้าหมายกลุ่มเปราะบาง/อาหารอ่อน (ผู้ป่วยติดเตียง/คนชรา) |
| `regular` | int $\ge 0$ | req | **[เพิ่มใหม่]** | เป้าหมายกลุ่มปกติทั่วไป |
| `volunteer` | int $\ge 0$ | req | **[เพิ่มใหม่]** | เป้าหมายกลุ่มเจ้าหน้าที่และอาสาสมัคร |
| `total` | int $\ge 0$ | req | **[เพิ่มใหม่]** | ยอดเป้าหมายรวมผู้พักพิงและผู้รับอาหารทั้งหมด |

---

### 2. [MODIFY] §2.5 `meal_plan` — `meal_plan:{ulid}` · **schema_v 2** (Non-breaking additive)
> ปรับ `meal_plan` ทำหน้าที่เป็น Production Batch และเพิ่มฟิลด์เชื่อมโยง `meal_session`

| Field | ชนิด | req | สถานะ | คำอธิบายและหมายเหตุ |
| :--- | :---: | :---: | :---: | :--- |
| `_id` | str | req | **[คงเดิม]** | `meal_plan:{ulid}` |
| `type` | `'meal_plan'` | req | **[คงเดิม]** | Discriminator doc type |
| `schema_v` | `2` | req | **[คงเดิม]** | คงที่ 2 (Additive fields optional) |
| `date` | str | req | **[คงเดิม]** | `YYYY-MM-DD` |
| `meal` | enum(`breakfast`,`lunch`,`dinner`,`snack`) | req | **[คงเดิม]** | ช่วงเวลาของมื้อ |
| `label` | str | opt | **[คงเดิม]** | ชื่อเมนูที่ตั้งเอง (โหมด BOM/Custom) |
| `headcount` | object | req | **[คงเดิม]** | ยอดประชากร `{total, halal, soft_food, infant}` |
| `recipes` | array | req | **[คงเดิม]** | `[{recipe_id, planned_qty, unit?}]` รายการวัตถุดิบ |
| `status` | enum(`draft`,`confirmed`) | req | **[คงเดิม]** | สถานะของแผน |
| `override_reason` | str\|null | opt | **[คงเดิม]** | เหตุผลกรณีปรับยอด headcount ต่างจากทะเบียน |
| `calc_source` | object\|null | opt | **[คงเดิม]** | Audit trail การคำนวณ SOP |
| `gas_usage` | array | opt | **[คงเดิม]** | `[{cylinder_id, consumption_kg}]` คำนวณแก๊สที่ต้องใช้ (CR-086) |
| `meal_session_id` | str\|null | opt | **[เพิ่มใหม่]** | รหัสอ้างอิง `meal_session._id` ต้นทาง |
| `target_tags` | [str] | opt | **[เพิ่มใหม่]** | กลุ่มเป้าหมายที่ผลิตให้ เช่น `['everyone']`, `['halal']`, `['regular']`, `['volunteer']` |
| `allocated_target` | int $\ge 0$ | opt | **[เพิ่มใหม่]** | จำนวนจาน/กล่องเป้าหมายของชุดการผลิตนี้ |

---

### 3. [MODIFY] §2.6 `kitchen_requisition` — `kitchen_requisition:{ulid}` · **schema_v 3**
> ปรับปรุงจาก append-only document เป็น State Machine สำหรับระบบตั๋ว `TKT-KITCHEN` (CR-059 Flow 3)

| Field | ชนิด | req | สถานะ | คำอธิบายและหมายเหตุ |
| :--- | :---: | :---: | :---: | :--- |
| `_id` | str | req | **[คงเดิม]** | `kitchen_requisition:{ulid}` |
| `type` | `'kitchen_requisition'` | req | **[คงเดิม]** | Discriminator doc type |
| `schema_v` | `3` | req | **[ปรับเปลี่ยน]** | Bump จาก 2 ➔ 3 (เพิ่มสถานะ State Machine) |
| `ticket_no` | str | req | **[เพิ่มใหม่]** | รหัสตั๋วคำขอเบิก เช่น `"TKT-KITCHEN-3272"` |
| `status` | enum(`pending`,`approved`,`rejected`) | req | **[เพิ่มใหม่]** | สถานะตั๋ว (default `"pending"`) |
| `meal_plan_id` | str\|null | opt | **[คงเดิม]** | รหัสอ้างอิง `meal_plan._id` |
| `meal_session_id` | str\|null | opt | **[เพิ่มใหม่]** | รหัสอ้างอิง `meal_session._id` |
| `items` | array | req | **[คงเดิม]** | `[{item_id, qty_requested, qty_issued, unit}]` รายการวัตถุดิบ |
| `gas_drawdown` | array | opt | **[เพิ่มใหม่]** | `[{cylinder_id: str, qty_kg: qty_str}]` รายการแก๊สเชื้อเพลิงที่ขอเบิกตัดคลัง |
| `ledger_ids` | [str] | sys | **[ปรับเปลี่ยน]** | รหัส `stock_ledger` / `gas_ledger` (เดิม pre-generate ตอนสร้าง, เปลี่ยนเป็นสร้างเมื่อ status = `approved`) |
| `requested_at` | ts | req | **[เพิ่มใหม่]** | เวลาที่ส่งคำขอเบิก (ตอนสร้างช่วง A) |
| `issued_at` / `approved_at` | ts\|null | opt | **[ปรับเปลี่ยน]** | เวลาที่คลังอนุมัติตัดสต็อกจริง (ช่วง B) |
| `approved_by` | str\|null | opt | **[เพิ่มใหม่]** | ชื่อ/รหัสเจ้าหน้าที่คลังผู้อนุมัติตัดสต็อก |

---

### 4. [MODIFY] §2.7 `meal_service` — `meal_service:{ulid}` · **schema_v 2** (Non-breaking additive)
> บันทึกผลการบริการอาหารและผลผลิตจริง Actual Yield (CR-058 หมวด 3 & CR-085)

| Field | ชนิด | req | สถานะ | คำอธิบายและหมายเหตุ |
| :--- | :---: | :---: | :---: | :--- |
| `_id` | str | req | **[คงเดิม]** | `meal_service:{ulid}` |
| `type` | `'meal_service'` | req | **[คงเดิม]** | Discriminator doc type |
| `schema_v` | `2` | req | **[คงเดิม]** | คงที่ 2 (Additive fields optional) |
| `date` | str | req | **[คงเดิม]** | `YYYY-MM-DD` |
| `meal` | enum(`breakfast`,`lunch`,`dinner`,`snack`) | req | **[คงเดิม]** | ช่วงเวลาของมื้อ |
| `meal_plan_id` | str\|null | opt | **[คงเดิม]** | รหัสอ้างอิง `meal_plan._id` |
| `served` | int $\ge 0$ | req | **[คงเดิม]** | จำนวนที่แจกออกไปจริง |
| `waste` | int $\ge 0$ | req | **[คงเดิม]** | จำนวนที่เหลือทิ้ง/ชำรุด |
| `external` | object | req | **[คงเดิม]** | `{volunteers: int, outside_evacuees: int}` แจกนอกศูนย์ |
| `notes` | str | opt | **[คงเดิม]** | หมายเหตุเพิ่มเติม |
| `actual_yield` | int $\ge 0$ | opt | **[คงเดิม]** | จำนวนที่ครัวปรุงได้จริง (ผลผลิต — เพิ่มใน CR-085) |
| `meal_session_id` | str\|null | opt | **[เพิ่มใหม่]** | รหัสอ้างอิง `meal_session._id` |
| `actual_gas_used_kg` | qty_str | opt | **[เพิ่มใหม่]** | ปริมาณแก๊สที่ใช้จริงในกระบวนการปรุง |

---

## UI Flow & Architecture

```mermaid
flowchart TD
    subgraph S1 [หน้าสรุปมื้ออาหาร Meal Sessions List]
        A[เปิดหน้าสรุปมื้อ /back-office/kitchen] --> B[กด + สร้างมื้อใหม่]
        B --> C[Modal สร้างมื้อ: ดึงยอดผู้พักพิง 5 กลุ่มอัตโนมัติ]
        C --> D[บันทึก Meal Session ใหม่]
        D --> E[ขยายการ์ดมื้อ: แสดงตารางเป้าหมาย 5 กลุ่ม]
        E --> F[กด + เพิ่มเมนูผลิต Production Batch]
    end

    subgraph S2 [แผงควบคุมและจัดสรรเครื่องครัว Production Setup Board Wizard]
        F --> G[ช่วง A: เลือกสูตร BOM + เลือก TAGS กลุ่มเป้าหมาย + จัดสรรแก๊ส]
        G --> H[กด สร้างใบเบิกวัตถุดิบ]
        H --> I[ช่วง B: รอคลังอนุมัติ Ticket TKT-KITCHEN]
        I --> J[คลังอนุมัติหรือกดปุ่มจำลองอนุมัติ ตัด Stock & Gas Ledger]
        J --> K[ช่วง C: รายงานผลจริง กรอก Actual Yield & ข้อมูลเสิร์ฟ/แก๊สจริง]
        K --> L[บันทึก Meal Service]
    end

    L -->|อัปเดตยอดทำแล้วและสถานะครบแล้ว| E
```

---

## Acceptance Criteria (DoD)

- [ ] **Meal Session Management:**
  - สร้าง `meal_session` พร้อมดึงยอดผู้พักพิง 5 กลุ่มจากทะเบียนจริง (`halal`, `infant`, `soft_food`, `regular`, `volunteer`) ได้ถูกต้อง
  - แสดงรายการมื้ออาหาร ค้นหา กรองสถานะ และลบมื้ออาหารที่เป็น draft ได้
- [ ] **Production Setup Board (Wizard 3 ขั้น):**
  - **ช่วง A:** เลือกสูตร BOM คำนวณวัตถุดิบเทียบยอดคงคลังได้ถูกต้อง จัดสรรเตา/ถังแก๊สและคำนวณปริมาณแก๊สได้
  - **ช่วง B:** สร้างตั๋ว `TKT-KITCHEN-XXXX` สถานะ `pending` สำเร็จ; เมื่อกดอนุมัติ (หรือจำลองอนุมัติ) ตัด `stock_ledger` (FEFO) และ `gas_ledger` ได้ถูกต้อง
  - **ช่วง C:** กรอก `actual_yield` และบันทึก `meal_service` สำเร็จ
- [ ] **Progress Reactive Summary:**
  - ตารางกลุ่มเป้าหมายในหน้าสรุปมื้อสะท้อนยอด "ทำแล้ว (จาน)" และสถานะ "ครบแล้ว/ยังไม่ครบ" ตามข้อมูล `actual_yield` ของทุก Batch ในมื้อนั้นอย่างแม่นยำ
- [ ] **Database & Replication Safety:**
  - มีการเพิ่ม `meal_session` ลงใน whitelist ของ `_design/access`
  - รองรับการทำงานแบบ Offline ผ่าน Local IndexedDB/PouchDB Proxy ตามมาตรฐาน Remote-first Architecture

---

## Migration

- `meal_session` เป็น doc type ใหม่ (schema_v 1) ไม่มีข้อมูลเก่าต้อง migrate
- `meal_plan` และ `meal_service` เพิ่มฟิลด์ optional เชื่อมโยง ไม่ทำให้ข้อมูลเดิมผิดรูป (schema_v คงเดิม)
- `kitchen_requisition` ปรับเพิ่ม `status`, `ticket_no`, `requested_at` โดย fallback สำหรับ doc เดิมให้อ่านเป็น `status: 'approved'`

---

## Decision Log

- 2026-09-02 — proposed (จัดทำ Draft CR สำหรับ CR-058 หมวด 3 และ CR-059 Flow 3 ตามผลการสัมภาษณ์ความต้องการและ UI Mockup)
