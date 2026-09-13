---
id: draft
title: หมวดหมู่สินค้ามาตรฐาน (Item Category Schema v2) และอาหารปรุงสุกแบบ Per-Dish ItemMaster
status: proposed
date: 2026-09-13
requested_by: Catalog & Logistics Working Group
decided_by: <รออนุมัติจาก Project Owner>
layer: volatile
affects:
  - docs/data/schema.md §4.1 (`item_category` schema_v 1 → 2)
  - docs/data/schema.md §4.2 (`item_master` — ยืนยันการใช้งาน per-dish ready_meal)
  - frontend/src/lib/features/catalog/
  - frontend/scripts/seed.ts
---

# draft-master-data-item-category-schema-v2 — หมวดหมู่สินค้ามาตรฐาน (Item Category Schema v2) และอาหารปรุงสุกแบบ Per-Dish ItemMaster

> [!NOTE]
> **สรุป (TL;DR):**
> ยกระดับสกีมาหมวดหมู่สินค้า `item_category` จาก `schema_v: 1` เป็น **`schema_v: 2`** ในฐานข้อมูลกลาง `catalog` โดยเพิ่มฟิลด์ `system_key`, `default_class`, `description`, และ `is_protected` พร้อมทั้งรับรอง 10 หมวดหมู่ระบบคุ้มครอง (Protected System Categories) เพื่อเป็นมาตรฐานกลางในการจำแนกประเภทสิ่งของบรรเทาทุกข์.
>
> ให้ลงทะเบียนอาหารปรุงสุก/อาหารกล่องเป็น **Per-Dish ItemMaster** รายเมนูภายใต้หมวดหมู่ `item_category:ready_meal` (`type_class: 'CONSUMABLE'`) โดยรักษามาตรฐาน `TypeClass` ดั้งเดิม 3 ชนิด (`CONSUMABLE`, `DURABLE`, `EQUIPMENT`) และ**ห้ามเพิ่มหมวดหมู่พิเศษ `PREPARED_FOOD`**

---

## 1. Why (เหตุผลและความจำเป็น)

1. **การจำแนกประเภทพัสดุขาดมาตรฐาน:** ใน `schema.md` §4.1 เดิม `item_category` (`schema_v: 1`) มีเพียงฟิลด์ `name`, `deactivated`, `override`, `shelter_code` ทำให้ไม่มีการกำหนดลักษณะทางกายภาพพื้นฐาน (`TypeClass`) ว่าเป็นของใช้สิ้นเปลือง ของใช้คงทน หรืออุปกรณ์
2. **ความต้องการในการควบคุมสิทธิ์อาหารและโภชนาการ:** อาหารปรุงสุกจากครัวหรือที่รับบริจาคเข้ามา จำเป็นต้องมีรหัสสินค้า (`ItemMaster`) เพื่อใช้ในการบันทึกสต็อก ตัดจ่าย และแจกจ่ายหน้างานอย่างมีมาตรฐาน
3. **การปฏิเสธ Food Archetypes:** ในร่างแบบเดิมบางฉบับได้เสนอให้ยุบอาหารเหลือเพียง 5 Archetype กว้าง ๆ ซึ่งทำให้สูญเสียข้อมูลสำคัญ เช่น ความต้องการอาหารเฉพาะกลุ่ม (Halal, อาหารอ่อน, อาหารเด็ก) การใช้ Per-Dish `ItemMaster` ภายใต้หมวดหมู่ `ready_meal` ช่วยรักษาความสมบูรณ์ของข้อมูลโภชนาการได้ดีกว่า
4. **ความคงเส้นคงวาของ TypeClass:** ระบบคงคลังและบัญชีคุมสต็อกอิงกับ 3 ประเภทหลัก (`CONSUMABLE`, `DURABLE`, `EQUIPMENT`) การสร้างประเภทที่ 4 เช่น `PREPARED_FOOD` จะทำให้โค้ดและรายงานเดิมทั้งหมดต้องแยกกิ่งทำงานโดยไม่จำเป็น

---

## 2. โครงสร้างสกีมา ItemCategory (schema_v: 2)

เอกสารในฐานข้อมูล `catalog`:
- **รหัสเอกสาร:** `item_category:{system_key_lowercase}` (สำหรับ 10 หมวดหมู่ระบบ) หรือ `item_category:{ulid}` (สำหรับหมวดหมู่ทั่วไป)
- **เวอร์ชันสกีมา:** `schema_v: 2`

