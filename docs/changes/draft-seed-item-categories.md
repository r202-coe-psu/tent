---
id: draft
title: ฐานข้อมูล 10 หมวดหมู่ระบบมาตรฐาน (10 System Protected Categories) และกลไก Seed ข้อมูลเริ่มต้นใน Catalog
status: proposed
date: 2026-09-12
updated: 2026-09-12
requested_by: "Project Owner (ระบบบริหารจัดการสิ่งของบรรเทาทุกข์และโรงครัวกลาง)"
decided_by: <รออนุมัติจาก Project Owner>
layer: stable
affects:
  - docs/data/schema.md §4.1 (`item_category` schema_v 1 → 2)
  - docs/data/schema.md §4.2 (`item_master` category field reference)
  - frontend/src/lib/features/catalog/domain/catalog.ts
  - frontend/src/lib/features/catalog/data/catalog.remote.ts
  - frontend/src/lib/features/catalog/ui/item-category-form.svelte
  - frontend/src/lib/features/catalog/ui/item-master-form.svelte
  - frontend/src/routes/(protected)/back-office/catalog/components/item-category-tab.svelte
  - frontend/src/routes/(protected)/portal/system-management/catalog/components/item-category-tab.svelte
  - frontend/scripts/sync-central-db.ts
  - frontend/scripts/seed.ts
---

# Draft CR: ฐานข้อมูล 10 หมวดหมู่ระบบมาตรฐาน (10 System Protected Categories) และกลไก Seed ข้อมูลเริ่มต้นใน Catalog

> **สรุป (TL;DR):**  
> **เปลี่ยนอะไร:** กำหนด 10 หมวดหมู่ระบบมาตรฐาน (10 System Protected Categories) พร้อมขยาย Schema `item_category` (`schema_v 1 → 2`) เพิ่มฟิลด์ `system_key`, `default_class`, `description`, `is_protected` · ล็อคห้ามลบเด็ดขาด 3 ชั้น (UI, Repository, CouchDB VDU) · เชื่อมโยง `item_master.category` เก็บ `category_id` พร้อม Auto-fill `type_class` อัตโนมัติ · บรรจุ Seed อัตโนมัติแบบ Idempotent ใน `sync-central-db.ts` และ `seed.ts`  
> **เพื่อใคร/ทำไม:** ผู้ดูแลระบบส่วนกลาง (SA), ผู้จัดการคลังสินค้า, โรงครัว และฝ่ายแจกจ่าย เพื่อสร้างมาตรฐานการจำแนกพัสดุ/อาหารที่สอดคล้องทั้งระบบ ป้องกัน Data Corruption จากการเผลอลบหมวดหมู่หลัก และลดความผิดพลาดตอนลงทะเบียนสินค้าใหม่  
> **dev ต้อง build อะไร:** ขยาย domain schema/type `ItemCategory`, ปรับปรุงฟังก์ชันป้องกันการลบใน `catalog.remote.ts` และ VDU CouchDB, เพิ่มฟังก์ชัน Auto-fill ใน `item-master-form.svelte`, ปรับหน้าจัดการหมวดหมู่ซ่อนปุ่มลบสำหรับ protected categories, และเขียน Idempotent Seeder ใน `sync-central-db.ts`  
> **กระทบ schema/scope:** `docs/data/schema.md` §4.1 (`item_category` schema_v 1 → 2) และ §4.2 (`item_master` category reference)

---

## 1. Why (ที่มาและความจำเป็น)

1. **ขาด Master Categories มาตรฐานระดับระบบ:**
   ระบบปัจจุบันเปิดให้สร้าง `item_category` ได้อย่างอิสระโดยไม่มีชุดข้อมูลตั้งต้น (Cold-start empty database) ทำให้แต่ละศูนย์พักพิงตั้งชื่อหมวดหมู่ไม่ตรงกัน (เช่น บางศูนย์ตั้ง "อาหาร", บางศูนย์ตั้ง "ของกิน", บางศูนย์ตั้ง "วัตถุดิบครัว") ส่งผลให้การรายงานภาพรวมข้ามศูนย์ (Multi-shelter aggregation), การคำนวณโภชนาการ, และการตัดสต็อกอัตโนมัติตามโมเดลตั๋วเบิกจ่ายไม่สามารถจับคู่ข้อมูลได้อย่างแม่นยำ
