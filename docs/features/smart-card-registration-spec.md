---
title: สเปคระบบอ่านบัตรประชาชนและการลงทะเบียนผู้ประสบภัย (Smart Card Reader & Fast-Track Registration Spec)
status: active
created: 2026-08-29
updated: 2026-09-11
author: Soravit Sukkarn (Team Lead)
affects:
  - docs/data/schema.md §1.1
  - docs/adr/0001-decoupled-registration-and-medical-screening-flow.md
  - docs/changes/CR-097-smart-card-evacuee-draft-flow.md
  - frontend/src/lib/features/scanners/
  - frontend/src/lib/features/people/
  - frontend/src/routes/(protected)/onsite/people/
  - frontend/src/routes/api/v1/scanner/
---

# สเปคระบบอ่านบัตรประชาชนและการลงทะเบียนผู้ประสบภัย (Smart Card Reader & Fast-Track Registration)

**สรุป (BLUF):**  
บันทึกข้อมูลชิปบัตรประชาชนสร้าง entity `evacuee` โดยตรง กำหนดสถานะ `current_stay.status = 'pre_registered'`, ระบุ `registered_via: 'kiosk'`, และแนบ `card_snapshot` พร้อมคำนวณอายุและรหัสไปรษณีย์อัตโนมัติ · ข้อมูลไหลเข้าสู่คิว Station 1 (`/onsite/people`) ในแท็บ "รอรับรายงานตัว" (`pre_registered`) เช่นเดียวกับการลงทะเบียนล่วงหน้าออนไลน์ (`registered_via: 'web'`) · เจ้าหน้าที่กด "รับรายงานตัว" (`/onsite/people/[id]/report-in`) เพื่อตรวจสอบข้อมูลที่ Autofill จาก `card_snapshot` ปรับสถานะเป็น `arriving` และออก Person QR ส่งต่อไป Station 2 (คัดกรองสุขภาพ) และ Station 3 (จัดโซน/Check-in สู่ `active`) ตาม ADR-0001

---

## 1. วัตถุประสงค์และภาพรวม (Objectives & Scope)

เพื่อลดเวลาการบันทึกข้อมูลหน้างาน ณ จุดรับเข้าศูนย์พักพิง (Onsite Reception Desk) จากเดิม 3–5 นาที ให้เหลือเพียง 30–60 วินาที โดยผสานข้อมูลทางการจากชิปบัตรประชาชนเข้ากับสถาปัตยกรรมคัดกรอง 3 สถานี (Decoupled 3-Station Pipeline ตาม [ADR-0001](../adr/0001-decoupled-registration-and-medical-screening-flow.md))

### ข้อกำหนดสำคัญ (Core Invariants):

1. **Direct Pre-registration:** ผู้ประสบภัยที่เสียบบัตร ณ ตู้ Kiosk จะได้รับสถานะ `pre_registered` ทันที และมีฟิลด์ `registered_via: 'kiosk'` เพื่อแยกแยะจากช่องทางออนไลน์ (`'web'`)
2. **Editable & Manual Override:** ข้อมูลทุกช่องที่ Autofill จาก `card_snapshot` จะต้องไม่ถูกล็อกตาย เจ้าหน้าที่และผู้ประสบภัยสามารถตรวจสอบและแก้ไขข้อมูลจริงได้ในฟอร์มรับรายงานตัว Station 1
3. **Decoupled Pipeline Handshake:** การเสียบบัตรที่ Kiosk ทำหน้าที่เก็บข้อมูลอัตลักษณ์และที่อยู่เท่านั้น **ไม่มีการจัดเตียง/โซน และไม่มีการคัดกรองโรคที่ Kiosk หรือ Station 1** การตรวจโรคเป็นหน้าที่ของ Station 2 และการ Check-in เข้าพักจริงเป็นหน้าที่ของ Station 3 เท่านั้น
4. **Data Privacy & Search-First:** รายการจาก Kiosk ปรากฏในคิว `pre_registered` ประจำศูนย์ และค้นหาได้ผ่าน Unified Search Omnibox ในหน้า `/onsite/people` โดยไม่เปิดเผยข้อมูลชิปบัตรสู่ Public Directory

