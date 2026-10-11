---
id: CR-031
title: "Item Master Schema Reconciliation — เพิ่มฟิลด์ category"
status: done
date: 2026-07-04
updated: 2026-07-05
requested_by: development team C
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §4.2
  - frontend/src/lib/features/catalog/domain/catalog.ts
---

# CR-031 — Item Master Schema Reconciliation (เพิ่มฟิลด์ category)

> [!NOTE]
> **สรุป (TL;DR):** เพิ่มฟิลด์ `category` (str, opt) ในเอกสาร Canonical Schema ของ `item_master` เพื่อจัดแนว (reconcile) ให้ตรงกับแบบจำลองจริงในโค้ดฝั่ง frontend และ Mock UI ที่ใช้ระบุประเภท/หมวดหมู่ของสินค้ามาตรฐานกลาง · schema_v คงที่ระดับ 2 (reconcile)

## Why

ในส่วนของ Mock UI และโค้ดพัฒนาจริงในระบบ มีการออกแบบให้กำหนดหมวดหมู่ของสินค้ามาตรฐานผ่านฟิลด์ `category` (อ้างอิงจากชื่อ `item_category.name`) เพื่อใช้จัดประเภทสินค้าในการค้นหาคัดกรองและแสดงผล แต่เนื่องจากในเอกสารหลัก `docs/data/schema.md` §4.2 ยังขาดฟิลด์ `category` นี้ในข้อมูลตารางคุณลักษณะสินค้า จึงทำการเปิด Change Record นี้เพื่อระบุและปรับปรุงเอกสาร Technical Canonical ให้มีข้อมูลที่สอดคล้องตรงกันทั้งโครงการ

## Change

### 1. Spec ↔ Code Schema Reconciliation

ปรับปรุงคุณสมบัติของ `item_master` ในเอกสาร `docs/data/schema.md` §4.2:

- เพิ่มฟิลด์ `category` (str, opt) เพื่อระบุหมวดหมู่ของสินค้า เช่น `"food"`, `"medicine"`, `"hygiene"` (อ้างอิงชื่อหมวดหมู่จาก `item_category.name`)

### 2. Spec Update

- อัปเดต `docs/data/schema.md` §4.2 (`item_master` schema table)

---

## Impact

- **`docs/data/schema.md` §4.2** — เพิ่มฟิลด์ `category` ในตารางรายละเอียดสินค้ามาตรฐาน
- **`docs/changes/_index.md`** — เพิ่มบันทึกประวัติการแก้ไขนี้

## Migration

- **schema_v 2 (คงเดิม):** การเปลี่ยนแปลงนี้เป็นการจัดแนวสเปก (Reconciliation) ให้สอดคล้องกับระบบจริงที่มีคุณสมบัตินี้อยู่แล้วในฝั่งโค้ด ข้อมูลสินค้าดั้งเดิมที่ไม่มีการระบุหมวดหมู่ยังสามารถทำงานได้ตามปกติเนื่องจากฟิลด์นี้ถูกกำหนดให้เป็นแบบเลือกได้ (optional) จึงไม่มีผลกระทบต่อประวัติข้อมูลเดิมในฐานข้อมูล

## Decision log

- 2026-07-04 — proposed
- 2026-07-05 — renumbered CR-030 → CR-031 (CR-030 ถูกใช้โดย kitchen requisition unit)
- 2026-07-05 — approved; schema.md §4.2 updated (done)
