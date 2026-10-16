---
id: CR-155
title: "Shelter Incident Log — doc type shelter_incident (Daily Occurrence Book, owner-based) · supersede CR-040"
status: approved
date: 2026-09-25
updated: 2026-10-08
requested_by: den (feature spec "ระบบบันทึกเหตุการณ์ประจำวันในศูนย์")
decided_by: kong (D1–D5, 2026-10-02 — PR #323 review; approved 2026-10-07)
layer: volatile
affects:
  - docs/data/schema.md §2.10 (`shelter_report` → `shelter_incident`, schema_v 1) · §7 index · §8 validation
  - docs/data/data-model.md · docs/data/schema-er-diagram.md (doc type `shelter_incident` แทน `shelter_report`)
  - docs/changes/08-E-reports/CR-040-shelter-case-grievance-reframe.md (status → superseded)
  - docs/prd/phase-r3-operations.md FR-47 · docs/prd/role-permission-matrix.md แถว FR-47 (สิทธิ์ราย record: owner / staff / SM)
  - docs/features/shelter-report-flow.md (แทนด้วย flow ของ incident log)
  - docs/task-breakdown/08-E-reports.md T-19 / T-33 · docs/sitemap.md (`/reports` → `/back-office/incidents`)
  - frontend/src/lib/features/incidents/** (domain · data · application · ui)
  - frontend/src/lib/server/shelter-access-design.ts (VDU allow-list + rules `shelter_incident` + ห้ามลบ)
  - frontend/src/lib/server/user-service.ts + src/routes/api/v1/shelters/[code]/staff (staff directory)
  - frontend/src/lib/auth/roles.ts `canAccessIncidents` · src/lib/guards/auth.ts `requireIncidents`
  - frontend/src/routes/(protected)/back-office/incidents/**
  - frontend/src/lib/components/backoffice-navbar/static.ts (เมนูหมวด 3)
  - tests: features/incidents/domain/incident.test.ts · data/incident.remote.test.ts · lib/server/shelter-access-design.incident.test.ts · lib/server/user-service.test.ts
why: แก้ปัญหา SM เป็นคอขวดในการเปิดเคสเหตุการณ์หน้างาน, เพิ่ม audit trail ในการส่งเวร, และแทนที่ shelter_report (CR-040) ทั้งหมด
migration: N/A — doc type ใหม่เข้าแทนที่ shelter_report (ยังไม่มี production data สำหรับ shelter_report) · ศูนย์ที่ provision แล้วต้อง redeploy `_design/access`
---

# CR-155: Shelter Incident Log — `shelter_incident`

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** doc type `shelter_incident:{ulid}` (schema_v 1) ใน `shelter_{code}` **แทน `shelter_report` (CR-040) ทั้งหมด** — สมุดบันทึกเหตุการณ์ประจำวัน: staff ทุกคนเปิดบันทึกได้และเป็นเจ้าของเคสทันที
- **เพื่อใคร/ทำไม:** ไม่ให้ SM เป็นคอขวด · ทุกการเปลี่ยนสถานะ/ส่งต่อมี Action & Reason ใน timeline · รองรับคู่กรณีที่ยังไม่ทราบตัวตนแล้วระบุภายหลัง
- **dev ต้อง build:** feature `incidents` + route `/back-office/incidents` (list ส่งเวร / สร้าง / detail + timeline + dialog) + VDU rules + endpoint รายชื่อ staff ในศูนย์
- **กระทบ:** CR-040 → `superseded` · `shelter_report` / `/reports` / `features/shelter-reports` ไม่ถูก build (ไม่มี data ให้ migrate) · บันทึกลบไม่ได้ — ยกเลิกผ่านสถานะ `cancelled` เท่านั้น

## Change — before → after (เทียบ CR-040 `shelter_report`)

| หัวข้อ              | Before (CR-040 `shelter_report`)                                      | After (`shelter_incident`)                                                                                 |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Doc type            | `shelter_report:{ulid}` schema_v 1 (ยังไม่ implement)                 | `shelter_incident:{ulid}` schema_v 1 — **แทนทั้งหมด** รวมเรื่อง grievance (D1)                             |
| หัวข้อ              | `subject` str req                                                     | `title` str req ≤120 · immutable · ใช้ค้นหา (IL-D12)                                                       |
| `kind`              | `grievance` \| `incident`                                             | ไม่มี — แยกด้วย `category` (IL-D4)                                                                         |
| ใครสร้าง            | `shelter_manager` เท่านั้น (+ SA)                                     | staff ทุกคนในศูนย์ (IL-P1)                                                                                 |
| ใครอัปเดตสถานะ      | SM                                                                    | เจ้าของเคส (`assigned_to`) หรือ SM/SA                                                                      |
| เจ้าของเคส          | `assignee_user_id` opt                                                | `assigned_to` req · default = `reported_by` · ส่งต่อได้พร้อมเหตุผล                                         |
| สถานะ               | `open → in_progress → resolved → closed` · `escalated` · forward-only | IL-S1 · `resolved → action_in_progress` (ปะทุซ้ำ) · SM ยกเลิกได้จาก `reported` / `action_in_progress` (D4) |
| Category            | 12 ค่า (`theft`, `violence`, `fire`, …)                               | 7 ค่า (IL-D4)                                                                                              |
| Severity            | `info`, `warning`, `critical`                                         | `low`, `medium`, `high`, `critical`                                                                        |
| บุคคลที่เกี่ยวข้อง  | `reporter{source,…}` + `evacuee_ids[]` + `pet_refs[]`                 | `complainant` (5 ประเภท) + `respondent` (4 สถานะ) แยกฝั่ง · ระบุตัวคู่กรณีภายหลังได้                       |
| Timeline            | `actions[{at,by,note}]`                                               | `timeline[{timestamp,actor_id,type,details,…}]` · 4 type · ทุก action ต้องมีเหตุผล                         |
| เลขอ้างอิง          | ไม่มี                                                                 | `incident_no` `INC-YYYYMMDD-NNN` (IL-D3)                                                                   |
| การลบ               | ไม่ระบุ                                                               | **ห้ามลบ** ทุก role (IL-P6)                                                                                |
| Escalate → referral | มี (atomic)                                                           | **ตัดออก** รอบนี้ (D5)                                                                                     |
| Route               | `/reports`                                                            | `/back-office/incidents` · เมนู sidebar หมวด "3. รายงานและการตรวจสอบ"                                      |

## Requirements

### Data (IL-D)

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-D1**  | `_id = shelter_incident:{ulid}` · `type = shelter_incident` · `schema_v = 1` · envelope มาตรฐาน (`shelter_code` = ศูนย์ที่เกิดเหตุ) · enum ทุกตัวเป็น `lower_snake_case` (D2)                                                                                                                                                                                                                                                            |
| **IL-D2**  | Field: `incident_no` str · `title` str (IL-D12) · `location_detail` str · `category` enum · `severity` enum · `occurred_at` ts · `reported_by` str (คงที่) · `assigned_to` str (default = `reported_by`) · `description` str · `attachments` [str] (`image:{ulid}`, default `[]`) · `current_status` enum · `complainant` · `respondent` · `timeline` []                                                                                 |
| **IL-D3**  | `incident_no` = `INC-YYYYMMDD-NNN` · `YYYYMMDD` = วันที่ Asia/Bangkok ตอนสร้าง · **วิธีออกเลข (client):** อ่าน `shelter_incident` ทั้งหมดของศูนย์ด้วย `_all_docs` prefix `shelter_incident:` (ชุดเดียวกับหน้า list) → หา `NNN` สูงสุดของวันนั้น → +1 (pad 3 หลัก) · **best-effort:** สองเครื่องสร้างพร้อมกันอาจได้เลขซ้ำ — ยอมรับได้ เพราะ identity คือ `_id` (ULID) และ `incident_no` ใช้แสดงผลเท่านั้น · ไม่ใช้ counter doc / sequence |
| **IL-D4**  | `category` ∈ `harassment_violence`, `theft_property_damage`, `substance_rule_violation`, `fraud_resource_abuse`, `medical_mental_health`, `dispute`, `other`                                                                                                                                                                                                                                                                             |
| **IL-D5**  | `severity` ∈ `low`, `medium`, `high`, `critical`                                                                                                                                                                                                                                                                                                                                                                                         |
| **IL-D6**  | `current_status` ∈ `reported`, `action_in_progress`, `resolved`, `closed`, `cancelled`                                                                                                                                                                                                                                                                                                                                                   |
| **IL-D7**  | `complainant = { type: evacuee\|staff\|external\|shelter_property\|anonymous, evacuee_id: str\|null, name_or_detail: str\|null }` · `evacuee` ต้องมี `evacuee_id` · `staff`/`external` ต้องมีชื่อ                                                                                                                                                                                                                                        |
| **IL-D8**  | `respondent = { status: known_evacuee\|known_external\|unknown\|none, evacuee_id, name_or_detail, unknown_description }` · `known_evacuee` ต้องมี `evacuee_id` · `known_external` ต้องมี `name_or_detail` · `unknown_description` คงไว้หลังระบุตัวตน (หลักฐาน)                                                                                                                                                                           |
| **IL-D9**  | `timeline[] = { timestamp, actor_id, type: status_change\|reassignment\|add_note\|identify_respondent, details, from_status?, to_status?, from_assignee?, to_assignee? }` · append-only · `details` ห้ามว่าง                                                                                                                                                                                                                             |
| **IL-D10** | หลังสร้าง field ข้อเท็จจริง (`incident_no`, `title`, `location_detail`, `category`, `severity`, `occurred_at`, `reported_by`, `description`, `attachments`, `complainant`) แก้ไม่ได้ — เปลี่ยนได้เฉพาะ `current_status`, `assigned_to`, `respondent`, `timeline` ผ่าน action                                                                                                                                                             |
| **IL-D11** | **ระบุคู่กรณีภายหลัง (late binding):** เปลี่ยน `respondent.status` ได้ **ครั้งเดียว** จาก `unknown` → `known_evacuee` หรือ `known_external` ผ่าน entry `identify_respondent` เท่านั้น · ห้ามเปลี่ยนกลับเป็น `unknown` และห้ามเปลี่ยนจาก `none` / `known_*` · บังคับที่ VDU: entry type อื่นต้องคง `respondent` เดิมทุก field และ `identify_respondent` ต้องมี `oldDoc.respondent.status = unknown`                                       |
| **IL-D12** | **หัวข้อเหตุการณ์ `title`:** str **req** · trim · 1–120 ตัวอักษร · แก้ไม่ได้หลังสร้าง (IL-D10) · ใช้เป็นหัวเรื่องในหน้ารวม/รายละเอียด และเป็น key หลักของการค้นหา (IL-U1) · UI แนะนำไม่ใส่ชื่อ-นามสกุลผู้เสียหาย (แสดงให้ staff ทุกคนในศูนย์) · **อ่านแบบ tolerant:** doc ที่สร้างก่อนมี field (dev data — ลบไม่ได้ตาม IL-P6) ไม่มี `title` → แสดงชื่อหมวดหมู่แทน · ไม่ bump `schema_v` (ยังไม่มีข้อมูล production)                      |

### Status (IL-S)

| ID        | Requirement                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-S1** | Transitions: `reported → action_in_progress \| cancelled` · `action_in_progress → resolved \| cancelled` · `resolved → closed \| action_in_progress` · `closed`, `cancelled` = terminal |
| **IL-S2** | ทุกการเปลี่ยนสถานะ = หนึ่ง timeline entry `status_change` (from/to + เหตุผล)                                                                                                            |
| **IL-S3** | เคส terminal แก้ไม่ได้ทุกกรณี (รวม note) · **ไม่มีการลบ** — เอกสารไม่ถูกลบในทุกสถานะ เคสที่แจ้งเท็จ/ซ้ำให้ SM ยกเลิกเป็น `cancelled` (IL-P6)                                            |

### Permissions (IL-P) — บังคับทั้ง client policy และ CouchDB VDU

| Action                                              | Owner (`assigned_to`) | Staff ในศูนย์ | SM / SA   |
| --------------------------------------------------- | --------------------- | ------------- | --------- |
| สร้าง (เป็น owner อัตโนมัติ)                        | ✅                    | ✅            | ✅        |
| เปลี่ยนสถานะ + note                                 | ✅ เคสตัวเอง          | ❌            | ✅ ทุกเคส |
| เพิ่มบันทึกสังเกตการณ์                              | ✅                    | ✅            | ✅        |
| ส่งต่อ / มอบหมาย                                    | ✅                    | ❌            | ✅        |
| ระบุคู่กรณี (unknown → known)                       | ✅                    | ❌            | ✅        |
| ปิดเคส (ทุก severity — D3)                          | ✅                    | ❌            | ✅        |
| ยกเลิก (จาก `reported` / `action_in_progress` — D4) | ❌                    | ❌            | ✅        |
| ลบเอกสาร                                            | ❌                    | ❌            | ❌        |

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-P1** | "Staff ในศูนย์" = user ที่มี `shelter:{code}` (ทุก capability) หรือ `system_admin`                                                                                                                                                                                                                                                                          |
| **IL-P2** | "Manager" = `{code}:shelter_manager` หรือ `system_admin`                                                                                                                                                                                                                                                                                                    |
| **IL-P3** | VDU create: ต้อง `reported_by = assigned_to = created_by = userCtx.name`, `current_status = reported`, `timeline = []`, `title` เป็น string ไม่ว่าง ≤120 ตัวอักษร                                                                                                                                                                                           |
| **IL-P4** | VDU update: ต้องต่อท้าย timeline **หนึ่ง** entry ที่ `actor_id = userCtx.name` และ entry type ต้องสอดคล้องกับ field ที่เปลี่ยน · `oldDoc` สถานะ terminal → reject ทุก update                                                                                                                                                                                |
| **IL-P5** | Endpoint `GET /api/v1/shelters/{code}/staff` คืน `{ name, display_name }[]` เฉพาะ user ที่ **active**, มี **capability อย่างน้อย 1 ตัวของศูนย์นั้น** (`{code}:<cap>` หรือ legacy bare cap ของ user ศูนย์เดียว) และ **ไม่ใช่บัญชีอาสาสมัคร** (`personnel_type ≠ volunteer`) — ไม่คืน contact/PII · caller ต้องอยู่ใน scope ศูนย์หรือ SA (ใช้เลือกผู้รับช่วง) |
| **IL-P6** | VDU delete: ถ้า `oldDoc.type = shelter_incident` และ `newDoc._deleted = true` → **reject ทุก role** (รวม `system_admin`) · ยกเว้นเฉพาะ CouchDB `_admin` ซึ่ง VDU ข้ามทั้งหมดตามกลไกของ CouchDB (ใช้สำหรับงาน ops เท่านั้น)                                                                                                                                  |

### UI (IL-U)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IL-U1** | `/back-office/incidents` — ช่องค้นหาข้อความ (case-insensitive substring บน `title`, `incident_no`, `location_detail` — ใช้ร่วมกับ filter อื่น · กรองใน client จากชุด `_all_docs` เดียวกัน ไม่ต้องมี index) · ตารางใช้ `title` เป็นคอลัมน์หลัก · default filter "ยังไม่ปิด" (status ∉ closed/cancelled) สำหรับส่งเวร · filter status/severity/category/"เฉพาะเคสของฉัน" · **sort in-memory บน client** (ไม่ใช้ Mango sort — `severity` เป็น string enum เรียงตามตัวอักษรไม่ตรงลำดับความรุนแรง): rank `critical`=0 → `high` → `medium` → `low` แล้ว `occurred_at` ใหม่→เก่า · โหลดด้วย `_all_docs` prefix `shelter_incident:` (ไม่ต้องมี Mango index / view) · ถ้าจำนวนต่อศูนย์โตจนกระทบ performance → เปิด CR ใหม่เพื่อเพิ่ม view ที่ emit `[status_bucket, severity_rank, occurred_at]` |
| **IL-U2** | `/back-office/incidents/new` — ช่องแรก "หัวข้อเหตุการณ์ *" · ไม่บังคับผู้เข้าพัก · ช่องตามประเภทฝ่าย (ค้นหา evacuee / ชื่อ / รูปพรรณ) · หลังบันทึก → detail + toast                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **IL-U3** | `/back-office/incidents/{id}` — ข้อมูล, สองฝั่งคู่กรณี, timeline ใหม่→เก่า, ปุ่มเฉพาะ action ที่ actor มีสิทธิ์ · ทุก action เปิด dialog บังคับกรอกเหตุผล                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **IL-U4** | เมนู "บันทึกเหตุการณ์ประจำวัน" ใน sidebar back-office หมวด "3. รายงานและการตรวจสอบ" — แสดงให้ทุก staff (IL-P1); สิทธิ์จริงตัดสินที่ route guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Acceptance

- [ ] staff ที่ไม่ใช่ SM สร้างเคสได้ และเป็น `assigned_to`
- [ ] owner: reported → action_in_progress → resolved → closed ได้ พร้อม note ทุกขั้น; ข้ามขั้นถูก reject (client + VDU)
- [ ] owner ปิดเคส `critical` ได้ (D3)
- [ ] staff อื่นเพิ่ม note ได้ แต่เปลี่ยนสถานะ/ส่งต่อไม่ได้ (VDU 403)
- [ ] owner ส่งต่อให้ staff B → B เปลี่ยนสถานะได้, owner เดิมไม่ได้
- [ ] owner ยกเลิกไม่ได้ · SM ยกเลิกได้จาก `reported` และ `action_in_progress` · ยกเลิกจาก `resolved` ไม่ได้ (D4)
- [ ] เคส `unknown` → ระบุเป็น `known_evacuee` หรือ `known_external` ได้ครั้งเดียว + timeline `identify_respondent` · ระบุซ้ำ / กลับเป็น `unknown` ถูก reject (IL-D11)
- [ ] เคส closed/cancelled แก้อะไรไม่ได้
- [ ] ลบเอกสาร `shelter_incident` ไม่ได้ทุก role รวม SA (VDU 403 `Cannot delete shelter_incident documents`)
- [ ] staff ศูนย์อื่นเขียนไม่ได้
- [ ] สร้างเคสโดยไม่กรอกหัวข้อ / หัวข้อเกิน 120 ตัวอักษรไม่ได้ (client + VDU) · แก้หัวข้อหลังสร้างไม่ได้ (VDU 403 `title is immutable`)
- [ ] พิมพ์ส่วนหนึ่งของหัวข้อ / เลขที่บันทึก / จุดเกิดเหตุในช่องค้นหาแล้วเจอเคส
- [ ] รายชื่อผู้รับช่วงไม่มีบัญชีอาสาสมัคร / user ที่ไม่มี capability ในศูนย์

## Decisions (เคาะโดย kong · 2026-10-02 · PR #323)

| #   | หัวข้อ                 | คำตัดสิน                                                            |
| --- | ---------------------- | ------------------------------------------------------------------- |
| D1  | ความสัมพันธ์กับ CR-040 | **(b) แทน `shelter_report` ทั้งหมด** — CR-040 → `superseded`        |
| D2  | รูปแบบค่า enum         | **(a) `lower_snake_case`** ตาม convention ของ `schema.md`           |
| D3  | สิทธิ์ปิดเคส           | **ตัดข้อจำกัด** — owner ปิดได้ทุก severity รวม `critical`           |
| D4  | SM ยกเลิกเคส           | ได้ทั้งจาก `reported` และ `action_in_progress` (แจ้งเท็จ / ซ้ำซ้อน) |
| D5  | Escalate → referral    | **ตัดออก** รอบนี้                                                   |
| D6  | วิธี track             | CR ไฟล์ (draft ใน `docs/changes/`) — 2026-09-28                     |

## Open (ไม่บล็อก merge — ยกเป็น CR ถัดไปถ้าต้องการ)

- **O1 — หมวดเรื่องร้องทุกข์:** หลัง D1 เรื่อง grievance เดิมของ CR-040 (เช่น `food_service`, `facility`, `staff_conduct`, `privacy`, `noise`) ไม่มีหมวดตรงใน IL-D4 → ตอนนี้ลง `other` · ต้องการเพิ่มหมวดหรือไม่
- **O2 — แก้คู่กรณีที่ระบุผิดคน:** IL-D11 ล็อกให้ระบุได้ครั้งเดียว · ถ้าต้องการให้แก้ได้พร้อมเหตุผล ต้องเพิ่ม entry type ใหม่ (เช่น `correct_respondent`)
- **O3 — เปิดเคสที่ปิดแล้วใหม่ (reopen จาก `closed`)** ยังไม่รองรับ — ตอนนี้ทำได้แค่ `resolved → action_in_progress`

## Out of scope (รอบนี้)

- Upload `attachments` (field มีแล้ว, UI รอบถัดไป)
- Escalate → referral (D5)
- Behavior Flag บน Evacuee Profile · Safety Heatmap (spec §6 next phase)

## Why

- CR-040 ให้ SM mutate คนเดียว → คอขวดเมื่อเหตุเกิดหน้างานตอน SM ไม่อยู่
- ต้องมี audit trail ว่าใครทำอะไรเพราะอะไร สำหรับส่งเวรและตรวจสอบย้อนหลัง
- เคสลักขโมยส่วนใหญ่เปิดตอนยังไม่รู้ตัวผู้กระทำ — ต้อง late-bind โดยไม่แก้ประวัติเดิม
- แยกผู้เสียหาย/คู่กรณี เพื่อไม่ให้ผู้เสียหายติดประวัติพฤติกรรมเชิงลบ (ใช้ต่อใน Behavior Flag)

## Impact

| ส่วน                                                          | สิ่งที่ต้องแก้                                                                                                                                                        | สถานะใน branch `feat/shelter-incident-log`    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `docs/data/schema.md`                                         | §2.10 `shelter_report` → `shelter_incident` (field ตาม IL-D) · §7 ตัด index ของ `shelter_report` (incident ไม่ต้องมี Mango index — IL-U1) · §8 state machine + ห้ามลบ | อัปเดตแล้ว 2026-10-08                         |
| `docs/data/data-model.md` · `schema-er-diagram.md`            | แทนแถว `shelter_report` ด้วย `shelter_incident`                                                                                                                       | อัปเดตแล้ว 2026-10-08                         |
| `docs/changes/CR-040-…` · `_index.md`                         | `status: superseded` + link มา CR นี้                                                                                                                                 | อัปเดตแล้ว 2026-10-08                         |
| `docs/prd/` FR-47 · `role-permission-matrix.md`               | สิทธิ์ราย record (owner / staff / SM)                                                                                                                                 | อัปเดตแล้ว 2026-10-08                         |
| `docs/features/shelter-report-flow.md`                        | แทนด้วย flow incident log                                                                                                                                             | อัปเดตแล้ว 2026-10-08 (flow doc → superseded) |
| `docs/task-breakdown/08-E-reports.md` · `docs/sitemap.md`     | T-19/T-33 · route `/back-office/incidents`                                                                                                                            | อัปเดตแล้ว 2026-10-08                         |
| `features/incidents/**`                                       | domain · data · application · ui (D3/D4 แล้ว)                                                                                                                         | implement แล้ว                                |
| `lib/server/shelter-access-design.ts`                         | VDU allow-list + rules (IL-P3/P4/P6, IL-D11)                                                                                                                          | implement แล้ว                                |
| `lib/server/user-service.ts` + `api/v1/shelters/[code]/staff` | staff directory (IL-P5)                                                                                                                                               | implement แล้ว                                |
| `lib/auth/roles.ts` · `lib/guards/auth.ts`                    | `canAccessIncidents` · `requireIncidents`                                                                                                                             | implement แล้ว                                |
| `routes/(protected)/back-office/incidents/**` + sidebar       | IL-U1–U4                                                                                                                                                              | implement แล้ว                                |
| Tests                                                         | domain 23 · VDU 14 · remote 3 · staff directory 1                                                                                                                     | ผ่าน (`pnpm test`)                            |
| Deploy                                                        | redeploy `_design/access` ทุกศูนย์ที่ provision แล้ว                                                                                                                  | dev แล้ว · staging/prod หลัง merge            |

## Migration

N/A — doc type ใหม่. ไม่มี `shelter_report` ใน production (CR-040 ยังไม่ถูก implement) → ไม่ต้อง backfill. ศูนย์ที่ provision แล้วต้อง redeploy `_design/access` (`pnpm redeploy:access --write --confirm`) เพื่อให้ VDU รู้จัก `shelter_incident` และกฎห้ามลบ.

## Decision log

- 2026-09-25 — proposed (implementation อยู่ใน branch `feat/shelter-incident-log`)
- 2026-09-27 — route ย้ายจาก `/onsite/incidents` → `/back-office/incidents` + เมนู sidebar หมวด 3 (IL-U4)
- 2026-09-28 — D6: track ด้วย CR ไฟล์ (draft) · เพิ่ม section Change (before→after) + Impact
- 2026-10-02 — PR #323 review: kong เคาะ D1(b) supersede CR-040 · D2(a) lower_snake · D3 owner ปิดได้ทุก severity · D4 SM ยกเลิกจาก `action_in_progress` ได้ · D5 ตัด escalate · เพิ่ม IL-P6 ห้ามลบ (VDU) · ระบุวิธี sort (IL-U1) / ออกเลข (IL-D3) / late binding (IL-D11) · IL-P5 ตัดบัญชีอาสาสมัคร · เติม `why` / `migration` ใน frontmatter
- 2026-10-03 — เพิ่ม `title` (หัวข้อเหตุการณ์, IL-D12) + ช่องค้นหาในหน้ารวม (IL-U1) — owner อนุมัติให้ implement แล้ว; ยังอยู่ใน schema_v 1
- 2026-10-05 — PR #323 review รอบ 2: resolve conflict markers (คงฉบับ 2026-10-03 ที่มี D1–D5 + IL-D12 เท่านั้น) · IL-D1 ไม่อ้าง `shelter_id` แล้ว
- 2026-10-07 — approved: รันเลข CR-155 ตาม branch develop; ปรับสถานะเป็น approved
- 2026-10-08 — apply canonical docs: schema.md §2.10/§7/§8 · data-model · ER · PRD FR-47 + glossary · role-permission-matrix · sitemap §2.8 · 08-E T-19/T-33 · 09-F / _timeline wording · schema-v3 status · shelter-report-flow.md → superseded (status คง `approved` จนกว่าโค้ดจะ merge → `done`)
