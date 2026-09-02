---
id: CR-106
title: Decoupled Registration, Medical Screening, and Zoning Flow with Shelter Toggle and Shared Form Architecture
status: approved
layer: stable + volatile
created: 2026-09-02
updated: 2026-09-03
affects:
  - docs/data/schema.md §1.1 (evacuee schema_v 9), §1.4 (movement zone_change), §1.5 (screening triage_level), §3.1 (shelter feature_flags)
  - docs/prd/role-permission-matrix.md
  - docs/changes/CR-072-triage-green-yellow-red.md (ratifies triage_level)
  - docs/adr/0001-decoupled-registration-and-medical-screening-flow.md
  - frontend/src/lib/features/people/
  - frontend/src/lib/features/shelters/
  - frontend/src/lib/auth/roles.ts
  - frontend/src/routes/(protected)/onsite/
---

# CR-106: Decoupled Registration, Medical Screening, and Zoning Flow with Shelter Toggle and Shared Form Architecture

> **สรุป (TL;DR):**  
> ปรับ Intake Pipeline เป็น 3 สถานีอิสระ: **Station 1 ทะเบียน** → **Station 2 แพทย์** (ถ้าเปิด flag) → **Station 3 จัดโซน**.  
> Flag `enable_medical_screening` สลับเฉพาะการแสดง Station 2 + Handover Slip หลังลงทะเบียน — **ห้ามจัดโซน/เช็คอินที่ Station 1 ทุกกรณี**.  
> Station 1 = คิวตารางเดียว + wizard `/new` (personal+special_needs → household → pets/assets; `createEvacuee` เท่านั้น, status `arriving`, zone null, ออก Person QR เสมอ).  
> Station 3 = `/onsite/zoning` + movement `zone_change` สำหรับย้ายโซนหลังเข้าพัก.  
> ขยาย `arriving`, `triage_level`, และ shared form sub-components ตามเดิม.

---

## 1. Context & Motivation (Why)

1. **คอขวดหน้างานและความปลอดภัยทางการแพทย์:** รวม EWAR + จัดโซนที่โต๊ะทะเบียนทำให้สัมภาษณ์ยาว และเสี่ยงจัดเตียงทั่วไปก่อนตรวจติดต่อ/เปราะบาง
2. **ความต่างของทรัพยากรแต่ละศูนย์:** ศูนย์เล็กไม่มีแพทย์ต้องปิด Station 2 ได้ แต่ยังแยกโต๊ะจัดโซนจากทะเบียน
3. **Fast Handover:** คิวรอตรวจ + Handover QR path-only `/onsite/medical-screening/{evacuee_id}`
4. **DRY form UI:** Shared sub-components ภายใต้ `$lib/features/people/ui/forms/`

---

## 2. Requirements & Specification

### 2.1 Shelter Configuration Toggle
- **FR-01 (Screening Feature Flag):** `shelter.feature_flags.enable_medical_screening: boolean` (default `false`)
- **Flag ON:** pipeline `S1 → S2 → S3`; แสดง Station 2 บน onsite hub; หลังลงทะเบียนออก Handover Slip ด้วย
- **Flag OFF:** pipeline `S1 → S3` (ข้ามแพทย์); ไม่แสดง Station 2; ไม่บังคับมี `screening` ก่อนจัดโซน
- Flag **ไม่** เปิด zoning/check-in ที่ Station 1

### 2.2 Evacuee Stay Status Expansion (schema_v 9)
- **FR-02:** `current_stay.status` รวม `'arriving'`
- หลัง Station 1 submit: `status = 'arriving'`, `zone = null`; `household.status = 'arriving'` เมื่อเกี่ยวข้อง
- `arriving` ไม่นับ occupancy เตียงจริง