2. **ความเสี่ยงต่อการลบหมวดหมู่ที่มีพัสดุอ้างอิงอยู่ (Data Integrity Risk):**
   ในปัจจุบัน `item_category` สามารถถูกสั่งลบได้จากหน้า UI โดยไม่มีการตรวจสอบการเป็นหมวดหมู่ระบบ ทำให้เสี่ยงต่อการเกิด Orphan Reference บน `item_master`
3. **การกำหนดค่าเริ่มต้นของพัสดุ (Default Classification Mismatch):**
   เมื่อสร้างสินค้าใหม่ ผู้ใช้งานต้องเลือกระหว่าง `CONSUMABLE`, `DURABLE`, `EQUIPMENT` ด้วยตนเองทุกครั้ง ซึ่งพบข้อผิดพลาดบ่อยครั้ง (เช่น ตั้งข้าวสารเป็น DURABLE หรือตั้งเต็นท์เป็น CONSUMABLE) การมี `default_class` ผูกไว้กับหมวดหมู่จะช่วยลดความผิดพลาดหน้างานด้วยกลไก Auto-fill

---

## 2. Change (เปรียบเทียบก่อนและหลังปรับปรุง)

| มิติ | ก่อนปรับปรุง (Before) | หลังปรับปรุง (After) |
| :--- | :--- | :--- |
| **1. ข้อมูลเริ่มต้น (Seeded Data)** | ไม่มี seed หมวดหมู่ในระบบ ฐานข้อมูลเริ่มต้นว่างเปล่า | Seed 10 หมวดหมู่ระบบมาตรฐานอัตโนมัติลงในฐานข้อมูลกลาง `catalog` ทันทีที่ deploy |
| **2. Document ID Pattern** | สร้างแบบสุ่ม `item_category:{ulid}` | 10 หมวดหมู่ระบบใช้ Deterministic ID `item_category:{system_key.toLowerCase()}` (เช่น `item_category:food`); หมวดหมู่สร้างเองใช้ `{ulid}` ตามเดิม |
| **3. Schema `item_category`** | `schema_v: 1` มีเฉพาะ `name`, `is_default` | **`schema_v: 2`** เพิ่ม `system_key`, `default_class`, `description`, `is_protected` |
| **4. การคุ้มครองหมวดหมู่ระบบ** | ลบและแก้ไขได้อิสระทุกรายการ | **ล็อคห้ามลบ 10 หมวดหมู่ระบบ 100%** (UI ซ่อนปุ่มลบ + Repository reject + CouchDB VDU ปฏิเสธการลบ) และห้ามแก้ `system_key`/`default_class` แต่ยอมให้ SA แก้ชื่อภาษาไทย/คำอธิบายได้ |
| **5. การเชื่อมโยงกับ ItemMaster** | `item_master.category` ผูกชื่อสตริง `cat.name` | `item_master.category` จัดเก็บ `category_id` (เช่น `"item_category:food"`) พร้อม fallback รองรับชื่อเดิม |
| **6. UX การสร้าง ItemMaster** | ผู้ใช้ต้องเลือก `type_class` แยกเองทั้งหมด | เมื่อเลือกหมวดหมู่ ระบบ Auto-fill `type_class` ตาม `default_class` ให้ทันที (ผู้ใช้สามารถแก้ไขทับได้หากมีกรณีพิเศษ) |
| **7. การรันกระบวนการ Seed** | ไม่มีคำสั่ง seed หมวดหมู่ | ฝังใน `sync-central-db.ts` (รันอัตโนมัติใน CI/CD และ `pnpm db:sync`) และเรียกใน `seed.ts` แบบ Idempotent |

---

## 3. The 10 System Protected Categories Specification (ข้อกำหนด 10 หมวดหมู่ระบบมาตรฐาน)

ระบบต้องเตรียมข้อมูลเริ่มต้น (Seeded Data) ทั้ง 10 รายการนี้ในฐานข้อมูล `catalog` เสมอ และบังคับ `is_protected: true`:

