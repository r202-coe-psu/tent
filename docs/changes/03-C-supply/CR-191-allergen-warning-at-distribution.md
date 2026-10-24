---
id: CR-191
title: CR-191 — เตือนสารก่อแพ้ตอนแจกอาหาร — item_master.allergens เป็น code + กติกาเทียบกับ medical.allergies
status: approved
date: 2026-10-24
updated: 2026-10-25
requested_by: feedback หน้างาน (ข้อ 6) — issue #607 (ต่อจาก CR-187 / #648)
decided_by: kong (approved 2026-10-25)
layer: volatile
affects:
  - docs/data/schema.md §4.2 (`item_master.allergens` = master `allergy` code หรือ free text; schema_v 5 → 6)
  - docs/data/schema.md §2.30 (`distribution_log.allergen_conflicts` — additive, ไม่ bump)
  - docs/changes/03-C-supply/CR-159-onsite-distribution.md §C (เพิ่ม FR-MRM-06..10; FR-MRM-05 ข้อยกเว้น FR-5)
  - frontend/src/lib/features/catalog/domain (ItemMaster.allergens, ITEM_MASTER_SCHEMA_V, itemAllergens reader)
  - frontend/src/lib/features/catalog/ui (item-master-form, master-item-sheet)
  - frontend/src/lib/features/master-data (ย้าย MasterTagInput มาเป็น shared UI ของ master-data)
  - frontend/src/lib/features/distribution/domain/food-supplies (กติกา allergen conflict)
  - frontend/src/lib/features/distribution/application/food-supplies/distribution-workflow.ts
  - frontend/src/lib/features/distribution/ui/frontline (FoodDistributionCard, MealEntitlementWarning)
---

# CR-191 — เตือนสารก่อแพ้ตอนแจกอาหาร

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ตอนแจกอาหารปรุงสำเร็จที่ `/onsite/distribution` ระบบเทียบ **สิ่งที่ผู้รับแพ้**
>   (`medical.allergies`, CR-187) กับ **สารก่อแพ้ของเมนู** (`item_master.allergens`) ด้วย code ของ master
>   `allergy` — ชนกัน → **เตือน + ต้อง override พร้อมเหตุผล** จึงแจกได้ (เคาะแล้ว)
> - **ทะเบียนสินค้า:** `allergens` เปลี่ยนจากข้อความเดียว (โค้ดปัจจุบัน) เป็น `[str]` ตาม schema.md —
>   เลือกจาก master `allergy` หลายค่า หรือพิมพ์ free text; `item_master` schema_v 5 → 6
> - **บันทึก:** override เพราะแพ้ → `distribution_log.allergen_conflicts` เก็บ code ที่ชน (additive)
> - **ข้อมูลเดิม:** ไม่ backfill — reader แปลงข้อความเดิมเป็นรายการตอนอ่าน และ map label → code ตอนเทียบ/บันทึก

---

## Why

- feedback หน้างาน (ข้อ 6): ผู้แพ้อาหารอาจได้รับเมนูที่มีสารที่แพ้ เพราะเจ้าหน้าที่หน้าโต๊ะแจกไม่เห็นประวัติแพ้
- CR-187 ทำให้ `medical.allergies` เก็บเป็น code ของ master `allergy` แล้ว — เหลือฝั่งอาหาร
- อาหารทุกชนิดที่แจกคือ `item_master` (ของสำเร็จรูป/บริจาค และอาหารที่ครัวทำซึ่งรับเข้าเป็น ready-meal item)
  → กำกับสารก่อแพ้ที่ทะเบียนสินค้าที่เดียว
- โค้ดปัจจุบันเก็บ `allergens` เป็น `string` เดียว ขัดกับ schema.md §4.2 ที่กำหนด `[str]` (CR-082)

## Change

### Requirements — ทะเบียนสินค้า

