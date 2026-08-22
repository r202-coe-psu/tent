---
id: CR-078
title: Master data — label ห้ามซ้ำภายใน master_type เดียวกัน (เช็คก่อนสร้าง/แก้ไข ทั้ง UI และ server)
status: approved
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
2. **การเทียบ:** normalize ก่อนเทียบ — NFC, **ตัดอักขระ zero-width ทิ้ง** (U+200B–U+200D, U+2060,
   U+FEFF — JS `\s` ไม่จับ U+200B ซึ่งพบบ่อยในข้อความไทยที่ copy มาจาก Word/Excel/LINE),
   ยุบช่องว่างทุกชนิด (รวม NBSP) เหลือช่องว่างเดียว, trim, lowercase (ไทยไม่มี case — มีผลเฉพาะ
   ส่วนละตินของ label). ค่าที่**บันทึกจริงยังเป็นข้อความตามที่เจ้าหน้าที่พิมพ์** — normalize
   ใช้เพื่อเปรียบเทียบเท่านั้น
3. **item ที่ปิดใช้งานนับด้วย:** `status: 'inactive'` ยังถือว่าจองชื่อนั้นไว้ เพราะ `code` เดิมยังถูก
   record ที่บันทึกไปแล้วอ้างอยู่ (soft-delete, schema.md §3.3) — ถ้าอยากใช้ชื่อเดิมอีกให้เปิดใช้งาน
   item เดิมกลับมา ไม่ใช่สร้างใหม่
4. **ข้ามสอง tier — ตรวจสองทาง:** หน้า back-office แสดงรายการ merge (global + shelter-local)
   รวมกัน ชื่อที่ชนกันจากทิศไหนก็อ่านเหมือนกันทั้งคู่ จึงตรวจทั้งสองทาง — การเขียน shelter-local
   ตรวจกับ items ของ global tier, และ**การเขียน global ตรวจกับ items ของทุกศูนย์**
   (`readShelterMasterDocs` — prefix scan `master_data:{type}:` บน `_all_docs`). ถ้าตรวจทางเดียว
   SA จะสร้าง global item ที่ชนกับของศูนย์ใดศูนย์หนึ่งได้ แล้วศูนย์นั้นจะบันทึก type นั้นไม่ได้อีกเลย
5. **จุดบังคับ 2 ชั้น:**
   - **Modal** — ตรวจสดขณะพิมพ์ ขึ้นข้อความ "มีรายการชื่อนี้อยู่แล้วในประเภทนี้" (ต่อท้าย
     "(ปิดใช้งานอยู่)" เมื่อชนกับ item ที่ปิดใช้งาน) และ **disable ปุ่มบันทึก**
   - **`PUT /api/back-office/master-data/{type}`** — ด่านจริง ตอบ `422 VALIDATION` พร้อมชื่อที่ชน
     กัน กัน request ที่ยิงตรงข้าม UI
6. **ตอนแก้ไข** ยกเว้น item ตัวเอง — บันทึกซ้ำโดยไม่เปลี่ยนชื่อยังทำได้ แต่เปลี่ยนชื่อไปชนกับ item
   อื่นถูกปฏิเสธ
7. **Detect-then-resolve สำหรับชื่อซ้ำที่เล็ดลอดเข้ามา:** กฎนี้บังคับได้เฉพาะที่ application layer
   — ทางเข้าอื่นที่ไม่ผ่าน BFF (replication backlog จาก edge, script/seed ที่เขียน CouchDB ตรง,
   import) จึงยังทำให้เกิดชื่อซ้ำได้ และ **กดกฎลงไปที่ CouchDB ไม่ได้**: `validate_doc_update`
   เห็นแค่ `(newDoc, oldDoc)` ของ doc ตัวเอง อ่าน doc อื่นไม่ได้ → ตรวจ uniqueness ข้าม
   global ↔ shelter-local ไม่ได้เลย. ดังนั้นหน้า master data จึง **ตรวจจับและแจ้ง** แทนการกัน:
   ขึ้น banner บอกจำนวนรายการที่ซ้ำ (นับจาก items ทั้งหมด ไม่ขึ้นกับช่องค้นหา) และติด badge
   "ชื่อซ้ำ" ที่แถวที่ชนกัน ให้เจ้าหน้าที่ไปแก้ชื่อหรือปิดใช้งานให้เหลืออันเดียว. ภายใต้ศูนย์ รายการ
   GLOBAL ที่ชนจะถูกมาร์กด้วย แต่ต้องแก้ที่ส่วนกลาง (copy ใน banner บอกไว้)

