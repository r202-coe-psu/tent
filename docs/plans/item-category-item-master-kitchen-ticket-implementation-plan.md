---
title: "Implementation Plan — Item Category, Item Master, Recipe Portion และ Kitchen Ticket"
status: implemented
created: 2026-09-15
updated: 2026-09-15
scope: "CR-119, CR-120 (Catalog & Kitchen Foundation) และ CR-121 (Kitchen Requisition & Ready Meal Yield)"
---

# Implementation Plan: Item Category, Item Master, Recipe Portion และ Kitchen Ticket

เอกสารนี้กำหนดแผน implementation สำหรับ `Item Category`, `Item Master`, สูตรอาหารที่คำนวณตามจำนวน `portion`, การบริหารจัดการแก๊สในครัว และ `Kitchen Requisition Ticket` โดยอิงตาม:

- [CR-119 — Seed Item Categories](../changes/CR-119-seed-item-categories.md)
- [CR-120 — Fuel Energy / Gas Inventory](../changes/CR-120-fuel-energy-gas-inventory.md)
- [CR-121 — Requisition Ticket](../changes/CR-121-spec-ticket.md)
- [Data Schema](../data/schema.md)

> **ขอบเขตของแผนนี้ (Scope Definition):**
>
> 1. มุ่งเน้น **Catalog Pipeline** (10 System Categories, Item Master LPG & READY_MEAL, Recipe BOM, Portion Calculator)
> 2. มุ่งเน้น **Kitchen Requisition & Yield Flow** (สร้างตั๋วเบิกวัตถุดิบครัว `TKT-KITCHEN`, Picking, Approval, Dispatch ตัด Stock+Gas, และบันทึกผลผลิต Batch Yield + 4 ชม. Expiry)
> 3. **CR-120 Gas Scoping:** ครอบคลุม Item Master LPG, การเปลี่ยนโมเดลจาก `gas_cylinder_type` เป็น `fuel_cylinder`, การเลือกถังใน Meal Plan, และการตัด `gas_ledger` ส่วนงาน **Supply Warehouse UI** (ตารางสต็อก Dual Display `3 ถัง (45 กก.)`, Expandable Row, Modal จัดการถัง Batch Gen/Refill/Adjust ในคลัง) จะแยกเป็นอีกแผนงานสำหรับฝั่ง Supply เพื่อให้รอบนี้กระชับและส่งมอบแกนหลักของครัวได้รวดเร็ว
> 4. คำว่า `potion` ในคำขอเดิมถูกตีความเป็น `portion` หรือจำนวนชุดอาหารที่ต้องผลิต/จ่าย

---

## 1. เป้าหมาย

ทำให้ flow การปฏิบัติงานของโรงครัวและคลังวัตถุดิบทำงานต่อเนื่องและตรวจสอบย้อนหลังได้ 100%:

```text
Item Category (10 หมวดหมู่ระบบ + Protected 3 ชั้น)
    → Item Master (หมวดหมู่เป็น Category ID, Auto-fill Class, รองรับ LPG และ READY_MEAL)
    → Recipe / BOM (สัดส่วนวัตถุดิบต่อ Standard Portion)
    → Meal Plan (คำนวณ requested_qty ด้วย Decimal, ระบุถังแก๊ส fuel_cylinder)
    → Requisition Ticket (TKT-KITCHEN: snapshot วัตถุดิบ + แก๊ส, กันเบิกซ้ำด้วย meal_plan.ticket_id)
    → Picking & Approval (กำหนด allocated_qty โดยพนักงานคลัง, ผจก. อนุมัติ READY_FOR_DISPATCH)
    → Dispatch (ตัด stock_ledger และ gas_ledger พร้อมกันใน bulkDocs)
    → Kitchen Production Board (บันทึก yield_items[] เข้า meal_service และรับเข้า stock พร้อม Expiry 4 ชม.)
```

เป้าหมายสำคัญ:

1. ใช้ category ID มาตรฐานเดียวกันทั้งระบบ (`item_category:food` ถึง `item_category:kits`)
2. ป้องกันการลบหรือแก้ไขหมวดหมู่ระบบ 3 ชั้น (UI, Repository, CouchDB VDU)
3. แยกข้อมูล master ของสินค้าออกจากปริมาณการใช้ในสูตร (Portion scaling อยู่ใน Recipe ไม่ใช่ Item Master)
4. คำนวณวัตถุดิบตามจำนวน portion โดยใช้ Decimal และ `qty_str` ป้องกัน floating-point error
5. ปรับปรุง `MealPlanRecipe.planned_qty` ให้รองรับ Decimal string เพื่อไม่ให้ปัดเศษผิดพลาด
6. สร้าง `requisition_ticket` จาก meal plan พร้อม snapshot ปริมาณวัตถุดิบและแก๊สที่ต้องใช้
7. ป้องกันการสร้างตั๋วซ้ำด้วยการผูก `ticket_id` เข้ากับ `meal_plan` อาศัย CouchDB MVCC (`_rev`)
8. ตัดวัตถุดิบ (`reason: 'requisition'`) และแก๊ส (`reason: 'consumption'`) พร้อมกันเมื่อคลังกด dispatch
9. รองรับอาหารปรุงสำเร็จเป็น local `ItemMaster` รายเมนูใต้หมวด `item_category:ready_meal`
10. บันทึกผลผลิตแบบหลายเมนู (`yield_items[]`) พร้อมติดสติกเกอร์ล็อตและวันหมดอายุ 4 ชั่วโมง

---

## 2. สถานะปัจจุบันและช่องว่าง (Current State & Gap Analysis)

