---
id: CR-106
title: Decoupled Registration, Medical Screening, and Zoning Flow with Shelter Toggle and Shared Form Architecture
status: approved
layer: stable + volatile
created: 2026-09-02
updated: 2026-09-03
affects:
  - docs/data/schema.md §1.1 (evacuee schema_v 9 — รวม `last_name` ว่างได้), §1.3 (household Residence semantics — ไม่ bump schema_v), §1.4 (movement zone_change), §1.5 (screening triage_level), §3.1 (shelter feature_flags)
  - CONTEXT.md (Household UI label; Residence; Identity-document address)
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
> Station 1 = คิวตารางเดียว + **single-page form + scroll spy** (shared shell สำหรับ walk-in `/new` และ Report-in `/onsite/people/[id]/report-in`); persist `arriving` + zone null; ออก Person QR เสมอ.  
> **Household (UI 「ครอบครัว」):** ค่าเริ่มต้น = ฟอร์ม Residence สร้างใหม่ + debounce แนะนำที่อยู่ซ้ำ (ไม่บล็อก) + ปุ่ม「เข้าร่วม」ค้นชื่อ/เบอร์ผู้อพยพ; ยุบ keep/create/join/solo; `label` อัตโนมัติ; Residence บน Household / ที่อยู่บัตรบน Evacuee.  
> Station 3 = `/onsite/zoning` + movement `zone_change` สำหรับย้ายโซนหลังเข้าพัก.  
> ขยาย `arriving`, `triage_level`, และ shared form sub-components ตามเดิม.  
> `last_name` ว่างได้ (mononym / ชาวต่างชาติ) + UX hint + `formatPersonName` (FR-18..20).

---

## 1. Context & Motivation (Why)

1. **คอขวดหน้างานและความปลอดภัยทางการแพทย์:** รวม EWAR + จัดโซนที่โต๊ะทะเบียนทำให้สัมภาษณ์ยาว และเสี่ยงจัดเตียงทั่วไปก่อนตรวจติดต่อ/เปราะบาง
2. **ความต่างของทรัพยากรแต่ละศูนย์:** ศูนย์เล็กไม่มีแพทย์ต้องปิด Station 2 ได้ แต่ยังแยกโต๊ะจัดโซนจากทะเบียน
3. **Fast Handover:** คิวรอตรวจ + Handover QR path-only `/onsite/medical-screening/{evacuee_id}`
4. **DRY form UI:** Shared sub-components ภายใต้ `$lib/features/people/ui/forms/`
5. **Household ที่โต๊ะทะเบียนซับซ้อนและค้นหายาก:** ชิป keep/create/join/solo ซ้ำกับฟอร์มซ้อน; create≈solo; ค้นหัวหน้าด้วยโทร/บัตรอย่างเดียว — ต้องการ flow สั้นลง ลดซ้ำ UI และค้นด้วยชื่อ/เบอร์สมาชิก + ที่อยู่สังเขป

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

> **UX drivers (confirmed 2026-09-03):** ความเร็ว + การทบทวนข้อมูล `pre_registered`; อุปกรณ์ผสม tablet + laptop.  
> **Shell:** single-page form + scroll spy ใช้ร่วม walk-in create และ Report-in — **ไม่ใช่** multi-step wizard.

- **FR-03a (Queue — primary UI):** ตารางเดียวทุก stay status + ค้นหา + **filter chips** + สแกน Person QR
  - คอลัมน์: ชื่อ, สถานะ, special_needs (สั้น), **ครอบครัว** (domain: Household), โซน (ถ้ามี), อัปเดต, **「คิวถัดไป」** (`รอแพทย์` / `รอโซน` / `พักแล้ว` จาก flag + มี screening หรือไม่)
  - เมนู onsite: 「ทะเบียนผู้ประสบภัย」 / Registration Desk (Station 1)
  - คลิกแถว → side panel / bottom sheet: สรุปสถานะ + CTA ตาม status/roles/flag (ไป S2 / S3 / โปรไฟล์ / พิมพ์)
  - **Entry points (ไม่ one-click status patch):**
    - 「ลงทะเบียนใหม่」 → `/onsite/people/new` (walk-in create; ใช้ shared registration shell)
    - `pre_registered` 「รายงานตัว」 / Report-in → `/onsite/people/[id]/report-in` — เปิด **ฟอร์มเต็มหน้า** (shared shell กับ `/new`) เพื่อยืนยัน/แก้ข้อมูลแล้ว promote เป็น `arriving` — **ห้าม** ปุ่มเดียว patch status โดยไม่เปิดฟอร์ม
  - Dedupe ทำที่คิวเท่านั้น

