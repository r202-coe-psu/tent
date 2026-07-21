---
title: "Task Breakdown — Module E — Shelter Report Cases"
status: active
created: 2026-06-05
updated: 2026-07-16
module: E
note: >
  CR-040 (2026-07-15) — reframe จาก Security check-in/out → Shelter Report Case
  (ร้องเรียน/ร้องทุกข์/ติดตามเคส). Doc type `shelter_report_case`. ดู
  docs/changes/CR-040-shelter-case-grievance-reframe.md +
  docs/features/shelter-case-grievance-flow.md
---

# Module E — Shelter Report Cases

> grievance / incident case tracking (`shelter_report_case`) — ไม่ใช่ security gate / occupancy monitoring

- **Team owner:** Team B — พีค, โฮป, ปิ๊ก (ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R2, R3
- **Design input (บริษัท):** P-01 (ส่งมอบแล้ว), P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026
- **Spec:** [CR-040](../changes/CR-040-shelter-case-grievance-reframe.md) · [feature flow](../features/shelter-case-grievance-flow.md)

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-19 | ⬜ | Groundwork: shelter_report_case schema + case↔referral handoff | prep R3 | R2 | prod | ส.ค. | 6 | ÷1.25 | 5 | T-02 |
| T-33 | ⬜ | Shelter report case intake + list/detail + escalate (atomic) | FR-47 | R3 | prod | ส.ค. | 6 | ÷1.6 | 4 | T-19 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **12** |  | **9** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-19 — Groundwork: shelter_report_case schema + case↔referral handoff (prep R3)

**Description:** งานเตรียม R3: ลงทะเบียน doc type `shelter_report_case` (state machine ตาม CR-040), category/severity whitelist, forward-only status, `pet_refs` shape, mutate allow-list (`SHELTER_REPORT_CASE_MUTATE_ROLES` = SM ใน R3 + SA override), และสัญญา **escalate atomic → referral** ร่วม Module F (T-34) — ไม่ใช่ feature ที่ end-user ใช้ครบ

**Definition of Done:**
- Schema `shelter_report_case` (field + transitions + indexes) ผ่าน review Lead และสอดคล้อง T-02 / `schema.md` หลัง CR-040 approve
- สัญญา escalate: สร้าง `referral` สำเร็จก่อนตั้ง `status=escalated` + `escalation.referral_id` (ห้าม escalated ไร้ referral_id); recovery path เมื่อ partial fail ระบุชัด
- Mutate permission = allow-list คงที่เดียว (ขยายบทบาทภายหลังได้โดยไม่เปลี่ยน schema) — R3 default = `shelter_manager` (+ `system_admin` override)
- ข้อสรุปเพียงพอให้ T-33 / T-34 เริ่ม build โดยไม่ redesign
- **นอกขอบเขต T-19:** UI list/create, occupancy/monitoring, check-in/out

### T-33 — Shelter report case intake + list/detail + escalate (FR-47)

**Description:** สร้าง feature `shelter-report-cases` + route `/cases`: SM เปิดเคสร้องเรียน/เหตุการณ์ ติดตามสถานะและ timeline มอบหมาย และ escalate ไป referral แบบ atomic — อ้างอิงคน/สัตว์เป็น related refs จาก People (T-06/T-07) **ไม่ทำ** security gate check-in/out และ **ไม่ทำ** หน้า monitoring “ใครอยู่ในศูนย์ / ออกแล้วยังไม่กลับ”

**Definition of Done:**
- CRUD/lifecycle ตาม [feature flow SC-\*](../features/shelter-case-grievance-flow.md): สร้าง grievance + incident, filter status/severity, **default sort = severity แล้ว occurred_at**, detail + append `actions[]`, transition forward-only
- Mutate เฉพาะ role ใน allow-list (R3: SM) ใน shelter scope; SA override; REG/KS/WS เข้าไม่ได้จนกว่าจะขยาย allow-list
- `pet_refs` = `{ household_id, pet_index }` validate กับ household; `evacuee_ids` จาก people barrel
- Escalate (UI confirm) → สร้าง referral atomic → เคส `escalated` มี `referral_id` (SC-D8)
- **ห้าม** เขียน `movement` / อัปเดต occupancy จาก Module E; **ไม่มี** UI present/overdue roster
- Demo: J1 (grievance → resolved) + J3 (escalate) เมื่อ referral พร้อม; unit test transition / whitelist / pet_ref / allow-list helper

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R2 | 6 | 5 |
| R3 | 6 | 4 |
| **รวม** | **12** | **9** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-02` (Data-model expansion) — module **Platform/Core**
- `T-06` / people movement — อ่านผู้เกี่ยวข้องเท่านั้น (ไม่เขียนจาก Module E)
- `T-07` Pet/asset — `pet_refs` อ้าง household pets
- `T-34` Referral & hand-off — ปลายทาง escalate (atomic contract จาก T-19)