| ลำดับ | System Key | Document `_id` | ชื่อหมวดหมู่ภาษาไทย (`name`) | Default Class (`default_class`) | คำอธิบายมาตรฐาน (`description`) |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | `FOOD` | `item_category:food` | อาหารและวัตถุดิบ (Food Ingredients) | `CONSUMABLE` | วัตถุดิบประกอบอาหารสดและแห้งสำหรับโรงครัวกลาง |
| 2 | `WATER` | `item_category:water` | น้ำดื่มสะอาด (Drinking Water) | `CONSUMABLE` | น้ำดื่มบรรจุขวด ถังน้ำดื่มสะอาดสำหรับบริโภค |
| 3 | `WASH` | `item_category:wash` | สุขอนามัยและของใช้ส่วนตัว (WASH & Hygiene) | `CONSUMABLE` | สบู่ ยาสระผม แปรงสีฟัน ยาสีฟัน ผ้าอนามัย ผงซักฟอก |
| 4 | `MEDICAL` | `item_category:medical` | เวชภัณฑ์และการปฐมพยาบาล (Medical & First Aid) | `CONSUMABLE` | ยาสามัญประจำบ้าน ยาประจำตัว ชุดทำแผล แอลกอฮอล์ อุปกรณ์การแพทย์ |
| 5 | `SPECIAL_CARE`| `item_category:special_care` | ของใช้กลุ่มเปราะบาง (Special Care & Vulnerable) | `CONSUMABLE` | ผ้าอ้อมผู้ใหญ่/เด็ก นมผงทารก แผ่นรองซับ สำหรับกลุ่มเฉพาะ |
| 6 | `VOLUNTEER_PPE`| `item_category:volunteer_ppe` | อุปกรณ์เจ้าหน้าที่และอาสาสมัคร (PPE & Operations) | `EQUIPMENT` | ถุงมือ เสื้อกั๊กสะท้อนแสง รองเท้าบูท อุปกรณ์คุ้มครองความปลอดภัย |
| 7 | `READY_MEAL` | `item_category:ready_meal` | อาหารปรุงเสร็จและเครื่องดื่ม (Ready-to-Eat Meals) | `CONSUMABLE` | อาหารปรุงสุกพร้อมรับประทาน ข้าวกล่อง นม สำหรับแจกจ่ายหน้างาน |
| 8 | `BEDDING` | `item_category:bedding` | เครื่องนอนและที่พักพิง (Shelter & Bedding) | `DURABLE` | เสื่อปูนอน มุ้ง ผ้าห่ม หมอน เต็นท์ครอบครัว พัสดุหมุนเวียนยืม-คืน |
| 9 | `FUEL_ENERGY` | `item_category:fuel_energy` | เชื้อเพลิงและพลังงาน (Fuel & Energy) | `CONSUMABLE` | แก๊สหุงต้ม LPG (15kg/4kg) น้ำมันดีเซลเครื่องปั่นไฟ ถ่านไม้ วัตถุไวไฟ |
| 10 | `KITS` | `item_category:kits` | ชุดพัสดุยังชีพรวม (Relief Kits & Packages) | `CONSUMABLE` | ถุงยังชีพพระราชทาน ชุดธารน้ำใจ ชุดสุขอนามัยครอบครัว |

---

## 4. Requirements (ข้อกำหนดระบบ)

### 4.1 Data Model & Schema Requirements
- **FR-01 (Schema Extension):** ขยายฟิลด์ใน `ItemCategory` เป็น **`schema_v: 2`**:
  - `system_key`: `string` (optional, มีค่าเฉพาะ 10 หมวดหมู่ระบบตามตาราง §3)
  - `default_class`: enum `TypeClass` (`'CONSUMABLE' | 'DURABLE' | 'EQUIPMENT'`) (optional, มีค่าตั้งต้นสำหรับหมวดหมู่ระบบ และเปิดให้หมวดหมู่สร้างเองระบุได้)
  - `description`: `string` (optional, คำอธิบายมาตรฐานหรือรายละเอียดเพิ่มเติม)
  - `is_protected`: `boolean` (default `false`, เป็น `true` สำหรับ 10 หมวดหมู่ระบบ)
  - `name`: `string` (required, ชื่อหมวดหมู่ภาษาไทย)
  - `is_default`: `boolean` (optional, default `false`)