- **FR-03b (Shared registration shell — single page + scroll spy):** ใช้ร่วม walk-in `/onsite/people/new` และ Report-in `/onsite/people/[id]/report-in`

  **Layout & chrome**
  - หน้าเดียว มี section เรียงแนวตั้ง + **sticky section chips** (scroll spy) ด้านบน + **sticky save** ด้านล่าง
  - **ไม่มี autosave**; ออกจากฟอร์มขณะ dirty → **confirm ทิ้งการแก้**
  - Full-page validate ตอนกดบันทึก → แสดงสรุป error + **กระโดดไป section แรกที่ invalid**

  **Sections (ลำดับบนหน้า):**
  1. **Photo** — ภาพถ่ายใบหน้า (**optional** — ไม่บังคับถ่าย/อัปโหลดเพื่อบันทึก)
  2. **Personal identity** — ข้อมูลประจำตัว
  3. **Household** — UI label 「ครอบครัว」 (canonical domain: **Household** — ดูกฎด้านล่าง — ใช้ได้ทั้ง walk-in และ Report-in)
  4. **Emergency contact** — ข้อมูลติดต่อฉุกเฉิน (**required** — แสดง `*` ที่ section และฟิลด์)
  5. **Special needs** — ความต้องการพิเศษ (copy บน Station 1 **ห้าม** ใช้คำว่ากลุ่มเปราะบาง)
  6. **Pets / assets / vehicles (section E)** — สัตว์เลี้ยง / ทรัพย์สิน / ยานพาหนะ — แสดงเมื่อ flag เปิดหรือมีข้อมูลเดิม (อยู่ท้ายเสมอ)
     - **Nav chip:** แสดง **หนึ่ง** รายการใน scroll-spy nav เมื่อ `allow_pets | allow_assets | allow_vehicles` อย่างน้อยหนึ่งตัวเป็น true; **ซ่อน** เมื่อทุก flag เป็น false
     - ถ้า flag ปิดทั้งหมดแต่เอกสารมีข้อมูลเดิมของหมวดนั้น → **ยังแสดง section ทั้งก้อนเป็น read-only** (ไม่ลบข้อมูลเงียบๆ; ไม่ให้แก้จนกว่า flag จะเปิด; ไม่ซ่อนเฉพาะ sub-field)
     - เมื่อ flag เปิดและมี Household ที่ลิงก์/เลือกแล้ว → **fetch เติม** pets/assets/vehicles แล้วให้แก้ได้ทันที; บันทึก = **เขียนลงเอกสาร Household ร่วม** (สมาชิกทุกคนใช้ชุดเดียวกัน) — แสดงคำใบ้สั้นๆ ว่าเป็นของทั้งครอบครัว

  **Household / ครอบครัว (FR-03b-H — supersedes keep/create/join/solo chips):**

  > **Terminology:** โดเมน/โค้ด/สคีมา = **Household**; UI ภาษาไทย = **ครอบครัว** (`CONTEXT.md`).  
  > **Residence** = ที่พักอาศัยร่วม บนเอกสาร Household. **Identity-document address** = ที่อยู่บนบัตร บน Evacuee เท่านั้น — **ห้าม** เก็บซ้ำบน Household.

  **ค่าเริ่มต้น (ยังไม่ลิงก์ Household):**
  - แสดงฟอร์ม **Residence** สำหรับสร้างครอบครัวใหม่ทันที (ไม่ใช่ชิปเลือกโหมด)
  - `label` = อัตโนมัติ `ครอบครัว{ชื่อคนที่ลงทะเบียน}` — **ไม่โชว์ช่อง**
  - ตอนสร้าง: **บังคับ Residence ขั้นต่ำ** = บ้านเลขที่ + จังหวัด + อำเภอ + ตำบล (หมู่/ถนน/รหัสไปรษณีย์ optional) — validation ฝั่ง Station 1; ไม่ bump `household` schema_v
  - **Debounced suggest (~300–400ms)** เมื่อ Residence ครบขั้นต่ำพอค้น: หา Household ในศูนย์ที่ที่อยู่ตรงกัน (บ้านเลขที่ + หมู่/ถนนถ้ามี + ตำบล + อำเภอ + จังหวัด) → แสดงรายการแนะนำให้ **เข้าร่วมได้** หรือ **สร้างใหม่ได้เสมอ** (ที่อยู่ซ้ำ ≠ ครอบครัวเดียวกัน — **ห้ามบล็อก** การสร้าง)
  - ปุ่มแยก **「เข้าร่วม」:** ค้น Evacuee ในศูนย์นี้ที่ **มี `household_id`** ด้วย **ชื่อ หรือเบอร์โทร** (สมาชิกคนใดก็ได้; **ทุก stay status** รวม `pre_registered`) → เลือกคนแล้ว join Household ของคนนั้น
  - Section E (เมื่อ flag เปิด): กรอกได้ตอนสร้าง; ตอนเลือก join จาก suggest/ค้นหา → fetch ของปลายทางมาเติมแล้วแก้ได้ (write-through ตามด้านบน)

  **โหมดลิงก์แล้ว** (มี `household_id` / Report-in / สแกนเจอของเดิม):
  - แสดงสรุปครอบครัวปัจจุบัน (label / Residence / สมาชิกสั้นๆ)
  - ค่าเริ่มต้น = **คงครอบครัวเดิม** (keep)
  - ทางเลือกชัด: **เปลี่ยนที่อยู่** (แก้ Residence ของ Household นี้) · **ออกแล้วสร้างใหม่** (ฟอร์ม Residence ใหม่) · **เข้าร่วมครอบครัวอื่น** (flow 「เข้าร่วม」)
  - Section E: fetch ของครอบครัวปัจจุบันมาเติม + แก้ได้เมื่อ flag เปิด

  **Smart-card / scan:**
  - Identity-document address เก็บที่ Evacuee ตามเดิม
  - **เสนอคัดลอกเป็นค่าเริ่มต้น Residence** (editable) พร้อมข้อความว่ามาจากที่อยู่บนบัตร — ไม่บังคับใช้เป็น Residence
  - ถ้าสแกน/match แล้วมี Household เดิม → เข้า **โหมดลิงก์แล้ว** (ไม่บังคับสร้างใหม่)

  **Mode: walk-in (`/new`)**
  - สร้าง evacuee ใหม่ผ่าน `createEvacuee` (ดู FR-03d)
  - Household ตาม FR-03b-H (ค่าเริ่มต้นสร้าง + suggest + เข้าร่วม; โหมดลิงก์ถ้ามีจาก scan)

  **Mode: Report-in (`/[id]/report-in`)**
  - โหลดข้อมูล `pre_registered` ที่มีอยู่เพื่อยืนยัน/แก้; submit → promote `current_stay.status` เป็น `arriving`, `zone` คง `null`
  - Household ตาม FR-03b-H (โหมดลิงก์แล้วถ้ามี `household_id`)
  - **Leaving household:** อนุญาตผ่าน 「ออกแล้วสร้างใหม่」 / 「เข้าร่วมครอบครัวอื่น」
    - ถ้าคนที่รายงานตัวเป็น **หัวหน้าครัวเรือน** และครัวเรือนนั้น **ยังมีสมาชิกอื่นเหลือ** → **บังคับเลือกหัวหน้าคนใหม่** ในฟอร์มก่อนบันทึก; ผู้สมัครหัวหน้าใหม่ = **เฉพาะสมาชิกที่อยู่ในครัวเรือนนั้นตอนนี้เท่านั้น**; การย้ายออก + โอนหัวหน้าต้อง **atomic ใน submit เดียวกัน** (ห้ามย้ายออกแล้วเหลือครัวเรือนไร้หัวหน้า)
    - ถ้าไม่ใช่หัวหน้า หรือไม่มีสมาชิกอื่นเหลือ → ย้ายออกได้ตามกฎ household ปกติโดยไม่ต้องโอนหัวหน้า
    - ถ้าคนที่ออกเป็น **สมาชิกคนสุดท้าย** ของครัวเรือนเดิม → **ยกเลิก/ยุบครัวเรือนเดิมอัตโนมัติ** หลังย้ายออกสำเร็จ (ไม่เก็บเอกสารครัวเรือนว่าง)

  **Post-submit (เหมือนกันทั้งสองโหมด — FR-03e):**  
  persist `arriving` + zone null → ออก **Person QR เสมอ** (พิธีจบหลักหลังบันทึก) → ถ้า `enable_medical_screening` on แสดง Handover Slip ด้วย → กลับคิว / CTA ไป S2 หรือ S3 ตาม flag