- **Catalog Foundation:** `ItemCategory` ในโค้ดยังไม่มี `system_key`, `default_class`, `description` และ `is_protected` ตาม CR-119 ([catalog.ts](../../frontend/src/lib/features/catalog/domain/catalog.ts:40))
- **Item Master:** ฟอร์ม Item Master ยังบันทึก category เป็นชื่อสตริงภาษาไทย ไม่ใช่ canonical `category_id` ([item-master-form.svelte](../../frontend/src/lib/features/catalog/ui/item-master-form.svelte:379)) และยังไม่มี dynamic LPG section
- **MealPlan Contract:** `MealPlanRecipe.planned_qty` ใน [kitchen.ts](../../frontend/src/lib/features/kitchen/domain/kitchen.ts:96) บังคับเป็น `z.number().int().positive()` ทำให้ไม่สามารถเก็บค่าทศนิยมของ portion ได้ (เช่น 37.5 kg)
- **Recipe Calculation:** `meal-calc.ts` ใช้ `.ceil().toNumber()` ปัดเศษเป็นจำนวนเต็ม แทนที่จะส่งผ่าน `Decimal` และคงรูป `qty_str`
- **Gas Model (CR-120):** ระบบครัวยังใช้ `gas_cylinder_type` เดิม แทน `fuel_cylinder` (schema_v 1) ([kitchen.ts](../../frontend/src/lib/features/kitchen/domain/kitchen.ts:293))
- **Kitchen Requisition (CR-121):** ระบบครัวยังใช้ `kitchen_requisition` เดิม และหน้าต่าง [requisition-dialog.svelte](../../frontend/src/lib/features/kitchen/ui/requisition-dialog.svelte) ยังทำหน้าที่ตัดสต็อกทันที แทนที่จะส่งตั๋วไปให้คลังจัดของ
- **Operations Ref-Prefix:** `REF_PREFIX_BY_REASON` ใน [operations.ts](../../frontend/src/lib/features/operations/domain/operations.ts:310) ยังล็อค `requisition: 'kitchen_requisition:'` ไม่ยอมรับ `requisition_ticket:` และ `receive` ยังไม่รับ `meal_service:`
- **Kitchen Yield:** `meal_service` ยังเป็นผลผลิตเดี่ยว ไม่มี `yield_items[]` และฟิลด์ `actual_yield`, `served`, `waste` ยังเป็น integer number ไม่ใช่ `qty_str`
- **CouchDB VDU:** `catalog/_design/access` ยังไม่อนุญาตให้ `kitchen_staff` เขียน `item_master` (ต้องเขียนลงฐานข้อมูลศูนย์ `shelter_{code}` เท่านั้น) และ `shelter-access-design.ts` ยังไม่มี `requisition_ticket` ใน `allowed` doc types

---

## 3. Data Contract

### 3.1 Item Category ตาม CR-119

ขยาย Interface `ItemCategory` เป็น **`schema_v: 2`**:

```ts
export const SYSTEM_CATEGORY_KEYS = [
  "FOOD",
  "WATER",
  "WASH",
  "MEDICAL",
  "SPECIAL_CARE",
  "VOLUNTEER_PPE",
  "READY_MEAL",
  "BEDDING",
  "FUEL_ENERGY",
  "KITS",
] as const;

export type SystemCategoryKey = (typeof SYSTEM_CATEGORY_KEYS)[number];

export interface ItemCategory extends CatalogDoc {
  type: "item_category";
  name: string;
  system_key?: SystemCategoryKey | string;
  default_class?: TypeClass;
  description?: string;
  is_protected?: boolean;
  is_default?: boolean;
  shelter_code?: string;
  override?: boolean;
}
```

หมวดหมู่ระบบ 10 รายการต้องใช้ deterministic ID:

| System key      | ID                            | Default class | ชื่อหมวดหมู่ภาษาไทย                               |
| --------------- | ----------------------------- | ------------- | ------------------------------------------------- |
| `FOOD`          | `item_category:food`          | `CONSUMABLE`  | อาหารและวัตถุดิบ (Food Ingredients)               |
| `WATER`         | `item_category:water`         | `CONSUMABLE`  | น้ำดื่มสะอาด (Drinking Water)                     |
| `WASH`          | `item_category:wash`          | `CONSUMABLE`  | สุขอนามัยและของใช้ส่วนตัว (WASH & Hygiene)        |
| `MEDICAL`       | `item_category:medical`       | `CONSUMABLE`  | เวชภัณฑ์และการปฐมพยาบาล (Medical & First Aid)     |
| `SPECIAL_CARE`  | `item_category:special_care`  | `CONSUMABLE`  | ของใช้กลุ่มเปราะบาง (Special Care & Vulnerable)   |
| `VOLUNTEER_PPE` | `item_category:volunteer_ppe` | `EQUIPMENT`   | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร (PPE & Operations) |
| `READY_MEAL`    | `item_category:ready_meal`    | `CONSUMABLE`  | อาหารปรุงเสร็จและเครื่องดื่ม (Ready-to-Eat Meals) |
| `BEDDING`       | `item_category:bedding`       | `DURABLE`     | เครื่องนอนและที่พักพิง (Shelter & Bedding)        |
| `FUEL_ENERGY`   | `item_category:fuel_energy`   | `CONSUMABLE`  | เชื้อเพลิงและพลังงาน (Fuel & Energy)              |
| `KITS`          | `item_category:kits`          | `CONSUMABLE`  | ชุดพัสดุยังชีพรวม (Relief Kits & Packages)        |

### 3.2 Item Master ตาม CR-119 และ CR-120

