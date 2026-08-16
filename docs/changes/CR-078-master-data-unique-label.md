---
id: CR-078
title: Master data — label ห้ามซ้ำภายใน master_type เดียวกัน (เช็คก่อนสร้าง/แก้ไข ทั้ง UI และ server)
status: proposed
date: 2026-08-16
requested_by: project owner
decided_by: project owner (ยืนยัน 2026-08-16)
layer: volatile
affects:
  - docs/data/schema.md §3.3 (invariant ใหม่ — ไม่เปลี่ยน field, ไม่ bump schema_v)
  - frontend/src/lib/features/master-data/domain/master-data.ts
  - frontend/src/lib/features/master-data/ui/master-data-edit-modal.svelte
  - frontend/src/routes/api/back-office/master-data/[type]/+server.ts
---

# CR-078 — Master data: unique label ต่อ master_type

> **สรุป (TL;DR):** `label` ของ item ต้องไม่ซ้ำภายใน `master_type` เดียวกัน · เทียบแบบ normalize
> (trim + ยุบช่องว่าง + lowercase ตัวอักษรละติน) · item ที่ `status: 'inactive'` **นับว่าใช้ชื่อนั้นแล้ว** ·
> shelter-local item ห้ามชนกับ item ของ global tier ด้วย · บังคับทั้งที่ modal (กันก่อนกด) และที่
> PUT endpoint (ด่านจริง, 422) · ไม่เปลี่ยน persisted shape และ **ไม่ bump `schema_v`**

## Why

ทั้ง 3 หน้าที่จัดการ master data — ตั้งค่าการลงทะเบียน (`registration-config`, 5 type),
ข้อมูลหลักครัวเรือน (`household-master-data`, 2 type) และตั้งค่าศูนย์พักพิง (`shelter-config`,
1 type) — ใช้คอมโพเนนต์ `MasterDataConfigPage` ตัวเดียวกัน และ**ไม่มีการเช็คชื่อซ้ำเลยสักชั้น**:
modal ตรวจแค่ "ห้ามว่าง", `applyItemOp` ต่อ item ใหม่พร้อม ULID ทุกครั้ง, และ PUT endpoint ตรวจ
เฉพาะรูปทรงด้วย Zod

ผลคือเจ้าหน้าที่กด "เพิ่มข้อมูล" ด้วยชื่อเดิมซ้ำได้ ได้ item คนละ `code` แต่ `label` เหมือนกัน ซึ่ง
แยกไม่ออกในทุก dropdown ที่ผูกกับ master data (เขต / ชุมชน / กลุ่มเปราะบาง / โรคประจำตัว / ฯลฯ)
ทำให้สถิติกระจายข้ามสองรายการที่ผู้ใช้เข้าใจว่าเป็นค่าเดียวกัน

## Change

1. **ขอบเขต:** `label` ต้อง unique **ภายใน `master_type` เดียวกัน** เท่านั้น — ชื่อเดียวกันยังใช้ข้าม
   type ได้ (เช่น "อื่นๆ" มีได้ทั้งใน `vulnerable_group` และ `pet_types`)
2. **การเทียบ:** normalize ก่อนเทียบ — NFC, ยุบช่องว่างทุกชนิด (รวม NBSP) เหลือช่องว่างเดียว, trim,
   lowercase (ไทยไม่มี case — มีผลเฉพาะส่วนละตินของ label). ค่าที่**บันทึกจริงยังเป็นข้อความตามที่
   เจ้าหน้าที่พิมพ์** — normalize ใช้เพื่อเปรียบเทียบเท่านั้น
3. **item ที่ปิดใช้งานนับด้วย:** `status: 'inactive'` ยังถือว่าจองชื่อนั้นไว้ เพราะ `code` เดิมยังถูก
   record ที่บันทึกไปแล้วอ้างอยู่ (soft-delete, schema.md §3.3) — ถ้าอยากใช้ชื่อเดิมอีกให้เปิดใช้งาน
   item เดิมกลับมา ไม่ใช่สร้างใหม่
4. **ข้ามสอง tier:** การเขียน shelter-local ต้องไม่ชนกับ `label` ของ global tier ด้วย เพราะหน้า
   back-office แสดงรายการ merge (global + shelter-local) รวมกัน — สองชื่อเดียวกันในตารางนั้นแยกไม่ออก
   (การเขียน global ตรวจเฉพาะภายในรายการ global)
