---
id: CR-106
title: Decoupled Registration, Medical Screening, and Zoning Flow with Shelter Toggle and Shared Form Architecture
status: approved
layer: stable + volatile
created: 2026-09-02
updated: 2026-09-03
affects:
  - docs/data/schema.md §1.1 (evacuee schema_v 9), §1.5 (screening triage_level), §3.1 (shelter feature_flags)
  - docs/prd/role-permission-matrix.md
  - docs/changes/CR-072-triage-green-yellow-red.md (ratifies triage_level)
  - docs/adr/0001-decoupled-registration-and-medical-screening-flow.md
  - frontend/src/lib/features/people/
  - frontend/src/lib/features/shelters/
  - frontend/src/routes/(protected)/onsite/
---

# CR-106: Decoupled Registration, Medical Screening, and Zoning Flow with Shelter Toggle and Shared Form Architecture

> **สรุป (TL;DR):**  
> ปรับสถาปัตยกรรมกระบวนการรับผู้ประสบภัยหน้างาน (Intake Pipeline) ให้แยกอิสระเป็น 3 สถานี: **โต๊ะลงทะเบียน (Registration Desk)** $\rightarrow$ **โต๊ะคัดกรองการแพทย์ (Medical Screening Desk)** $\rightarrow$ **โต๊ะจัดสรรที่พัก (Zoning & Wristband Desk)** โดยรองรับการเปิด/ปิดระบบคัดกรองการแพทย์ตามความพร้อมของแต่ละศูนย์พักพิง (`feature_flags.enable_medical_screening`), ขยายสถานะผู้พักพิงเพิ่ม `arriving` (bump `evacuee` เป็น `schema_v: 9`), ปลดล็อกฟิลด์ `triage_level` (เขียว/เหลือง/แดง) ในเอกสาร `screening`, เพิ่มระบบใบนำทาง Handover QR Slip ส่งต่อหน้างาน, และปรับโครงสร้างฟอร์มเป็น Shared Core Sub-components ใช้ร่วมกันระหว่าง Registration Wizard, Edit Profile, และ Medical Screening.

---

## 1. Context & Motivation (Why)

1. **คอขวดหน้างานและความปลอดภัยทางการแพทย์:**  
   เดิมขั้นตอนการลงทะเบียนหน้างานรวมการประเมินอาการโรค (EWAR) และการเลือกโซนที่พักไว้ในจุดเดียว ทำให้โต๊ะลงทะเบียนใช้เวลาสัมภาษณ์นาน และมีความเสี่ยงสูงในการจัดเตียง/ห้องพักทั่วไปให้แก่ผู้มีอาการโรคติดต่อหรือข้อจำกัดทางกายภาพที่ยังไม่ได้รับการตรวจประเมินโดยบุคลากรทางการแพทย์
2. **ความแตกต่างของขนาดและทรัพยากรแต่ละศูนย์พักพิง:**  
   ศูนย์พักพิงขนาดเล็กมักไม่มีแพทย์/พยาบาลประจำ จึงจำเป็นต้องมีสวิตช์เปิด/ปิดการคัดกรองการแพทย์ระดับศูนย์ เพื่อให้สามารถลงทะเบียนและจัดโซนเสร็จสิ้นในโต๊ะเดียวได้ตามเดิม ขณะที่ศูนย์ขนาดกลาง/ใหญ่สามารถเปิดระบบคัดกรองเพื่อแยกสายงานได้อย่างมีประสิทธิภาพ
3. **การส่งต่อที่รวดเร็ว (Fast Handover):**  
   ในภาวะวิกฤตที่มีผู้ประสบภัยหลั่งไหลเข้ามาพร้อมกัน การให้แพทย์ค้นหารายชื่อด้วยการพิมพ์ชื่อ-สกุลมีความล่าช้าและผิดพลาดได้ง่าย ระบบจึงต้องมีทั้ง **ตารางคิวรอตรวจ (Waiting Queue Table)** พร้อมช่องค้นหา และ **ใบนำทางพร้อม QR Code (Handover Slip)** ที่แพทย์สามารถยิงสแกนแล้วเปิดหน้าตรวจได้ทันทีใน 1 วินาที
