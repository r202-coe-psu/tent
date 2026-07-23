---
id: CR-040
title: "Module E reframe — Security check-in/out → Shelter Report (kind: grievance | incident)"
status: done
date: 2026-07-15
updated: 2026-07-23
approved_on: 2026-07-23
done_on: 2026-07-23
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/prd/phase-r3-operations.md FR-47 (+ JTBD §2.1)
  - docs/prd/role-permission-matrix.md FR-47 row / wording
  - docs/task-breakdown/08-E-reports.md T-19 / T-33
  - docs/sitemap.md §2.8 `/security-events` → `/reports`
  - docs/data/schema.md §2.10 (`security_event` → `shelter_report`)
  - docs/data/data-model.md · schema-er-diagram.md
  - docs/features/shelter-report-flow.md
  - schema_v shelter_report 1 (ตั้งต้น; แทน security_event ที่ยังไม่ implement)
  - frontend → features/shelter-reports (หลัง approve)
  - Notion T-19 / T-33 wording (sync หลัง approve)
---

# CR-040 — Module E: Shelter Report (grievance / incident)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** Reframe Module E (FR-47) จาก “security check-in/out + safety monitoring” เป็น **ระบบเปิดและติดตามรายงานในศูนย์** (`shelter_report`) — หน่วยหลัก = **Report** · แยกประเภทด้วย **`kind`**: `grievance` | `incident` — ตัดหน้าที่ซ้ำกับ People movement/occupancy
- **เพื่อใคร/ทำไม:** SM เป็นผู้ดูแลศูนย์โดยไม่มี Security Officer role; product ที่ใช้จริงคือ **รับเรื่อง → มอบหมาย → ปิด / escalate (atomic กับ referral)**
- **dev ต้อง build อะไร:** feature `shelter-reports` — list/สร้าง/อัปเดต + timeline · persist `shelter_report:{ulid}` · route `/reports` · mutate = SM (allow-list scalable) + SA platform override
- **กระทบ schema/scope:** แทน `security_event` (§2.10) ด้วย `shelter_report` (state machine, schema_v 1) · **`done` 2026-07-23** — canonical docs apply แล้ว; โค้ดยังรอ T-19/T-33

## Why

- FR-47 + DoD T-33 วาง “security check-in/out” และ monitoring present/overdue ซึ่ง **ซ้อนกับ movement + occupancy**
- `security_event` เป็น incident log ไม่ใช่ gate check-in — ชื่อ FR กับ data model ไม่ตรงกัน
- ไม่มี role `security_officer` (CR-002) → โมเดลรายงานร้องเรียน/เหตุการณ์เข้ากับงาน SM
- “ดูแลคนและสัตว์” คงเป็น **related refs บนรายงาน** ไม่ใช่ live roster
- ยังไม่มี implementation ของ `security_event` → เปลี่ยน shape ได้โดยไม่ migrate data จริง
- ชื่อผลิตภัณฑ์ควรเป็น **Report** (ไม่ใช่ Case) — grievance กับ incident เป็น `kind` ชั้นเดียวกัน

## Decisions locked

| # | หัวข้อ | คำตัดสิน | วันที่ |
| --- | --- | --- | --- |
| 1 | Doc naming | **`shelter_report`** (`_id` / `type`) — ไม่ใช้ชื่อเปล่า `report` | 2026-07-23 |
| 2 | Kind / ประเภท | Field **`kind`**: `grievance` \| `incident` — **ห้าม** field ชื่อ `type` (ชน CouchDB `type`) | 2026-07-23 |
| 3 | Public / self-service | **ปิด** — staff intake เท่านั้น (ไม่มี PUB endpoint) | 2026-07-15 |
| 4 | ใคร mutate ได้ | **R3: `shelter_manager` เท่านั้น** (shelter ops) · สิทธิ์ผ่าน **allow-list คงที่ในโค้ด** เพื่อขยายบทบาทภายหลังโดยไม่ redesign · **`system_admin` = platform override** ตามแพทเทิร์นโปรเจกต์ | 2026-07-15 |
| 5 | `pet_refs` | **`(household_id, pet_index)`** อ้าง `household.pets[]` | 2026-07-15 |
| 6 | Escalate | **Atomic** — สร้าง `referral` สำเร็จแล้วค่อยตั้ง `status=escalated` + `escalation.referral_id` ในลำดับ fail-safe เดียวกัน | 2026-07-15 |
| 7 | List sort | **`severity` ก่อน** (critical → warning → info) แล้ว `occurred_at` ใหม่→เก่า | 2026-07-15 |
| 8 | Route / feature | **`/reports`** · Module E — Shelter Reports · `features/shelter-reports` | 2026-07-23 |

