---
id: CR-145
title: ตัดฟีเจอร์จัดสรรอาหารส่งจุดแจกจ่าย (Push to POS) ทิ้งทั้งหมด — ticket flow จบที่คลังตรวจรับเข้าสต็อก
status: approved
date: 2026-09-26
updated: 2026-09-26
requested_by: Project Owner (session ตรวจ /back-office/tickets/kitchen)
decided_by: Project Owner
layer: stable
supersedes:
  - CR-144 (จัดสรรอาหารปรุงเสร็จส่งจุดแจกจ่าย — Push to POS)
affects:
  - docs/data/schema.md §2.7.4 (`meal_distribution_push` — ถูกลบ)
  - frontend/src/lib/features/kitchen/domain/meal-distribution-push.ts (ลบไฟล์)
  - frontend/src/lib/features/kitchen/data/kitchen.repository.ts + kitchen.remote.ts
  - frontend/src/lib/features/kitchen/application/queries.ts
  - frontend/src/lib/features/kitchen/index.ts (barrel)
  - frontend/src/routes/(protected)/back-office/kitchen/distribute/ (ลบทั้งไดเรกทอรี)
  - frontend/src/lib/features/tickets/ui/ticket-list.svelte
  - frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte
  - frontend/src/lib/server/shelter-access-design.ts + shelter-access-design.test.ts
---

# CR-145: ตัดฟีเจอร์จัดสรรอาหารส่งจุดแจกจ่าย (Push to POS) ทิ้งทั้งหมด

## Why

เจ้าของโครงการทบทวนหน้า `/back-office/tickets/kitchen` แล้วสรุปว่า flow ของ ticket ครัวควรจบแค่
"เก็บอาหารเข้าคลัง" — เมื่อคลังกด "ยืนยันตรวจรับ" ในขั้นตอน "รอตรวจรับเข้าคลัง" เสร็จ ให้ถือว่า
"ส่งมอบเสร็จสิ้น" ทันที ไม่มีขั้นตอนจัดสรรส่งจุดแจกจ่าย (Push to POS) ต่อจากนั้นอีก — คำเดิม
"จากครัวเข้าคลัง แค่นั้น"

นี่คือการย้อนกลับ [CR-144](CR-144-meal-distribution-push.md) เต็มรูปแบบ (ไม่ใช่แค่ §3.3 ที่แยก
หมวด `PENDING_DISPATCH`) — เจ้าของโครงการยืนยันให้ตัดทั้งฟีเจอร์ push-to-POS ทิ้ง ไม่ใช่แค่ย้อน
กลับไปพฤติกรรมเดิมของ CR-142/CR-143 แล้วเก็บหน้า `/distribute` ไว้เฉยๆ

## Change

**Before (CR-144):** `meal_service_receipt.outcome='confirmed'` → เช็คยอดคงเหลือที่ยังไม่ได้ push
(`mealServicePushRemaining`) → ถ้าเหลือ > 0 แสดงหมวด "รอส่งมอบ" (`PENDING_DISPATCH`, สีม่วง) พร้อม
ปุ่มไปหน้า `/back-office/kitchen/distribute` เพื่อสร้าง `meal_distribution_push` doc ใหม่; ถ้า
push ครบแล้วจึงเป็น "ส่งมอบเสร็จสิ้น" (`DELIVERED_IN`)

**After (CR-145 = กลับไปพฤติกรรม CR-142/CR-143 เดิม แล้วลบฟีเจอร์ push ทิ้ง):**
`meal_service_receipt.outcome='confirmed'` → ถือเป็น "ส่งมอบเสร็จสิ้น" (`DELIVERED_IN`) ทันที ไม่มี
การเช็คยอดคงเหลือ ไม่มีหมวด `PENDING_DISPATCH` อีกต่อไป

รายละเอียดที่ตัดออก:

1. **ลบ doc type `meal_distribution_push` ทั้งหมด** — domain schema/factory/guard, repository +
   remote implementation, TanStack Query hooks (`useMealDistributionPushes`,
   `useCreateMealDistributionPush`), live-query wiring, barrel exports
2. **ลบหน้า `/back-office/kitchen/distribute` ทั้งหน้า** (ฟอร์ม push-to-POS + ตาราง push history)
3. **ticket-list.svelte** — เอาหมวด `PENDING_DISPATCH` ออกจาก `RowCategory`, คืน category
   derivation ให้ตรงกับ CR-142 เดิม (confirmed → `DELIVERED_IN` เสมอ, ไม่เช็ค remaining), เอาปุ่ม
   หัวหน้าเพจ "จัดสรรอาหารส่งจุดแจก (Push)" ออก, เอา tab "รอส่งมอบ" ออก, `direction`/`fromLabel`/
   `toLabel`/`manageHref` ของแถว confirmed กลับไปเป็น "รับเข้า: โรงครัวกลาง → คลังเสบียงกลาง" คงที่
   (ไม่มีขา "จ่ายออกไปจุดแจก" อีก)
4. **production-board/[session_id]** — ข้อความ/ปุ่ม CTA ที่ชวนไปหน้า `/distribute` หลังยืนยันตรวจรับ
   เปลี่ยนเป็นข้อความปิดจบ "ส่งมอบเสร็จสิ้น" เฉยๆ
5. **RBAC (`shelter-access-design.ts` + test)** — เอา `meal_distribution_push` ออกจากทั้ง
   allow-list และ append-only list ของ `_design/access` validate_doc_update — เอกสารประเภทนี้เขียน
   ใหม่ไม่ได้อีกต่อไป (ตรงกับ UI ที่ไม่มีทางสร้างแล้ว)

## Impact

- ไม่มี schema_v bump (ทั้ง doc type ถูกลบ ไม่ใช่แก้ field)
- ไม่กระทบ `RequisitionTicket`/`stock_ledger` — เหมือนเดิมตาม CR-142 §2.3 (synthetic display logic
  เท่านั้น)
- เอกสาร `meal_distribution_push:*` ที่เคยเขียนไปแล้วใน production (ถ้ามี) ไม่ถูกลบออกจาก CouchDB
  (append-only ห้ามลบตาม policy เดิม แม้ตอนนี้จะไม่อยู่ใน allow-list ของ validate_doc_update แล้วก็
  ตาม) — กลายเป็น orphan ที่แอปไม่อ่าน/เขียนอีกต่อไป cleanup นอก scope ของ CR นี้
- `docs/data/schema.md` §2.7.4 เปลี่ยนจากตาราง field เป็นบันทึกว่าเอกสารประเภทนี้ถูกลบพร้อมอ้างอิง
  CR นี้ (คง heading ไว้เพื่อ traceability ไม่ลบทั้ง section)

## Migration

N/A — ไม่มี schema_v bump ให้ backfill/migrate เอกสารที่ persist แล้ว

## Decision log

- 2026-09-26 — เจ้าของโครงการอธิบาย flow ที่ต้องการระหว่างตรวจสอบหน้า
  `/back-office/tickets/kitchen`; ยืนยันให้ตัดฟีเจอร์ push-to-POS ทิ้งทั้งหมด (ไม่ใช่แค่ย้อนหมวด
  `PENDING_DISPATCH`); ยืนยัน track เป็น CR ไฟล์ใหม่ — approved ในบทสนทนาเดียวกัน