4. **ความซ้ำซ้อนของโค้ด UI (DRY & Component Reusability):**  
   ปัจจุบันฟิลด์ข้อมูลส่วนตัว, ที่อยู่, สุขภาพ, และทรัพย์สินถูกเขียนซ้ำกันระหว่าง `evacuee-form.svelte` (Wizard) และชุด Modal Edit ใน `evacuee-profile-view.svelte` การแยกเป็น Shared Form Sub-components จะช่วยลด Technical Debt และทำให้ logic การ validate ตรงกัน 100%

---

## 2. Requirements & Specification

### 2.1 Shelter Configuration Toggle
- **FR-01 (Screening Feature Flag):** ขยายฟิลด์ในเอกสาร `shelter.feature_flags`:
  ```ts
  feature_flags: {
    allow_pets: boolean;
    allow_vehicles: boolean;
    allow_assets: boolean;
    public_donations_enabled: boolean;
    enable_medical_screening: boolean; // default: false
  }
  ```
- เมื่อ `enable_medical_screening === false`:
  - โต๊ะลงทะเบียนพาผู้ใช้เข้าสู่ขั้นตอนจัดสรรโซน (Zoning) และ Check-in สำเร็จในขั้นตอนเดียว (Unified Flow เดิม)
- เมื่อ `enable_medical_screening === true`:
  - โต๊ะลงทะเบียนบันทึกข้อมูลแล้วเสร็จสิ้นที่การออกบัตรคิว/ใบนำทาง Handover Slip $\rightarrow$ ส่งต่อไปคิวแพทย์

### 2.2 Evacuee Stay Status Expansion (schema_v 9)
- **FR-02 (Stay Status: arriving):** ขยาย enum `evacuee.current_stay.status` ให้มีค่า:
  `['pre_registered', 'arriving', 'active', 'temporary_leave', 'transferred', 'checked_out', 'deceased', 'cancelled']`
  - `arriving`: ผู้ประสบภัยที่มารายงานตัวหน้างานและลงทะเบียนแล้ว อยู่ระหว่างรอรับการตรวจคัดกรอง หรือรอจัดสรรที่พัก
  - เมื่อโต๊ะลงทะเบียนบันทึก (กรณีเปิด screening): ตั้งค่า `evacuee.current_stay.status = 'arriving'`, `current_stay.zone = null` และ `household.status = 'arriving'`
  - ผู้ที่มีสถานะ `arriving` ยังไม่นับยอดเป็นเตียงที่ถูกใช้จริงใน Occupancy Dashboard ของโซน

### 2.3 Registration Desk Scope (Station 1)
- **FR-03 (Intake Data Collection):** โต๊ะลงทะเบียนบันทึก:
  1. ตรวจสอบประวัติ / Smart Card Kiosk draft lookup
  2. ข้อมูลผู้ประสบภัยส่วนบุคคล (`first_name`, `last_name`, `person_id`, `phone`, `birth_year`/`age`, `gender`, `religion`)
  3. อาการเฝ้าระวังเบื้องต้น (EWAR Checklist)
  4. กลุ่มเปราะบางและความต้องการพิเศษ (`special_needs`: วีลแชร์, ผู้ป่วยติดเตียง, ใช้ออกซิเจน, หญิงตั้งครรภ์, ทารก, ฯลฯ)
  5. ครัวเรือนและที่อยู่ (`household`, ที่อยู่เดิม)
  6. ทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง (`pets`, `assets`, `vehicles`)
  7. ผู้ติดต่อฉุกเฉิน (`emergency_contact`)
- เมื่อกด Submit: บันทึกข้อมูล `evacuee` + `household` ในสถานะ `arriving` พร้อมแสดง Modal หรือหน้าพิมพ์ **Handover Slip**

