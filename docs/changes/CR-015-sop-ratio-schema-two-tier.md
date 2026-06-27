---
id: CR-015
title: Implement SOP Ratio Two-Tier Schema (sop_profile v2 & sop_override v1)
status: done
date: 2026-06-26
requested_by: PR#25 Code Review
decided_by: Tech Lead & Project Owner
layer: volatile
affects:
  - docs/data/schema.md §2.14, §4.2
  - schema_v 1 → 2 for sop_profile
  - schema_v 1 (new) for sop_override
  - frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts
  - frontend/src/lib/db/model.ts
---

# CR-015 — Implement SOP Ratio Two-Tier Schema (sop_profile v2 & sop_override v1)

## Why
ตามข้อเสนอแนะและ Blocker ใน PR#25 (Commit `6d2ad394ac199177be60291bc3072b21e40c811d`) ที่ระบุว่าการแยกชั้นข้อมูลตามสถาปัตยกรรมแบบ Two-Tier (ตามที่กำหนดใน CR-006) ยังไม่ได้สะท้อนลงในเอกสารสกีมากลางของโครงการ [schema.md](../data/schema.md)

เพื่อให้ตรงตาม Change Management Policy ของโครงการ การเปลี่ยนแปลงโครงสร้างฐานข้อมูล (Database Schema) ทั้งการเพิ่มประเภทเอกสารใหม่และการยกระดับรุ่นโครงสร้างเดิม จะต้องได้รับการบันทึกและอัปเดตลงในเอกสารกลางคู่กับโค้ดจริงเสมอ ซึ่งได้รับการผสานและแก้ไขใน Commit `140afdf7c6c222129ead008533a59f7c5734da08`

## Change
การปรับปรุงข้อมูลโครงสร้างสกีมาใน [schema.md](../data/schema.md) ประกอบด้วย:

1. **ยกระดับ `sop_profile` (Master Profile) ขึ้นเป็น `schema_v 2`**
   - **ก่อนแก้ไข (schema_v 1):** เอกสารจัดเก็บในระดับ Shelter DB มีฟิลด์ `shelter_code`
   - **หลังแก้ไข (schema_v 2):** ย้ายไปจัดเก็บในฐานข้อมูลกลาง `catalog` และตัดฟิลด์ `shelter_code` ออก เพื่อให้เป็นเกณฑ์สัดส่วนทรัพยากรมาตรฐานที่ทุกศูนย์พักพิงสามารถดึงไปใช้ร่วมกันได้ (Global Master Profile)
2. **เพิ่ม Document Type ใหม่ `sop_override` (Local Override) เป็น `schema_v 1`**
   - จัดเก็บในฐานข้อมูลระดับศูนย์พักพิง `shelter_{shelter_code}` โดยมีฟิลด์ `shelter_code` และ `base_profile_id` เพื่อใช้สลับและปรับเปลี่ยนอัตราสัดส่วนทรัพยากรเฉพาะจุดข้ามเกณฑ์มาตรฐานกลาง
3. **กำหนดให้โครงสร้าง ratios ต้องระบุคีย์ครบถ้วน (Full Ratios Requirement)**
   - **รายละเอียด:** ปรับปรุง Zod Schema โดยนำ `.partial()` และ `.refine()` ออก เพื่อให้ฟิลด์ `ratios` ของทั้ง `sop_profile` และ `sop_override` บังคับกรอกข้อมูลคีย์ทั้งหมดครบชุดในระดับ Validation (`water_l_per_person_day`, `rice_g_per_person_meal`, `toilet_per_person`) สอดคล้องตามกฎข้อบังคับของ PO ที่ไม่ต้องการให้ทำ partial/per-key merge
4. **บังคับใช้นโยบายหนึ่งสาขาหนึ่งเกณฑ์เปิดใช้งาน (Strict One-Active-Override-per-Shelter)**
   - **รายละเอียด:** ปรับปรุงลอจิกใน `SopOverridePouchRepository.setActive` ให้ทำการปิดใช้งาน (set `active: false`) ของเกณฑ์อื่น ๆ ทั้งหมดที่มีในฐานข้อมูลศูนย์พักพิงเดียวกันแทนการเช็คเฉพาะชื่อเดียวกัน เพื่อรับประกันว่าจะมีเกณฑ์ใช้งานของศูนย์เพียงตัวเดียวเท่านั้นที่เป็นจริง ณ ขณะใดขณะหนึ่ง


---

## Impact

### 1. ไฟล์เอกสารของโครงการ
- **[schema.md](../data/schema.md):** 
  - เพิ่มเซกชัน §2.14 `sop_override` (schema_v 1) ในฐานข้อมูลระดับศูนย์
  - อัปเดตเซกชัน §4.2 `sop_profile` (schema_v 2) ในฐานข้อมูล `catalog` พร้อมระบุหมายเหตุการย้ายและตัดฟิลด์
- **[CR-015-sop-ratio-schema-two-tier.md](CR-015-sop-ratio-schema-two-tier.md):** บันทึกการตัดสินใจการเปลี่ยนผ่านและการควบคุมคุณสมบัติแบบสองชั้น

### 2. ซอร์สโค้ดและโมเดล Zod
- **[sop-ratio.ts](../../frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts):**
  - อัปเดต `sopMasterSchema` ให้ตรงตาม `schema_v: 2` (ไม่มี `shelter_code`)
  - อัปเดต `sopOverrideSchema` ให้ตรงตาม `schema_v: 1` (มี `shelter_code` และ `base_profile_id`)
- **[model.ts](../../frontend/src/lib/db/model.ts):**
  - แยก `auditShelterCodeSchema` ออกจาก `shelterCodeSchema` เพื่อรองรับรหัสส่วนกลาง `'catalog'` ในเอกสารตรวจสอบระบบ (Audit Trails) โดยไม่บั่นทอนมาตรฐานความปลอดภัยในการกรองรหัสศูนย์พักพิงจริงในระดับ Tenants (Tenant Isolation)

### 3. ชุดการทดสอบ
- **[sop-ratio.pouch.test.ts](../../frontend/src/lib/features/sop-ratios/data/sop-ratio.pouch.test.ts):** ปรับปรุงชุดการทดสอบการทำงานของ PouchDB ให้รองรับโครงสร้างสกีมาใหม่ และจำลองสถานการณ์ความถูกต้องของสิทธิ์การเข้าถึง (Tenant Boundaries)

---

## Migration
- **ข้อมูลตั้งเดิม:** เนื่องจากคุณลักษณะ SOP Ratios เป็นฟังก์ชันใหม่ที่เพิ่งถูกพัฒนาและทดสอบในสาขา `team-D` และยังไม่มีการ Deploy ใช้งานจริงในโปรดักชัน จึงไม่มีข้อมูลเก่าที่ต้องทำการทำ Data Migration หรือแก้ไขตัวเอกสารในระบบย้อนหลัง
- **Seed Script:** ปรับปรุง `seedCatalogSopRatios` ใน `scripts/seed.ts` ให้ทำการ Seed ตัวเกณฑ์มาตรฐาน "Sphere Baseline" ลงใน `catalog` ด้วยสกีมารูปแบบใหม่โดยตรง

---

## Decision log
- 2026-06-26 — proposed (ตามข้อเสนอแนะ PR#25 Code Review)
- 2026-06-26 — approved & done (แก้เสร็จใน Commit `140afdf7c6c222129ead008533a59f7c5734da08` และทดสอบผ่าน 100%)
