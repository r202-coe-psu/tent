---
id: CR-217
title: kitchen_staff สร้าง แก้ไข และลบ recipe ของศูนย์ตัวเองได้ (production board และหน้า catalog)
status: approved
date: 2026-10-29
updated: 2026-11-01
requested_by: feedback หน้างาน (roleplay 23/10/2569) — issue #802
decided_by: kong
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md (แถว Recipe — create / edit / delete)
  - frontend/src/lib/features/catalog/domain/catalog-permissions.ts
  - frontend/src/lib/features/catalog/application/queries.ts (useCreateRecipe, useUpdateRecipe, useDeleteRecipe)
  - frontend/src/routes/(protected)/back-office/catalog/components/recipe-tab.svelte
  - frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte
---

# CR-217 — `kitchen_staff` สร้าง แก้ไข และลบ `recipe` ของศูนย์ตัวเองได้

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `kitchen_staff` ของศูนย์ได้สิทธิ์ **สร้าง แก้ไข และลบ** `recipe` ในฐานข้อมูลศูนย์
>   ตัวเอง (`shelter_<code>`). การสร้าง/แก้ `item_master` / `item_category` คงสิทธิ์เดิม. recipe ใน
>   catalog กลาง (ไม่ระบุศูนย์) ยังเป็นของ system_admin เท่านั้น.
> - **เพื่อใคร/ทำไม:** ครัวกำหนดวัตถุดิบเองในโหมด "สร้างสูตรเอง" ที่ production board แล้วอยากเก็บเป็น
>   สูตรใช้ซ้ำ (#802) และต้องดูแลสูตรของศูนย์เองได้ (แก้ปริมาณ / ลบสูตรที่ไม่ใช้). เดิมสิทธิ์มีแค่
>   system_admin / shelter_manager / warehouse_staff ทำให้คนครัวซึ่งเป็นผู้ใช้หลักทำไม่ได้.
> - **Schema:** ไม่เปลี่ยน — ใช้ `recipe` schema_v 4 เดิม.

## Why

Feedback จากการ roleplay วันที่ 23/10/2569: วัตถุดิบที่ครัวกำหนดเองใช้ได้แค่รอบเดียว ต้องกรอกใหม่ทุกครั้ง.
Issue #802 ขอให้บันทึกเป็นสูตรใหม่ได้จากหน้า production board. ผู้ใช้หน้า production board คือ
`kitchen_staff` และ `shelter_manager` (`requireKitchen`) แต่ client guard ของ catalog
(`enforceWriteAccess`) อนุญาตแค่ admin / manager / warehouse_staff. เมื่อคนครัวสร้างสูตรได้แล้ว
ก็ต้องแก้หรือลบสูตรของศูนย์ได้ด้วย ไม่อย่างนั้นสูตรที่บันทึกผิดจะค้างอยู่จนกว่า SM จะมาแก้ให้.

## Change

| สิทธิ์                                       | ก่อน                                                                  | หลัง                                 |
| -------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| สร้าง `recipe` ใน `shelter_<code>`           | system_admin, shelter_manager, warehouse_staff (+ supply_coordinator) | **+ kitchen_staff ของศูนย์เดียวกัน** |
| แก้ไข / ลบ `recipe` ใน `shelter_<code>`      | system_admin, shelter_manager, warehouse_staff (+ supply_coordinator) | **+ kitchen_staff ของศูนย์เดียวกัน** |
| สร้าง / แก้ไข / ลบ `recipe` ใน catalog กลาง  | system_admin                                                          | ไม่เปลี่ยน                           |
| สร้าง / แก้ไข `item_master`, `item_category` | system_admin, shelter_manager, warehouse_staff                        | ไม่เปลี่ยน                           |

- `kitchen_staff` แก้ไข / ลบได้ทุก recipe ของศูนย์ตัวเอง ไม่จำกัดเฉพาะสูตรที่ตัวเองสร้าง.
- CouchDB `validate_doc_update` ของ `shelter_*` รับ `recipe` อยู่แล้วโดยไม่จำกัด role → ไม่ต้องแก้ design doc.
  ขอบเขตการบังคับสิทธิ์จึงเป็นฝั่ง client เหมือนเอกสาร catalog อื่น.

## Impact

- `catalog` domain: policy เดียวสำหรับ create / update / delete `recipe` (ขยาย `canCreateShelterRecipe` ของ
  PR #1076) — ไม่มี shelter = central catalog → system_admin เท่านั้น.
- `catalog` application: `useCreateRecipe`, `useUpdateRecipe`, `useDeleteRecipe` ใช้ policy เดียวกันนี้
  แทน `enforceWriteAccess` สำหรับ `recipe`.
- Production board Stage A (รอบใหม่) โหมด "สร้างสูตรเอง" และโหมด BOM ที่แก้วัตถุดิบจากสูตรเดิมแล้ว: checkbox
  "บันทึกเป็นสูตรใหม่" อย่างเดียว ใช้ "ชื่อเมนูที่แสดง" เป็นชื่อสูตร
  และ "จำนวนจานที่ต้องการผลิต" เป็นจำนวนจานมาตรฐาน (ติ๊กแล้วไม่กรอกชื่อเมนู → toast ให้กรอก และยังไม่เปิดตั๋ว).
  บันทึกล้ม / ชื่อซ้ำ → toast แจ้ง แต่ยังเปิดตั๋วเบิกได้.
  โหมด BOM: meal plan อ้างอิงสูตรใหม่ ถ้าไม่ได้บันทึก (ชื่อซ้ำ / ล้ม) อ้างอิงสูตรเดิม; สูตรเดิมไม่ถูกแก้.
- หน้า catalog แท็บสูตรอาหาร (`/back-office/catalog?tab=recipe`): kitchen_staff เห็นปุ่ม "เพิ่มสูตรอาหาร"
  และปุ่มแก้ไข / ลบ บนสูตรของศูนย์ตัวเอง (สูตรจาก catalog กลางยังแก้ / ลบไม่ได้).
- `docs/prd/role-permission-matrix.md`: แถว Recipe (Create / Edit / Delete) KS = scope.

## Migration

N/A — ไม่มีการเปลี่ยนรูปเอกสาร.

## Decision log

- 2026-10-29 — proposed (`draft-kitchen-staff-create-recipe`) ระหว่าง implement #802: kitchen_staff สร้าง recipe ได้อย่างเดียว.
- 2026-11-01 — approved โดย kong พร้อมขยายขอบเขต: kitchen_staff ของศูนย์เดียวกัน **แก้ไข / ลบ** recipe ได้ด้วย
  (เดิมเสนอให้สร้างได้อย่างเดียว). โค้ดใน PR #1076 ต้องปรับตาม (update / delete guard + ปุ่มแก้ไข / ลบในหน้า catalog).