### 2.4 Handover Slip & QR Code
- **FR-04 (Handover Token):** แสดงบัตรนำทางที่มี:
  - ชื่อ-นามสกุล, เลขประจำตัว/หมายเลขบัตรประชาชน (Masked), เบอร์โทร
  - แท็กสรุปความต้องการพิเศษ (`special_needs`) และอาการเฝ้าระวัง (EWAR)
  - QR Code บรรจุ Deep Link แบบ path-only: `/onsite/medical-screening/{evacuee_id}` (ไม่ใช้ query `?evacuee_id=`)
  - ปุ่มสั่งพิมพ์ (Print Slip) หรือดาวน์โหลดรูปภาพ

### 2.5 Medical Screening Route & Station (Station 2)
- **FR-05 (Dedicated Routes):**
  - **Queue:** `/onsite/medical-screening` — ค้นหา + สแกน QR/กล้อง + ตารางคิวเท่านั้น (ไม่มีแผงฟอร์มด้านขวา)
  - **Form:** `/onsite/medical-screening/[evacuee_id]` — ฟอร์มคัดกรองเต็มหน้าจอ
  - **Access Guard:** จำกัดสิทธิ์เฉพาะ `medical_staff`, `triage_staff`, `shelter_manager`, `system_admin`
  - ไม่รองรับ legacy redirect จาก `?evacuee_id=` บนหน้า queue
- **FR-06 (Queue Tabs & Fast Search):**
  - **แท็บ "รอตรวจ":** ผู้มีสถานะ `arriving` / `pre_registered` ที่ยังไม่มีเอกสาร `screening`
  - **แท็บ "ตรวจแล้ว (แก้ไขได้)":** ผู้ที่มีเอกสาร `screening` แล้ว — เปิดแก้ไขได้ทุกบทบาทที่เข้า Station 2 ได้
  - **ช่องค้นหาทันใจ (Search Bar):** ค้นหาด้วย ชื่อ, นามสกุล, ที่อยู่, เบอร์โทรศัพท์ หรือเลขบัตร
  - **เครื่องสแกนบาร์โค้ด/กล้อง (QR Scanner):** ยิงสแกน Handover Slip แล้ว navigate ไป `/onsite/medical-screening/{id}`
- **FR-07 (Medical Assessment Form):**
  - แสดงข้อมูลที่โต๊ะทะเบียนบันทึกมา (EWAR Checklist + `special_needs`)
  - เมื่อเป็น re-edit: prefill จาก screening/medical ล่าสุด + แบนเนอร์บริบท (จำนวนครั้งที่ตรวจ / `screened_at` / ผู้ตรวจ)
  - ฟิลด์ประเมินและตรวจวัด:
    - สัญญาณชีพ & อุณหภูมิร่างกาย (`temperature_c`)
    - อาการเจ็บป่วยเพิ่มเติม (`symptoms[]`)
    - ระดับ Triage 3 สี: `triage_level: 'green' | 'yellow' | 'red'`
    - การส่งต่อฉุกเฉิน: `needs_referral: boolean` + รายละเอียดส่งต่อ
    - เวชระเบียนส่วนบุคคล: กรุ๊ปเลือด (`blood_group`), โรคประจำตัว (`conditions[]`), ยาที่ใช้ประจำ (`medications[]`), ประวัติแพ้ยา/อาหาร (`allergies[]`), บันทึกทางการแพทย์ (`notes`)
  - Sticky footer สำหรับปุ่มบันทึก; ยืนยันก่อนออกหากฟอร์ม dirty
  - id ไม่พบ / ไม่มีสิทธิ์: แสดงข้อความชัดเจน + ปุ่มกลับคิว
- **FR-08 (Station 2 Save — no zoning this round):**
  - **ปุ่มเดียว "บันทึกผลคัดกรอง":** สร้าง `screening` ใหม่ (append-only) + อัปเดต `medical` in place; กลับไปหน้าคิวพร้อม toast ว่าจะส่งต่อไปโต๊ะจัดโซนในภายหลัง
  - **ไม่แสดง** การเลือกโซน / เช็คอินจาก Station 2 ในรอบนี้ (ไม่มี "บันทึกและจัดโซนทันที"); ลิงก์ไป Station 3 เลื่อนไปจนกว่า Station 3 จะมีจริง
  - API `recordMedicalScreening` อาจยังรับ `zone`/`checkIn` แบบ optional แต่ UI ไม่เรียกใช้

