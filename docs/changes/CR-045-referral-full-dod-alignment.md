---
title: CR-045 — Referral Schema & Implementation Alignment (Full T-34 DoD)
status: approved
created: 2026-07-22
updated: 2026-07-24
layer: volatile
affects:
  - docs/data/schema.md §2.11 (referral schema definition)
  - docs/task-breakdown/09-F-referral.md (T-34 DoD alignment)
  - frontend/src/lib/features/referrals/
---

# CR-045 — Referral Schema & Implementation Alignment (Full T-34 DoD)

> **สรุป (TL;DR):** ปรับปรุง `referral` schema และการทำงานของโมดูล Referral (T-34) ให้รองรับ 3 Referral Kinds (`capacity`, `resource`, `medical-emergency`), การบันทึกเหตุผลการตอบกลับ (`response_reason`), และ Side-effect ย้ายศูนย์พักพิงกรณี `capacity` referral โดย **ปลายทางต้องกดตอบรับก่อนจึงย้าย** เพื่อเติมเต็ม Definition of Done (DoD) ของ T-34

---

## Why — เหตุผลความจำเป็น

ในสเปกเดิมของ `referral` schema (§2.11) และการ implement ระยะแรก มีเพียงการส่งต่อสถานพยาบาล (`to_org`) โดยขาดประเภทการส่งต่อ (`referral_type`), รหัสศูนย์ปลายทางสำหรับกรณีการย้ายศูนย์ (`to_shelter_code`), และช่องบันทึกเหตุผลเมื่อปลายทางตอบรับหรือปฏิเสธ (`response_reason`) ส่งผลให้ไม่สามารถครอบคลุม DoD ทั้ง 3 ข้อของ T-34 (capacity transfer, resource request, medical emergency) ได้ครบถ้วน

---

## Changes — รายละเอียดการแก้ไข

### 1. `docs/data/schema.md` §2.11 `referral`
เพิ่มฟิลด์ในตาราง `referral`:

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `evacuee_id` | str | req | — |
| `referral_type` | enum(`capacity`,`resource`,`medical-emergency`) | req | default `medical-emergency` |
| `to_shelter_code` | str | opt | รหัสศูนย์พักพิงปลายทาง (ระบุเมื่อ `referral_type` = `capacity`) |
| `to_org` | {`name`:str?, `kind`:enum(`hospital`,`social_services`,`other`)?, `contact`:str?} | opt | หน่วยงานปลายทาง (ระบุเมื่อ `referral_type` ≠ `capacity`) |
| `reason` | str | req | เหตุผลความจำเป็นในการส่งต่อ |
| `response_reason` | str | opt | เหตุผลประกอบการตอบรับ (`accepted`) หรือปฏิเสธ (`rejected`) จากปลายทาง |
| `urgency` | enum(`normal`,`urgent`) | req | — |
| `status` | enum(`draft`,`sent`,`accepted`,`rejected`,`closed`) | req | forward-only |
| `timeline` | {`sent`:{at,by}?, `responded`:{at,by}?, `closed`:{at,by}?} | sys | — |
| `notes` | str | opt | — |

### 2. Side-Effects & State Machine Rules (destination-gated capacity)
- เมื่อมีการเปลี่ยนสถานะเป็น `accepted` หรือ `rejected` จะจะต้องรองรับการส่งผ่านและบันทึก `response_reason`
- **Capacity / DoD:** การย้ายศูนย์เกิดเมื่อ**ปลายทาง**กด `accepted` เท่านั้น — ต้นทางส่งได้แต่ตอบรับ/ปฏิเสธ capacity ไม่ได้
  1. ต้นทาง `draft → sent` (BFF) → **mirror** referral (same `_id`, คง `shelter_code` ของต้นทาง) เข้า `shelter_{to}` เป็น inbox
  2. ปลายทาง (`caller.shelter_code === to_shelter_code`) กด `accepted` / `rejected`
  3. ตอน `accepted`: cross-DB transfer (ห้าม rewrite `shelter_code` ใน DB ต้นทาง)
     - Destination `shelter_{to}`: สร้าง/อัปเดต `evacuee` + `movement:transfer_in` → stay `active`
     - Source `shelter_{from}`: `movement:transfer_out` + stay `transferred` (คง `shelter_code` ต้นทาง)
     - Sync สถานะ referral กลับต้นทาง
  4. Write path = BFF `/api/back-office/referral/[id]/transition` ผ่าน `adminRaw`
  5. SPA: capacity transitions ทั้งหมดไป BFF; medical/resource ยังใช้ session remote

### 3. Query & Performance Optimizations
- **Pagination & Filtering:** ปรับปรุง `referralFilterSchema` และ `ReferralRepository.list()` รองรับ:
  - `limit`: กำหนดจำนวนรายการต่อหน้า (default: `50`, max: `1000`) ป้องกันปัญหา Silent Truncation 25 รายการเดิม
  - `skip`: รองรับจำนวนรายการที่ต้องการข้ามสำหรับ Pagination
  - `sort`: รองรับการเรียงลำดับรายการ (`created_at_desc` เป็น default หรือ `created_at_asc`)
  - `referralFilterSchema`: Zod schema สำหรับทำ Type Validation ความถูกต้องของพารามิเตอร์การค้นหา
- **Mango Index Deployment:** เพิ่มและลงทะเบียน CouchDB Mango Index `referral-list-sort-idx` (`['type', 'created_at', 'status', 'evacuee_id']`) และ `referral-list-basic-idx` (`['type', 'created_at']`) ใน `scripts/seed.ts` เพื่อรองรับการค้นหา เรียงลำดับ และป้องกันข้อผิดพลาด 400 Bad Request ประสิทธิภาพสูง

---

## Impact & Affected System Component

1. **Docs:**
   - `docs/data/schema.md` §2.11
   - `docs/task-breakdown/09-F-referral.md` (T-34)
   - `docs/changes/_index.md`
2. **Frontend Code (`frontend/src/lib/features/referrals/`):**
   - `domain/referral.schema.ts` — Zod schemas (`referralTypeSchema`, `to_shelter_code`, `response_reason`)
   - `domain/referral.authorization.ts` — destination-gated accept/reject สำหรับ capacity
   - `domain/referral.transitions.ts` — `responseReason?: string` ใน `applyTransition`
   - `domain/referral.capacity-transfer.ts` — builders สำหรับ cross-DB transfer_out / transfer_in
   - `data/referral.remote.ts` — capacity transitions ทั้งหมดมอบหมายไป BFF
   - `server/referral.server-repository.ts` — mirror on sent, dest-gated accept, `completeCapacityTransfer`
   - `ui/*` — inbox badge ขาเข้า, ซ่อน Accept ที่ต้นทาง, แบนเนอร์รอปลายทาง