- **FR-03c (ห้ามที่ Station 1):** EWAR checklist, medical history step, สร้างเอกสาร `screening`, ขั้นตอนเลือกโซน/check-in — **คงเดิม** (single-page shell ไม่เปลี่ยนข้อห้ามนี้)
- **FR-03d (Persist):**
  - Walk-in `/new`: `createEvacuee` เท่านั้น (ไม่ใช้ `createEvacueeWithScreening`); status `arriving`, zone `null`
  - Report-in: อัปเดตเอกสารที่มีอยู่ + promote `pre_registered` → `arriving`; zone คง `null`; **ห้าม** สร้าง screening / จัดโซน
- **FR-03e (End of Station 1 form — ทั้ง `/new` และ Report-in):** หลังบันทึกสำเร็จ **ต้องออก Person QR** (พิธีจบหลัก); ถ้า flag on ออก Handover Slip ด้วย; กลับคิว / CTA S2 หรือ S3

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
- **FR-09:** ตามเดิมภายใต้ `$lib/features/people/ui/forms/` (`personal-info`, `emergency-contact`, `special-needs`, `ewar-symptoms`, `household-address`, `pet-asset-vehicle`, `health-medical`, `zone-selection`) — EWAR/health ใช้ที่ Station 2 / profile **ไม่ใช่** Station 1 registration shell; Station 1 ประกอบ sub-components เป็น single-page + scroll spy (FR-03b)