- ฟิลด์ `category` จัดเก็บเป็น canonical ID เช่น `"item_category:food"`
- รองรับ Backward Compatibility สำหรับเอกสารเดิมที่เก็บเป็นชื่อภาษาไทย โดย UI Dropdown จะจับคู่ทั้ง `_id` และ `name`

#### Ready Meal Item Master (CR-121)

อาหารปรุงสำเร็จเป็น `ItemMaster` รายเมนู:

```ts
{
  _id: 'item_master:{ulid}',
  type: 'item_master',
  name: 'ข้าวกะเพราไก่',
  category: 'item_category:ready_meal',
  type_class: 'CONSUMABLE',
  base_unit: 'กล่อง',
  shelter_code: 'SH001' // local shelter scope
}
```

> **ข้อกำหนดสิทธิ์:** `kitchen_staff` ได้รับอนุญาตให้สร้าง `item_master` เมนูอาหารปรุงสำเร็จได้เฉพาะ **Local Shelter Scope** (ต้องมี `shelter_code` เสมอ เพื่อเขียนลง `shelter_{shelter_code}`) ไม่อนุญาตให้เขียนลงฐานข้อมูลกลาง `catalog`

#### Fuel Energy Item Master (CR-120)

เมื่อเลือกหมวด `item_category:fuel_energy` ฟอร์มจะสลับเป็นโหมด LPG อัตโนมัติ:

```ts
{
  category: 'item_category:fuel_energy',
  type_class: 'CONSUMABLE',
  base_unit: 'ถัง', // locked
  fuel_type: 'LPG',
  capacity_kg: '15',
  burn_rate_kg_per_hour: '0.50',
  time_multiplier: '1.0'
}
```

และตัดฟิลด์ที่ไม่เกี่ยวข้อง (`shelf_life_days`, `allergens`, `dietary`, `returnable` ฯลฯ) ออกจากการ persist

### 3.3 Fuel Cylinder Document (CR-120)

แทนที่ `gas_cylinder_type` ด้วย `fuel_cylinder` (schema_v 1) ใน `shelter_{shelter_code}`:

```ts
export interface FuelCylinder extends BaseDoc {
  _id: string; // fuel_cylinder:{ulid}
  type: "fuel_cylinder";
  schema_v: 1;
  item_master_id: string; // FK item_master (หมวด FUEL_ENERGY)
  cylinder_code: string; // e.g. "LPG-01" (unique per shelter)
  name: string; // e.g. "เตาแก๊สหลัก 1"
  capacity_kg: string; // qty_str > 0
  burn_rate_kg_per_hour: string; // qty_str > 0
  time_multiplier: string; // qty_str > 0 (default "1.0")
  tare_weight_kg?: string;
  deactivated?: boolean;
}
```

### 3.4 Recipe / BOM

ปริมาณต่อ portion อยู่ใน Recipe ไม่ใช่ Item Master:

```ts
export interface RecipeIngredient {
  item_master_id: string;
  quantity: string; // qty_str ของ batch มาตรฐาน
  uom: string; // ต้องตรงกับ item_master.base_unit
}

export interface Recipe extends CatalogDoc {
  type: "recipe";
  label: string;
  ingredients: RecipeIngredient[];
  standard_portions: string; // qty_str > 0
  standard_duration_hours: string;
  deactivated?: boolean;
}
```

> **กฎ UOM:** ในเฟสนี้ บังคับ `ingredient.uom === item_master.base_unit` อย่างเคร่งครัดตามข้อกำหนด CR-045 หากหน่วยไม่ตรงกันให้ปฏิเสธการบันทึก เพื่อป้องกันความคลาดเคลื่อนจากการแปลงหน่วยที่ไม่มีตารางคำนวณมาตรฐาน

### 3.5 Meal Plan Update

ปรับปรุง `MealPlan` ใน `kitchen.ts` และ `docs/data/schema.md §2.5`:

```ts
export interface MealPlanRecipe {
  recipe_id: string;
  planned_qty: string; // ปรับจาก int เป็น qty_str รองรับทศนิยม portion
  unit?: string;
}

export interface MealPlan extends BaseDoc {
  // ... fields เดิม
  recipes: MealPlanRecipe[];
  ticket_id?: string | null; // FK requisition_ticket (กันเบิกซ้ำ)
  gas_usage?: Array<{
    cylinder_id: string; // FK fuel_cylinder
    consumption_kg: string; // qty_str
  }>;
}
```

---

## 4. สูตรคำนวณตาม Portion และ Precision Rules

กำหนดการคำนวณวัตถุดิบจาก Recipe สู่ Meal Plan:

```text
planned_portions = meal_plan.headcount.total
scale = Decimal(planned_portions).div(Decimal(recipe.standard_portions))
requested_qty = Decimal(ingredient.quantity).mul(scale)
```

ตัวอย่าง:

```text
สูตรมาตรฐาน 100 portions:
- ข้าวสาร: 20 kg
- ไข่ไก่: 200 ฟอง
- เกลือ: 0.15 kg

แผนใหม่ 250 portions:
- scale = 250 / 100 = 2.5
- ข้าวสาร = 20 × 2.5 = 50 kg
- ไข่ไก่ = 200 × 2.5 = 500 ฟอง
- เกลือ = 0.15 × 2.5 = 0.375 kg (บันทึกเป็น "0.375" qty_str ห้ามปัดเป็น int)
```

**กฎเหล็กการคำนวณ:**

