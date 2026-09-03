---
id: CR-098
title: M2 External API Services Integration (A_M2_API_SERVICES_SHELTER_V1.0) — Phase 1 Endpoints 1 & 3 (renumbered from CR-079)
status: approved
date: 2026-08-20
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
parent: CR-066
affects:
  - docs/data/api-contract.md
  - backend /external/v1 (CR-062)
---

# CR-098 — M2 External API Integration (Phase 1)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เปิดบริการ API เชื่อมต่อกับระบบ M2 (Consumer) ภายใต้ `/external/v1` จำนวน 2 บริการแรก: `GET /external/v1/shelters` และ `GET /external/v1/persons/shelter-residency` พร้อมรองรับ `Authorization: Bearer <token>` ควบคู่กับ `X-API-Key`
- **เพื่อใคร/ทำไม:** รองรับระบบ M2 (ระบบประเมินความพร้อมและจัดการกลุ่มเปราะบาง) ในการดึงรายชื่อศูนย์พักพิงและตรวจสอบสถานะการเข้าพักของผู้ประสบภัย
- **dev ต้อง build อะไร:** 
  1. `GET /external/v1/shelters` คืนรายการศูนย์พร้อม `shelter_id, shelter_name, lat, long`
  2. `GET /external/v1/persons/shelter-residency` ตรวจสอบสถานะการเข้าพักจาก CID (คืน `CHECKED_IN`/`CHECKED_OUT` หรือ 404 หากไม่พบ)
  3. ปรับ Security ให้รองรับ Dual Auth (`Authorization: Bearer` และ `X-API-Key`) ผ่านโมเดล `ApiKey` เดิม
  4. จัดรูปแบบ Error Response มาตรฐานตามสเปก M2 (`{"error": {"code": "...", "message": "..."}}`)
- **กระทบ schema/scope ไหน:** ไม่มี breaking change กับ CouchDB หรือ MongoDB; Endpoint 2 (`POST /shelters/booking`) รอระบบหลักเสร็จสิ้นในเฟสถัดไป

---

## 1. Specifications

### 1.1 Endpoint 1: ดึงรายการศูนย์พักพิง (`get-list-shelter`)
- **Method & Path:** `GET /external/v1/shelters`
- **Query Param:** `status` (optional, เช่น `open`)
- **Response 200 OK:**
  ```json
  [
    {
      "shelter_id": "SH001",
      "shelter_name": "ศูนย์พักพิงเทศบาล 1",
      "lat": 7.0084,
      "long": 100.4767
    }
  ]
  ```

### 1.2 Endpoint 3: ตรวจสอบสถานะการเข้าพัก (`get-person-shelter-residency`)
- **Method & Path:** `GET /external/v1/persons/shelter-residency`
- **Query Param:** `cid` (เลขประจำตัวประชาชน 13 หลัก, required)
- **Response 200 OK:**
  ```json
  {
    "shelter_id": "SH001",
    "shelter_name": "ศูนย์พักพิงเทศบาล 1",
    "checkin_datetime": "2026-08-20T14:30:00+07:00",
    "status": "CHECKED_IN"
  }
  ```
- **Error Responses:**
  - 401 `unauthorized`: Token ไม่ถูกต้องหรือหมดอายุ
  - 404 `not_found`: ไม่พบประวัติการเข้าพักของ CID นี้ (รวมถึงกรณีจองล่วงหน้าแต่ยังไม่เคย check-in จริง)
  - 422 `validation_error`: CID ไม่ถูกต้อง (ไม่ครบ 13 หลัก)

---

## 2. Decision Log

- 2026-08-20 — Approved by project owner (ร่างเดิมใช้รหัส CR-079). Phase 1 ดำเนินการ Endpoints 1 และ 3; พัก Endpoint 2 (`booking`) รอระบบหลักของอีกทีม.
- 2026-08-31 — renumbered เป็น CR-098 เพื่อหลีกเลี่ยงการชนกับ CR-079 SOP what-if simulation