- **FR-02 (Deterministic Identity):** 10 หมวดหมู่มาตรฐานระบบต้องใช้ Document `_id` ในรูปแบบ `item_category:${system_key.toLowerCase()}` หมวดหมู่ที่สร้างขึ้นใหม่โดยผู้ใช้ทั่วไปยังคงใช้ `item_category:${ulid}`

### 4.2 Security & Immutability Requirements
- **FR-03 (Three-Tier Deletion Protection):** ระบบต้องป้องกันการลบหมวดหมู่ที่เป็น `is_protected: true` โดยเด็ดขาด 3 ชั้น:
  1. **UI Layer:** ปิดการแสดงผลหรือ disable ปุ่ม Delete สำหรับหมวดหมู่ที่มี `is_protected: true` ในหน้าตารางหมวดหมู่ทั้งใน Portal System Management และ Back-office
  2. **Repository/Application Layer:** ฟังก์ชัน `deleteItemCategory` ต้องตรวจสอบ หากเป็น `is_protected: true` ให้ throw Error `"ไม่อนุญาตให้ลบหมวดหมู่ระบบมาตรฐาน"`
  3. **Database Layer (CouchDB VDU):** ปรับปรุง `validate_doc_update` บน Database `catalog` (`_design/access`): หากเอกสารเดิม (`oldDoc`) มี `is_protected === true` และมีการส่งเอกสารที่มี `_deleted: true` ให้ reject ด้วย `{ forbidden: 'Cannot delete system protected category' }`
- **FR-04 (Field Mutability Rules for System Categories):**
  - ฟิลด์ `system_key`, `default_class`, และ `is_protected` ถือเป็น **Immutable** สำหรับหมวดหมู่ระบบ (ห้ามแก้ไข)
  - ยินยอมให้ผู้ใช้บทบาท `system_admin` แก้ไขเฉพาะ `name` (ชื่อภาษาไทย) และ `description` (คำอธิบาย) ได้ เพื่อปรับให้เข้ากับบริบทหน้างานขององค์กร

### 4.3 Integration with ItemMaster Requirements
- **FR-05 (Category Reference in ItemMaster):**
  - ฟิลด์ `category` ใน `item_master` ต้องจัดเก็บ `category_id` (เช่น `"item_category:food"`)
  - สำหรับเอกสารเดิมที่บันทึกเป็นชื่อสตริงภาษาไทย (Legacy Documents) ตัวอ่านข้อมูล (Reader/Adapter) ต้องสามารถค้นหาจับคู่ได้ทั้งจาก `_id` และจาก `name`
- **FR-06 (Auto-fill TypeClass on Selection):**
  - ในหน้าสร้างสินค้าใหม่ (`item-master-form.svelte`) เมื่อผู้ใช้เลือกหมวดหมู่สินค้า ระบบต้องดึงค่า `default_class` ของหมวดหมู่นั้นมากำหนดให้ฟิลด์ `type_class` อัตโนมัติ (Reactive Auto-fill)
  - ผู้ใช้งานยังคงมีสิทธิ์แก้ไขปรับเปลี่ยน `type_class` เป็นค่าอื่นได้หากสินค้าชิ้นนั้นมีข้อยกเว้นพิเศษ

### 4.4 Seeding & Deployment Requirements
- **FR-07 (Idempotent Central Seeding):**
  - เพิ่มฟังก์ชัน `syncSystemItemCategories` ใน `frontend/scripts/sync-central-db.ts`
  - ตรวจสอบเอกสารทั้ง 10 รายการในฐานข้อมูล `catalog`:
    - หากยังไม่มี: ทำการสร้างเอกสารด้วย `_id`, `system_key`, `name`, `default_class`, `description`, `is_protected: true`, `schema_v: 2`
    - หากมีอยู่แล้ว: ตรวจสอบและคงค่า `is_protected: true`, `system_key`, `default_class` ไว้ โดยไม่เขียนทับ `name` และ `description` ที่ SA อาจมีการปรับแก้ไปแล้ว