1. ใช้ `Decimal` จาก `decimal.js` ผ่าน `$lib/utils/qty.ts` เสมอ
2. Persist ทุกปริมาณเป็น `qty_str` (string)
3. ห้ามใช้ JavaScript floating-point (`+`, `*`, `/`) ในการคำนวณตัวเลขสต็อก
4. ปฏิเสธการคำนวณหาก `headcount.total <= 0` หรือ `recipe.standard_portions <= 0`
5. รวมรายการ ingredient ที่มี `item_master_id` เดียวกันก่อนนำไปสร้างตั๋ว (Group by `item_master_id` และรวมผลด้วย `addQty`)
6. ตรวจสอบว่า ingredient ทุกตัวอ้างอิง `item_master` ที่ยังมีสถานะ active (`!deactivated`)
7. ตรวจสอบ `ingredient.uom === item_master.base_unit`
8. หน่วยนับที่ไม่สามารถแบ่งทศนิยมได้หน้างาน (เช่น ถัง, กล่อง, ฟอง) ให้แสดงตัวเลขที่คำนวณได้บน Preview และให้ฝ่ายคลังปรับ `allocated_qty` เป็นจำนวนเต็มตอนหยิบของจริง

---

## 5. Kitchen Requisition Ticket ตาม CR-121

### 5.1 Ticket Document Contract

เอกสาร `requisition_ticket` สำหรับประเภท `kitchen`:

```ts
export interface RequisitionTicket extends BaseDoc {
  _id: string; // requisition_ticket:{ulid}
  type: "requisition_ticket";
  schema_v: 1;
  ticket_no: string; // e.g. "TKT-KITCHEN-0001"
  requisition_type: "kitchen";
  status: TicketStatus;
  meal?: MealPeriod;
  meal_plan_id: string; // required สำหรับ kitchen
  source_location: string; // "warehouse:main"
  destination_location: string; // "kitchen"
  requested_by: string; // user_id ผู้เปิดตั๋ว
  approved_by?: string; // user_id ผจก. ผู้ตรวจสอบ
  dispatched_by?: string; // user_id เจ้าหน้าที่คลังผู้ปล่อยของ
  received_by?: string; // user_id ฝ่ายครัวผู้รับของ

  // Audit Snapshot
  planned_portions?: string;
  source_recipe_ids?: string[];

  // Snapshot แก๊สที่ต้องตัดพร้อมวัตถุดิบ (CR-120/121 Reconciliation)
  gas_usage?: Array<{
    cylinder_id: string;
    consumption_kg: string;
  }>;

  items: Array<{
    item_id: string; // FK item_master
    item_name: string;
    category?: string;
    type_class: TypeClass;
    unit: string; // required เพื่อผูกกับ stock_ledger.unit
    requested_qty: string; // qty_str snapshot ณ เวลาเปิดตั๋ว
    allocated_qty: string; // qty_str ระบุโดยพนักงานคลัง
  }>;
  notes?: string;
}
```

### 5.2 Kitchen Ticket Lifecycle

```text
🟡 PENDING_PICK (ครัวเปิดตั๋ว / คลังเริ่มหยิบของและระบุ allocated_qty)
  ↓
🔵 READY_FOR_DISPATCH (ผจก. ตรวจสอบความถูกต้องและอนุมัติ)
  ↓
🚚 IN_TRANSIT (คลังกดยืนยันส่งของ ➔ ตัด stock_ledger และ gas_ledger ทันที)
  ↓
✅ COMPLETED (ครัวตรวจนับของจริงและกดยืนยันรับเข้าครัว ➔ จบวงจร)
```

> **เหตุผลที่ไม่ใช้ DISTRIBUTING/SHIFT_CLOSED:** วงจรการแจกจ่าย 7 ขั้นตอน (Distributing ➔ Shift Closed ➔ Return) ใช้เฉพาะตั๋วประเภท `food`, `supplies`, และ `transfer` ที่ต้องนำของไปแจกต่อผู้พักพิงหน้างาน ตั๋ววัตถุดิบครัวสิ้นสุดเมื่อของส่งถึงครัว (`COMPLETED`)

### 5.3 กลไกป้องกันการเปิดตั๋วซ้ำ (Idempotent Concurrency Guard)

เพื่อป้องกันการกดเบิ้ลหรือสร้างตั๋วซ้ำซ้อนจาก Meal Plan เดียวกัน:

1. เมื่อฝ่ายครัวกดยืนยันสร้างตั๋ว ระบบจะสร้าง `requisition_ticket` และทำการ patch เอกสาร `meal_plan` โดยใส่ `ticket_id = ticket._id` ในคราวเดียวกัน
2. หากมีการกดส่งคำขอซ้ำ CouchDB MVCC (`_rev` conflict) จะ reject คำขอที่สองทันที
3. บน UI หน้าครัว หาก `meal_plan.ticket_id` มีค่าอยู่แล้ว ให้ disable ปุ่มสร้างตั๋ว และแสดง Badge สถานะของตั๋วพร้อมลิงก์ไปยังหน้ารายละเอียดตั๋วแทน

### 5.4 การตัด Stock และ Gas ตอน Dispatch (Atomic Execution)

เมื่อผู้จัดการหรือเจ้าหน้าที่คลังกดยืนยันปล่อยของ (`[ 🚚 เริ่มดำเนินการจัดส่ง ]`):

1. **Lock & Verify:**
   - ตรวจสอบว่าตั๋วอยู่ในสถานะ `READY_FOR_DISPATCH`
   - ตรวจสอบ `allocated_qty > 0` ทุกรายการ
   - ตรวจสอบยอดคงเหลือล่าสุดในคลัง (`on_hand >= allocated_qty`)
   - หากมี `gas_usage` ตรวจสอบยอดแก๊สคงเหลือในถัง `fuel_cylinder` แต่ละใบ (`remaining_kg >= consumption_kg`)
   - หากวัตถุดิบหรือแก๊สไม่เพียงพอ ให้ reject operation ทั้งหมด (ห้ามตัดบางส่วน)