- **FR-1** — `item_master.allergens: [str]`; แต่ละค่าเป็น `code` ของ `master_data:allergy` **หรือ** free text
  (กติกา map เดียวกับ CR-187 FR-6: ข้อความตรง `label_th`/`label_en` ของ item `active` → code)
- **FR-2** — ฟอร์มทะเบียนสินค้า (`item-master-form`) ช่อง「สารก่อภูมิแพ้」เป็น tag autocomplete
  (`MasterTagInput` ตัวเดียวกับ Station 2) เลือกได้หลายค่า; FUEL_ENERGY ยังซ่อน/ไม่ persist ตามเดิม
- **FR-3** — หน้าดูสินค้า (`master-item-sheet`) แสดง label แทน code; free text แสดงตามที่เก็บ
- **FR-4** — reader รองรับ doc เดิม (schema_v ≤ 5) ที่ `allergens` เป็นข้อความ: แยกด้วย `,` → รายการ (trim,
  ตัดค่าว่าง); writer ใหม่ stamp schema_v 6 และเขียนเป็น array เสมอ

### Requirements — ตอนแจก (เพิ่มใน CR-159 §C)

- **FR-MRM-06** — ผู้รับ `evacuee`: ดึง `medical` ของผู้รับ (`medical.allergies`) ตอนเลือกผู้รับ;
  ผู้รับ `volunteer` / `outside` ไม่มีข้อมูลสุขภาพ → **ข้ามการเช็ค**
- **FR-MRM-07** — สารที่ชน = `resolve(medical.allergies) ∩ resolve(item.allergens)` โดย `resolve` map ข้อความ
  เป็น code ของ master `allergy` (item `active`) แล้วเทียบเฉพาะ **code**; free text ไม่ match อัตโนมัติ
- **FR-MRM-08** — ชนกัน → แสดงคำเตือน "‹เมนู› มี ‹สาร› — ผู้รับแพ้" และ **ต้อง override + เหตุผล** จึงแจกได้
  (เคาะ: เตือน + override ได้ — ไม่ห้ามแจกเด็ดขาด เพราะบางคนแพ้ไม่รุนแรง/รับไปให้คนในครอบครัว);
  ใช้ modal override เดิมของรับซ้ำ/เมนูไม่ตรงกลุ่ม; workflow ปฏิเสธถ้าชนแต่ไม่ override
- **FR-MRM-09** — การแสดงผลบนการ์ดผู้รับ:
  - ผู้รับมีอาการแพ้ที่เป็น code → badge แดง "แพ้: อาหารทะเล, ไข่"
  - ผู้รับมีอาการแพ้เป็น free text → "มีประวัติแพ้: ‹ข้อความ›" ให้เจ้าหน้าที่อ่านเอง (ไม่ match)
  - ผู้รับมีอาการแพ้ แต่เมนูไม่ระบุสารก่อแพ้ → "เมนูนี้ไม่ระบุสารก่อแพ้" (แจ้งเฉยๆ ไม่ต้อง override)
- **FR-MRM-10** — ข้อมูลสุขภาพของผู้รับยังโหลดไม่เสร็จ/โหลดไม่สำเร็จ → ปุ่มยืนยันแจกถูกล็อก (fail closed)
  เหมือน preflight เดิม (FR-MRM-04)

### Requirements — บันทึก

- **FR-5** — `distribution_log.allergen_conflicts: [str]` (opt) — code ที่ชนตอนแจก; เขียนเฉพาะเมื่อมีสารชน
  (ซึ่งต้องมี `is_override: true` + `override_reason`) → แยกได้ว่า override เพราะแพ้

### Before → after

|                                | ก่อน                            | หลัง                                         |
| ------------------------------ | ------------------------------- | -------------------------------------------- |
| `item_master.allergens` (code) | `string` (ขัด schema `[str]`)   | `[str]` master `allergy` code หรือ free text |
| `item_master` schema_v         | 5                               | 6                                            |
| ฟอร์มทะเบียนสินค้า             | input ข้อความ "เช่น ถั่ว, นม"   | tag autocomplete จาก master `allergy`        |
| แจกอาหาร                       | ไม่เช็คการแพ้                   | ชนกัน → เตือน + override + เหตุผล            |
| `distribution_log`             | `is_override`/`override_reason` | + `allergen_conflicts` (opt)                 |

