---
title: "Task Breakdown — Platform/Core"
status: active
created: 2026-06-05
updated: 2026-07-16
module: core
note: decision-synced 2026-07-15 — CR-033 remote-first; CR-005 public-tier redaction (T-01) + donation schema_v2/donation_slot (T-02) + public read-model (T-35)
---

# Platform/Core

> Lead pair — auth, RBAC, data model, shared API, integration, deployment, governance, handover (critical dependency — ทุกโมดูลขึ้นกับโมดูลนี้)

- **Team owner:** Lead pair — แจ็ก (Platform/Core) + เด่น (Integration/Floating) (ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R2, R3, R4
- **Design input (บริษัท):** P-01 (ส่งมอบแล้ว), P-02 (กำหนดส่งก่อนกรกฎาคม 2026), P-03 (Family Search ส่งล่วงหน้า; EOC/Open API ตาม deferred)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

> **สถานะ ณ 2026-06-14:** Legend — ✅ done · 🔄 in progress/partial · ⬜ not started
>
> - **T-01 🔄** — Role kernel (`$lib/auth/roles.ts`: SYSTEM_ADMIN, SHELTER_MANAGER, STAFF_CAPABILITIES, guard helpers) + auth store + route guards done; role/shelter-scope enforcement + full role-permission matrix ยังไม่ครบ DoD
> - **T-02 🔄** — Base schema + remote-first data path + active endpoint strategy (Central-first, Edge fallback) วางแนวแล้ว; household/zone/supply/ledger/donation expansion ยังไม่ได้ build
> - **T-03 🔄** — Shared typed errors, api-core, auth guard pattern, BFF convention (`/api/v1/`) in place; convention doc เรื่อง endpoint/session failover + phase contract freeze ยังไม่ทำ
> - **T-20 ถึง Q-03 ⬜** — ยังไม่ได้เริ่ม (รอ Foundation Gate)

| ID   | Status           | Feature / Task                                                              | FR        | Phase | Stage | Scope  | Raw MD | AI×    | Adj MD | Depends |
| ---- | ---------------- | --------------------------------------------------------------------------- | --------- | ----- | ----- | ------ | ------ | ------ | ------ | ------- |
| T-01 | 🔄 | RBAC extension: approved 5 roles + shelter-scope enforcement + public/API redaction | FR-34 | R2 | prod | ส.ค. | 8 | ÷1.25 | 6.5 | P-01 |
| T-02 | 🔄 | Data-model expansion (household, zone, supply, ledger, donation) — additive | FR-34 | R2 | prod | ส.ค. | 10 | ÷1.25 | 8 | P-01 |
| T-03 | 🔄 | Shared API convention + contract freeze for phase | - | R2 | prod | ส.ค. | 4 | ÷1.25 | 3 | P-01 |
| T-20 | ⬜ | R2 integration + Backoffice Foundation Gate UAT | gate | R2 | post | ส.ค. | 5 | ÷1.3 | 4 | all R2 |
| T-35 | ⬜ | Resource-calc backbone + read-model perf (cross-squad) | NFR-18,21 | R3 | prod | ส.ค. | 6 | ÷1.25 | 5 | T-31 |
| T-36 | ⬜ | R3 integration + Operations Gate UAT | gate | R3 | post | ส.ค. | 6 | ÷1.3 | 4.5 | all R3 |
| T-43 | ⬜ | RoPA / consent / retention finalization | FR-55 | R4 | post | ส.ค. | 6 | ÷1.1 | 5.5 | all |
| T-44 | ⬜ | Cross-module UAT + production hardening + handover package | FR-56 | R4 | post | ส.ค. | 10 | ÷1.1 | 9 | all |
| T-46 | ⬜ | Final Handover Gate sign-off + training delivery | gate | R4 | post | ส.ค. | 5 | ÷1.1 | 4.5 | T-44 |
| Q-01 | ⬜ | Deployment + release automation (staging/prod, rollback) | NFR-25 | R4 | post | ส.ค. | 6 | ÷1.25 | 5 | - |
| Q-02 | ⬜ | Post-launch support / warranty buffer (~2 wks bugfix after go-live) | - | R4 | post | ส.ค. | 20 | ÷1.3 | 15.5 | T-44 |
| Q-03 | ⬜ | User manual (full) + ops runbook | - | R4 | post | ส.ค. | 8 | ÷1.1 | 7.5 | T-44 |
|  | **รวมทั้งโมดูล** |  |  |  |  | **94** |  | **78** |  |

## Task Details

> DoD ยึด [Standard DoD](_index.md#standard-dod): **prod = UI + data/write path + validation + permission + test + demo ของ slice · post = gate/handover artifact** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-01 — RBAC extension: approved 5 roles + shelter-scope enforcement + public/API redaction (FR-34)

**Description:** สร้างระบบ RBAC เต็มรูปต่อจาก auth/RBAC skeleton ของ walking skeleton (**greenfield — ไม่มีระบบ MVP เดิมรันอยู่**): ใช้ approved 5 internal roles (`system_admin`, `shelter_manager`, `registration_staff`, `kitchen_staff`, `warehouse_staff`) ตาม [role-permission matrix](../prd/role-permission-matrix.md), บังคับ role/shelter-scope ทุก write/read path และบังคับ public/API redaction สำหรับ medical/national ID. Internal authenticated staff เห็น medical ตาม shelter scope เพื่อรองรับงานฉุกเฉิน; public/FAM/API/EOC ไม่ได้รับ medical หรือ national ID ทุกกรณี (`volunteer` ไม่ใช่ RoleKey — เป็น domain/profile concept หรือ `affiliation_tags` เท่านั้น)

**Definition of Done:**

- Role + permission ครบตาม role-permission matrix, mapping ทดสอบ allow/deny ต่อ role อัตโนมัติ
- Role/shelter-scope enforcement บังคับที่ data/service layer — cross-shelter access ต้อง deny ทั้ง read/write
- Public/FAM/API/EOC serializers มี no-medical-detail tests รวม parameter manipulation/adversarial request; **national ID rule เป็น tier-specific (CR-005):** PUB/EOC/Open API = ห้าม national ID ทุกกรณี; **FAM tier (`/search`) คืน national ID แบบ masked เท่านั้น** (3หน้า+3ท้าย) — test ยืนยันว่าเลขเต็ม/เบอร์เต็ม/medical หลุดไม่ได้แม้ query ด้วยเลขบัตร/เบอร์
- **PUB-tier aggregate whitelist (CR-005 §A/OP-8):** serializer ของ `/public/v1/transparency/*` ยอมให้ aggregate ระดับระบบ `occupancy_total` + `vulnerable_count` ผ่านได้ (กั้นหลัง flag `public_metrics_occupancy`/`public_metrics_vulnerable`, default on) — **ห้าม drill-down เป็นรายชื่อ/ราย attribute** (test ยืนยันไม่มี person-level path)
- Role ฝั่ง baseline (registration, screening, medical) ทำงานถูกต้องร่วมกับ role ใหม่ภายใต้ matrix เดียวกัน และมี pattern/ตัวอย่างให้ทีมอื่น reuse
- เอกสารวิธีประกาศ permission ของ endpoint ใหม่ สั้นพอให้ทีมทำตามเองได้

### T-02 — Data-model expansion (household, zone, supply, ledger, donation) — additive (FR-34)

**Description:** วาง data model ของทั้งระบบ (**greenfield** — เริ่มจาก base schema ใน walking skeleton: person, screening, movement ตาม baseline FR-1–20) แล้วขยายแบบ **additive**: household, zone, supply/ledger, donation บน Central CouchDB ภายใต้สถาปัตยกรรม **remote-first** โดยให้ active endpoint เป็น Central ก่อนเสมอ และสลับไป Edge เฉพาะตอน Central/WAN ใช้งานไม่ได้ (LAN Edge เป็น outage fallback replica เท่านั้น) — **fan-out ใหญ่สุดของโครงการ** (block T-04/08/10/17/18/19) และเป็น tech risk #1 (endpoint failover/failback + data consistency) เจ้าของคือ Lead B ตาม schedule decision

**Definition of Done:**

- Schema ทุก entity ตรง data dictionary + ERD ใน `docs/data/` พร้อม validation
- Sync/conflict design (remote-first) เขียนเป็นเอกสาร + พิสูจน์ด้วย test conflict scenario จริงบน CouchDB โดยกำหนดว่า write ยิงไป active endpoint โดยตรง (Central ก่อน, Edge fallback เมื่อจำเป็น), active remote มีครั้งละหนึ่งเป้าหมายเท่านั้น, **ไม่มี local-only write queue** (ถ้า Central และ Edge ไม่พร้อมให้เข้าโหมด disconnected แบบ status-only, ไม่มี read-only local cache) และใช้ policy เดียวกันทั้งระบบ: automatic retry 3 attempts, เกินนั้นแสดงแบนเนอร์ "cannot connect" แบบชัดเจน และให้ผู้ใช้กด force retry ได้; Edge backlog ขึ้น Central เมื่อ WAN กลับมา และ failback ไม่สร้าง duplicate
- ส่วนขยายเป็น additive ต่อ base schema — ไม่ breaking ต่อ collection ที่ทีมอื่นเริ่มใช้แล้ว (มี regression test)
- Seed data + ตัวอย่าง query ต่อ entity ให้ทีม copy pattern, ผ่าน review แล้วทีม downstream เริ่มงานได้
- **CR-005 §F (additive, backward-compatible):** `donation` §2.3 bump **schema_v 1→2** (+`logistics`, `booking_ref`, `donor.line_id/email`, `items[].category/condition/note` — ทั้งหมด optional/sys, ไม่ backfill) + **`donation_slot` §2.13 doc type ใหม่** (DN-5) + index + view `slot_availability`/`needs_open`; อัปเดต `validate_doc_update` (central **และ** edge) ให้รับ field/type ใหม่ก่อน rollout — feed T-60

### T-03 — Shared API convention + contract freeze for phase

**Description:** กำหนดมาตรฐาน API ใช้ร่วมทุกทีม (naming, error shape, pagination, auth, versioning, active endpoint/session state) แล้ว **freeze contract ของ phase** — กันปัญหา 4 ทีมต่างคนต่างออกแบบจน integrate ไม่ได้ตอน gate โดยยึด remote-first semantics: Central-first + Edge fallback, แยก session ต่อ endpoint, canonical live-update ผ่าน app-level event channel, และกำหนด failback/retry UX expectation ให้ชัด

**Definition of Done:**

- เอกสาร convention + ตัวอย่าง endpoint อ้างอิง (จาก walking skeleton slice) เผยแพร่ให้ทุกทีม
- Auth/session convention ระบุ Central-first login, Edge fallback เฉพาะตอน Central/WAN ล่ม, Central/Edge `_session` cookie แยกกัน, และ public/no-login endpoints เป็น Central-only
- Contract ของ phase ถูก tag/version — แก้หลัง freeze ต้องผ่าน Lead approve
- ทุกทีม acknowledge ใน kickoff/workshop และ checklist review PR มีข้อ convention

### T-20 — R2 integration + Backoffice Foundation Gate UAT (gate)

**Description:** รวมงาน R2 ทุกโมดูล (household/zone, supply, donation intake) ทดสอบ integration ข้ามโมดูล + จัด UAT ของ Foundation Gate — gate แรกที่ตัดสินว่า foundation พร้อมให้ R3 ต่อยอด

**Definition of Done:**

- Integration test ข้ามโมดูล R2 ผ่านบน staging (ลงทะเบียน → จัดโซน → รับของ → แจกของ end-to-end)
- UAT script ครอบ FR-21..34 รันกับผู้ใช้ตัวแทน, defect critical/major = 0 (minor มี plan ปิด)
- Gate sign-off จากบริษัท (QA/Release go-no-go) เป็นลายลักษณ์อักษร

### T-35 — Resource-calc backbone + read-model perf (NFR-18, NFR-21)

**Description:** งาน cross-squad รองรับ resource calc (T-31): วาง read-model/view ของ CouchDB ให้ dashboard และ calc query ได้เร็วตาม NFR — แยกภาระ read หนักออกจาก write path ของหน้างาน

**Definition of Done:**

- Read-model/materialized view สำหรับ occupancy, stock, calc result — latency ตาม NFR-18/21 พิสูจน์ด้วย load test บนข้อมูลขนาด realistic (เช่น ผู้พักพิง 3,000 คนตาม scale ใน source proposal)
- Write path หน้างานไม่ช้าลง (เทียบ benchmark ก่อน-หลัง)
- เอกสาร pattern การเพิ่ม view ใหม่ให้ทีมอื่นใช้ต่อ
- **CR-005 (public metrics):** read-model ครอบ aggregate ที่ public tier ใช้ — `occupancy_total`, `vulnerable_count`, `shelters_open/total`, per-shelter occupancy/capacity (T-57/T-58) + `needs_open`/`slot_availability` (T-60); public page อ่านแบบ polling (10 นาที, stale-threshold 30 นาที — OP-7) ไม่ poll DB ตรง

### T-36 — R3 integration + Operations Gate UAT (gate)

**Description:** รวมงาน R3 ทุกโมดูล (donation flows, kitchen, volunteer, SOP calc, security, referral) ทดสอบ integration + UAT ของ Operations Gate — ปิด phase R3 ก่อนเข้า R4/go-live

**Definition of Done:**

- Integration scenario ข้ามโมดูลผ่าน: occupancy → calc → meal plan → requisition → ตัด stock ครบ loop
- UAT script ครอบ FR-35..48 รันกับผู้ใช้ตัวแทน, defect critical/major = 0
- Gate sign-off จากบริษัท + รายการ known issues ส่งต่อเข้า T-44

### T-43 — RoPA / consent / retention finalization (FR-55)

**Description:** จัดทำธรรมาภิบาลข้อมูลให้พร้อมก่อน go-live (minimal scope ตาม schedule decision — **บังคับเพราะ Family Search เปิด public = PII exposure จริง**): RoPA (Record of Processing Activities), แนวทาง consent, นโยบาย retention + กลไกลบ/anonymize ตามกำหนด

**Definition of Done:**

- RoPA ครอบทุก processing activity ของระบบ ผ่าน review ผู้รับผิดชอบ PDPA ของโครงการ
- Retention policy ต่อประเภทข้อมูลกำหนดชัด + กลไกลบ/anonymize อัตโนมัติทำงานจริง (test ได้) — รวม cleanup ของ submission/temp artifacts ตาม FR-17 (remote-first continuity baseline, [CR-033](../changes/CR-033-remote-first-architecture-program-index.md); **ไม่มี offline local Pouch store ให้ cleanup**) ที่ FR-55 กำหนด
- Consent flows (ลงทะเบียน, family search T-40, donor, volunteer) สอดคล้องเอกสารและ audit ได้
- เอกสารชุดนี้อยู่ใน handover package (T-44)

### T-44 — Cross-module UAT + production hardening + handover package (FR-56)

**Description:** UAT รอบสุดท้ายข้ามทุกโมดูล + hardening ก่อน production (security review, backup/restore, monitoring) + จัดทำ handover package ให้ผู้รับช่วงดูแลระบบต่อ — hub ของช่วงปิดโครงการ (block T-46, Q-02, Q-03)

**Definition of Done:**

- Cross-module UAT ผ่านครบทุก journey หลัก บน environment เทียบเท่า production, defect critical = 0
- Hardening checklist ปิดครบ: security review (รวม public surface: donation form, family search, transparency report), backup/restore ทดสอบ restore จริง, monitoring + alert พร้อม
- Handover package ครบ: architecture, runbook อ้าง Q-03, credentials/secrets procedure, known issues
- พร้อมเสนอ Final Handover Gate (T-46)

### T-46 — Final Handover Gate sign-off + training delivery (gate)

**Description:** Gate ปิดโครงการ: ส่งมอบ handover package (T-44) อย่างเป็นทางการ + อบรมผู้ใช้และผู้ดูแลระบบ (เทศบาล/ศูนย์อาสา ม.อ. ตามโครงสร้างใน source proposal)

**Definition of Done:**

- Training ผู้ใช้หน้างาน + ผู้ดูแลระบบจัดแล้วจริง พร้อมเอกสารประกอบ (อิง Q-03) และรายชื่อผู้เข้าอบรม
- ผู้รับมอบทดสอบรับระบบตาม checklist ต่อหน้า (operate ได้เองโดยไม่พึ่งทีม dev)
- Sign-off จาก stakeholder ที่มีอำนาจรับมอบ เป็นลายลักษณ์อักษร

### Q-01 — Deployment + release automation (NFR-25)

**Description:** CI/CD pipeline สำหรับ staging/production: build → test → deploy อัตโนมัติ พร้อม rollback — ฐานของ walking skeleton ตั้งแต่สัปดาห์แรก และเป็นเงื่อนไข go-live ที่ปลอดภัย

**Definition of Done:**

- Pipeline deploy staging อัตโนมัติจาก branch หลัก, production ผ่าน approval step
- Rollback ทดสอบจริงอย่างน้อย 1 ครั้ง (ไม่ใช่แค่มีปุ่ม), migration/seed รันใน pipeline ได้
- Secrets ไม่อยู่ใน repo, จัดการผ่านกลไกที่ตกลง, เอกสาร deploy/rollback อยู่ใน runbook (Q-03)

### Q-02 — Post-launch support / warranty buffer

**Description:** Buffer สนับสนุนหลัง go-live ~2 สัปดาห์ (เฉลี่ยทุกทีม): triage + แก้ bug จากการใช้งานจริง, ปรับแต่งเล็กน้อย — ไม่ใช่ช่องทาง feature ใหม่ จบภายใน hard deadline 14/09/2026

**Definition of Done:**

- ช่องทางรับแจ้งปัญหา + เกณฑ์ triage (critical/major/minor) ประกาศให้ผู้ใช้ทราบ
- Critical bug ทั้งหมดถูกปิดหรือมี workaround ที่ผู้ใช้ยอมรับภายในกรอบ buffer
- สรุปรายการปัญหา-การแก้ทั้งหมดส่งเข้า handover (เป็น known-issues update)

### Q-03 — User manual (full) + ops runbook

**Description:** คู่มือผู้ใช้ฉบับเต็ม (ทุก role: เจ้าหน้าที่ลงทะเบียน, คลัง, ครัว, อาสา, shelter_manager) + ops runbook สำหรับผู้ดูแลระบบ (deploy, backup/restore, monitoring, troubleshooting) — ภาษาไทยเป็นหลัก ใช้อบรมใน T-46

**Definition of Done:**

- User manual ครอบ journey หลักของทุก role พร้อมภาพหน้าจอจริงจากระบบ
- Ops runbook ครอบ: start/stop, deploy/rollback (อิง Q-01), backup/restore, ปัญหาที่พบบ่อย
- ผู้ใช้ตัวแทน + ผู้ดูแลระบบทดลองทำตามเอกสารสำเร็จโดยไม่ต้องถามทีม dev
- เป็นส่วนหนึ่งของ handover package (T-44)

## Effort by phase (Adj MD)

| Phase   | Raw MD | Adj MD |
| ------- | ------ | ------ |
| R2      | 27     | 21.5   |
| R3      | 12     | 9.5    |
| R4      | 55     | 47     |
| **รวม** | **94** | **78** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-31` (Daily resource calculation engine) — module **Module B — SOP & Resource Calc**

**Gate / integration:** all, all R2, all R3 (รอให้ทั้ง phase เสร็จก่อน)

**Design input:** P-01 (pre-production โดยบริษัท)