2. **Assemble Ledger Entries:**
   - สร้าง `stock_ledger` แยกตามรายการสินค้า:
     - `qty: -allocated_qty` (Signed Decimal String)
     - `unit: item.unit`
     - `reason: 'requisition'`
     - `ref_id: ticket._id` (`requisition_ticket:{ulid}`)
   - หากมี `gas_usage` สร้าง `gas_ledger` ควบคู่กัน:
     - `cylinder_id: g.cylinder_id`
     - `qty_kg: -g.consumption_kg`
     - `reason: 'consumption'`
     - `ref_id: ticket._id`
3. **Atomic Commit:**
   - ปรับสถานะตั๋วเป็น `IN_TRANSIT` พร้อมบันทึก `dispatched_by` และ `updated_at`
   - บันทึก `[ticket, ...stockLedgers, ...gasLedgers]` ผ่าน strict `_bulk_docs` คำสั่งเดียว
   - เนื่องจาก CouchDB `_bulk_docs` รายงานผลแยกต่อเอกสาร ระบบใช้ ledger ID แบบ deterministic ต่อ ticket/line, ไม่ยอมรับ conflict แบบเงียบ ๆ และ reconcile แถวที่ขาดเมื่อ retry เพื่อให้ผลลัพธ์เชิงธุรกิจเป็น exactly-once แม้เกิด partial response ระหว่าง network failure

---

## 6. Kitchen Production และ Ready Meal Yield

เมื่อครัวปรุงอาหารเสร็จสิ้น ทำการบันทึกผลผลิตผ่าน Production Board (`/back-office/kitchen/production-board`):

### 6.1 ขยาย MealService Contract

```ts
export interface KitchenYieldItem {
  item_id: string; // FK item_master (หมวด item_category:ready_meal)
  menu_name: string; // ชื่อเมนูอาหาร
  category: "item_category:ready_meal";
  type_class: "CONSUMABLE";
  actual_yield: string; // qty_str
  unit: string; // เช่น "กล่อง"
  storage_zone?: string;
  cooking_completed_at: string; // ISO Timestamp เวลาที่ปรุงเสร็จ
}

export interface MealService extends BaseDoc {
  type: "meal_service";
  date: string;
  meal: MealPeriod;
  meal_plan_id: string | null;
  yield_items?: KitchenYieldItem[];
  actual_yield?: string; // sum(yield_items.actual_yield) เป็น qty_str
  served: string; // qty_str (CR-038)
  waste: string; // qty_str (CR-038)
  external: {
    volunteers: number;
    outside_evacuees: number;
  };
  notes?: string;
}
```

### 6.2 การรับผลผลิตเข้าคลังพร้อมวันหมดอายุ 4 ชั่วโมง

เมื่อกดบันทึกผลผลิต:

1. ตรวจสอบว่า `item_master` ของแต่ละเมนูเป็นหมวดหมู่ `item_category:ready_meal`
2. สร้าง `stock_ledger` รับเข้าแยกตามเมนู:
   - `qty: +item.actual_yield`
   - `unit: item.unit`
   - `reason: 'receive'`
   - `ref_id: meal_service._id` (`meal_service:{ulid}`)
   - `lot.lot_no`: สร้างตามรูปแบบ `LOT_NO_PATTERN` (เช่น `L-YYMMDD-001`)
   - `lot.note`: บันทึก `menu_name`
   - `lot.expiry`: คำนวณเป็น `cooking_completed_at + 4 ชั่วโมง`
3. บันทึก `meal_service` และ `stock_ledger` ทั้งหมดผ่าน `bulkDocs` แบบ Atomic

---

## 7. แผนการแก้ไขไฟล์และลำดับขั้นตอน (Phased Implementation)

### Phase 0 — Contracts, Schemas และ Database Whitelists

- **`docs/data/schema.md`**:
  - อัปเดต `item_category` เป็น schema_v 2
  - อัปเดต `item_master` สำหรับ `category_id`, LPG specs, และ READY_MEAL
  - แทนที่ `gas_cylinder_type` ด้วย `fuel_cylinder` (schema_v 1)
  - ขยาย `meal_plan.recipes[].planned_qty` เป็น `qty_str` และเพิ่ม `ticket_id`
  - เพิ่ม `requisition_ticket` (schema_v 1) และขยาย `meal_service.yield_items`
- **`frontend/src/lib/features/operations/domain/operations.ts`**:
  - อัปเดต `REF_PREFIX_BY_REASON`:
    - `requisition`: `['requisition_ticket:', 'kitchen_requisition:']`
    - `receive`: เพิ่ม `'meal_service:'` และ `'requisition_ticket:'`
- **`frontend/src/lib/server/shelter-access-design.ts`**:
  - นำ `'gas_cylinder_type'` ออกจาก `allowed` และเพิ่ม `'fuel_cylinder'`, `'requisition_ticket'`
  - กำหนดให้ `requisition_ticket` เป็น Mutable Doc (ห้ามใส่ใน `appendOnly`)
  - กำหนดสิทธิ์ให้ `kitchen_staff` เขียน local `item_master` (เฉพาะ READY_MEAL) ในฐานข้อมูลศูนย์ได้

### Phase 1 — Catalog Foundation & 10 System Categories (CR-119)

- **`frontend/src/lib/features/catalog/domain/catalog.ts`**:
  - ประกาศ `SYSTEM_CATEGORY_KEYS`, `SystemCategoryKey`, ขยาย `ItemCategory` schema_v 2
  - เพิ่ม `is_protected`, `default_class`, `system_key`, `description`
