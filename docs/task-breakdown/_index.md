---
title: "Task Breakdown by Module — Index"
status: active
created: 2026-06-05
updated: 2026-07-15
note: decision-synced 2026-07-15 — CR-033 remote-first; Markdown task-breakdown = planning source; technical source = docs/data/schema.md + data-model.md + api-contract.md
---

# Task Breakdown by Module

เอกสารชุดนี้คือ **master task breakdown** ราย module / feature (FD-15) — แทนที่ `prd/task-breakdown.md` เดิม (deprecated/ลบแล้ว 2026-06-11). โครงสร้างทีม = 2 Lead + 4 ทีม × 3 คน; **K-13 ปิดแล้วตาม [Team Planning & Balancing](teamplanning.md)**.
Planning source ปัจจุบัน = Markdown ใน `docs/task-breakdown/` โดยตรง. Technical source = [`docs/data/schema.md`](../data/schema.md), [`docs/data/data-model.md`](../data/data-model.md), [`docs/data/api-contract.md`](../data/api-contract.md).

**→ [Dependencies & Timeline](_timeline.md)** — ลำดับ dependency + gantt (mermaid).
**→ [Glossary & Technical Terms](glossary.md)** — สรุปความหมายตัวย่อและศัพท์เทคนิคในโครงการ.
**→ [Team Planning & Balancing](teamplanning.md)** — ข้อเสนอแนะการจัดสรรโมดูลและแบ่งงานให้ 4 ทีม.

## Schedule & Deadline

- **Greenfield:** ยังไม่มีระบบ MVP ที่ใช้งานจริงมาก่อน (มีเพียง CouchDB PoC) — คำว่า "MVP/baseline" ในเอกสารชุดนี้และ PRD หมายถึง **baseline scope FR-1–20** (auth, person registration, screening, person QR/movement, dashboard, remote-first continuity — spec ใน `docs/features/`) ซึ่งต้อง **build เป็นส่วนแรกของ foundation** ก่อนที่ R2 จะต่อยอด
- ✅ **ปิดช่องว่างแล้ว (เคาะ 2026-06-11):** baseline FR-1–20 มี T-task ของตัวเองแล้ว — [module 0 Baseline](00-baseline.md) (T-47..T-55, 37 Adj MD) ยอดรวมใหม่ = **250 Adj MD**; estimate เคาะจริงใน workshop (K-16)
- **Data layer ([CR-033](../changes/CR-033-remote-first-architecture-program-index.md) เคาะ 2026-07-07; baseline task sync 2026-07-15):** ระบบหลักเป็น **remote-first** — write ไป active endpoint โดยตรง (Central ก่อนเสมอ, LAN Edge fallback ตอน WAN/Central ล่ม, active ได้ครั้งละหนึ่ง); **deny** PouchDB / local-first / local-only write queue; disconnected = status-only; public tier และ EOC/Open API read-model ใช้ **MongoDB projection** จาก Central CouchDB (ดู [10-eoc](10-eoc.md))
- **Kickoff:** 2026-06-10 · **Workshop (ทีมเริ่มงาน):** 2026-06-17
- **In-scope** (Baseline + R2 + R3 + Family Search + governance): ส่งมอบภายใน **สิงหาคม 2026** (2026-08-31), **go-live full program กันยายน** (สัปดาห์ 1)
- **Deferred** (EOC aggregate API, Open API, SOP simulation, inventory polish): ส่งมอบหลัง go-live
- **Hard deadline งาน feature = สัปดาห์ที่ 2 กันยายน 2026 (2026-09-14)** — ไม่มีงาน feature ใหม่เลยกรอบนี้
- **หลัง 14/09:** รับ feedback + แก้ไข (maintenance/bug-fix) ต่อเนื่อง **จนครบกำหนดโครงการ 12 เดือน** [ASSUMPTION: นับจากเริ่มโครงการ มิ.ย. 2026 → สิ้นสุดราว มิ.ย. 2027 — ยืนยันวันที่จริงกับสัญญาโครงการ]

## Canonical Decisions (sync 2026-07-15)

| Decision | Status |
| --- | --- |
| K-12 role-permission matrix | ✅ Approved 5 internal roles: `system_admin`, `shelter_manager`, `registration_staff`, `kitchen_staff`, `warehouse_staff` — `volunteer` ไม่ใช่ RoleKey (CR-002) |
| K-13 team assignment | ✅ Closed per `teamplanning.md`: Lead = แจ็ก/เด่น; Team A = Donation+Volunteer; Team B = People+Family Search+Security; Team C = Supply+Kitchen; Team D = SOP+Referral |
| K-14 Open API contract owner | เปิดแบบมี owner — PM/SA + ศูนย์คอม; implementation รอ P-03 contract/sign-off |
| K-15 family search consent | ✅ Opt-out: default `privacy.search_excluded=false`, opt-out audit required |
| K-16 estimates | เปิดแบบควบคุม — ใช้ Adj MD ปัจจุบันเป็น baseline planning แล้ว recalibrate หลัง sprint แรก |
| K-17 EOC aggregate datastore | ✅ MongoDB projection จาก Central CouchDB |
| CR-033 remote-first | ✅ Approved — deny PouchDB/local-first/offline draft; Central-first + Edge fallback; disconnected status-only; retry 3 + banner; live-update = app event channel |

## Standard DoD

- **Prod task:** UI + data/write path + validation + role/shelter-scope permission + tests + demo slice
- **Public task:** rate-limit/anti-enumeration + no-PII/no-medical/no-national-ID tests + production CAPTCHA gate when public-facing
- **Post/gate task:** artifact + UAT/sign-off + known issues / handover note

