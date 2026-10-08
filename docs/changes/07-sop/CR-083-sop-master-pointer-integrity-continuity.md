---
id: CR-083
title: SOP master active pointer — verified resolution and fail-closed calculation
status: approved
date: 2026-08-19
requested_by: project owner
decided_by: project owner (approved 2026-08-19)
layer: stable
affects:
  - docs/data/schema.md §§4.4–4.5
  - frontend/src/lib/features/sop-ratios/
  - frontend/src/lib/features/resource-calc/
  - relevant unit & integration tests
---

# CR-083 — SOP master active pointer: verified resolution and fail-closed calculation

> **สรุป (TL;DR):** `sop_profile_active:global` ต้องชี้ได้เฉพาะ immutable `sop_profile` ที่มีอยู่จริงและ validate ผ่านสเปก · T-31 Resource Calculation ต้อง fail-closed เมื่อ master active pointer ผิดปกติ (pointer missing/malformed, target missing/malformed, slug/version mismatch หรือ unresolved CAS conflict) · Legacy Kitchen API คงเดิมไม่เปลี่ยน behavior · Active override ยังคงชนะตามลำดับความสำคัญของ CR-006 · Existing `daily_calc` snapshots ไม่ถูกลบหรือ rewrite · ไม่เพิ่ม persisted field และไม่ bump `schema_v`

## Why

CouchDB `validate_doc_update` ตรวจสอบความถูกต้องได้เฉพาะเอกสารเดี่ยวฉบับเดียว ไม่สามารถบังคับ referential integrity ระหว่าง `sop_profile_active:global.active_profile_id` กับ `sop_profile` ได้. หากมี manual write หรือ pointer anomaly ระบบต้องไม่เลือก profile จาก `sop_profile.active` หรือ fallback แบบเดา. การคำนวณทรัพยากรด้วย SOP ที่ไม่ถูกต้องมีความเสี่ยงด้านการดำเนินงานสูงกว่าการปฏิเสธคำขอการคำนวณใหม่พร้อมแจ้งเตือนผู้ดูแลระบบ.

## Change

1. **Strict Master Verifier (`getVerifiedActiveSopProfile`):**
   เพิ่ม API ตรวจสอบ Master Active Pointer ที่เข้มงวด:
   - อ่าน raw pointer `sop_profile_active:global` และ validate ด้วย `sopMasterActivePointerSchema`.
   - อ่าน target `sop_profile` และ validate ด้วย `sopMasterSchema`.
   - ตรวจสอบ equality ทั้ง 3 ค่า: `pointer.active_profile_id === profile._id`, `pointer.active_slug === profile.slug` และ `pointer.active_version === profile.version`.
   - หากพบความผิดปกติ (missing, malformed, mismatch) ให้โยน `SopMasterIntegrityError` พร้อมระบุ `reason` ชัดเจน; ห้ามเลือก `profile.active`, latest version หรือ profile อื่นเป็น fallback โดยเด็ดขาด.

2. **T-31 Fail-Closed Integration:**
   - เมื่อมี active override ที่ผ่านการ validate → ใช้ override คำนวณตาม CR-006 ลำดับความสำคัญดั้งเดิม.
   - เมื่อไม่มี active override (ต้องใช้ master fallback) → เรียก `getVerifiedActiveSopProfile()`. หาก integrity check ล้มเหลว ห้ามคำนวณ resources และห้ามสร้าง/เขียนทับ `daily_calc`.
   - Snapshots ของ `daily_calc` ที่เคยบันทึกไว้ในอดีต จะไม่ถูกลบหรือแก้ไขโดย integrity error.

3. **Strict Pointer CAS & Controlled Repair Foundation:**
   - `createInitial`, `createVersion` และ `setActive` ของ Master SOP ต้องใช้ strict CAS บน pointer (`onConflict: 'throw'`) และยืนยันผลหลังเขียนก่อนรายงานสำเร็จ.
   - ห้าม audit รายงานว่า "promotion สำเร็จ" หาก post-write verification ล้มเหลว.

4. **Legacy Consumer & Scope Boundaries:**
   - Legacy Kitchen API (`useActiveSopProfile()`, `getActiveSopProfile()`) คงพฤติกรรมเดิมไว้ ไม่เปลี่ยน return type เพื่อไม่ให้กระทบ Module D.
   - `sop_override` behavior และ persistence ถูก freeze และอยู่นอกขอบเขตของ CR นี้.
   - Platform/Operations infrastructure (edge warm replica, UPS, replication monitoring, design doc deployment) อยู่นอกขอบเขตของ CR นี้.

## Acceptance

- [ ] Active master resolver คืนค่า verified profile เมื่อ pointer ชี้ไปยัง target ที่ถูกต้องและ field ตรงกัน
- [ ] เมื่อ pointer หรือ target profile หายไป/malformed/mismatch, master resolver โยน `SopMasterIntegrityError` โดยไม่ fallback
- [ ] T-31 calculation เมื่อไม่มี active override และ master integrity ล้มเหลว จะปฏิเสธการคำนวณ (fail closed) โดยไม่สร้าง/ลบ `daily_calc`
- [ ] Active override ที่ถูกต้องยังคงใช้คำนวณ T-31 ได้ตาม CR-006 โดยไม่ถูกบล็อกด้วย master pointer integrity
- [ ] Legacy Kitchen API (`useActiveSopProfile`, `getActiveSopProfile`) คงพฤติกรรมและ signature ดั้งเดิม 100%
- [ ] Cache invalidation ของ `resource-calc` และ `sop-ratios` ทำงานเมื่อ `sop_profile_active` ถูกอัปเดต
- [ ] Unit & integration tests ครอบคลุม integrity failure cases ทั้งหมดโดยไม่ต่อ CouchDB จริง

## Impact

- **Frontend Feature (`sop-ratios`):** เพิ่ม `getVerifiedActiveSopProfile`, `SopMasterIntegrityError` และ pure domain verifier helper ใน public barrel
- **Frontend Feature (`resource-calc`):** อัปเดต `daily-calc.remote.ts` ให้เรียก verified master resolver เมื่อไม่มี active override; อัปเดต `calc-sync.ts` ให้ฟัง `sop_profile_active`
- **Documentation:** `schema.md` §§4.4–4.5 ปรับคำอธิบาย pointer authority และ CouchDB single-doc validation constraints
- **Out of Scope:** ไม่เปลี่ยน `sop_override`, ไม่แตะ Kitchen API, ไม่แก้ไข UI Dashboard T-32, ไม่รวม Platform/DevOps tasks

## Migration

N/A — ไม่มีการเพิ่ม/ลบ/เปลี่ยน persisted field และไม่ bump `schema_v`.

## Decision log

- 2026-08-19 — Approved Team-D implementation CR; Platform/Operations infrastructure ถูกเลื่อนออกจากการติดตามใน CR นี้.
- 2026-08-19 — ยืนยันให้ Kitchen คง legacy API เดิม และให้ T-31 fail-closed เฉพาะ master fallback path.