- **`frontend/src/lib/features/catalog/data/catalog.remote.ts`**:
  - เพิ่ม Guard ใน `deleteItemCategory`: หาก `is_protected === true` ให้ throw Error
- **`catalog/_design/access` (CouchDB VDU)**:
  - บล็อกการลบและบล็อกการแก้ไข `system_key`, `default_class` ของ Protected Categories
- **`frontend/scripts/sync-central-db.ts` & `seed.ts`**:
  - สร้างฟังก์ชัน `syncSystemItemCategories` แบบ Idempotent seed 10 หมวดหมู่ระบบ

### Phase 2 — Item Master LPG & fuel_cylinder Domain (CR-120 Foundation)

- **`frontend/src/lib/features/catalog/ui/item-master-form.svelte`**:
  - เปลี่ยน Category Select ให้เก็บค่า `_id`
  - ทำ Reactive Watcher: Auto-fill `type_class` ตาม `default_class` ของหมวดหมู่ที่เลือก
  - เพิ่ม Dynamic LPG Specs Section เมื่อเลือก `item_category:fuel_energy` (บังคับ `base_unit = 'ถัง'`, ซ่อนฟิลด์อาหาร)
- **`frontend/src/lib/features/kitchen/domain/kitchen.ts`**:
  - ลบ `GasCylinderType` ทั้งหมด และเพิ่ม `FuelCylinder` พร้อม Zod Schemas
  - ปรับปรุง Helper functions ให้คำนวณ `fuel_cylinder` balance
- **`frontend/scripts/seed.ts`**:
  - Seed Item Master `แก๊สหุงต้ม LPG 15 กิโลกรัม` ใน Catalog
  - Seed ถังแก๊สตัวอย่าง 3 ใบ (`LPG-01` เต็ม, `LPG-02` กำลังใช้, `LPG-03` เปล่า) ในศูนย์ `SH001`

### Phase 3 — Recipe BOM & Portion Calculator

- **`frontend/src/lib/features/catalog/domain/catalog.ts`**:
  - บังคับ `recipe.ingredients[].uom === item_master.base_unit`
- **`frontend/src/lib/features/kitchen/domain/kitchen.ts`**:
  - ปรับปรุง `MealPlanRecipe`: เปลี่ยน `planned_qty` เป็น `qty_str` โดยใช้ `qtyStrCoercePositiveSchema`
- **`frontend/src/lib/features/kitchen/domain/meal-calc.ts`**:
  - ปรับปรุง `calculateMealIngredientsFromRecipe`: คำนวณด้วย `Decimal` และคงค่าทศนิยมเป็น `qty_str` (ไม่ใช้ `.ceil().toNumber()`)
  - รวมรายการ ingredient ที่มี `item_master_id` ซ้ำกันด้วย `addQty`
  - ตรวจสอบสถานะ active ของ `item_master`

### Phase 4 — Kitchen Ticket Lifecycle, Kitchen UI & Workspaces (CR-121)

- **`frontend/src/lib/features/tickets/` (สร้าง Module ใหม่)**:
  - `domain/ticket.ts`: Enums, Types (`RequisitionTicket`), Zod Schemas
  - `data/ticket.repository.ts` & `ticket.remote.ts`: CRUD, picking, dispatch atomic mutation
  - `application/queries.ts`: SvelteQuery hooks สำหรับตั๋ว
- **`frontend/src/lib/features/kitchen/ui/requisition-dialog.svelte`**:
  - เปลี่ยนจากการกดเบิกตัดสต็อกโดยตรง เป็นแบบฟอร์ม **"สร้างคำขอเบิกวัตถุดิบ (TKT-KITCHEN)"**
  - ซ่อนช่องแก้ไขจำนวนที่จ่าย (`allocated_qty`) แสดงเฉพาะ `requested_qty` ที่คำนวณจากสูตร
  - Snapshot `gas_usage` จาก `meal_plan` ลงในตั๋ว
  - เมื่อสร้างตั๋วสำเร็จ ทำการผูก `meal_plan.ticket_id = ticket._id`
- **`frontend/src/routes/(protected)/back-office/kitchen/`**:
  - แสดงสถานะของตั๋วบน Meal Plan Card (รอจัดของ, พร้อมส่ง, จัดส่งแล้ว)
- **`frontend/src/routes/(protected)/back-office/tickets/`**:
  - หน้า Landing Hub: `/back-office/tickets`
  - หน้ารายการตั๋วครัว: `/back-office/tickets/kitchen`
  - หน้ารายละเอียดตั๋ว: `/back-office/tickets/[id]` (รองรับพนักงานคลังกรอก `allocated_qty`, ผจก. อนุมัติ, และกด Dispatch ตัด Stock+Gas)

### Phase 5 — Production Board & READY_MEAL Batch Yield

- **`frontend/src/lib/features/kitchen/domain/kitchen.ts`**:
  - ขยาย `MealService` และ `MealServiceInput` รองรับ `yield_items: KitchenYieldItem[]`
  - ปรับปรุง `actual_yield`, `served`, `waste` ให้รองรับ `qty_str` แบบ backward-compatible
- **`frontend/src/lib/features/kitchen/data/kitchen.remote.ts`**:
  - ปรับปรุง `recordMealService` ให้สร้าง `stock_ledger` รับเข้าแบบ Multi-menu พร้อม lot expiry 4 ชั่วโมง
