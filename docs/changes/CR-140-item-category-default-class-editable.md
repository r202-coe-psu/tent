---
id: CR-140
title: อนุญาตให้แก้ไข default_class ของหมวดหมู่ระบบมาตรฐานได้ (แก้ไข CR-119 FR-04)
status: approved
date: 2026-09-17
updated: 2026-09-17
requested_by: Project Owner (session ปรับหน้า Catalog)
decided_by: Project Owner
layer: stable
affects:
  - docs/changes/CR-119-seed-item-categories.md §4.2 FR-04 (แก้ไขบางส่วน)
  - docs/data/schema.md §4.1 (`item_category` immutability note)
  - docs/data/schema.md §5 invariant #11
  - frontend/src/lib/features/catalog/data/catalog.remote.ts (`updateItemCategory`)
  - frontend/src/lib/server/shelter-access-design.ts (`validate_doc_update` — canonical)
  - frontend/scripts/sync-central-db.ts (VDU string ซ้ำ)
  - frontend/scripts/seed/master-seed.ts (VDU string ซ้ำ)
  - frontend/src/lib/features/catalog/ui/item-category-form.svelte
  - frontend/src/lib/server/shelter-access-design.test.ts
  - frontend/src/lib/features/catalog/data/catalog.remote.test.ts
---

# CR-140: อนุญาตให้แก้ไข default_class ของหมวดหมู่ระบบมาตรฐานได้ (แก้ไข CR-119 FR-04)

## 1. Why

ตอนใช้งานจริงพบว่าการล็อก `default_class` ของ 10 หมวดหมู่ระบบมาตรฐานไว้ตายตัวตาม CR-119 FR-04
เข้มงวดเกินไปสำหรับหน้างาน — ผู้ดูแลระบบต้องการปรับ `default_class` ของหมวดหมู่ระบบได้เองเมื่อพบว่า
ค่าเริ่มต้นที่ seed มาไม่ตรงกับบริบทของศูนย์ (เช่น อยากตั้ง `เครื่องนอนและที่พักพิง` เป็น `CONSUMABLE`
แทน `DURABLE` ในบางกรณี) โดยไม่ต้องรอทำ Change Record ทุกครั้งที่มีการปรับ

**ยืนยันชัดเจนแล้วว่านี่คือการแก้ business rule ที่อนุมัติไปแล้วใน CR-119 FR-04** (ถามผู้ใช้ตรงๆ
2 รอบ ก่อนแก้โค้ด) — เก็บเป็น Change Record ใหม่ตามนโยบาย `docs/change-management.md` §2/§6

## 2. Change (ก่อน → หลัง)

| มิติ | ก่อน (CR-119 เดิม) | หลัง (CR-140) |
| --- | --- | --- |
| `default_class` ของหมวดหมู่ระบบ (`is_protected: true`) | Immutable ทั้ง 3 ชั้น (UI disabled, repository force-restore, CouchDB VDU reject) | **แก้ไขได้** โดย `system_admin` เช่นเดียวกับ `name`/`description` |
| `system_key` ของหมวดหมู่ระบบ | Immutable | **ยังคง Immutable เหมือนเดิม** — ไม่เปลี่ยน |
| `is_protected` ของหมวดหมู่ระบบ | Immutable (ห้ามถอด flag) | **ยังคง Immutable เหมือนเดิม** — ไม่เปลี่ยน |
| การลบหมวดหมู่ระบบ (FR-03, 3-tier deletion protection) | ห้ามลบเด็ดขาด | **ไม่เปลี่ยน** — ยังห้ามลบเหมือนเดิม |

**ขอบเขตแคบมาก:** แก้เฉพาะ FR-04 ส่วน `default_class` เท่านั้น ไม่แตะ FR-03 (deletion) และไม่แตะ
immutability ของ `system_key`/`is_protected`

## 3. Requirements

- **FR-01:** ฟอร์มแก้ไขหมวดหมู่สิ่งของ (`item-category-form.svelte`) ต้องเปิดให้เลือก
  `default_class` (CONSUMABLE/DURABLE/EQUIPMENT) ได้ปกติแม้เป็นหมวดหมู่ระบบมาตรฐาน (`is_protected: true`)
  — ลบ locked-notice "🔒 หมวดหมู่มาตรฐานระบบถูกกำหนดประเภทเริ่มต้นไว้ตายตัว" และปลดล็อกปุ่มเลือก