### 2.8 Optional last name (mononym / foreign nationals)
- **FR-18 (last_name ว่างได้):** `first_name` ยัง required; `last_name` ตัดช่องว่างแล้ว **ว่างได้** (persist เป็น `""`) — ไม่บังคับใส่ `-` / `.` เมื่อไม่มีนามสกุล (เช่น พม่า / mononym)
- **FR-19 (UX hint):** ฟอร์ม personal-info แสดงคำแนะนำเมื่อ `country ≠ THAILAND` หรือบัตรไม่ใช่ `national_id`: ใส่ชื่อเต็มในช่องชื่อและเว้นนามสกุลได้; ช่องนามสกุลไม่มีเครื่องหมายบังคับ
- **FR-20 (display):** แสดงชื่อด้วย `formatPersonName` — รวมชื่อ+สกุลแล้ว trim / ข้ามสกุลว่าง

---

## 3. Data Schema & Migration Impact

### 3.1 `evacuee` — schema_v 9 (Additive)
- ขยาย enum `current_stay.status` เพิ่ม `'arriving'`
- `last_name`: field คง required บนเอกสาร แต่ **อนุญาตค่าว่าง** (เดิมห้าม empty ใน Zod/UI) — ไม่ bump schema_v เพิ่ม; ไม่ต้อง backfill
- Identity-document address ยังอยู่ที่คน (เช่น `card_snapshot`) — **ไม่** ย้ายไป Household
- Migration: read-time compatibility; ไม่ต้อง backfill

### 3.2 `screening` — schema_v 2 (Additive)
- `triage_level`: `enum('green','yellow','red') | null`
- Migration: additive

### 3.3 `shelter` — schema_v 5 (Additive)
- `enable_medical_screening: boolean` ใน `feature_flags` (default `false`)