- **`frontend/src/routes/(protected)/back-office/kitchen/production-board/+page.svelte`**:
  - เชื่อมต่อข้อมูลจริง: ดึงเมนูจาก Meal Plan หรือเลือก `item_master` หมวด `READY_MEAL`
  - เพิ่มปุ่ม On-the-fly สร้างเมนูอาหารปรุงสำเร็จใหม่ (บันทึกลง `shelter_{shelter_code}`)
  - ป้อนผลผลิตรายเมนูและคำนวณเวลานับถอยหลัง 4 ชั่วโมง

### Phase 6 — Integration, Clean Reseed & E2E Testing

- รัน `pnpm redeploy:access` อัปเดต design document ของ CouchDB
- ทำการ Reset/Reseed ฐานข้อมูลสำหรับ dev/test ด้วย `pnpm seed`
- เขียน Unit & Integration Tests ครอบคลุม:
  - Seed Idempotency & Protected Category Deletion Guard
  - Recipe Portion Decimal Calculation (เช่น 0.15 kg x 250)
  - Concurrency Guard บน Meal Plan ไม่ให้สร้างตั๋วซ้ำ
  - Dispatch Ticket แล้วตัด `stock_ledger` และ `gas_ledger` ถูกต้องพร้อมกัน
  - บันทึก Batch Yield ได้รับ stock พร้อม Expiry 4 ชม.

---

## 8. สิทธิ์การใช้งานและการแยก Scope ฐานข้อมูล (Security Matrix)

| การดำเนินการ (Action)              | บทบาทที่อนุญาต (Role)                | ฐานข้อมูลเป้าหมาย                           | มาตรการควบคุมความปลอดภัย                                |
| ---------------------------------- | ------------------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| จัดการ 10 หมวดหมู่ระบบ             | `system_admin`                       | `catalog`                                   | ล็อคห้ามลบเด็ดขาด 3 ชั้น; แก้ได้เฉพาะชื่อไทย/คำอธิบาย   |
| สร้าง/แก้ไข หมวดหมู่ทั่วไป         | `shelter_manager`, `warehouse_staff` | `catalog` (ส่วนกลาง) หรือ `shelter_{code}`  | ตรวจสอบบทบาทและ shelter_code                            |
| สร้าง Item Master ทั่วไป/LPG       | `shelter_manager`, `warehouse_staff` | `catalog`                                   | บังคับสเปก LPG และล็อคหน่วย "ถัง"                       |
| สร้าง READY_MEAL เมนูใหม่          | `kitchen_staff`                      | `shelter_{code}` **(Local Scope เท่านั้น)** | บังคับระบุ `shelter_code` ห้ามเขียนลง `catalog` กลาง    |
| วางแผนอาหาร (Meal Plan)            | `kitchen_staff`                      | `shelter_{code}`                            | บันทึก headcount, portion และถังแก๊ส                    |
| เปิดตั๋วเบิกวัตถุดิบ (TKT-KITCHEN) | `kitchen_staff`                      | `shelter_{code}`                            | สถานะเริ่มต้น `PENDING_PICK`, ผูก `meal_plan.ticket_id` |
| ระบุจำนวนที่จัดได้ (Picking)       | `warehouse_staff`                    | `shelter_{code}`                            | บันทึก `allocated_qty` บนตั๋ว                           |
| อนุมัติตั๋วพร้อมส่ง                | `shelter_manager`, `system_admin`    | `shelter_{code}`                            | เปลี่ยนสถานะเป็น `READY_FOR_DISPATCH`                   |
| ปล่อยของและตัดสต็อก (Dispatch)     | `warehouse_staff`, `shelter_manager` | `shelter_{code}`                            | เปลี่ยนเป็น `IN_TRANSIT`, ตัด Stock+Gas แบบ Atomic      |
| ยืนยันรับวัตถุดิบเข้าครัว          | `kitchen_staff`                      | `shelter_{code}`                            | เปลี่ยนสถานะเป็น `COMPLETED`                            |
| บันทึกผลผลิตอาหารปรุงสำเร็จ        | `kitchen_staff`                      | `shelter_{code}`                            | บันทึก `meal_service` และรับเข้าสต็อก (+4 ชม.)          |

---

## 9. Test Plan และ Definition of Done

### 9.1 Item Category & Item Master

- [ ] รัน `pnpm seed` แล้วปรากฏ 10 หมวดหมู่ระบบใน DB `catalog` ครบถ้วน
- [ ] รัน Seed ซ้ำแล้วค่าไม่เพี้ยน (`skipped = 10`) — ต้องยืนยันกับ CouchDB จริง
- [x] ลบ Protected Category ไม่ได้ทั้งจาก UI (ปุ่มถูกซ่อน), Repository (throw error) และ Direct CouchDB API (403 Forbidden)
- [x] สร้าง Item Master เมื่อเลือกหมวดหมู่ ระบบ Auto-fill `type_class` ถูกต้อง
- [x] สร้าง Item Master แก๊ส LPG: ช่อง UOM ถูกล็อคเป็น "ถัง", บังคับกรอก `capacity_kg` และ `burn_rate` และไม่บันทึกฟิลด์อาหาร

### 9.2 Recipe & Portion Calculator

- [x] คำนวณสูตร 100 → 250 portions ได้ค่าแม่นยำ ไม่ปัดเศษตัวเลขทศนิยมสูญหาย (เช่น เกลือ 0.15 kg x 2.5 = 0.375 kg)
- [x] Zod schema ยอมรับ `planned_qty` ที่เป็น `qty_str` ทศนิยม
- [x] รวมรายการ ingredient ที่ซ้ำกันในสูตรได้อย่างถูกต้อง
- [x] ปฏิเสธการคำนวณหาก `headcount.total <= 0` หรือ `standard_portions <= 0`
- [x] ปฏิเสธวัตถุดิบที่ UOM ไม่ตรงกับ `item_master.base_unit`