- **FR-08 (Developer & Test Environment Seed):**
  - บรรจุการเรียกฟังก์ชัน Seed หมวดหมู่ระบบใน `frontend/scripts/seed.ts` เพื่อให้การ setup เครื่อง dev และ test environment ได้รับข้อมูลมาตรฐานเสมอ

---

## 5. Technical Specifications (รายละเอียดเชิงเทคนิค)

### 5.1 Updated TypeScript Interfaces (`$lib/features/catalog/domain/catalog.ts`)

```typescript
import { z } from 'zod';
import { catalogDoc, type CatalogDoc, type AuthorContext } from '$lib/db/model';
import { typeClassSchema, type TypeClass } from './catalog-types';

// ================================================================
// ItemCategory Schema & Types (schema_v: 2)
// ================================================================

export const SYSTEM_CATEGORY_KEYS = [
  'FOOD',
  'WATER',
  'WASH',
  'MEDICAL',
  'SPECIAL_CARE',
  'VOLUNTEER_PPE',
  'READY_MEAL',
  'BEDDING',
  'FUEL_ENERGY',
  'KITS'
] as const;

export type SystemCategoryKey = (typeof SYSTEM_CATEGORY_KEYS)[number];

export interface ItemCategory extends CatalogDoc {
  type: 'item_category';
  name: string;
  system_key?: SystemCategoryKey | string;
  default_class?: TypeClass;
  description?: string;
  is_protected?: boolean;
  is_default?: boolean;
  shelter_code?: string;
  override?: boolean;
}

export const itemCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อหมวดหมู่'),
  default_class: typeClassSchema.optional(),
  description: z.string().trim().optional(),
  is_default: z.boolean().optional(),
  override: z.boolean().optional()
});

export type ItemCategoryInput = z.input<typeof itemCategoryInputSchema>;
```

### 5.2 CouchDB Access Design Document (`validate_doc_update`)

ใน `catalog/_design/access` ปรับปรุงฟังก์ชันตรวจสอบความถูกต้องเพื่อป้องกันการลบและแก้ไขฟิลด์ต้องห้าม:

```javascript
function (newDoc, oldDoc, userCtx, secObj) {
  // ตรวจสอบการลบหมวดหมู่ระบบที่ได้รับการคุ้มครอง
  if (oldDoc && oldDoc.type === 'item_category' && oldDoc.is_protected === true) {
    if (newDoc._deleted === true) {
      throw({ forbidden: 'Cannot delete system protected category: ' + oldDoc._id });
    }
    // ห้ามแก้ไข system_key และ default_class ของหมวดหมู่ระบบ
    if (newDoc.system_key !== oldDoc.system_key) {
      throw({ forbidden: 'system_key is immutable on protected categories' });
    }
    if (newDoc.default_class !== oldDoc.default_class) {
      throw({ forbidden: 'default_class is immutable on protected categories' });
    }
    if (newDoc.is_protected !== true) {
      throw({ forbidden: 'is_protected flag cannot be removed' });
    }
  }

  // Security ปกติของ catalog (System Admin หรือ Scoped Staff)
  if (userCtx.roles.indexOf('_admin') !== -1 || userCtx.roles.indexOf('system_admin') !== -1) {
    return;
  }
  if (oldDoc && oldDoc.shelter_code !== newDoc.shelter_code) {
    throw({ forbidden: 'shelter_code is immutable' });
  }
  if (newDoc.shelter_code) {
    var hasScope = userCtx.roles.indexOf('shelter:' + newDoc.shelter_code) !== -1;
    var isManager = userCtx.roles.indexOf('shelter_manager') !== -1;
    var isWS = userCtx.roles.indexOf('warehouse_staff') !== -1;
    if (hasScope && (isManager || isWS)) {
      return;
    }
  }
  throw({ forbidden: 'Only System Admins can write to global catalog documents, and only authorized shelter staff can write local documents.' });
}
```

### 5.3 Seeding Implementation Pattern (`scripts/sync-central-db.ts`)