> 2026-07-23 — supersede ชื่อเดิม `shelter_report_case` / `/cases` / Shelter Report Case (ยังไม่เคย apply schema)

## Change

### A. FR-47 (before → after)

| | Before | After |
| --- | --- | --- |
| ชื่อ | Security Check-in/out & Safety Monitoring | **Shelter Report — grievance / incident** |
| หน้าที่หลัก | เฝ้าเข้า–ออก + monitoring present + log เหตุ | **เปิดรายงาน · ติดตามสถานะ · timeline · ปิดหรือ escalate** |
| ประเภทเรื่อง | (ไม่ชัด) | **`kind`**: grievance (ร้องเรียน/ร้องทุกข์) · incident (เหตุที่ staff/SM บันทึก) |
| Occupancy / overdue | อยู่ใน DoD Module E | **อยู่นอก Module E** — People/movement |
| สัตว์เลี้ยง | monitoring คน+สัตว์ | **related party** บนรายงาน (`pet_refs`) |
| CCTV / hardware | open question | **นอก scope** — manual intake |

**Consequences (testable):**

1. SM เปิดรายงานใน scope ศูนย์ได้ (ผู้พักร้องผ่านปากเปล่า / staff พบเองที่ SM บันทึก)
2. ทุก report ต้องมี `kind` ∈ {`grievance`,`incident`}
3. สถานะ forward-only ตาม §C
4. เก็บ kind/category/severity/zone/ผู้เกี่ยวข้อง/actions
5. Escalate → สร้าง `referral` **atomic** แล้วตั้ง `escalated` (medical detail ไม่หลุดนอก shelter scope)
6. ไม่มี write path ใน Module E สำหรับ check-in/out หรือนับ occupancy

### B. Doc type (before → after)

| | Before (`security_event`) | After (`shelter_report`) |
| --- | --- | --- |
| `_id` | `security_event:{ulid}` | `shelter_report:{ulid}` |
| Mutability | append-only | **state machine** (forward-only; pattern `referral`) |
| Focus | snapshot เหตุ | รายงานติดตามจนปิด/escalate · แยกประเภทด้วย `kind` |

### C. `shelter_report` — `shelter_report:{ulid}` · schema_v 1

> Apply ลง `schema.md §2.10` หลัง approve. Flow เต็ม: [`docs/features/shelter-report-flow.md`](../features/shelter-report-flow.md)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `kind` | enum(`grievance`,`incident`) | req | **field หลักแยกประเภท** — grievance = ร้องเรียน/ร้องทุกข์; incident = เหตุที่ staff/SM บันทึก |
| `category` | enum (whitelist) | req | ดูด้านล่าง |
| `severity` | enum(`info`,`warning`,`critical`) | req | ความเร่งด่วน / ความรุนแรง |
| `status` | enum(`open`,`in_progress`,`resolved`,`closed`,`escalated`) | req | forward-only |
| `subject` | str | req | หัวข้อสั้น |
| `description` | str | req | รายละเอียด |
| `zone` | str\|null | opt | โซนที่เกี่ยวข้อง |
| `reporter` | `{ source: enum(evacuee,staff,anonymous,other), evacuee_id?:str, display_name?:str, contact?:str }` | req | ใครร้อง/ใครพบ |
| `evacuee_ids` | [str] | opt | default `[]` |
| `pet_refs` | [{`household_id`:str, `pet_index`:int≥0}] | opt | อ้าง `household.pets[]` — ไม่ duplicate pet doc |
| `assignee_user_id` | str\|null | opt | Couch `_users` name |
| `actions` | [{`at`:ts, `by`:str, `note`:str}] | req | timeline — append เท่านั้น |
| `escalation` | `{ referral_id:str, reason?:str }\|null` | opt | เมื่อ `escalated` **ต้องมี** `referral_id` |
| `occurred_at` | ts | req | เวลาเกิดเหตุ / เวลาร้อง |
| `closed_at` | ts\|null | opt | ตั้งเมื่อ `resolved`/`closed` |

**Category whitelist:**

`theft` · `violence` · `fire` · `intrusion` · `lost_person` · `pet_related` · `facility` · `food_service` · `staff_conduct` · `noise` · `privacy` · `other`

**Status transitions (forward-only):**

```
open → in_progress → resolved → closed
open → in_progress → escalated
open → resolved → closed
open → escalated
* ห้ามย้อนกลับ — แก้ผิด = เปิดรายงานใหม่ + อ้างรายงานเดิมใน description/actions
```

**Escalate (atomic):**

