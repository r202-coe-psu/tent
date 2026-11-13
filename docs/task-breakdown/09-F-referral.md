---
title: "Task Breakdown — Module F — Referral"
status: active
created: 2026-06-05
updated: 2026-11-11 # draft CR referral-m5 — ส่งต่อผู้ป่วยผ่าน M5 (scope release ปัจจุบัน D2, ข้อยกเว้น PDPA D1, medical_staff D8) · CR-167/CR-168 — sent→closed, close_reason, bulk endpoint, shelter-closure worker (DoD line เท่านั้น; ยังไม่เพิ่ม T-id)
module: F
note: decision-synced 2026-06-15 — task details and DoD maintained directly in Markdown
---

# Module F — Referral

> referral & hand-off (capacity/resource/medical) — owned by shelter_manager (FD-13)

- **Team owner:** Team D — เน, ภูดิท, วิลเลียม (Referral; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R3
- **Design input (บริษัท):** P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID   | Status | Feature / Task                                  | FR    | Phase | Stage | Scope | Raw MD | AI×  | Adj MD | Depends |
| ---- | ------ | ----------------------------------------------- | ----- | ----- | ----- | ----- | ------ | ---- | ------ | ------- |
| T-34 | 🔄     | Referral & hand-off (capacity/resource/medical) | FR-48 | R3    | prod  | ส.ค.  | 6      | ÷1.6 | 4      | T-19    |
|      |        | **รวมทั้งโมดูล**                                |       |       |       |       | **6**  |      | **4**  |         |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-34 — Referral & hand-off (capacity/resource/medical) (FR-48)

**Description:** ระบบส่งต่อและบูรณาการตาม source Module F: สร้างคำขอส่งต่อเมื่อศูนย์เต็ม (ย้ายผู้ประสบภัยทีละคนตาม `evacuee_id` ไปศูนย์อื่น — R3 ไม่ย้ายทั้งครัวเรือนในครั้งเดียว), ทรัพยากรขาด (ขอสนับสนุน/โอนของ ผูก T-13), หรือผู้ป่วยฉุกเฉิน — ทุก case มี hand-off record ตรวจสอบย้อนหลังได้; เจ้าของ flow = `shelter_manager` (FD-13) **Scope R3 = referral ภายในเครือข่ายศูนย์ในระบบ** — การเชื่อมหน่วยงานภายนอกเต็มรูปไปทาง EOC/Open API ใน R4 (ASSUMPTION ใน PRD FR-48)

**Definition of Done:**

- สร้าง referral 3 ประเภท (capacity / resource / medical-emergency) พร้อมเหตุผล, ต้นทาง, ปลายทาง, ความเร่งด่วน — สิทธิ์สร้าง/อนุมัติเป็นของ shelter_manager ตาม FD-13
- State machine ครบตาม `docs/data/schema.md`: draft → sent → accepted/rejected → closed และ **draft → closed** (ยกเลิกร่างก่อนส่ง — CR-046); **ปลายทาง**ตอบรับ/ปฏิเสธพร้อมเหตุผลได้ (capacity ต้องปลายทางกดรับก่อนย้าย — CR-045) · **sent → closed** (ถอนคำขอ, ต้นทางเท่านั้น — [CR-167](../changes/09-F-referral/CR-167-referral-withdraw-close-reason-bulk.md)); เหตุผลปิดเก็บที่ `close_reason` แยกจาก `response_reason`; bulk ใน list ผ่าน `bulk-transition`; flow ปิดศูนย์ด้วย worker job ([CR-168](../changes/09-F-referral/CR-168-referral-shelter-closure-worker.md))
- Medical referral: อยู่ใน internal shelter scope เท่านั้น; public/FAM/EOC/Open API ไม่ได้รับ medical detail หรือ national ID ทุกกรณี (FR-48/NFR-5, ใช้ RBAC/`redactForScope` จาก T-01/T-34)
  - **ข้อยกเว้น M5 ([draft CR referral-m5](../changes/draft-referral-m5-hospital-integration.md) D1):** ใบโหมด "ส่งผ่าน M5" ส่งชื่อ เลขบัตรประชาชน อายุ และอาการไปยัง สธ. ผ่านระบบ M5 ในฐานะผู้ให้การรักษา · ประกอบ payload ฝั่ง server เท่านั้น · บันทึกทุกการเรียกใน `m5_outbound_logs` (ไม่เก็บ payload) · โหมด "ติดตามอย่างเดียว" ไม่ส่งข้อมูลออกเหมือนเดิม
- ส่งต่อผู้ป่วยผ่าน M5 อยู่ใน scope release ปัจจุบัน (D2): staff เลือกโหมดต่อชุด, ส่งหลายคนเป็นชุดเดียว (`batch_id`), สถานะมาจาก M5 ผ่าน sync worker, แจ้งรถออก / ถอนทั้งชุด, ผู้ป่วยที่รถออกแล้วเป็น `temporary_leave` — รายละเอียดใน `docs/data/schema.md` §5.4 และ `api-contract.md` §2.10, §5.4
- สิทธิ์ referral ทางการแพทย์: shelter_manager และ medical_staff ของศูนย์ต้นทาง (D8) · medical_staff เห็นเฉพาะ `medical-emergency` (D16)
- ส่งต่อ capacity สำเร็จ → ผู้ประสบภัย (`evacuee_id`) ย้ายศูนย์แล้วยอด occupancy สองฝั่งถูกต้อง (ไม่ claim การย้ายทั้งครัวเรือนใน R3)
- Test state machine + demo ส่งต่อครบ 1 case ต่อประเภท

## Effort by phase (Adj MD)

| Phase   | Raw MD | Adj MD |
| ------- | ------ | ------ |
| R3      | 6      | 4      |
| **รวม** | **6**  | **4**  |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- ~~`T-19` (Groundwork: shelter_report schema + report↔referral handoff)~~ — CR-155 ตัด escalate → referral ออก (D5); Module E ไม่สร้าง referral ในรอบนี้