---

## 2. แผนผังการทำงานของระบบ (End-to-End System Flow)

```mermaid
flowchart TD
    Start["ผู้ประสบภัยเสียบบัตรประชาชนที่ Kiosk"] --> ReadCard["เครื่องอ่านข้อมูลชิปการ์ดและเลข 13 หลัก"]
    ReadCard --> CheckDB{"ตรวจสอบประวัติในฐานข้อมูลศูนย์"}

    CheckDB -- "1. ยังไม่เคยมีประวัติ" --> CreatePreReg["สร้าง Evacuee ใหม่<br/>- status = 'pre_registered'<br/>- registered_via = 'kiosk'<br/>- household_id = null<br/>- บันทึก card_snapshot<br/>- คำนวณอายุและรหัสไปรษณีย์อัตโนมัติ"]
    CreatePreReg --> ScreenNew["หน้าจอ Kiosk แสดงผล UI สีเขียว:<br/>'อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล'"]

    CheckDB -- "2. มีสถานะ pre_registered อยู่แล้ว" --> WarnPre["แจ้งเตือนสแกนซ้ำ (409 already_pre_registered):<br/>'ท่านมีข้อมูลในระบบแล้ว กรุณาไปพบเจ้าหน้าที่'"]
    CheckDB -- "3. อยู่ระหว่างพักอาศัย (active)" --> WarnActive["แจ้งเตือน (409 already_active):<br/>'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว'"]
    CheckDB -- "4. อยู่ระหว่างออกชั่วคราว (temporary_leave)" --> WarnLeave["แจ้งเตือน (409 already_temporary_leave):<br/>'ท่านอยู่ในสถานะออกชั่วคราว กรุณาติดต่อเจ้าหน้าที่'"]
    CheckDB -- "5. เคยพักในอดีต (checked_out/transferred)" --> WarnHistory["แจ้งเตือน (409 previously_stayed):<br/>'ท่านเคยมีประวัติการเข้าพักในศูนย์แล้ว กรุณาไปพบเจ้าหน้าที่'"]
    CheckDB -- "6. สถานะถูกยกเลิก (cancelled)" --> ReactivatePre["Reactivate กลับมาเป็น pre_registered<br/>อัปเดต card_snapshot ล่าสุด"]

    ScreenNew --> Station1Desk["ผู้ประสบภัยเดินไปพบเจ้าหน้าที่ Station 1 (/onsite/people)"]
    WarnPre --> Station1Desk
    ReactivatePre --> Station1Desk

    Station1Desk --> QueuePre["แสดงใน Tab 1: ลงทะเบียนล่วงหน้า (pre_registered)<br/>หรือค้นหาด้วยเลข 13 หลัก / ชื่อ"]
    QueuePre --> ActionReportIn["เจ้าหน้าที่กดปุ่ม: [ รับรายงานตัว ]<br/>นำทางสู่ /onsite/people/[id]/report-in"]
    ActionReportIn --> SharedForm["Shared Registration Shell (Scroll Spy):<br/>- Autofill อัตลักษณ์จาก card_snapshot<br/>- Autofill ที่อยู่เดิม พร้อมรหัสไปรษณีย์<br/>- สร้าง/ผูก ครอบครัว (Household)<br/>- ระบุข้อมูลติดต่อฉุกเฉิน (Required)"]
    SharedForm --> SaveStation1["บันทึกข้อมูล:<br/>- ปรับ status: pre_registered -> arriving<br/>- ออก Person QR Code (+ Handover Slip)"]

    SaveStation1 --> CheckMedical{"เปิด Medical Screening หรือไม่?"}
    CheckMedical -- "เปิด (ON)" --> Station2["Station 2: คัดกรองสุขภาพ EWAR & Triage"]
    CheckMedical -- "ปิด (OFF)" --> Station3["Station 3: จัดสรรโซนที่พัก (Zoning)"]
    Station2 --> Station3
    Station3 --> CheckInDone["Atomic Check-in:<br/>ปรับ status: arriving -> active<br/>บันทึก movement 'check_in' เข้า Occupancy จริง"]
```