5. **จุดบังคับ 2 ชั้น:**
   - **Modal** — ตรวจสดขณะพิมพ์ ขึ้นข้อความ "มีรายการชื่อนี้อยู่แล้วในประเภทนี้" (ต่อท้าย
     "(ปิดใช้งานอยู่)" เมื่อชนกับ item ที่ปิดใช้งาน) และ **disable ปุ่มบันทึก**
   - **`PUT /api/back-office/master-data/{type}`** — ด่านจริง ตอบ `422 VALIDATION` พร้อมชื่อที่ชน
     กัน กัน request ที่ยิงตรงข้าม UI
6. **ตอนแก้ไข** ยกเว้น item ตัวเอง — บันทึกซ้ำโดยไม่เปลี่ยนชื่อยังทำได้ แต่เปลี่ยนชื่อไปชนกับ item
   อื่นถูกปฏิเสธ

## Acceptance

- [x] เพิ่ม item ด้วยชื่อที่มีอยู่แล้วในประเภทเดียวกัน → modal ขึ้น error และปุ่มบันทึกกดไม่ได้
- [x] ชื่อที่ต่างกันแค่ช่องว่างหน้า/หลัง/ตรงกลาง หรือตัวพิมพ์ใหญ่-เล็กของส่วนละติน → ถือว่าซ้ำ
- [x] ชื่อที่ชนกับ item ซึ่ง `status: 'inactive'` → ถือว่าซ้ำ
- [x] แก้ไข item เดิมแล้วกดบันทึกโดยไม่เปลี่ยนชื่อ → ผ่าน
- [x] ชื่อเดียวกันข้าม `master_type` → ผ่าน
- [x] PUT ที่ยิงตรงพร้อม items ที่มี label ซ้ำ → `422` และไม่มีการเขียนลง CouchDB
- [x] PUT scope shelter ที่ label ชนกับ item ของ global → `422`
- [x] ครอบทั้ง 3 หน้า (registration-config / household-master-data / shelter-config) ทั้งฝั่ง
      `back-office` และ `portal/system-management` — ใช้ `MasterDataConfigPage` ร่วมกัน

## Impact

- **Domain** เพิ่ม pure helper 3 ตัว: `normalizeLabel`, `findDuplicateLabel` (สำหรับ UI, รับ
  `excludeCode`), `findLabelCollision` (สำหรับ write path, ตรวจทั้งในรายการและข้าม tier) — export
  ผ่าน barrel และ `domain.ts` (server facade)
- **UI** `MasterDataEditModal` รับ prop `existingItems` เพิ่ม (ภายใต้ศูนย์คือรายการ merge แล้ว)
- **Server** PUT scope shelter อ่าน global doc เพิ่ม 1 ครั้งเพื่อตรวจข้าม tier — เดิมไม่อ่านเลย
  (test เดิมที่ assert ว่า "ไม่อ่าน global" ถูกปรับให้ยืนยันเฉพาะว่า doc ที่เขียนไม่ถูก merge)
- **ไม่กระทบ** consumer ฝั่งอ่าน (dropdown ต่างๆ) และไม่กระทบ worker/Mongo projection

## Migration

N/A — ไม่เปลี่ยน persisted document shape และ **ไม่ bump `schema_v`** (คงที่ 3)

**ข้อมูลเดิมที่ซ้ำอยู่ก่อนแล้ว:** กฎนี้ตรวจที่ payload ของ PUT ไม่ใช่ตอนอ่าน — doc ที่มี label ซ้ำ
ค้างอยู่ยังอ่านและแสดงผลได้ปกติ แต่การแก้ไขครั้งถัดไปของ type นั้นจะถูกปฏิเสธจนกว่าจะเปลี่ยนชื่อให้
ไม่ซ้ำ (แก้ได้จาก modal ตามปกติ — การเปลี่ยนเป็นชื่อที่ไม่ซ้ำไม่ถูกบล็อก). seed ปัจจุบัน
(`frontend/scripts/seed.ts`) ไม่มี label ซ้ำในทุก type จึงไม่ต้อง backfill

## Decision log

- 2026-08-16 — project owner เลือก: ขอบเขต = ภายใน `master_type` เดียวกัน, inactive นับเป็นซ้ำ,
  ห้าม shelter-local ชนกับ global, และ tracking = CR ไฟล์ใหม่
- 2026-08-16 — proposed: domain helper + modal guard + PUT gate + unit/server tests
