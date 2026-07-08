
---
id: CR-034
title: เพิ่ม needs[].status ใน donation_campaign สำหรับระบบ Force Cut-off และขยับ schema_v เป็น 2
status: proposed
date: 2026-07-06
requested_by: ทีมพัฒนา (Team A)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §2.4
  - schema_v 1 → 2
  - frontend/src/lib/features/operations/domain/operations.ts
---
# CR-034 — เพิ่ม needs[].status ใน donation_campaign

## Why

ตามเป้าหมายของงาน T-22 (Donation Cut-off) เจ้าหน้าที่ในระบบหลังบ้านต้องสามารถ Manual Override เพื่อสั่งปิดรับบริจาคสิ่งของบางประเภทในแคมเปญแบบด่วนได้ (Force Cut-off) แม้ยอดยังไม่ถึงเป้า จึงจำเป็นต้องเพิ่มฟิลด์สถานะรายไอเทม (`needs[].status`)

## Change

- ปรับโครงสร้างของฟิลด์ `needs` ใน `donation_campaign`
  - **Before (v1):** `needs: [{ item_id: string, qty_target: number, unit: string }]`
  - **After (v2):** `needs: [{ item_id: string, qty_target: number, unit: string, status?: 'open' | 'closed' }]` (โดย `status` มีค่าเริ่มต้นเป็น `'open'`)
- ขยับ `schema_v` ของเอกสาร `donation_campaign` จาก `1` เป็น `2`

## Impact

- กระทบต่อ Zod Validation ใน `operations.ts` (`campaignInputSchema`)
- กระทบต่อการแสดงผลบนกระดานหลังบ้านและการเช็คเงื่อนไข Cut-off

## Migration

- ฟิลด์ `needs[].status` เป็นฟิลด์ทางเลือก (Optional) หากเอกสารเดิมที่อยู่ในระบบไม่มีฟิลด์นี้ ให้ระบบถือว่าสถานะเป็น `'open'` (Fallback) โดยปริยาย จึงไม่จำเป็นต้องทำ Script ย้ายข้อมูล (No production backfill needed)

## Decision log

- 2026-07-06 — proposed