- **FR-02:** Repository layer (`updateItemCategory`) ต้อง**ไม่**force-restore ค่า `default_class`
  เดิมอีกต่อไปเมื่อแก้ไขหมวดหมู่ระบบ (ยังคง force-restore `system_key` และ `is_protected` เหมือนเดิม)
- **FR-03:** CouchDB `validate_doc_update` (`_design/access` บน database `catalog`) ต้องลบเงื่อนไข
  reject การเปลี่ยน `default_class` บนหมวดหมู่ protected ออก (ยังคง reject การเปลี่ยน `system_key`
  และการถอด `is_protected` เหมือนเดิม) — ต้อง sync 3 จุดที่มี VDU string นี้ซ้ำกันให้ตรงกัน
  (`shelter-access-design.ts` คือ canonical source, `sync-central-db.ts` และ `master-seed.ts`
  เป็นสำเนาที่ต้องแก้ตาม) แล้ว redeploy design doc ด้วย `pnpm redeploy:access --write --confirm`

## 4. Impact & Traceability

- `docs/changes/CR-119-seed-item-categories.md` §4.2 FR-04: เพิ่มหมายเหตุชี้ไปยัง CR-140
  ว่าเฉพาะส่วน `default_class` ถูกแก้ไขแล้ว — `system_key`/`is_protected` ยังคง immutable ตามเดิม
- `docs/data/schema.md` §4.1: ปรับประโยค "ห้ามเปลี่ยน `system_key`, `default_class` หรือ
  `is_protected`" เป็น "ห้ามเปลี่ยน `system_key` หรือ `is_protected` (`default_class` แก้ไขได้ตาม
  CR-140)"
- `docs/data/schema.md` §5 invariant #11: ปรับข้อความเดียวกัน
- โค้ดตาม `affects:` ด้านบน

## 5. Migration

ไม่กระทบ `schema_v` (ยังเป็น `item_category schema_v 2` เหมือนเดิม — แค่เปลี่ยนกฎการเขียน ไม่เปลี่ยน
โครงสร้างเอกสาร) ต้อง redeploy CouchDB VDU (`pnpm redeploy:access --write --confirm`) เพื่อให้ฐานข้อมูล
dev ที่รันอยู่ยอมรับการเปลี่ยน `default_class` บนเอกสาร protected ทันที

## 6. Acceptance Criteria

- [ ] **AC-01:** เปิดฟอร์มแก้ไขหมวดหมู่ระบบ (เช่น `item_category:bedding`) ปุ่มเลือก Default Class
      ไม่ disabled และไม่มี lock notice
- [ ] **AC-02:** บันทึกเปลี่ยน `default_class` ของหมวดหมู่ระบบสำเร็จ ค่าใหม่ถูกบันทึกจริงใน CouchDB
      (ไม่ถูก force-restore กลับ)
- [ ] **AC-03:** พยายามเปลี่ยน `system_key` หรือถอด `is_protected` บนหมวดหมู่ระบบ (ยิงตรงผ่าน
      repository/VDU) ยังคงถูกปฏิเสธเหมือนเดิม
- [ ] **AC-04:** การลบหมวดหมู่ระบบยังคงถูกบล็อกทั้ง 3 ชั้นเหมือนเดิม (ไม่กระทบ FR-03)
- [ ] **AC-05:** Unit test ที่เกี่ยวข้อง (`shelter-access-design.test.ts`,
      `catalog.remote.test.ts`) ปรับให้ตรงพฤติกรรมใหม่แล้ว ผ่านทั้งหมด

## 7. Decision Log

- **2026-09-17 (Decision 1):** ยืนยันกับ Project Owner ตรงๆ ว่าต้องการแก้ business rule ที่อนุมัติ
  แล้วใน CR-119 FR-04 จริง (ไม่ใช่ความเข้าใจผิด) ก่อนเริ่มแก้โค้ด
- **2026-09-17 (Decision 2):** เลือก track เป็น Change Record ใหม่ (CR-140) แทนที่จะแก้ CR-119 เดิม
  ตรงๆ เพื่อรักษาประวัติการอนุมัติเดิมของ CR-119 ไว้ครบ (Non-destructive amendment)
  ตามนโยบาย `docs/change-management.md`
- **2026-09-17 (Decision 3):** จำกัดขอบเขตแคบที่สุด — แก้เฉพาะ `default_class`, ไม่แตะ `system_key`,
  `is_protected`, หรือ FR-03 (deletion protection) ของ CR-119