1. สร้าง `referral` (draft→… ตาม Module F) ให้สำเร็จก่อน  
2. อัปเดตรายงาน: `escalation.referral_id` + `status=escalated` (+ action note)  
3. ถ้าข้อ 2 ล้มเหลวหลังข้อ 1 สำเร็จ → ต้องมี recovery path ที่ระบุใน T-19 (เช่น เก็บ referral_id ใน action / ไม่ทิ้ง orphan โดยเงียบ) — **ห้าม** ตั้ง `escalated` โดยไม่มี `referral_id`

**Index:** `(status, occurred_at)` · `(severity, status)` · `(kind, status)` · `(assignee_user_id, status)`

### D. Task / planning (T-19 / T-33)

| Task | After (หลัง approve) |
| --- | --- |
| T-19 | Groundwork: `shelter_report` schema + atomic escalate↔referral + allow-list permission note |
| T-33 | Intake + list (sort severity) + detail timeline + escalate · filter/create by `kind` |

### E. Routes / naming

| Before | After |
| --- | --- |
| `/security-events` | `/reports` |
| Module “Security” | Module E — **Shelter Reports** (feature dir: `shelter-reports`) |
| (draft กลางทาง) `/cases` · `shelter_report_case` | **superseded** — ใช้ `/reports` · `shelter_report` |

### F. Permissions (scalable allow-list)

```
SHELTER_REPORT_MUTATE_ROLES = ['shelter_manager']   // R3 — ขยาย array เมื่อมี CR permission
// system_admin: อนุญาตผ่าน platform override (requireAdmin ∥ role ∈ MUTATE_ROLES)
```

- **อ่าน/เขียน/escalate ชั้นศูนย์:** เฉพาะ role ใน `SHELTER_REPORT_MUTATE_ROLES` ที่อยู่ใน shelter scope  
- **R3 ค่าเริ่มต้น:** เฉพาะ `shelter_manager`  
- **ขยายภายหลัง** (เช่น เพิ่ม `registration_staff`): แก้ allow-list + role-permission-matrix ผ่าน CR ใหม่ — **ไม่ต้องเปลี่ยน schema**  
- **ไม่เปิด PUB** · ไม่มี RoleKey ใหม่

## Impact

| Artifact | หลัง approve |
| --- | --- |
| `schema.md` §2.10 | แทน `security_event` → `shelter_report`; ถอดจาก append-only list; เพิ่ม forward-only status rule + `kind` |
| data-model / ER | rename + mutability |
| PRD R3 FR-47 + JTBD | ข้อความ Shelter Report / ตัด security check-in wording |
| role-permission-matrix | แถว FR-47 = Shelter report; หมายเหตุ mutate = SM (+ SA override) |
| `08-E-reports.md` | DoD T-19/T-33 |
| `sitemap.md` | `/reports` |
| feature flow | draft → active เมื่อ CR approved |
| Code | `features/shelter-reports/` ใหม่ |

## Migration

- ไม่มี `security_event` จาก production feature → ไม่ backfill  
- ไม่มี `shelter_report_case` ใน prod (ชื่อร่างก่อน 2026-07-23) → ไม่ migrate  
- หลัง approve: `schema_v shelter_report = 1`; ห้ามสร้าง `security_event` ใหม่  

## Open decisions

*ไม่มีค้าง* — ล็อกครบ (รวม rename Report + kind 2026-07-23)

## Decision log

- 2026-07-15 — proposed (reframe Module E → report case). Track = ไฟล์ CR + feature flow
- 2026-07-15 — owner ล็อก: (1) `shelter_report_case` (2) no PUB (3) SM mutate + scalable allow-list + SA override (4) pet_refs household_id+index (5) escalate atomic (6) list sort by severity then occurred_at
- 2026-07-15 — sync **task-breakdown** `08-E-cases.md` (T-19/T-33) + cross-refs `_index` / `09-F` / `02-people` / `_timeline` / `teamplanning` + Notion T-19/T-33 title+DoD
- 2026-07-15 — **ยังไม่ apply** schema.md / PRD FR-47 / role-matrix / sitemap จนกว่า `status: approved`
- 2026-07-23 — **rename ผลิตภัณฑ์:** หน่วยหลัก = **Report** · doc type **`shelter_report`** · `kind` = grievance|incident · route `/reports` · feature `shelter-reports` — supersede `shelter_report_case` / `/cases` / Shelter Report Case · sync `08-E-reports.md` + `shelter-report-flow.md`
- 2026-07-23 — **approved** โดย project owner · ขั้นถัดไป: apply schema.md / PRD FR-47 / role-matrix / sitemap + feature flow `active` → แล้วปิด `done`
- 2026-07-23 — **apply canonical + `done`:** schema.md §2.10 · data-model · ER · PRD FR-47/JTBD/glossary/scope · role-matrix · sitemap `/reports` · kickoff · squad-roster · schema-v3 status · feature flow active