## Progress Summary (ณ 2026-07-15)

> Legend — ✅ done · 🔄 in progress/partial · ⬜ not started

**Walking skeleton (10–17 มิ.ย.) — done (CR-033 reframe):**

- ✅ Auth/RBAC kernel: roles, guards, auth store (`$lib/auth/`, `$lib/guards/`, `$lib/stores/`)
- ✅ Remote CouchDB access layer + repository pattern + app-level event channel (`$lib/db/`) — **ไม่ใช้ PouchDB** ([CR-033](../changes/CR-033-remote-first-architecture-program-index.md))
- ✅ CouchDB `_session` cookie auth + Central-first remote write design
- ✅ Shared typed errors + API utilities (`$lib/utils/`)
- ✅ Login/logout, me profile, health check, register (server-only)
- ✅ **Shelters** CRUD + admin UI + auto-assign shelter_code + seed shelter_sh001 (`features/shelters`)
- ✅ **Users** management BFF `/api/v1/users` + admin UI (`features/users`)

**Baseline (module 0):** T-47 🔄 · T-54 🔄 (central remote path done; Edge failover follow-up) · T-48..55 ดู implement ใน repo  
**Platform/Core (module 1):** T-01 🔄 · T-02 🔄 · T-03 🔄 · gate/post ⬜  
**Modules 2–12:** มีความคืบหน้าหลายโมดูลในโค้ด — tracking ละเอียดอยู่ใน Notion + โมดูลไฟล์

## Modules

| #   | Module                                    | Tasks | Adj MD  | Phase      | Target                 |
| --- | ----------------------------------------- | ----- | ------- | ---------- | ---------------------- |
| 0   | [Baseline (FR-1–20)](00-baseline.md)      | 9     | 37      | Foundation | ก.ค. (Foundation Gate) |
| 1   | [Platform/Core](01-core.md)               | 12    | 78      | R2, R3, R4 | ส.ค.                   |
| 2   | [Household & Zoning](02-people.md)        | 6     | 18.5    | R2         | ส.ค.                   |
| 3   | [Module C — Supply & Inventory](03-C.md)  | 6     | 19.5    | R2, R4     | ส.ค. + deferred tail   |
| 4   | [Donation](04-donation.md)                | 7     | 25.5    | R2, R3     | ส.ค.                   |
| 5   | [Module D — Kitchen & Food](05-D.md)      | 4     | 15.5    | R2, R3     | ส.ค.                   |
| 6   | [Module A — Volunteer](06-A.md)           | 2     | 7.5     | R3         | ส.ค.                   |
| 7   | [Module B — SOP & Resource Calc](07-B.md) | 5     | 21.5    | R2, R3, R4 | ส.ค. + deferred tail   |
| 8   | [Module E — Shelter Report Cases](08-E.md) | 2    | 9       | R2, R3     | ส.ค. (CR-040)          |
| 9   | [Module F — Referral](09-F.md)            | 1     | 4       | R3         | ส.ค.                   |
| 10  | [EOC + Open API (Part 3)](10-eoc.md)      | 3     | 13.5    | R4         | ก.ย. wk2 (deferred)    |
| 11  | [Family Search](11-famsearch.md)          | 2     | 9       | R4         | ส.ค.                   |
| 12  | [Public Portal (PUB tier)](12-public.md)  | 3     | 11.5    | R3         | ส.ค. (CR-005)          |
|     | **รวม (prod+post นักศึกษา)**              |       | **270** |            |                        |

> **CR-005 (2026-06-22) — public-tier scope:** +Module 12 Public Portal (T-57/58/59, +11.5) · Donation +T-60 `/donate` wizard (+5.5) · Family Search T-41 `/search` bump (+1.5) → ยอดรวม 250 → **268.5 Adj MD** (provisional, recalibrate K-16). `/search` (FAM) ขยาย exposure surface, `/donate` (DN) ต้องการ donation schema_v 1→2 + `donation_slot` §2.13. ดูรายละเอียด [CR-005](../changes/CR-005-public-portal-landing-public-metrics.md).
> **CR-006 (2026-06-22) — SOP master/override:** Module B T-30 +1.5 Adj MD (master+override surface) → 268.5 → **270 Adj MD**.

## Pre-production design (บริษัท — แยก capacity)

| ID   | Phase | ครอบคลุม module                                                                                       | กำหนดส่ง                                          |
| ---- | ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| P-01 | R2    | Household & Zoning, Supply & Inventory, Donation, Platform/Core (+ baseline spec ใน `docs/features/`) | ส่งมอบแล้ว                                        |
| P-02 | R3    | Donation, Kitchen, Volunteer, SOP, Security, Referral                                                 | ก่อนกรกฎาคม 2026                                  |
| P-03 | R4    | Family Search (in-scope); EOC + Open API (deferred) — EOC read-model ใช้ MongoDB projection            | Family Search ล่วงหน้า; EOC/Open API ตาม deferred |

> **หมายเหตุ:** EOC (module 10) reframe ตาม **FD-14** — เป็น aggregate API + API key แทน human dashboard / role-scoped views และ (เคาะ 2026-06-11; K-17 sync 2026-06-15) เป็น **service แยก** ออกจากระบบหลัก ดึงข้อมูลจาก CouchDB ผ่าน worker/ETL ไปยัง MongoDB projection; phase-r4 PRD และ role matrix align ตามแนวทางนี้แล้ว.