```typescript
export const SYSTEM_ITEM_CATEGORIES: Array<{
  key: SystemCategoryKey;
  id: string;
  name: string;
  default_class: TypeClass;
  description: string;
}> = [
  {
    key: 'FOOD',
    id: 'item_category:food',
    name: 'อาหารและวัตถุดิบ (Food Ingredients)',
    default_class: 'CONSUMABLE',
    description: 'วัตถุดิบประกอบอาหารสดและแห้งสำหรับโรงครัวกลาง'
  },
  {
    key: 'WATER',
    id: 'item_category:water',
    name: 'น้ำดื่มสะอาด (Drinking Water)',
    default_class: 'CONSUMABLE',
    description: 'น้ำดื่มบรรจุขวด ถังน้ำดื่มสะอาดสำหรับบริโภค'
  },
  {
    key: 'WASH',
    id: 'item_category:wash',
    name: 'สุขอนามัยและของใช้ส่วนตัว (WASH & Hygiene)',
    default_class: 'CONSUMABLE',
    description: 'สบู่ ยาสระผม แปรงสีฟัน ยาสีฟัน ผ้าอนามัย ผงซักฟอก'
  },
  {
    key: 'MEDICAL',
    id: 'item_category:medical',
    name: 'เวชภัณฑ์และการปฐมพยาบาล (Medical & First Aid)',
    default_class: 'CONSUMABLE',
    description: 'ยาสามัญประจำบ้าน ยาประจำตัว ชุดทำแผล แอลกอฮอล์ อุปกรณ์การแพทย์'
  },
  {
    key: 'SPECIAL_CARE',
    id: 'item_category:special_care',
    name: 'ของใช้กลุ่มเปราะบาง (Special Care & Vulnerable)',
    default_class: 'CONSUMABLE',
    description: 'ผ้าอ้อมผู้ใหญ่/เด็ก นมผงทารก แผ่นรองซับ สำหรับกลุ่มเฉพาะ'
  },
  {
    key: 'VOLUNTEER_PPE',
    id: 'item_category:volunteer_ppe',
    name: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร (PPE & Operations)',
    default_class: 'EQUIPMENT',
    description: 'ถุงมือ เสื้อกั๊กสะท้อนแสง รองเท้าบูท อุปกรณ์คุ้มครองความปลอดภัย'
  },
  {
    key: 'READY_MEAL',
    id: 'item_category:ready_meal',
    name: 'อาหารปรุงเสร็จและเครื่องดื่ม (Ready-to-Eat Meals)',
    default_class: 'CONSUMABLE',
    description: 'อาหารปรุงสุกพร้อมรับประทาน ข้าวกล่อง นม สำหรับแจกจ่ายหน้างาน'
  },
  {
    key: 'BEDDING',
    id: 'item_category:bedding',
    name: 'เครื่องนอนและที่พักพิง (Shelter & Bedding)',
    default_class: 'DURABLE',
    description: 'เสื่อปูนอน มุ้ง ผ้าห่ม หมอน เต็นท์ครอบครัว พัสดุหมุนเวียนยืม-คืน'
  },
  {
    key: 'FUEL_ENERGY',
    id: 'item_category:fuel_energy',
    name: 'เชื้อเพลิงและพลังงาน (Fuel & Energy)',
    default_class: 'CONSUMABLE',
    description: 'แก๊สหุงต้ม LPG (15kg/4kg) น้ำมันดีเซลเครื่องปั่นไฟ ถ่านไม้ วัตถุไวไฟ'
  },
  {
    key: 'KITS',
    id: 'item_category:kits',
    name: 'ชุดพัสดุยังชีพรวม (Relief Kits & Packages)',
    default_class: 'CONSUMABLE',
    description: 'ถุงยังชีพพระราชทาน ชุดธารน้ำใจ ชุดสุขอนามัยครอบครัว'
  }
];

export async function syncSystemItemCategories(dryRun: boolean): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const cat of SYSTEM_ITEM_CATEGORIES) {
    const { status, data } = await couchReq('GET', `/catalog/${encodeURIComponent(cat.id)}`);
    if (status === 404) {
      if (!dryRun) {
        const doc: ItemCategory = {
          _id: cat.id,
          type: 'item_category',
          schema_v: 2,
          system_key: cat.key,
          name: cat.name,
          default_class: cat.default_class,
          description: cat.description,
          is_protected: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: 'system'
        };
        await couchReq('PUT', `/catalog/${encodeURIComponent(cat.id)}`, doc);
      }
      created++;
    } else if (status === 200) {
      const existing = data as ItemCategory;
      // ตรวจสอบว่าต้อง patch ฟิลด์คุ้มครองหรือไม่
      if (!existing.is_protected || existing.system_key !== cat.key || existing.default_class !== cat.default_class || existing.schema_v !== 2) {
        if (!dryRun) {
          const patched = {
            ...existing,
            schema_v: 2,
            system_key: cat.key,
            default_class: cat.default_class,
            is_protected: true,
            updated_at: new Date().toISOString()
          };
          await couchReq('PUT', `/catalog/${encodeURIComponent(cat.id)}`, patched);
        }
        updated++;
      } else {
        skipped++;
      }
    }
  }

  return { created, updated, skipped };
}
```