---

## 3. ข้อกำหนดเชิงหน้าที่และเกณฑ์การยอมรับ (Functional Requirements & Acceptance Criteria)

### 3.1 Kiosk Card Scanner & Inbound API

- **FR-CARD-01 (Inbound Gateway):** เมื่อเสียบบัตรประชาชน เครื่องอ่านส่ง payload มายัง `POST /api/v1/scanner/draft` พร้อม Header ยืนยันตัวตน `X-Device-Id` และ `X-Device-Secret`
- **FR-CARD-02 (New Evacuee Creation):** หากเลขประจำตัวประชาชน 13 หลักยังไม่เคยมีในฐานข้อมูลศูนย์พักพิง ให้สร้าง doc `evacuee` ใหม่โดยกำหนด:
  - `_id`: `"evacuee:{ulid}"`
  - `schema_v`: `10`
  - `current_stay.status`: `"pre_registered"`
  - `current_stay.zone`: `null`
  - `registered_via`: `"kiosk"`
  - `person_id`: `{ cardType: 'national_id', number: card.citizen_id }`
  - `first_name`, `last_name`, `gender`, `birth_year`, `age`: แมปจากชิปบัตร โดยคำนวณ `age` จากปีเกิด พ.ศ. อัตโนมัติ
  - `household_id`: `null` (รอผูกครัวเรือนที่ Station 1)
  - `card_snapshot`: เก็บ snapshot ข้อมูลบัตร, ที่อยู่ตามทะเบียนบ้าน, รูปถ่าย, พร้อมรหัสไปรษณีย์ (`postal_code`) ที่ค้นหาอัตโนมัติผ่านพจนานุกรมตำบล/อำเภอ/จังหวัด (`thailand-location`)
- **FR-CARD-03 (Re-scan & Status Handling):** การประมวลผลกรณีเลข 13 หลักมีประวัติเดิมในศูนย์:
  - `pre_registered`: ตอบกลับสถานะ `already_pre_registered` (HTTP 409) ไม่ overwrite doc ซ้ำ
  - `active`: ตอบกลับสถานะ `already_active` (HTTP 409)
  - `temporary_leave`: ตอบกลับสถานะ `already_temporary_leave` (HTTP 409)
  - `checked_out` หรือ `transferred`: ตอบกลับสถานะ `previously_stayed` (HTTP 409) แจ้งเตือนให้เจ้าหน้าที่เปิดรับเข้าพักใหม่
  - `deceased`: ปฏิเสธการทำรายการ `deceased_record` (HTTP 409)
  - `cancelled`: Reactivate doc เดิมกลับมาเป็น `pre_registered` พร้อมอัปเดต `card_snapshot` และ `updated_at` ใหม่ (HTTP 200)
- **FR-CARD-04 (Kiosk Response UI):**
  - เสียบบัตรสำเร็จ (New Walk-in / Reactivate): แสดง UI สีเขียว — *"อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล"*
  - มีประวัติเดิม / สแกนซ้ำ: แสดง UI สีเหลือง (Amber) หรือข้อความสถานะตามเงื่อนไขใน FR-CARD-03
  - อ่านบัตรไม่สำเร็จ: แสดง UI สีแดง — แสดงคำแนะนำการหงายชิปสีทองขึ้นและเสียบให้สุด

### 3.2 Station 1 Onsite Intake Flow (`/onsite/people`)