| Field | ชนิด | req | หมายเหตุ |
| :--- | :--- | :--- | :--- |
| `name` | str | req | ชื่อหมวดหมู่ภาษาไทยสำหรับแสดงผล (เช่น `"อาหารและวัตถุดิบ (Food Ingredients)"`) |
| `system_key` | str | opt | รหัสระบุตัวตนเชิงระบบตัวพิมพ์ใหญ่ (เฉพาะ 10 หมวดหมู่ระบบคุ้มครอง เช่น `"FOOD"`, `"READY_MEAL"`) |
| `default_class` | enum(`CONSUMABLE`,`DURABLE`,`EQUIPMENT`) | opt | ประเภทพัสดุตั้งต้นสำหรับการนำไปใช้สร้าง `ItemMaster` (Auto-fill ใน UI) |
| `description` | str | opt | คำอธิบายขอบเขตของหมวดหมู่ |
| `is_protected` | bool | req | default `false`; หากเป็น `true` คือหมวดหมู่ระบบคุ้มครอง ห้ามลบหรือเปลี่ยน `system_key`/`default_class` |
| `deactivated` | bool | opt | default `false`; Soft-delete ปิดการใช้งาน |
| `override` | bool | opt | default `false`; เอกสารเฉพาะศูนย์ (ถ้ามี) |
| `shelter_code` | str | opt | รหัสศูนย์ (เฉพาะเอกสาร override) |

---

## 3. การรับรอง 10 หมวดหมู่ระบบคุ้มครอง (10 Protected System Categories — Option A)

รับรองหมวดหมู่ระบบเริ่มต้นจำนวน 10 รายการตาม Option A ที่ได้รับการอนุมัติจาก Project Owner และตรงตามสถาปัตยกรรม Private Domain Design โดยบรรจุไว้ในกระบวนการ Seed ของฐานข้อมูล `catalog`:

| ลำดับ | Document `_id` | System Key | ชื่อหมวดหมู่ภาษาไทย (`name`) | Default Class (`default_class`) | คำอธิบายมาตรฐาน (`description`) |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | `item_category:food` | `FOOD` | อาหารและวัตถุดิบ (Food Ingredients) | `CONSUMABLE` | วัตถุดิบประกอบอาหารสดและแห้งสำหรับโรงครัวกลาง |
| 2 | `item_category:water` | `WATER` | น้ำดื่มสะอาด (Drinking Water) | `CONSUMABLE` | น้ำดื่มบรรจุขวด ถังน้ำดื่มสะอาดสำหรับบริโภค |
| 3 | `item_category:wash` | `WASH` | สุขอนามัยและของใช้ส่วนตัว (WASH & Hygiene) | `CONSUMABLE` | สบู่ ยาสระผม แปรงสีฟัน ยาสีฟัน ผ้าอนามัย ผงซักฟอก |
| 4 | `item_category:medical` | `MEDICAL` | เวชภัณฑ์และการปฐมพยาบาล (Medical & First Aid) | `CONSUMABLE` | ยาสามัญประจำบ้าน ยาประจำตัว ชุดทำแผล แอลกอฮอล์ อุปกรณ์การแพทย์ |
| 5 | `item_category:special_care`| `SPECIAL_CARE` | ของใช้กลุ่มเปราะบาง (Special Care & Vulnerable) | `CONSUMABLE` | ผ้าอ้อมผู้ใหญ่/เด็ก นมผงทารก แผ่นรองซับ สำหรับกลุ่มเฉพาะ |
| 6 | `item_category:volunteer_ppe`| `VOLUNTEER_PPE` | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร (PPE & Operations) | `EQUIPMENT` | ถุงมือ เสื้อกั๊กสะท้อนแสง รองเท้าบูท อุปกรณ์คุ้มครองความปลอดภัย |
| 7 | `item_category:ready_meal` | `READY_MEAL` | อาหารปรุงเสร็จและเครื่องดื่ม (Ready-to-Eat Meals) | `CONSUMABLE` | อาหารปรุงสุกพร้อมรับประทาน ข้าวกล่อง นม สำหรับแจกจ่ายหน้างาน |
| 8 | `item_category:bedding` | `BEDDING` | เครื่องนอนและที่พักพิง (Shelter & Bedding) | `DURABLE` | เสื่อปูนอน มุ้ง ผ้าห่ม หมอน เต็นท์ครอบครัว พัสดุหมุนเวียนยืม-คืน |
| 9 | `item_category:fuel_energy` | `FUEL_ENERGY` | เชื้อเพลิงและพลังงาน (Fuel & Energy) | `CONSUMABLE` | แก๊สหุงต้ม LPG (15kg/4kg) น้ำมันดีเซลเครื่องปั่นไฟ ถ่านไม้ วัตถุไวไฟ |
| 10 | `item_category:kits` | `KITS` | ชุดพัสดุยังชีพรวม (Relief Kits & Packages) | `CONSUMABLE` | ถุงยังชีพพระราชทาน ชุดธารน้ำใจ ชุดสุขอนามัยครอบครัว |

