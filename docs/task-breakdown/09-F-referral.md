---
title: "Task Breakdown — Module F — Referral"
status: active
created: 2026-06-05
updated: 2026-07-22 # CR-045 referral schema & full DoD alignment
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

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-34 | 🔄 | Referral & hand-off (capacity/resource/medical) | FR-48 | R3 | prod | ส.ค. | 6 | ÷1.6 | 4 | T-19 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **6** |  | **4** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-34 — Referral & hand-off (capacity/resource/medical) (FR-48)

**Description:** ระบบส่งต่อและบูรณาการตาม source Module F: สร้างคำขอส่งต่อเมื่อศูนย์เต็ม (ย้ายครัวเรือนไปศูนย์อื่น), ทรัพยากรขาด (ขอสนับสนุน/โอนของ ผูก T-13), หรือผู้ป่วยฉุกเฉิน — ทุก case มี hand-off record ตรวจสอบย้อนหลังได้; เจ้าของ flow = `shelter_manager` (FD-13) **Scope R3 = referral ภายในเครือข่ายศูนย์ในระบบ** — การเชื่อมหน่วยงานภายนอกเต็มรูปไปทาง EOC/Open API ใน R4 (ASSUMPTION ใน PRD FR-48)

**Definition of Done:**
- สร้าง referral 3 ประเภท (capacity / resource / medical-emergency) พร้อมเหตุผล, ต้นทาง, ปลายทาง, ความเร่งด่วน — สิทธิ์สร้าง/อนุมัติเป็นของ shelter_manager ตาม FD-13
- State machine ครบตาม `docs/data/schema.md`: draft → sent → accepted/rejected → closed (ติดตามได้จนปิด); ปลายทางตอบรับ/ปฏิเสธพร้อมเหตุผลได้
- Medical referral: อยู่ใน internal shelter scope เท่านั้น; public/FAM/EOC/Open API ไม่ได้รับ medical detail หรือ national ID ทุกกรณี (FR-48/NFR-5, ใช้ RBAC/redaction จาก T-01)
- ส่งต่อ capacity สำเร็จ → ครัวเรือนย้ายศูนย์แล้วยอด occupancy สองฝั่งถูกต้อง
- Test state machine + demo ส่งต่อครบ 1 case ต่อประเภท

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R3 | 6 | 4 |
| **รวม** | **6** | **4** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-19` (Groundwork: shelter_report schema + report↔referral handoff) — module **Module E — Shelter Reports** (CR-040)
