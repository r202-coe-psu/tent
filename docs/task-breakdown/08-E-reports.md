---
title: "Task Breakdown — Module E — Shelter Incident Log"
status: active
created: 2026-06-05
updated: 2026-10-08
module: E
note: >
  CR-155 — Shelter Incident Log (`shelter_incident`) แทน Shelter Report (`shelter_report`, CR-040)
  ทั้งหมด รวมเรื่องร้องทุกข์ · staff ทุกคนเปิดบันทึกได้ · ไม่มี escalate → referral ในรอบนี้.
  ดู docs/changes/CR-155-shelter-incident-log.md + docs/data/schema.md §2.10
---

# Module E — Shelter Incident Log

> สมุดบันทึกเหตุการณ์ประจำวัน (`shelter_incident`) — ไม่ใช่ security gate / occupancy monitoring

- **Team owner:** Team B — พีค, โฮป, ปิ๊ก (ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R2, R3
- **Design input (บริษัท):** P-01 (ส่งมอบแล้ว), P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026
- **Spec:** [CR-155](../changes/CR-155-shelter-incident-log.md) (แทน [CR-040](../changes/CR-040-shelter-case-grievance-reframe.md)) · [schema.md §2.10](../data/schema.md)

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-19 | ⬜ | Groundwork: `shelter_incident` schema + VDU rules + staff directory | prep R3 | R2 | prod | ส.ค. | 6 | ÷1.25 | 5 | T-02 |
| T-33 | ⬜ | Shelter incident log: list ส่งเวร / create / detail + timeline actions | FR-47 | R3 | prod | ส.ค. | 6 | ÷1.6 | 4 | T-19 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **12** |  | **9** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-19 — Groundwork: `shelter_incident` schema + VDU rules + staff directory (prep R3)

**Description:** ลงทะเบียน doc type `shelter_incident` (schema.md §2.10, CR-155) — domain schema/state machine/policy, กฎ `validate_doc_update` (create · append timeline ทีละหนึ่ง entry · สิทธิ์ owner/staff/SM · ห้ามลบ) และ endpoint `GET /api/v1/shelters/{code}/staff` สำหรับเลือกผู้รับช่วง

**Definition of Done:**
- Domain (Zod schema, transitions, policy) กับ VDU บังคับกฎชุดเดียวกัน (IL-D / IL-S / IL-P ใน CR-155) — มี test ทั้งสองฝั่ง
- VDU reject การลบ `shelter_incident` ทุก role รวม SA
- Staff directory คืนเฉพาะ staff ที่ active มี capability ในศูนย์ และไม่ใช่บัญชีอาสาสมัคร (IL-P5)
- ขั้น deploy: `pnpm redeploy:access --write --confirm` ทุกศูนย์ที่ provision แล้ว
- **นอกขอบเขต T-19:** UI, escalate → referral (D5)

### T-33 — Shelter incident log UI (FR-47)

**Description:** feature `incidents` + route `/back-office/incidents` (`/new`, `/{id}`): staff ทุกคนในศูนย์เปิดบันทึกและเป็นเจ้าของเคส · เจ้าของเคส/SM เปลี่ยนสถานะ ส่งต่อ ระบุคู่กรณี ปิดเคส · SM ยกเลิก · ทุก action กรอกเหตุผลลง timeline — **ไม่ทำ** security gate check-in/out และหน้า monitoring occupancy

**Definition of Done:**
- List: default "ยังไม่ปิด" (ส่งเวร) · filter status/severity/category/"เฉพาะเคสของฉัน" · ค้นหา `title`/`incident_no`/จุดเกิดเหตุ · sort severity แล้ว `occurred_at` (IL-U1)
- Create: ไม่บังคับผู้เข้าพัก · complainant/respondent แยกฝั่ง · respondent `unknown` ได้ (IL-U2)
- Detail: timeline ใหม่→เก่า · แสดงเฉพาะปุ่มที่ actor มีสิทธิ์ · ทุก action เปิด dialog บังคับเหตุผล (IL-U3)
- เมนู sidebar หมวด 3 + ทางเข้าสำหรับ staff ทุก role (IL-U4)
- **ห้าม** เขียน `movement` / อัปเดต occupancy จาก Module E
- Acceptance ตาม CR-155 ผ่านด้วยบัญชี staff จริง (ไม่ใช่ CouchDB `_admin`)

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R2 | 6 | 5 |
| R3 | 6 | 4 |
| **รวม** | **12** | **9** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-02` (Data-model expansion) — module **Platform/Core**
- `T-06` / people — ค้นหาผู้เข้าพักสำหรับ complainant/respondent (อ่านอย่างเดียวผ่าน barrel)