### Acceptance

- [ ] ฟอร์มทะเบียนสินค้าเลือกสารก่อแพ้จาก master ได้หลายค่า; บันทึกแล้ว `allergens` เป็น array ของ code
- [ ] สินค้าเดิม `allergens: "ไข่, ถั่ว"` เปิดดู/แก้ได้ และนับเป็น `egg`, `nuts` ตอนแจก
- [ ] นางบีแพ้ไข่ — ข้าวผัดกุ้ง (อาหารทะเล, ไข่) → เตือน "ข้าวผัดกุ้ง มี ไข่ — ผู้รับแพ้", ต้อง override + เหตุผล,
      log มี `allergen_conflicts: ["egg"]`
- [ ] นางบีรับข้าวมันไก่ (ไม่มีสารก่อแพ้ที่ตรง) → แจกปกติ
- [ ] ผู้รับเป็นจิตอาสา/บุคคลภายนอก → ไม่เช็คการแพ้
- [ ] ผู้รับมีประวัติแพ้ free text → แสดง "มีประวัติแพ้: …" ไม่บังคับ override
- [ ] unit test: กติกา conflict, reader ข้อความเดิม, workflow ปฏิเสธเมื่อไม่ override

## Impact

- **Docs:** schema.md §4.2 (`allergens` row + schema_v 6 banner + migration), §2.30 (`allergen_conflicts`),
  CR-159 §C (FR-MRM-06..10; FR-MRM-05 มีข้อยกเว้น FR-5)
- **Code:** catalog domain/UI, master-data UI (ย้าย `MasterTagInput` จาก `people/ui/forms` เป็น shared component
  ของ master-data — catalog ห้าม import people), distribution domain/workflow/UI; people ไม่เปลี่ยน
- **ไม่กระทบ:** worker/FastAPI (`allergens` ไม่ project ไป public), VDU (`item_master` ไม่เช็ค schema_v;
  `distribution_log` field เพิ่มแบบ opt), ระบบแจกของใช้ (supplies) — เฉพาะอาหาร

## Migration

- `item_master` schema_v 5 → 6: **ไม่ backfill**. Reader รับทั้ง `string` (≤ v5) และ `[str]` (v6) ผ่าน helper
  เดียว; writer ใหม่ (สร้าง/แก้ในฟอร์ม) เขียน array + stamp 6. ข้อความเดิมที่ตรง label master ถูก map เป็น code
  ตอนเทียบและตอนบันทึกฟอร์ม; ที่ไม่ตรงคงเป็น free text (แสดงผลแต่ไม่ match)
- `distribution_log`: additive optional field → doc เดิมอ่านได้ ไม่ backfill

## Decisions (เคาะ kong, 2026-10-25)

1. **`allergen_conflicts` บน `distribution_log`** — เพิ่ม field opt **ไม่ bump** schema_v (additive,
   VDU ไม่ต้องแก้) ตามที่เสนอ
2. **ข้อความเดิมใน `allergens` ที่ไม่ตรง master** — คงเป็น free text ใน array (เหมือน
   `medical.allergies`) ตามที่เสนอ

## Decision log

- 2026-10-24 — proposed (#607). Owner เคาะแล้ว: พบแพ้ = **เตือน + override ได้** (ไม่ห้ามแจกเด็ดขาด);
  track ด้วย CR ไฟล์บน branch `docs/`
- 2026-10-25 — approved โดย kong เป็น CR-191; เคาะ `allergen_conflicts` opt ไม่ bump และคงข้อความเดิมเป็น free text ใน array ตามที่เสนอ