### 2.3 Registration Desk — Station 1 (`/onsite/people`)
- **FR-03a (Queue — primary UI):** ตารางเดียวทุก stay status + ค้นหา + **filter chips** + สแกน Person QR
  - คอลัมน์: ชื่อ, สถานะ, special_needs (สั้น), ครัวเรือน, โซน (ถ้ามี), อัปเดต, **「คิวถัดไป」** (`รอแพทย์` / `รอโซน` / `พักแล้ว` จาก flag + มี screening หรือไม่)
  - เมนู onsite: 「ทะเบียนผู้ประสบภัย」 / Registration Desk (Station 1)
  - คลิกแถว → side panel / bottom sheet: สรุปสถานะ + CTA ตาม status/roles/flag (ไป S2 / S3 / โปรไฟล์ / พิมพ์)
  - `pre_registered` 「รายงานตัว」: ยืนยัน/แก้ interview (identity/contact/special_needs/household ตามที่เกี่ยวข้อง) → save → `arriving` → Person QR ถ้าต้องการ → CTA S2 หรือ S3
  - Dedupe ทำที่คิวเท่านั้น
- **FR-03b (New registration wizard):** `/onsite/people/new` เต็มหน้า:
  1. personal + **special_needs**
  2. household
  3. pets / assets / vehicles
  4. done
- **FR-03c (ห้ามที่ Station 1):** EWAR checklist, medical history step, สร้างเอกสาร `screening`, ขั้นตอนเลือกโซน/check-in
- **FR-03d (Persist):** `createEvacuee` เท่านั้น (ไม่ใช้ `createEvacueeWithScreening`); status `arriving`, zone `null`
- **FR-03e (End of `/new`):** ออก **Person QR เสมอ**; ถ้า flag on ออก Handover Slip ด้วย; กลับคิว

### 2.4 Handover Slip & Person QR
- **FR-04a (Handover):** ชื่อ, บัตร (masked), โทร, special_needs; QR = path `/onsite/medical-screening/{evacuee_id}`; พิมพ์ได้
- **FR-04b (Person QR):** ออกที่ Station 1 เสมอ (รวม `arriving`); พิมพ์ซ้ำใช้ zone จาก profile เท่านั้น (ไม่สร้าง zone ที่ S1)

### 2.5 Medical Screening — Station 2
- **FR-05:** Queue `/onsite/medical-screening`; Form `/onsite/medical-screening/[evacuee_id]`; guard `medical_staff` | `triage_staff` | `shelter_manager` | `system_admin`
- **FR-06:** แท็บ รอตรวจ / ตรวจแล้ว; search + QR/camera; ไม่มีแผงฟอร์มด้านขวา
- **FR-07:** ฟอร์มคัดกรองเต็มจอ (vitals, symptoms, triage_level, referral, medical record); sticky save; dirty leave confirm
- **FR-08 (Save handoff):** บันทึก screening (+ medical) แล้วแสดงปุ่มชัดเจน 「ไปจัดโซนเลย」→ `/onsite/zoning/[id]` และ 「กลับคิวแพทย์」 (ไม่พึ่ง toast-only link); UI ไม่เลือกโซน/เช็คอินที่ Station 2

### 2.6 Zoning Desk — Station 3 (`/onsite/zoning`)
- **FR-10 (Routes & access):**
  - Queue: `/onsite/zoning` — แท็บ **รอจัด** | **จัดแล้ว**; search + scan (zoning path, bare id, medical path เมื่อ eligible)
  - Detail: `/onsite/zoning/[evacuee_id]`
  - Roles: `registration_staff` | `facility_staff` | `shelter_manager` | `system_admin` ผ่าน `canAccessZoning` / `requireZoning`
  - Onsite tile 「จัดสรรที่พัก」 แสดงเสมอสำหรับผู้มีสิทธิ์
- **FR-11 (Pending queue):**
  - Flag on: `arriving` + มี screening + `zone == null`
  - Flag off: `arriving` + `zone == null` (ไม่ต้องมี screening)