8. **`code` ซ้ำ = คนละปัญหากับ `label` ซ้ำ:** ทุก operation ในฟีเจอร์นี้อ้างอิง item ด้วย `code`
   (`applyItemOp` match ด้วย code, `item_sources` key ด้วย code, consumer resolve ด้วย
   `find(code)`) — doc ที่บันทึก item เดียวซ้ำสองครั้งจึงไม่ใช่ "สอง item" แต่เป็น item เดียวที่ถูก
   บันทึกซ้ำ และ**แก้จากหน้าจอไม่ได้** เพราะกดแก้/ปิดใช้งานจะโดนทั้งคู่. จัดการดังนี้:
   - **write path ยุบให้อัตโนมัติ** (`dedupeItemsByCode` — เก็บตัวแรกไว้ เพราะเป็นตัวที่ record
     เดิมอ้างอยู่) ทำงานร่วมกับ `enforceOneDefault` ซึ่งซ่อม state ผิดรูปแบบเดียวกันอยู่แล้ว
   - **ตารางต้องยังแสดงผลได้** — `{#each}` ที่ key ด้วย `code` ล้วนจะ throw `each_key_duplicate`
     ของ Svelte 5 แล้ว render หยุดกลางคัน ตารางว่างทั้งที่มีข้อมูล (เจอจริงตอนทดสอบ) จึงเปลี่ยนเป็น
     key แบบ `code#index` เฉพาะแถวที่ code ซ้ำ
   - **banner แยกกัน** — สีแดง "รหัสซ้ำ" (ระบบยุบให้เอง) vs สีเหลือง "ชื่อซ้ำ" (ต้องไปแก้เอง)
     และนับ "ชื่อซ้ำ" จากรายการที่ dedupe code แล้ว เพื่อไม่ให้ item ที่ซ้ำตัวเองถูกนับเป็นชื่อซ้ำ
     แล้วบอกให้ผู้ใช้ไปเปลี่ยนชื่อ ซึ่งเป็นคำแนะนำที่ทำตามไม่ได้

## Acceptance

- [x] เพิ่ม item ด้วยชื่อที่มีอยู่แล้วในประเภทเดียวกัน → modal ขึ้น error และปุ่มบันทึกกดไม่ได้
- [x] ชื่อที่ต่างกันแค่ช่องว่างหน้า/หลัง/ตรงกลาง หรือตัวพิมพ์ใหญ่-เล็กของส่วนละติน → ถือว่าซ้ำ
- [x] ชื่อที่ชนกับ item ซึ่ง `status: 'inactive'` → ถือว่าซ้ำ
- [x] แก้ไข item เดิมแล้วกดบันทึกโดยไม่เปลี่ยนชื่อ → ผ่าน
- [x] ชื่อเดียวกันข้าม `master_type` → ผ่าน
- [x] PUT ที่ยิงตรงพร้อม items ที่มี label ซ้ำ → `422` และไม่มีการเขียนลง CouchDB
- [x] PUT scope shelter ที่ label ชนกับ item ของ global → `422`
- [x] PUT scope global ที่ label ชนกับ item ของศูนย์ใดศูนย์หนึ่ง → `422`
- [x] ชื่อที่ต่างกันแค่อักขระ zero-width (U+200B / U+FEFF) → ถือว่าซ้ำ
- [x] doc ที่มีชื่อซ้ำค้างอยู่ก่อนกฎนี้ → toggle สถานะ / แก้ item อื่นยังผ่าน แต่เพิ่มคู่ซ้ำใหม่ยังถูกปฏิเสธ
- [x] modal ที่ยังโหลดรายการเดิมไม่สำเร็จ → ปุ่มบันทึก disabled พร้อมข้อความบอกเหตุผล
- [x] doc ที่มีชื่อซ้ำอยู่ → หน้า master data ขึ้น banner + badge "ชื่อซ้ำ" ที่แถวที่ชนกัน
- [x] banner ยังแสดงแม้กำลังพิมพ์ค้นหาอยู่ (นับจาก items ทั้งหมด ไม่ใช่ผลค้นหา)
- [x] doc ที่มี `code` ซ้ำ → ตารางยังแสดงทุกแถว (ไม่ว่างเปล่า) + banner "รหัสซ้ำ" + badge ที่แถว
- [x] PUT ที่ส่ง items ซึ่งมี `code` ซ้ำ → เขียนลง CouchDB เหลือรายการเดียว (เก็บตัวแรก)
- [x] item ที่ซ้ำตัวเอง (code เดียวกัน) ไม่ถูกนับเป็น "ชื่อซ้ำ" ในสีเหลือง
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