### 9.3 Kitchen Ticket Lifecycle

- [x] ครัวกดขอเบิกจาก Meal Plan แล้วได้ตั๋ว `TKT-KITCHEN-xxxx` ในสถานะ `PENDING_PICK`
- [x] เอกสาร `meal_plan` มีการบันทึก `ticket_id` และป้องกันการกดสร้างตั๋วซ้ำสำเร็จ
- [x] พนักงานคลังสามารถระบุ `allocated_qty` ในหน้า `/back-office/tickets/[id]` ได้
- [x] ผู้จัดการสามารถกดอนุมัติ `READY_FOR_DISPATCH` ได้ แต่พนักงานทั่วไปกดไม่ได้
- [x] เมื่อกดปล่อยของ (`IN_TRANSIT`):
  - สร้าง `stock_ledger` รายการติดลบตาม `allocated_qty` โดยมี `ref_id: requisition_ticket:...`
  - สร้าง `gas_ledger` รายการติดลบตาม `consumption_kg` โดยมี `ref_id: requisition_ticket:...`
  - ตรวจสอบว่า `stock_ledger` ผ่านการ validate ของ `REF_PREFIX_BY_REASON`
  - หากสต็อกหรือแก๊สไม่พอ ระบบ reject ก่อนเขียน; หากเกิด partial response ระบบใช้ deterministic IDs และ reconciliation เพื่อไม่ให้ตัดซ้ำ
- [x] ครัวกดยืนยันรับของแล้ว ตั๋วเปลี่ยนสถานะเป็น `COMPLETED`

### 9.4 Production Yield & Expiry

- [x] Kitchen Staff สามารถบันทึกผลผลิตหลายเมนูใน 1 มื้อได้
- [x] `stock_ledger` รับเข้าแยกตามเมนู มีเลขล็อต `lot_no` ตรงตามรูปแบบ `L-YYMMDD-XXX`
- [x] วันหมดอายุใน `lot.expiry` ถูกตั้งเป็น `cooking_completed_at + 4 ชั่วโมง`
- [x] แสดงป้ายเตือน Soft Warning เมื่ออาหารในสต็อกมีอายุเกิน 4 ชั่วโมง

---

## 10. Open Decisions & Architectural Alignments

1. **Resolved — Kitchen Requisition ใช้ `requisition_ticket`:** ตามมติ CR-121 ยกเลิกการสร้าง `kitchen_requisition` ใหม่ โดยคงไว้เฉพาะตัวอ่านประวัติย้อนหลัง (Historic Read-only)
2. **Resolved — Lifecycle ของตั๋วครัว:** ใช้ `PENDING_PICK → READY_FOR_DISPATCH → IN_TRANSIT → COMPLETED` โดยไม่ต้องผ่านสถานะ `DISTRIBUTING` หรือขั้นตอนคืนของ
3. **Resolved — Snapshot แก๊สบนตั๋วเบิก:** ตั๋ว `TKT-KITCHEN` จะ snapshot `gas_usage` จาก Meal Plan มาไว้บนตัวตั๋ว เพื่อให้ฝ่ายคลังตรวจสอบความพร้อมและตัดสต็อกวัตถุดิบพร้อมแก๊สได้ใน Transaction เดียวกันตอน Dispatch
4. **Resolved — Clean Replacement ของ CR-120 Gas:** ปฏิบัติตามมติ Pre-production Clean Reset ถอด `gas_cylinder_type` ออกจากระบบทั้งหมด และแทนที่ด้วย `fuel_cylinder` โดยไม่มีการทำ Migration Script
5. **Resolved — การแบ่งขอบเขต CR-120:** แผนนี้ส่งมอบส่วนของ Item Master LPG, Data Model `fuel_cylinder`, การเลือกถังใน Meal Plan และการตัด `gas_ledger` ส่วน Supply Warehouse UI (ตาราง Dual Display, Modal จัดการถังในคลัง) จะแยกทำในแผนงาน Supply Inventory ต่อไป
6. **Resolved — ป้องกันการสร้างตั๋วซ้ำด้วย CouchDB MVCC:** ผูก `meal_plan.ticket_id` เมื่อสร้างตั๋ว เพื่ออาศัย `_rev` Conflict ป้องกัน Race Condition 100% แทนการใช้ Soft Query
7. **Resolved — สิทธิ์สร้าง Ready Meal ของครัว:** กำหนดให้สร้างได้เฉพาะใน Local Shelter DB (`shelter_{code}`) เพื่อไม่ให้ขัดกับ CouchDB VDU ของฐานข้อมูลกลาง `catalog`

## 11. Implementation Verification

- [x] `svelte-kit sync` และ `svelte-check --tsconfig ./tsconfig.json` ผ่าน 0 errors / 0 warnings
- [x] Full Vitest ผ่าน 203 files, 2,799 tests ผ่าน, 8 skipped (legacy write fixtures retained as skipped)
- [x] `vite build` ผ่าน
- [x] `git diff --check` และ Prettier check ผ่าน
- [x] Legacy source scan ไม่พบ `gas_cylinder_type` / `GasCylinderType` ใน non-test source
- [x] `gas_ledger` บังคับ `requisition_ticket:*`, sign ของ `qty_kg`, `fuel_cylinder:*` และ role ของผู้เขียนครบทั้ง domain/VDU
- [ ] Live CouchDB clean reseed และ `redeploy:access` ต้องรันใน environment ที่มี CouchDB พร้อมใช้งาน