- **FR-12 (Detail assign):** ใช้ `EvacueeSelectZone` / `ZoneSelectionFields`; แนะนำ: triage→quarantine แล้ว special_needs→vulnerable; แสดง headcount ต่อโซน; อนุญาตเกิน capacity
- **FR-13 (First assign):** atomic `checkIn` → toast + กลับคิว — **ไม่มี** Person QR ceremony ที่ Station 3
- **FR-14 (Household):** person-primary; checkbox สมาชิกครัวเรือนที่ยังอยู่ในคิวรอจัด; default isolation เมื่อ quarantine recommended; **ห้าม** ตัด `household_id`
- **FR-15 (Rezone):** จากแท็บจัดแล้ว → detail rezone mode; bulk สมาชิก active ในครัวเรือนได้; toast หลัง rezone
- **FR-16 (Persistence):** movement action **`zone_change`** สำหรับย้ายโซนหลังเข้าพัก; profile/household zone moves ใช้ path นี้แทน patch-only
- **FR-17:** empty states ตามแท็บ + flag

### 2.7 Shared Form Sub-components
- **FR-09:** ตามเดิมภายใต้ `$lib/features/people/ui/forms/` (`personal-info`, `emergency-contact`, `special-needs`, `ewar-symptoms`, `household-address`, `pet-asset-vehicle`, `health-medical`, `zone-selection`) — EWAR/health ใช้ที่ Station 2 / profile ไม่ใช่ Station 1 wizard

---

## 3. Data Schema & Migration Impact

### 3.1 `evacuee` — schema_v 9 (Additive)
- ขยาย enum `current_stay.status` เพิ่ม `'arriving'`
- Migration: read-time compatibility; ไม่ต้อง backfill

### 3.2 `screening` — schema_v 2 (Additive)
- `triage_level`: `enum('green','yellow','red') | null`
- Migration: additive

### 3.3 `shelter` — schema_v 5 (Additive)
- `enable_medical_screening: boolean` ใน `feature_flags` (default `false`)

### 3.4 `movement` — additive enum (no schema_v bump)
- เพิ่ม `action: 'zone_change'` — คง `current_stay.status` (ปกติ `active`); อัปเดต `zone` จาก movement; ใช้สำหรับ rezone / ย้ายโซนหลัง check-in
- Migration: ไม่ต้อง backfill; client/validate_doc_update รับค่าใหม่

---

## 4. Decision Log

- 2026-09-02 — 3-Station Pipeline + `arriving` + Handover QR + shared forms + `triage_level`
- 2026-09-03 — Station 2 UX: queue/form แยก; ไม่ zoning จาก S2 ในรอบแรก
- 2026-09-03 — **Confirmed intake rewrite (in-place):**
  1. Flag สลับเฉพาะ S2 visibility + Handover — **ไม่มีการจัดโซนที่ Station 1 เลย**
  2. Flag ON: S1→S2→S3; OFF: S1→S3
  3. Station 1 = คิวตาราง + `/new` wizard ไร้ EWAR/screening/zone; `createEvacuee` only; Person QR เสมอ
  4. Station 3 = `/onsite/zoning` + `canAccessZoning` + `zone_change`
  5. S2 save → ปุ่มไปจัดโซน / กลับคิวแพทย์

---

## 5. Acceptance / DoD

- [ ] Flag on/off สลับ pipeline และ visibility ตาม FR-01
- [ ] Station 1 ไม่สร้าง screening และไม่ check-in/zone
- [ ] `/onsite/people` คิวมีคอลัมน์คิวถัดไป + filter chips + Person QR scan
- [ ] `/onsite/people/new` จบด้วย Person QR (+ Handover ถ้า flag on)
- [ ] Station 2 save มีปุ่มไป `/onsite/zoning/[id]` และกลับคิว
- [ ] Station 3 pending/assigned queues ตาม FR-11; first assign = check_in; rezone = zone_change
- [ ] schema.md §1.4 ระบุ `zone_change`; tests domain/utils ผ่าน