### 3.4 `movement` — additive enum (no schema_v bump)
- เพิ่ม `action: 'zone_change'` — คง `current_stay.status` (ปกติ `active`); อัปเดต `zone` จาก movement; ใช้สำหรับ rezone / ย้ายโซนหลัง check-in
- Migration: ไม่ต้อง backfill; client/validate_doc_update รับค่าใหม่

### 3.5 `household` — Residence semantics (no schema_v bump)
- ฟิลด์ที่อยู่เดิม (`address_no` … `postal_code`) = **Residence** ของ Household (ที่พักอาศัยร่วม)
- Station 1 **บังคับขั้นต่ำตอนสร้าง** (บ้านเลขที่ + จังหวัด/อำเภอ/ตำบล) ที่ชั้น validation/UI — เอกสารเก่าที่อยู่ว่างยังอ่านได้; ไม่ backfill; ไม่เพิ่มฟิลด์ที่อยู่บัตรบน Household
- `label` สร้างอัตโนมัติ `ครอบครัว{ชื่อ}` จาก Station 1 (field ยัง req บนเอกสาร)

---

## 4. Decision Log

- 2026-09-02 — 3-Station Pipeline + `arriving` + Handover QR + shared forms + `triage_level`
- 2026-09-03 — Station 2 UX: queue/form แยก; ไม่ zoning จาก S2 ในรอบแรก
- 2026-09-03 — **Confirmed intake rewrite (in-place):**
  1. Flag สลับเฉพาะ S2 visibility + Handover — **ไม่มีการจัดโซนที่ Station 1 เลย**
  2. Flag ON: S1→S2→S3; OFF: S1→S3
  3. Station 1 = คิวตาราง + registration shell ไร้ EWAR/screening/zone; walk-in = `createEvacuee` only; Person QR เสมอ
     _(superseded UX detail 2026-09-03: wizard → single-page + scroll spy + Report-in route — ดู decision log แถวล่าสุด)_
  4. Station 3 = `/onsite/zoning` + `canAccessZoning` + `zone_change`
  5. S2 save → ปุ่มไปจัดโซน / กลับคิวแพทย์
- 2026-09-03 — **Optional last_name (FR-18..20):** mononym / ชาวต่างชาติ — `last_name` ว่างได้; UX hint; `formatPersonName`
- 2026-09-03 — **Station 1 UX rewrite (in-place, no new CR):** ยุบ wizard ทั้งก้อน → **single-page + scroll spy**; shared shell สำหรับ `/new` + Report-in `/onsite/people/[id]/report-in`; 「รายงานตัว」เปิดฟอร์มเต็ม (ไม่ one-click patch); sections photo (optional) / personal+emergency / special needs / household / pets-assets-vehicles; sticky chips + sticky save; dirty leave confirm; no autosave; full-page validate → jump first invalid; section E nav ตาม shelter allow_* flags (+ แสดงทั้งก้อน read-only ถ้ามีข้อมูลเดิมขณะ flag ปิด); household UI ตัวเลือกชัด **keep / create / join / solo** (รองรับ smart-card พบครัวเรือนเดิม); leave + โอนหัวหน้า atomic เมื่อหัวหน้าออกและครัวเรือนยังมีสมาชิก; post-submit: **Person QR เสมอ** (+ Handover ถ้า flag) → คิว/CTA S2|S3. Glossary **Report-in** ใน `CONTEXT.md` ยืนยันแล้ว
  - _(Household chip detail superseded 2026-09-03 — ดูแถว Household UX rewrite)_
- 2026-09-03 — **Ambiguity lock-in:** photo optional; household keep เป็นตัวเลือกชัด + join หลังกรอกครบเมื่อ scan พบครัวเรือนเดิม; section E read-only = ทั้งก้อน; พิธีจบหลัก = Person QR; หัวหน้าใหม่ = เฉพาะสมาชิกในครัวเรือนปัจจุบัน; สมาชิกคนสุดท้ายออก → ยุบครัวเรือนเดิมอัตโนมัติ
  - _(Household keep/join chip wording superseded by Household UX rewrite below; leave/head + section E flag-off read-only ยังมีผล)_