---

## 6. Impact & Traceability (การวิเคราะห์ผลกระทบ)

### 6.1 เอกสารที่ได้รับผลกระทบ
- `docs/data/schema.md` §4.1: ปรับแก้สเปก `item_category` จาก `schema_v 1` เป็น `schema_v 2` พร้อมเพิ่มตารางฟิลด์ใหม่ `system_key`, `default_class`, `description`, `is_protected`
- `docs/data/schema.md` §4.2: ชี้แจงฟิลด์ `category` ใน `item_master` ให้บันทึกเป็น `category_id` (เช่น `"item_category:food"`)
- `docs/changes/_index.md`: เพิ่มประวัติ Change Record เมื่องานนี้ได้รับอนุมัติ

### 6.2 ซอร์สโค้ดที่ได้รับผลกระทบ
- `frontend/src/lib/features/catalog/domain/catalog.ts`: ขยาย Interface `ItemCategory`, Zod schemas, และ enum `SystemCategoryKey`
- `frontend/src/lib/features/catalog/data/catalog.remote.ts`: เพิ่ม guard ห้ามลบหมวดหมู่ที่มี `is_protected: true` ใน `deleteItemCategory`
- `frontend/src/lib/features/catalog/ui/item-category-form.svelte`: รองรับการแสดงผลฟิลด์ `default_class` และ `description` ป้องกันการแก้ `system_key` และ `default_class` ของ Protected Categories
- `frontend/src/lib/features/catalog/ui/item-master-form.svelte`: เพิ่มฟังก์ชัน Reactive Watcher เมื่อเปลี่ยนค่า Category ให้ Auto-fill ค่า `type_class`
- `frontend/src/routes/(protected)/back-office/catalog/components/item-category-tab.svelte`: ซ่อน/disable ปุ่มลบสำหรับแถวที่มี `is_protected: true` แสดง Badge `ระบบ (Protected)`
- `frontend/scripts/sync-central-db.ts`: เพิ่มขั้นตอน `syncSystemItemCategories`
- `frontend/scripts/seed.ts`: เรียก `syncSystemItemCategories` ร่วมในกระบวนการ Dev Seed

---

## 7. Migration & Compatibility (แผนการย้ายข้อมูลและความเข้ากันได้)

1. **ไม่มีการลบข้อมูลเดิม (Non-destructive):**
   การเพิ่ม 10 หมวดหมู่ระบบใช้ Deterministic ID (`item_category:food` ถึง `item_category:kits`) จึงไม่ชนกับหมวดหมู่เดิมที่ผู้ใช้เคยสร้างไว้ซึ่งใช้รูปแบบ `{ulid}`
2. **Backward Compatibility สำหรับ `item_master` เก่า:**
   สำหรับเอกสาร `item_master` ที่สร้างไว้ก่อนหน้านี้ซึ่งเก็บ `category` เป็นข้อความธรรมดา เช่น `"อาหารและวัตถุดิบ (Food Ingredients)"` หรือ `"อาหาร"`:
   - UI Dropdown ใน `item-master-form.svelte` จะทำการจับคู่ (Match) ทั้งจาก `cat._id === item.category` และ `cat.name === item.category`
   - เมื่อมีการเปิดแก้ไขและบันทึก `item_master` เอกสารจะถูกอัปเดตเป็น `category_id` ใหม่อัตโนมัติ
