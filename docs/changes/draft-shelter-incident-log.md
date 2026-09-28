---
id: draft
title: "Shelter Incident Log — doc type shelter_incident (Daily Occurrence Book, owner-based)"
status: proposed
date: 2026-09-25
updated: 2026-09-28
requested_by: project owner (feature spec "ระบบบันทึกเหตุการณ์ประจำวันในศูนย์")
decided_by: <เจ้าของโครงการ — รอเคาะ>
layer: volatile
affects:
  - docs/data/schema.md §2 (เพิ่ม `shelter_incident`, schema_v 1) · ความสัมพันธ์กับ §2.10 `shelter_report` (ดู NEEDS DECISION D1)
  - docs/data/data-model.md (ตาราง doc type)
  - docs/prd/role-permission-matrix.md แถว Security Incidents (สิทธิ์ต่อ record: owner / staff / SM)
  - docs/features/ (flow spec ใหม่ หรือแก้ shelter-report-flow.md — ตาม D1)
  - docs/sitemap.md (route `/back-office/incidents`)
  - frontend/src/lib/features/incidents/** (domain · data · application · ui)
  - frontend/src/lib/server/shelter-access-design.ts (VDU allow-list + rules `shelter_incident`)
  - frontend/src/lib/server/user-service.ts + src/routes/api/v1/shelters/[code]/staff (staff directory)
  - frontend/src/lib/auth/roles.ts `canAccessIncidents` · src/lib/guards/auth.ts `requireIncidents`
  - frontend/src/routes/(protected)/back-office/incidents/**
  - frontend/src/lib/components/backoffice-navbar/static.ts (เมนูหมวด 3)
  - tests: features/incidents/domain/incident.test.ts · data/incident.remote.test.ts · lib/server/shelter-access-design.incident.test.ts
---

# Shelter Incident Log — `shelter_incident`

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่ม doc type `shelter_incident:{ulid}` (schema*v 1) ใน `shelter*{code}` — สมุดบันทึกเหตุการณ์ประจำวัน: staff ทุกคนเปิดบันทึกได้และเป็นเจ้าของเคสทันที
- **เพื่อใคร/ทำไม:** ไม่ให้ SM เป็นคอขวด · ทุกการเปลี่ยนสถานะ/ส่งต่อมี Action & Reason ใน timeline · รองรับคู่กรณีที่ยังไม่ทราบตัวตนแล้วระบุภายหลัง
- **dev ต้อง build:** feature `incidents` + route `/back-office/incidents` (list ส่งเวร / สร้าง / detail + timeline + dialog) + VDU rules + endpoint รายชื่อ staff ในศูนย์
- **กระทบ:** doc type ใหม่ (ไม่มี migration) · ขัดกับ CR-040 D-WHO-CREATE (SM-only) สำหรับ incident — ต้องเคาะ D1

## Change — before → after (เทียบ CR-040 `shelter_report` สำหรับเรื่องประเภท incident)

| หัวข้อ              | Before (CR-040 `shelter_report`, `kind=incident`)                     | After (`shelter_incident`)                                                                                                    |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Doc type            | `shelter_report:{ulid}` schema_v 1 (ยังไม่ implement)                 | `shelter_incident:{ulid}` schema_v 1 — doc type ใหม่ (ตาม D1(a))                                                              |
| ใครสร้าง            | `shelter_manager` เท่านั้น (+ SA)                                     | staff ทุกคนในศูนย์ (IL-P1)                                                                                                    |
| ใครอัปเดตสถานะ      | SM                                                                    | เจ้าของเคส (`assigned_to`) หรือ SM/SA                                                                                         |
| เจ้าของเคส          | `assignee_user_id` opt                                                | `assigned_to` req · default = `reported_by` · ส่งต่อได้พร้อมเหตุผล                                                            |
| สถานะ               | `open → in_progress → resolved → closed` · `escalated` · forward-only | `reported → action_in_progress → resolved → closed` · `resolved → action_in_progress` (ปะทุซ้ำ) · `reported → cancelled` (SM) |
| Category            | 12 ค่า (`theft`, `violence`, `fire`, …)                               | 7 ค่า (IL-D4)                                                                                                                 |
| Severity            | `info`, `warning`, `critical`                                         | `low`, `medium`, `high`, `critical`                                                                                           |
| บุคคลที่เกี่ยวข้อง  | `reporter{source,…}` + `evacuee_ids[]` + `pet_refs[]`                 | `complainant` (5 ประเภท) + `respondent` (4 สถานะ) แยกฝั่ง · ระบุตัวคู่กรณีภายหลังได้                                          |
| Timeline            | `actions[{at,by,note}]`                                               | `timeline[{timestamp,actor_id,type,details,…}]` · 4 type · ทุก action ต้องมีเหตุผล                                            |
| เลขอ้างอิง          | ไม่มี                                                                 | `incident_no` `INC-YYYYMMDD-NNN`                                                                                              |
| Escalate → referral | มี (atomic)                                                           | ไม่มีในรอบนี้ (D5)                                                                                                            |
| Route               | `/reports`                                                            | `/back-office/incidents` · เมนู sidebar หมวด "3. รายงานและการตรวจสอบ"                                                         |

`shelter_report` (CR-040) คงไว้สำหรับ `kind=grievance` จนกว่า D1 จะเคาะเป็นแบบอื่น

## Requirements

### Data (IL-D)

| ID         | Requirement                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-D1**  | `_id = shelter_incident:{ulid}` · `type = shelter_incident` · `schema_v = 1` · envelope มาตรฐาน (`shelter_code` = ศูนย์ที่เกิดเหตุ แทน `shelter_id`)                                                                                                                                                                              |
| **IL-D2**  | Field: `incident_no` str · `location_detail` str · `category` enum · `severity` enum · `occurred_at` ts · `reported_by` str (คงที่) · `assigned_to` str (default = `reported_by`) · `description` str · `attachments` [str] (`image:{ulid}`, default `[]`) · `current_status` enum · `complainant` · `respondent` · `timeline` [] |
| **IL-D3**  | `incident_no` = `INC-YYYYMMDD-NNN` ตามวันที่ Asia/Bangkok ตอนสร้าง · running ต่อศูนย์ต่อวัน · **best-effort** (สองเครื่องพร้อมกันอาจได้เลขซ้ำ — identity คือ `_id`)                                                                                                                                                               |
| **IL-D4**  | `category` ∈ `harassment_violence`, `theft_property_damage`, `substance_rule_violation`, `fraud_resource_abuse`, `medical_mental_health`, `dispute`, `other`                                                                                                                                                                      |
| **IL-D5**  | `severity` ∈ `low`, `medium`, `high`, `critical`                                                                                                                                                                                                                                                                                  |
| **IL-D6**  | `current_status` ∈ `reported`, `action_in_progress`, `resolved`, `closed`, `cancelled`                                                                                                                                                                                                                                            |
| **IL-D7**  | `complainant = { type: evacuee\|staff\|external\|shelter_property\|anonymous, evacuee_id: str\|null, name_or_detail: str\|null }` · `evacuee` ต้องมี `evacuee_id` · `staff`/`external` ต้องมีชื่อ                                                                                                                                 |
| **IL-D8**  | `respondent = { status: known_evacuee\|known_external\|unknown\|none, evacuee_id, name_or_detail, unknown_description }` · `known_evacuee` ต้องมี `evacuee_id` · `known_external` ต้องมีชื่อ · `unknown_description` คงไว้หลังระบุตัวตน (หลักฐาน)                                                                                 |
| **IL-D9**  | `timeline[] = { timestamp, actor_id, type: status_change\|reassignment\|add_note\|identify_respondent, details, from_status?, to_status?, from_assignee?, to_assignee? }` · append-only · `details` ห้ามว่าง                                                                                                                      |
| **IL-D10** | หลังสร้าง field ข้อเท็จจริง (`incident_no`, `location_detail`, `category`, `severity`, `occurred_at`, `reported_by`, `description`, `attachments`, `complainant`) แก้ไม่ได้ — เปลี่ยนได้เฉพาะ `current_status`, `assigned_to`, `respondent`, `timeline` ผ่าน action                                                               |

### Status (IL-S)

| ID        | Requirement                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-S1** | Transitions: `reported → action_in_progress \| cancelled` · `action_in_progress → resolved` · `resolved → closed \| action_in_progress` · `closed`, `cancelled` = terminal |
| **IL-S2** | ทุกการเปลี่ยนสถานะ = หนึ่ง timeline entry `status_change` (from/to + เหตุผล)                                                                                               |
| **IL-S3** | เคส terminal แก้ไม่ได้ทุกกรณี (รวม note)                                                                                                                                   |

### Permissions (IL-P) — บังคับทั้ง client policy และ CouchDB VDU

| Action                        | Owner (`assigned_to`) | Staff ในศูนย์ | SM / SA   |
| ----------------------------- | --------------------- | ------------- | --------- |
| สร้าง (เป็น owner อัตโนมัติ)  | ✅                    | ✅            | ✅        |
| เปลี่ยนสถานะ + note           | ✅ เคสตัวเอง          | ❌            | ✅ ทุกเคส |
| เพิ่มบันทึกสังเกตการณ์        | ✅                    | ✅            | ✅        |
| ส่งต่อ / มอบหมาย              | ✅                    | ❌            | ✅        |
| ระบุคู่กรณี (unknown → known) | ✅                    | ❌            | ✅        |
| ปิดเคส                        | ✅ ยกเว้น `critical`  | ❌            | ✅        |
| ยกเลิก                        | ❌                    | ❌            | ✅        |

| ID        | Requirement                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-P1** | "Staff ในศูนย์" = user ที่มี `shelter:{code}` (ทุก capability) หรือ `system_admin`                                                                               |
| **IL-P2** | "Manager" = `{code}:shelter_manager` หรือ `system_admin`                                                                                                         |
| **IL-P3** | VDU: create ต้อง `reported_by = assigned_to = created_by = userCtx.name`, `current_status = reported`, `timeline = []`                                           |
| **IL-P4** | VDU: update ต้องต่อท้าย timeline **หนึ่ง** entry ที่ `actor_id = userCtx.name` และ entry type ต้องสอดคล้องกับ field ที่เปลี่ยน                                   |
| **IL-P5** | Endpoint `GET /api/v1/shelters/{code}/staff` คืน `{ name, display_name }[]` ของ user active ใน scope — caller ต้องอยู่ใน scope ศูนย์หรือ SA (ใช้เลือกผู้รับช่วง) |

### UI (IL-U)

| ID        | Requirement                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-U1** | `/back-office/incidents` — default filter "ยังไม่ปิด" (status ∉ closed/cancelled) สำหรับส่งเวร · filter status/severity/category/"เฉพาะเคสของฉัน" · sort severity (critical ก่อน) แล้ว `occurred_at` ใหม่→เก่า |
| **IL-U2** | `/back-office/incidents/new` — ไม่บังคับผู้เข้าพัก · ช่องตามประเภทฝ่าย (ค้นหา evacuee / ชื่อ / รูปพรรณ) · หลังบันทึก → detail + toast                                                                          |
| **IL-U3** | `/back-office/incidents/{id}` — ข้อมูล, สองฝั่งคู่กรณี, timeline ใหม่→เก่า, ปุ่มเฉพาะ action ที่ actor มีสิทธิ์ · ทุก action เปิด dialog บังคับกรอกเหตุผล                                                      |
| **IL-U4** | เมนู "บันทึกเหตุการณ์ประจำวัน" ใน sidebar back-office หมวด "3. รายงานและการตรวจสอบ" — แสดงให้ทุก staff (IL-P1); สิทธิ์จริงตัดสินที่ route guard                                                                |

## Acceptance

- [ ] staff ที่ไม่ใช่ SM สร้างเคสได้ และเป็น `assigned_to`
- [ ] owner: reported → action_in_progress → resolved → closed ได้ พร้อม note ทุกขั้น; ข้ามขั้นถูก reject (client + VDU)
- [ ] staff อื่นเพิ่ม note ได้ แต่เปลี่ยนสถานะ/ส่งต่อไม่ได้ (VDU 403)
- [ ] owner ส่งต่อให้ staff B → B เปลี่ยนสถานะได้, owner เดิมไม่ได้
- [ ] owner ยกเลิกไม่ได้ · SM ยกเลิกจาก reported ได้ · owner ปิดเคส critical ไม่ได้
- [ ] เคส `unknown` → ระบุเป็น evacuee ได้ครั้งเดียว + timeline `identify_respondent`
- [ ] เคส closed/cancelled แก้อะไรไม่ได้
- [ ] staff ศูนย์อื่นเขียนไม่ได้

## NEEDS DECISION (รอเจ้าของโครงการ)

- **D1 — ความสัมพันธ์กับ CR-040 `shelter_report`:** (a) `shelter_incident` แยก doc type, `shelter_report` เหลือ grievance (as-built ใน branch นี้) · (b) แทน `shelter_report` ทั้งหมด (supersede CR-040) · (c) รวมเป็น `shelter_report` schema_v 2
- **D2 — ค่า enum:** spec ต้นทางใช้ UPPER_CASE (`REPORTED`, `KNOWN_EVACUEE`…); as-built ใช้ lower_snake ตาม convention ของ schema.md
- **D3 — "ปิดได้ (เคสทั่วไป)":** as-built ตีความว่า owner ปิด `critical` ไม่ได้ (SM เท่านั้น) — ยืนยันหรือตัดออก
- **D4 — SM ยกเลิกได้เฉพาะจาก `reported`** ตาม state diagram — ต้องยกเลิกจาก `action_in_progress` ได้ด้วยหรือไม่
- **D5 — Escalate → referral** (มีใน CR-040) ไม่อยู่ใน spec ใหม่ — ไม่ implement ในรอบนี้
- ~~**D6 — วิธี track**~~ → เคาะแล้ว 2026-09-28: CR ไฟล์ (draft ใน `docs/changes/`)

## Out of scope (รอบนี้)

- Upload `attachments` (field มีแล้ว, UI รอบถัดไป)
- Behavior Flag บน Evacuee Profile · Safety Heatmap (spec §6 next phase)

## Why

- CR-040 ให้ SM mutate คนเดียว → คอขวดเมื่อเหตุเกิดหน้างานตอน SM ไม่อยู่
- ต้องมี audit trail ว่าใครทำอะไรเพราะอะไร สำหรับส่งเวรและตรวจสอบย้อนหลัง
- เคสลักขโมยส่วนใหญ่เปิดตอนยังไม่รู้ตัวผู้กระทำ — ต้อง late-bind โดยไม่แก้ประวัติเดิม
- แยกผู้เสียหาย/คู่กรณี เพื่อไม่ให้ผู้เสียหายติดประวัติพฤติกรรมเชิงลบ (ใช้ต่อใน Behavior Flag)

## Impact

| ส่วน                                                          | สิ่งที่ต้องแก้                                                           | สถานะใน branch `feat/shelter-incident-log` |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `docs/data/schema.md`                                         | เพิ่ม § `shelter_incident` (field ตาม IL-D) · note ความสัมพันธ์กับ §2.10 | รอ approve                                 |
| `docs/data/data-model.md`                                     | เพิ่มแถว doc type `shelter_incident`                                     | รอ approve                                 |
| `docs/prd/role-permission-matrix.md`                          | แถว Security Incidents → สิทธิ์ราย record (owner / staff / SM)           | รอ approve                                 |
| `docs/features/`                                              | flow spec ใหม่ หรือแก้ `shelter-report-flow.md` (ตาม D1)                 | รอ approve                                 |
| `docs/sitemap.md`                                             | route `/back-office/incidents`                                           | รอ approve                                 |
| `features/incidents/**`                                       | domain · data · application · ui                                         | implement แล้ว                             |
| `lib/server/shelter-access-design.ts`                         | VDU allow-list + rules `shelter_incident` (IL-P3/P4)                     | implement แล้ว                             |
| `lib/server/user-service.ts` + `api/v1/shelters/[code]/staff` | staff directory (IL-P5)                                                  | implement แล้ว                             |
| `lib/auth/roles.ts` · `lib/guards/auth.ts`                    | `canAccessIncidents` · `requireIncidents`                                | implement แล้ว                             |
| `routes/(protected)/back-office/incidents/**` + sidebar       | IL-U1–U4                                                                 | implement แล้ว                             |
| Tests                                                         | domain 22 · VDU 12 · remote 3                                            | ผ่าน (`pnpm test`)                         |
| Deploy                                                        | redeploy `_design/access` ทุกศูนย์ที่ provision แล้ว                     | หลัง merge                                 |

## Migration

N/A — doc type ใหม่. ศูนย์ที่ provision แล้วต้อง redeploy `_design/access` (`pnpm redeploy:access` หรือ admin redeploy) เพื่อให้ VDU รู้จัก `shelter_incident`.

## Decision log

- 2026-09-25 — proposed (implementation แบบ D1(a) อยู่ใน branch `feat/shelter-incident-log` รอเคาะ)
- 2026-09-27 — route ย้ายจาก `/onsite/incidents` → `/back-office/incidents` + เมนู sidebar หมวด 3 (IL-U4)
- 2026-09-28 — D6: track ด้วย CR ไฟล์ (draft) · เพิ่ม section Change (before→after) + Impact