- **FR-STAFF-01 (Queue Visibility):** ผู้ที่ลงทะเบียนผ่าน Kiosk จะปรากฏใน **Tab 1: "รายชื่อผู้ลงทะเบียนล่วงหน้า รอรับรายงานตัว"** (`activeTab = 'pre_registered'`) ควบคู่กับผู้ที่จองผ่านหน้าเว็บออนไลน์ (`web`)
- **FR-STAFF-02 (Omnibox Search):** เจ้าหน้าที่สามารถค้นหาผู้เสียบบัตรได้ด้วยเลข 13 หลัก, ชื่อ-นามสกุล, หรือสแกน QR Code จาก Unified Search Omnibox
- **FR-STAFF-03 (Report-in Action):** เมื่อกดปุ่ม `[ รับรายงานตัว ]` ให้เปิดเส้นทาง `/onsite/people/[id]/report-in` เพื่อเข้าสู่ Shared Registration Shell (Scroll Spy)
- **FR-STAFF-04 (Autofill & Override):**
  - Autofill ข้อมูลบุคคลและที่อยู่จาก `card_snapshot` เข้าสู่ฟอร์มอัตโนมัติ
  - เจ้าหน้าที่สามารถแก้ไขข้อมูลตัวสะกดและที่อยู่จริงได้อิสระ
  - บังคับระบุข้อมูลผู้ติดต่อฉุกเฉิน (`emergency_contact`) และการจัดตั้งหรือเข้าร่วมครัวเรือน (`household_id`)
- **FR-STAFF-05 (Station 1 Completion):** เมื่อบันทึกรายงานตัวสำเร็จ:
  - ปรับสถานะ `current_stay.status` จาก `'pre_registered'` $\rightarrow$ `'arriving'`
  - ออก **Person QR Code** ประจำตัวผู้ประสบภัย
  - หากเปิด flag `enable_medical_screening` ให้ออก Handover Slip และส่งคิวไป Station 2
  - หากปิด flag ให้ส่งคิวไป Station 3 เพื่อจัดโซนที่พักโดยตรง

---

## 4. การลงทะเบียนอุปกรณ์เครื่องสแกน (Device Hardware Registry)

- **FR-DEVICE-01:** ตู้ Kiosk ทุกเครื่องต้องลงทะเบียนเป็นเอกสาร `scanner_device` ใน DB `registry` ตรงกลาง
- **FR-DEVICE-02:** ประกอบด้วย: `device_id`, `name`, `shelter_code`, `station_name`, `secret_hash`, `status`, `last_seen_at`
- **FR-DEVICE-03:** Inbound API (`POST /api/v1/scanner/draft`) ตรวจสอบความถูกต้องของ `X-Device-Id` และ `X-Device-Secret` กับ DB `registry` ก่อนอนุญาตให้บันทึกข้อมูลเข้าสู่ DB ศูนย์พักพิง (`shelter_{shelter_code}`) พร้อมบันทึก Heartbeat `last_seen_at` อัตโนมัติ

---

## 5. นโยบายความปลอดภัยและข้อมูลสถิติ (PDPA & Governance)

1. **Occupancy Metrics:**
   - สถานะ `pre_registered` จาก Kiosk จะถูกนับรวมใน **Forecast Occupancy** (ยอดพยากรณ์ความต้องการเตียง) เช่นเดียวกับการจองออนไลน์
   - จะ**ไม่ถูกนับ**ใน **Present Occupancy** (ยอดผู้เข้าพักจริง) หรือการคำนวณโควตาอาหารของครัว จนกว่าจะผ่าน Station 3 ทำ Check-in เป็นสถานะ `active`
2. **Public Directory Exclusion:**
   - รายชื่อผู้มีสถานะ `pre_registered` จะไม่แสดงในระบบค้นหาญาติสาธารณะ (Public Directory / Public Portal) เพื่อคุ้มครองข้อมูลส่วนบุคคล
3. **Data Protection:**
   - ข้อมูลรูปถ่ายหน้าบัตร (`photo_base64`) และที่อยู่ฉบับเต็มถูกจัดเก็บในฐานข้อมูลศูนย์พักพิงที่จำกัดสิทธิ์ (RBAC) และไม่ส่ง `national_id_hash` หรือเลขบัตรตัวเต็มออกสู่ภายนอก