3. **Idempotency รับประกันการรันซ้ำ:**
   สคริปต์ Seeder ปฏิบัติตามหลัก Idempotent 100% สามารถรันซ้ำได้ไม่จำกัดจำนวนครั้ง โดยไม่ทำลายข้อมูลที่ SA ปรับแต่งไว้ในส่วนของ `name` หรือ `description`

---

## 8. Acceptance Criteria & Definition of Done (เกณฑ์การตรวจรับ)

- [ ] **AC-01 (Seed Verification):** เมื่อรัน `pnpm sync:central --write --confirm` หรือ `pnpm seed` ในฐานข้อมูล `catalog` จะต้องปรากฏเอกสาร 10 หมวดหมู่มาตรฐานครบถ้วน มี `_id`, `system_key`, `default_class`, `is_protected: true` ตรงตามตาราง §3
- [ ] **AC-02 (Idempotent Run):** รันคำสั่ง Seed ซ้ำรอบที่สอง เอกสารเดิมต้องไม่ถูกสร้างซ้ำ (`skipped = 10`) และไม่เกิด Error
- [ ] **AC-03 (Delete Protection - UI):** ในหน้ารายการหมวดหมู่ (`item-category-tab.svelte`) แถวของ 10 หมวดหมู่ระบบต้องแสดง Badge "หมวดหมู่ระบบ" และไม่มีปุ่มลบ (Delete Button) ปรากฏ
- [ ] **AC-04 (Delete Protection - CouchDB VDU):** เมื่อยิงคำสั่งลบเอกสาร `item_category:food` ตรงไปยัง CouchDB ผ่าน API ระบบต้อง Reject พร้อมแจ้งข้อผิดพลาด Forbidden
- [ ] **AC-05 (Auto-fill Behavior):** ในหน้าสร้างสินค้าใหม่ (`item-master-form.svelte`) เมื่อผู้ใช้เลือกหมวดหมู่ "อาหารและวัตถุดิบ" ช่อง Class ต้องถูกเลือกเป็น `CONSUMABLE` ให้โดยอัตโนมัติ และเมื่อเลือก "เครื่องนอนและที่พักพิง" ช่อง Class ต้องเปลี่ยนเป็น `DURABLE` โดยอัตโนมัติ
- [ ] **AC-06 (Automated Tests):** มี Unit Test ครอบคลุม Schema Validation v2, Seeding logic, และ Delete Protection Guard ใน `catalog.test.ts`

---

## 9. Decision Log

- **2026-09-12 (Decision 1):** กำหนดให้ใช้ Deterministic Lowercase ID (`item_category:food`, `item_category:water`, ...) เพื่อให้ Idempotent Seed ง่าย อ้างอิงตรงตัว และสอดคล้องกับแบบแผนเดิมของระบบ (`sop_profile:master_sphere_baseline`)
- **2026-09-12 (Decision 2):** Bump `schema_v` ของ `item_category` จาก 1 เป็น 2 พร้อมขยายฟิลด์ `system_key`, `default_class`, `description`, `is_protected` โดยเปิดให้หมวดหมู่ที่สร้างเองใช้ `default_class` และ `description` ได้ด้วย
- **2026-09-12 (Decision 3):** บังคับใช้การห้ามลบ 3 ชั้นอย่างเด็ดขาด (UI, Repository, CouchDB VDU) โดยห้ามแก้ `system_key`/`default_class` แต่ยอมให้ SA แก้ชื่อภาษาไทยและคำอธิบายได้
- **2026-09-12 (Decision 4):** กำหนดให้ `item_master.category` จัดเก็บเป็น `category_id` (เช่น `"item_category:food"`) เพื่อการอ้างอิงที่แม่นยำ พร้อมระบบ Auto-fill `type_class` ตาม `default_class` ของหมวดหมู่
- **2026-09-12 (Decision 5):** บรรจุกระบวนการ Seed ใน `scripts/sync-central-db.ts` (รันอัตโนมัติใน CI/CD) และ `scripts/seed.ts`
- **2026-09-12 (Decision 6):** เปิดบันทึกการเปลี่ยนแปลงเป็น Draft Change Record ฉบับเต็มที่ [`docs/changes/draft-seed-item-categories.md`](draft-seed-item-categories.md)
