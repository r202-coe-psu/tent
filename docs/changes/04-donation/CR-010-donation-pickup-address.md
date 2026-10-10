---
id: CR-010
title: เพิ่มที่อยู่รับของบริจาค (Pickup Address) สำหรับวิธีจัดส่งแบบไปรับที่บ้าน
status: done
date: 2026-06-24
requested_by: User
decided_by: User
layer: volatile
affects:
  - docs/data/schema.md
  - frontend/src/lib/features/donations/domain/donation.ts
  - frontend/src/lib/components/form/donor-time-selection-form.svelte
  - frontend/src/routes/public/donations/donation.svelte.ts
---

# CR-010 — เพิ่มที่อยู่รับของบริจาค (Pickup Address)

## Why
เมื่อผู้บริจาคประสงค์จะมอบสิ่งของและเลือกวิธีจัดส่งเป็น **"ต้องการให้รถศูนย์ไปรับ" (shelter_pickup)** ทางศูนย์พักพิงจำเป็นต้องทราบสถานที่ติดต่อหรือพิกัดที่อยู่เพื่อส่งเจ้าหน้าที่ไปรับของ โครงสร้าง Schema เดิม (schema_v 2) ใน `logistics` ไม่ได้ระบุถึงฟิลด์นี้ ทำให้ไม่มีช่องทางสำหรับเก็บที่อยู่

## Change
- **Schema (`docs/data/schema.md`):** เพิ่มฟิลด์ `pickup_address` (ชนิด string, optional) เข้าไปในแผนผังข้อมูล `logistics` ของโครงสร้าง `donation_pre_declaration` (schema_v 2)
- **Zod Schema (`donation.ts`):** เพิ่มฟิลด์ `pickup_address: z.string().optional()` ใน `donationPreDeclarationInputSchema` เพื่อ validate ฝั่งเซิร์ฟเวอร์
- **State Store (`donation.svelte.ts`):** เพิ่มตัวแปร `pickupAddress = $state('')` ให้กับ `donationStore`
- **UI (`donor-time-selection-form.svelte`):** เพิ่มช่อง Input กรอกรายละเอียดที่อยู่/สถานที่ติดต่อ โดยจะแสดงผลเฉพาะเมื่อผู้ใช้เลือกการจัดส่งแบบ "ต้องการให้รถศูนย์ไปรับ"

## Impact
- **Data Model:** ไม่ต้องทำการแก้ไขระบบ Migration เพราะเป็น Optional Field ใหม่ใน Schema v2.
- **Frontend / UX:** เพิ่มช่องทางสำหรับให้ผู้ใช้งานกรอกข้อมูลที่จำเป็นโดยไม่ต้องแอบใส่ข้อมูลไว้ใน `note`

## Migration
N/A (เป็น Optional Field จึงไม่มีผลกระทบต่อเอกสารเดิมที่มีอยู่แล้วในระบบ)

## Decision log
- 2026-06-24 — Proposed & Implemented