**ข้อมูลเดิมที่ซ้ำอยู่ก่อนแล้ว — grandfather:** ก่อนตรวจ ระบบอ่าน state ที่ persist อยู่แล้วมาทำ
ชุด "label ที่ซ้ำอยู่ก่อนหน้านี้" (`duplicateLabelKeys`) แล้ว**ข้ามการตรวจเฉพาะ label เหล่านั้น** —
doc ที่มีชื่อซ้ำค้างมาก่อนกฎนี้จึงยัง toggle สถานะ / แก้ item อื่นได้ตามปกติ ไม่ถูกล็อกจนกว่าจะ
เปลี่ยนชื่อ (ถ้าไม่ทำแบบนี้ การกด "ปิดใช้งาน" ก็จะถูกปฏิเสธ ทำให้แก้อะไรไม่ได้เลย). แต่การ**เพิ่มคู่ซ้ำ
ใหม่ยังถูกปฏิเสธเสมอ** แม้ doc นั้นจะมีคู่ซ้ำเดิมอยู่. seed ปัจจุบัน (`frontend/scripts/seed.ts`)
ไม่มี label ซ้ำในทุก type จึงไม่ต้อง backfill

## Decision log

- 2026-08-16 — project owner เลือก: ขอบเขต = ภายใน `master_type` เดียวกัน, inactive นับเป็นซ้ำ,
  ห้าม shelter-local ชนกับ global, และ tracking = CR ไฟล์ใหม่
- 2026-08-16 — proposed: domain helper + modal guard + PUT gate + unit/server tests
- 2026-08-16 — edge-case pass (bmad-review-edge-case-hunter) แก้เพิ่ม 3 จุดในกฎนี้: ตัดอักขระ
  zero-width ตอน normalize, ตรวจข้าม tier สองทาง (global ↔ shelter), และ grandfather ชื่อซ้ำเดิม
  ไม่ให้ล็อกการแก้ไขอื่น. modal ที่โหลดรายการเดิมไม่สำเร็จจะ disable ปุ่มบันทึกแทนการปล่อยผ่าน
- 2026-08-17 — พบของจริงระหว่างทดสอบ: `master_data:vulnerable_group:SH001` มี item เดียวกันสอง
  ครั้ง (`code` เดียวกัน) ทำให้ตาราง **ว่างทั้งหน้า** เพราะ Svelte throw `each_key_duplicate` →
  เพิ่มการจัดการ `code` ซ้ำแยกจาก `label` ซ้ำ (ดู Change ข้อ 8). ยังไม่ทราบต้นทางที่ทำให้ item ถูก
  บันทึกซ้ำ — ต้องสืบต่อ
- 2026-08-16 — project owner ถามถึงเคส offline/edge เขียนแล้ว sync กลับมาชนกัน. สรุป: ปัจจุบัน
  เกิดไม่ได้ เพราะ `registry` replicate ทางเดียว `central → edge` (data-model.md §1 ตาราง) ศูนย์
  อ่าน master data จาก edge ได้แต่เขียนไม่ได้ — ต่างจาก `shelter_{code}` ที่มี edge ⇄ central
  backlog. เลือกทาง **detect-then-resolve** (banner + badge) แทนการพยายามกันตอน replicate ซึ่ง
  ทำไม่ได้จริง — ดู Change ข้อ 7
- 2026-08-21 — approved (project owner อนุมัติสเปก CR-078)