### 2.6 Shared Form Sub-components Architecture
- **FR-09 (Modular Sub-forms):** สร้าง Shared Sub-components ภายใต้ `$lib/features/people/ui/forms/`:
  - `personal-info-fields.svelte`: ชื่อนามสกุล, บัตร, เบอร์, วันเกิด, สัญชาติ, ศาสนา
  - `emergency-contact-fields.svelte`: ผู้ติดต่อฉุกเฉิน
  - `special-needs-fields.svelte`: กลุ่มเปราะบางและความต้องการพิเศษ
  - `ewar-symptoms-fields.svelte`: การประเมินอาการเฝ้าระวัง EWAR
  - `household-address-fields.svelte`: ข้อมูลครัวเรือนและที่อยู่
  - `pet-asset-vehicle-fields.svelte`: สัตว์เลี้ยง ยานพาหนะ และทรัพย์สิน
  - `health-medical-fields.svelte`: กรุ๊ปเลือด, โรคประจำตัว, ยา, ประวัติแพ้, Triage level
  - `zone-selection-fields.svelte`: ตัวเลือกโซนและระบบแนะนำโซน (ใช้ที่ Station 3 / unified flow — ไม่ใช้บน Station 2 ในรอบนี้)

---

## 3. Data Schema & Migration Impact

### 3.1 `evacuee` — schema_v 9 (Additive)
- ขยาย enum `current_stay.status` เพิ่ม `'arriving'`
- **Migration:** Read-time compatibility — เอกสารเดิม schema_v 8 อ่านได้ตามปกติโดยไม่ต้อง backfill เมื่อมีการอัปเดตเอกสารจะ persist เป็น schema_v 9

### 3.2 `screening` — schema_v 2 (Additive)
- เพิ่มฟิลด์ `triage_level`: `enum('green', 'yellow', 'red') | null` (CR-072 ratify)

### 3.3 `shelter` — schema_v 5 (Additive)
- เพิ่ม `enable_medical_screening: boolean` ใน `feature_flags` (default: `false`)

---

## 4. Decision Log

- 2026-09-02 — สรุปข้อตกลงผ่านกระบวนการ Grilling & Domain Modeling:
  1. เลือก 3-Station Pipeline (ทะเบียน $\rightarrow$ แพทย์ $\rightarrow$ จัดโซน) โดยให้เปิด/ปิดได้ระดับศูนย์
  2. ใช้สถานะ `arriving` และ bump `evacuee` เป็น schema_v 9
  3. จัดโซนตามครัวเรือนเป็นหลัก โดยแพทย์สามารถแยกเฉพาะบุคคลไปโซนพยาบาล/กักตัวได้
  4. Handover ผ่าน QR Code Deep Link ควบคู่ตารางคิวรอตรวจ
  5. แยก Route `/onsite/medical-screening` สำหรับบุคลากรทางการแพทย์
  6. ปลดล็อก `triage_level` (เขียว/เหลือง/แดง) ตาม CR-072
  7. รวม Core Sub-form Components ใน `$lib/features/people/ui/forms/` เพื่อแชร์ร่วมกันในทุกหน้า
- 2026-09-03 — UX rewrite Station 2 (อัปเดต in-place ใน CR นี้):
  1. แยกหน้าคิว (ตาราง + แท็บรอตรวจ/ตรวจแล้ว) กับหน้าฟอร์มเต็มจอ `/[evacuee_id]`
  2. Handover QR เป็น path-only; ไม่รองรับ legacy `?evacuee_id=` redirect บน queue
  3. ตัด zoning/check-in จาก Station 2 ในรอบนี้; save แล้วกลับคิว + toast ส่งต่อ Station 3 ภายหลัง
  4. Re-edit ได้ทุกบทบาทที่เข้า Station 2; sticky footer + dirty leave confirm
