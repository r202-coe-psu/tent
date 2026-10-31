---
id: draft
title: kitchen_staff สร้าง recipe ของศูนย์ได้ (บันทึกสูตรจากโหมด "สร้างสูตรเอง")
status: proposed
date: 2026-10-29
requested_by: feedback หน้างาน (roleplay 23/10/2569) — issue #802
decided_by: project owner
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md (catalog / recipe — create)
  - frontend/src/lib/features/catalog/domain/catalog-permissions.ts
  - frontend/src/lib/features/catalog/application/queries.ts (useCreateRecipe)
  - frontend/src/routes/(protected)/back-office/catalog/components/recipe-tab.svelte
  - frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte
---

# draft-kitchen-staff-create-recipe — `kitchen_staff` สร้าง `recipe` ได้

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่มสิทธิ์ **สร้าง** `recipe` ในฐานข้อมูลศูนย์ (`shelter_*`) ให้ `kitchen_staff`
>   ของศูนย์นั้น. แก้ไข / ลบ recipe และสร้าง item_master / item_category คงสิทธิ์เดิม.
> - **เพื่อใคร/ทำไม:** ครัวกำหนดวัตถุดิบเองในโหมด "สร้างสูตรเอง" ที่ production board แล้วอยากเก็บเป็น
>   สูตรใช้ซ้ำ (#802). เดิมสิทธิ์สร้างสูตรมีแค่ system_admin / shelter_manager / warehouse_staff
>   ทำให้คนครัวซึ่งเป็นผู้ใช้หลักของหน้านี้บันทึกไม่ได้.
> - **Schema:** ไม่เปลี่ยน — ใช้ `recipe` schema_v 4 เดิม.

## Why

Feedback จากการ roleplay วันที่ 23/10/2569: วัตถุดิบที่ครัวกำหนดเองใช้ได้แค่รอบเดียว ต้องกรอกใหม่ทุกครั้ง.
Issue #802 ขอให้บันทึกเป็นสูตรใหม่ได้จากหน้า production board. ผู้ใช้หน้า production board คือ
`kitchen_staff` และ `shelter_manager` (`requireKitchen`) แต่ client guard ของ catalog
(`enforceWriteAccess`) อนุญาตแค่ admin / manager / warehouse_staff.

## Change

| สิทธิ์                                       | ก่อน                                                                  | หลัง                                 |
| -------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| สร้าง `recipe` ใน `shelter_<code>`           | system_admin, shelter_manager, warehouse_staff (+ supply_coordinator) | **+ kitchen_staff ของศูนย์เดียวกัน** |
| แก้ไข / ลบ `recipe`                          | system_admin, shelter_manager, warehouse_staff                        | ไม่เปลี่ยน                           |
| สร้าง / แก้ไข `item_master`, `item_category` | system_admin, shelter_manager, warehouse_staff                        | ไม่เปลี่ยน                           |

- CouchDB `validate_doc_update` ของ `shelter_*` รับ `recipe` อยู่แล้วโดยไม่จำกัด role → ไม่ต้องแก้ design doc.
  ขอบเขตการบังคับสิทธิ์จึงเป็นฝั่ง client (`useCreateRecipe`) เหมือนเอกสาร catalog อื่น.

## Impact

- `catalog` domain: เพิ่ม `canCreateShelterRecipe(roles, shelterCode?)`.
- `catalog` application: `useCreateRecipe` ใช้ `canCreateShelterRecipe` เป็นเงื่อนไขเดียว
  (ไม่มี shelter = central catalog → system_admin เท่านั้น).
- Production board Stage A โหมด "สร้างสูตรเอง": checkbox "บันทึกเป็นสูตรใหม่" อย่างเดียว ใช้ "ชื่อเมนูที่แสดง" เป็นชื่อสูตร
  และ "จำนวนจานที่ต้องการผลิต" เป็นจำนวนจานมาตรฐาน (ติ๊กแล้วไม่กรอกชื่อเมนู → toast ให้กรอก และยังไม่เปิดตั๋ว).
  บันทึกล้ม / ชื่อซ้ำ → toast แจ้ง แต่ยังเปิดตั๋วเบิกได้.
- หน้า catalog แท็บสูตรอาหาร (`/back-office/catalog?tab=recipe`): kitchen_staff เห็นปุ่ม "เพิ่มสูตรอาหาร" และเปิดฟอร์มสร้างได้
  (ใช้ `canCreateShelterRecipe`); ปุ่มแก้ไข / ลบยังซ่อนเหมือนเดิม.
- `docs/prd/role-permission-matrix.md`: เพิ่มแถว Recipe (Create) (KS = scope) และ Recipe (Edit / Delete) (ไม่เปลี่ยน)
  ไว้ก่อนอนุมัติ. ถ้าไม่อนุมัติ ให้ถอด 2 แถวนี้พร้อมสิทธิ์ใน `canCreateShelterRecipe`.

## Migration

N/A — ไม่มีการเปลี่ยนรูปเอกสาร.

## Decision log

- 2026-10-29 — proposed; เจ้าของโครงการเลือกให้ kitchen_staff สร้าง recipe ได้ (ระหว่าง implement #802)
- 2026-10-31 — อัปเดต role-permission-matrix ล่วงหน้าระหว่างรออนุมัติ (ตามที่ผู้พัฒนาขอ; PO ตีกลับได้)