- 2026-09-03 — **Section order lock-in:** ภาพถ่ายใบหน้า → ข้อมูลประจำตัว → ครัวเรือน → ข้อมูลติดต่อฉุกเฉิน (required + `*`) → ความต้องการพิเศษ (ตัดคำว่ากลุ่มเปราะบาง) → pets/assets/vehicles เมื่อแสดง
- 2026-09-03 — **Household UX rewrite (in-place, FR-03b-H):** ยุบ keep/create/join/solo + ฟอร์มซ้อน; ค่าเริ่มต้น = ฟอร์ม Residence สร้างใหม่ (`label` อัตโนมัติ); debounce แนะนำที่อยู่ซ้ำ (ไม่บล็อก); ปุ่ม「เข้าร่วม」ค้นชื่อ/เบอร์ Evacuee ที่มี `household_id` ทุกสถานะ; โหมดลิงก์แล้ว = สรุป + คงไว้ / เปลี่ยนที่อยู่ / ออกแล้วสร้างใหม่ / เข้าร่วมอื่น; UI 「ครอบครัว」 / โดเมน Household; Residence บน Household เท่านั้น; ที่อยู่บัตรบน Evacuee + prefill Residence จากบัตรได้; section E fetch+edit write-through; leave/head atomic คงเดิม

---

## 5. Acceptance / DoD

- [ ] Flag on/off สลับ pipeline และ visibility ตาม FR-01
- [ ] Station 1 ไม่สร้าง screening และไม่ check-in/zone
- [ ] `/onsite/people` คิวมีคอลัมน์คิวถัดไป + filter chips + Person QR scan; คอลัมน์ครอบครัวใช้ label 「ครอบครัว」
- [ ] 「รายงานตัว」เปิด `/onsite/people/[id]/report-in` (ฟอร์มเต็ม) — ไม่ one-click status patch
- [ ] Shared shell: single-page + scroll spy สำหรับ `/new` และ Report-in; sticky chips + sticky save; dirty leave confirm; no autosave
- [ ] Full-page validate กระโดดไป section แรกที่ invalid
- [ ] Section E nav ตาม `allow_pets|allow_assets|allow_vehicles`; อ่านอย่างเดียวทั้งก้อนเมื่อมีข้อมูลเดิมขณะ flag ปิด; เมื่อ flag เปิด + มี Household → fetch เติมแล้วแก้ได้ (write-through)
- [ ] Household UI ตาม FR-03b-H: ฟอร์ม Residence เป็นค่าเริ่มต้น; ไม่มีชิป keep/create/join/solo; debounce suggest ที่อยู่ (ไม่บล็อกสร้าง); 「เข้าร่วม」ค้นชื่อ/เบอร์; โหมดลิงก์แล้วครบทางเลือก; `label` อัตโนมัติ; Residence บังคับขั้นต่ำตอนสร้าง
- [ ] ที่อยู่บัตรไม่ถูก persist บน Household; สแกนบัตร prefill Residence ได้แบบแก้ได้
- [ ] Photo optional
- [ ] Leave + forced head pick atomic เมื่อหัวหน้าออกและครัวเรือนยังมีสมาชิกอื่น; หัวหน้าใหม่เลือกได้เฉพาะสมาชิกในครัวเรือนนั้น; สมาชิกคนสุดท้ายออก → ยุบครัวเรือนเดิม
- [ ] `/new` และ Report-in จบด้วย **Person QR** (+ Handover ถ้า flag on) + CTA S2/S3
- [ ] Station 2 save มีปุ่มไป `/onsite/zoning/[id]` และกลับคิว
- [ ] Station 3 pending/assigned queues ตาม FR-11; first assign = check_in; rezone = zone_change
- [ ] schema.md §1.4 ระบุ `zone_change`; §1.3 ระบุ Residence semantics; tests domain/utils ผ่าน
- [ ] `last_name` ว่างผ่าน validation; แสดงชื่อไม่เหลือช่องว่างท้าย; hint ต่างชาติ/บัตรต่างด้าว (FR-18..20)
