---
id: CR-057
title: Add stock_threshold_override document type and schema
status: proposed
date: 2026-07-28
requested_by: ทีมพัฒนา (ทีม C - T-14)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.16 (ใหม่)
  - docs/data/schema.md §7
  - schema_v stock_threshold_override 1 (ใหม่)
  - frontend/src/lib/features/supply/domain/threshold-override.ts
  - frontend/src/lib/features/supply/data/supply.remote.ts
  - frontend/src/lib/features/supply/application/queries.ts
  - frontend/src/lib/features/sop-ratios/ui/alert-threshold-editor.svelte
---

# CR-057 — Add stock_threshold_override document type and schema

**สรุป (TL;DR):**  
เพิ่มเอกสารชนิด `stock_threshold_override` สำหรับการกำหนดเกณฑ์เตือนภัยสินค้าขั้นต่ำแบบเฉพาะรายศูนย์พักพิง (Per-Shelter Reorder Threshold) เพื่อรองรับฟีเจอร์คำนวณและแจ้งเตือนสินค้าขาดแคลนบน Dashboard (งาน T-14) · ส่งออกข้อมูลให้ระบบรับบริจาค (T-21/22/23) และ Engine คำนวณความต้องการทรัพยากร (T-31) ใช้ร่วมกัน

## Why
ตามเกณฑ์ Definition of Done (DoD) ของภารกิจ **T-14 (Stock dashboard + reorder threshold)** ระบบจะต้องสามารถตั้งค่าระดับเกณฑ์เตือนภัย (reorder threshold) ต่อสินค้าเฉพาะศูนย์ได้ (Per-Shelter Override) 
เดิมทีระบบใช้ค่าเกณฑ์กลางร่วมกันของทั้งโปรเจกต์ ซึ่งทำให้ไม่ยืดหยุ่นต่อความจำเป็นของแต่ละศูนย์พักพิง (เช่น บางศูนย์พักพิงมีประชากรหนาแน่น มีความต้องการสำรองข้อมูลแตกต่างกัน) จึงต้องสร้างข้อมูลชนิดใหม่เพื่อเขียนทับ (Override) ค่าระบบกลางนี้

## Change

### 1. โครงสร้างข้อมูลใหม่ (CouchDB Document Type)
สร้าง `stock_threshold_override` บันทึกลงฐานข้อมูลเฉพาะศูนย์ (`shelter_*`) มีรูปแบบดังนี้:
- `_id`: `stock_threshold_override:{shelter_code}:{item_id}`
- `type`: `'stock_threshold_override'`
- `schema_v`: `1`
- `item_id`: `str` (ID สินค้า เช่น `item:{ulid}`)
- `reorder_level`: `num|null` (จำนวนสินค้าขั้นต่ำที่จะแจ้งเตือน หรือระบุแบบเจาะจง)
- `target_reserve_days`: `num|null` (จำนวนวันที่ประสงค์จะสำรองสินค้า)
- `consumption_rate`: `str|null` (อัตราความต้องการใช้สินค้าต่อคนต่อวัน)

### 2. กระบวนการตรวจสอบ (Runtime Validation)
- เพิ่ม Zod Schema `stockThresholdOverrideSchema` ในฝั่ง Client เพื่อทำการตรวจสอบโครงสร้างความถูกต้องของข้อมูลก่อนเขียนบันทึกลงสู่ CouchDB
- ทำการ Validation ข้อมูลอินพุตที่ส่งเข้ามาบันทึกในเมธอด `saveThresholdOverride` ของ Repository

## Impact

### 1. เอกสาร (Documentation)
- **[schema.md](file:///home/suthinxn/suthinxn/work/tent/docs/data/schema.md):** เพิ่มเนื้อหาในหัวข้อ §2.16 เพื่อนิยามฟิลด์และความหมายของเอกสาร และหัวข้อ §7 เพื่อเพิ่มการทำ Mango Index `(item_id)` บนฐานข้อมูล `shelter_*`

### 2. ซอร์สโค้ด (Source Code)
- **[threshold-override.ts](file:///home/suthinxn/suthinxn/work/tent/frontend/src/lib/features/supply/domain/threshold-override.ts):** ประกาศ Zod Schema และชนิดข้อมูล TypeScript สำหรับ Threshold Override
- **[supply.remote.ts](file:///home/suthinxn/suthinxn/work/tent/frontend/src/lib/features/supply/data/supply.remote.ts):** เพิ่มการตรวจสอบความสอดคล้องผ่าน Zod schema ก่อนเรียกฟังก์ชันเซฟเอกสารลงฐานข้อมูล CouchDB
- **[queries.ts](file:///home/suthinxn/suthinxn/work/tent/frontend/src/lib/features/supply/application/queries.ts):** กำหนด Type-Safety ใน Mutation function เพื่อป้องกันการทำ Type Erasure
- **[alert-threshold-editor.svelte](file:///home/suthinxn/suthinxn/work/tent/frontend/src/lib/features/sop-ratios/ui/alert-threshold-editor.svelte):** ป้อนอินพุตโดยตรงผ่านแบบฟอร์มแก้ไขเกณฑ์เตือนภัย

## Migration
- ไม่มีผลกระทบเชิงระบบกับประวัติข้อมูลเก่า (No Production Backfill) เนื่องจากนี่เป็นการเพิ่ม Document Type ใหม่เอี่ยมเข้าสู่คลังข้อมูล
- การพัฒนาและทดสอบในเครื่อง สามารถเซฟข้อมูลใหม่ได้ทันที และแนะนำให้ใช้ข้อมูลสินค้าและรหัสศูนย์จาก Script seed ที่จัดเตรียมไว้

## Decision log
- 2026-07-28 — proposed โดยทีม C (T-14)