---

## 4. นโยบายอาหารปรุงสุกแบบ Per-Dish ItemMaster

- อาหารปรุงสุกทุกเมนู (ทั้งที่ปรุงจากครัวของศูนย์ หรือรับบริจาคเข้ามาเป็นข้าวกล่องพร้อมทาน) จะต้องมีรายการ `ItemMaster` ประจำเมนู
- **หมวดหมู่:** `category: "item_category:ready_meal"`
- **ประเภทพัสดุ:** `type_class: "CONSUMABLE"` (ห้ามใช้ `PREPARED_FOOD`)
- **หน่วยนับหลัก (`base_unit`):** `"กล่อง"` หรือ `"ที่"` หรือ `"ชุด"`
- **ข้อมูลทางโภชนาการ/ความต้องการพิเศษ:** ระบุผ่านแท็ก เช่น `dietary: ["HALAL"]`, `is_soft_food: true` เพื่อให้ระบบคัดกรองแจกจ่ายตามความต้องการของผู้พักพิงได้อย่างแม่นยำ

---

## 5. การอพยพข้อมูลและความเข้ากันได้ (Migration & Compatibility)

- **`item_category` (v1 $\rightarrow$ v2):**
  - **10 หมวดหมู่ระบบคุ้มครอง:** มี `system_key` ตรงตามตาราง §3, ใช้ Deterministic ID (`item_category:food` ถึง `item_category:kits`), และมี `is_protected: true`
  - **หมวดหมู่เดิมของผู้ใช้ (Legacy v1) หรือหมวดหมู่ที่สร้างขึ้นเอง:** ยังคงรักษาตัวตนเดิม (`item_category:{ulid}`) โดยมี `system_key` เป็น `undefined / null / absent` (ห้ามสังเคราะห์หรือเดา `system_key = uppercase(name)` จากชื่อ display name โดยเด็ดขาด เพราะชื่ออาจเป็นภาษาไทย เปลี่ยนแปลงได้ หรือชนกัน), `is_protected` มีค่าเริ่มต้นเป็น `false`, และ `default_class` เป็น optional
  - **Idempotent Central Seeding:** สคริปต์ Seeder (`sync-central-db.ts` และ `seed.ts`) จะสร้างหรือตรวจสอบความถูกต้องของ 10 หมวดหมู่ระบบแบบ Idempotent โดยไม่แตะต้องหรือเขียนทับหมวดหมู่ของผู้ใช้
- **`ItemMaster`:** ไม่มีการเปลี่ยนแปลงฟิลด์ ยังคงอ้างอิง `category` ตามเดิม (รองรับทั้ง `category_id` และชื่อเดิม)

---

## 6. เกณฑ์การยอมรับ (Acceptance Criteria)

- **AC-CAT-01:** ระบบมีหมวดหมู่ `item_category:ready_meal` เป็นหมวดหมู่ประเภท `CONSUMABLE` และมี `is_protected: true`
- **AC-CAT-02:** ผู้ดูแลระบบสามารถลงทะเบียนเมนูอาหารปรุงสุกใหม่เป็น `ItemMaster` ที่ผูกกับ `item_category:ready_meal` ได้
- **AC-CAT-03:** ระบบไม่มีการเพิ่ม `type_class: 'PREPARED_FOOD'` และปฏิเสธค่า type class อื่นที่ไม่ใช่ `CONSUMABLE`, `DURABLE`, หรือ `EQUIPMENT`
