---
title: Full-System PRD Artifacts Index
status: active
created: 2026-06-03
updated: 2026-06-11
---

# Smart Shelter — Full-System PRD

ชุดเอกสาร PRD สำหรับการพัฒนา Smart Shelter Management Platform ทั้งระบบ — **greenfield** (ยังไม่มีระบบใช้งานจริง มีเพียง CouchDB PoC; baseline FR-1–20 ต้อง build เป็นส่วนแรกของ foundation)

**Schedule (เคาะ 2026-06-09):** build **มิ.ย.–ส.ค. 2026** · in-scope ส่งมอบ **31 ส.ค.** · **go-live full program ก.ย.** (สัปดาห์ 1) · deferred tail จบภายใน **14 ก.ย.** (hard deadline งาน feature) · หลังจากนั้นรับ feedback + แก้ไขจนครบกำหนดโครงการ **12 เดือน**. ทีม **14 คน = 2 Lead (Platform/Core) + 4 ทีม × 3** (จับ domain เข้าทีม **รอตัดสินใจ — K-13**) scope **software platform เท่านั้น**

**ระบบหลักเป็น offline-first บน Central CouchDB เป็นหลัก**: app เขียน local PouchDB ก่อน แล้ว sync กับ active remote เดียว (Central ปกติ, LAN Edge fallback ตอน WAN/Central ล่ม, หรือ local-only); EOC/Open API เป็น service แยก (worker/ETL จาก Central — ดู [Task Breakdown module 10](../task-breakdown/10-eoc.md))

สร้างด้วย bmad-prd skill

## Documents

- [**Full-System Kickoff**](kickoff.html) — เอกสารตัวเดียวรวม full scope + timeline + team + man-power + สิ่งที่ทีมต้องรู้ ฐานสำหรับทำ slide ประชุม kickoff
- [**Release Roadmap**](roadmap.html) — master timeline มิ.ย.–ก.ย. + maintenance, gates, team model, dependency order, risks
- [**Phase R2 — Foundation**](phase-r2-foundation.html) *(มิ.ย.–ก.ค. · Foundation Gate 17 ก.ค.)* — Baseline FR-1–20, Household, Zoning, Inventory/Supply (Module C), Donation intake, RBAC extension. FR-21..FR-34
- [**Phase R3 — Operations**](phase-r3-operations.html) *(ก.ค.–ส.ค. · Operations Gate 22 ส.ค.)* — Donation full, Kitchen (Module D), Volunteer (Module A), SOP calculator (Module B), Security+Referral (Modules E+F). FR-35..FR-48
- [**Phase R4 — Integration & Handover**](phase-r4-integration-handover.html) *(in-scope ส.ค.: Family Search + governance + handover · deferred ≤14 ก.ย.: EOC API + Open API + SOP simulation)* — FR-49..FR-56
- [**Task Breakdown by Module**](../task-breakdown/_index.md) — **master WBS** ทุก task (T-01..T-55) + effort/AI uplift + dependencies/gantt *(แทนที่ task-breakdown.md เดิมในชุดนี้ — ลบแล้ว 2026-06-11)*

## ID continuity

| | Baseline (build ใน foundation) | R2 | R3 | R4 |
| --- | --- | --- | --- | --- |
| FR | 1–20 | 21–34 | 35–48 | 49–56 |
| NFR | 1–11 | 12–16 | 17–21 | 22–26 |
| UJ | 1–4 | 5–6 | 7–8 | 9–10 |
| SM | 1–6 | 7–10 | 11–15 | 16–20 |

> Baseline FR-1..20 / NFR-1..11 = scope ชุดแรกที่ต้อง build (registration-first) — spec รายละเอียดอยู่ใน [`docs/features/`](../features/index.html); ยังไม่มีระบบที่ implement ชุดนี้มาก่อน

## Source-of-truth

- Scope/FR/NFR ราย phase → เอกสารในชุดนี้
- FR-1..FR-20 / NFR-1..NFR-11 baseline → feature specs ใน [`docs/features/`](../features/index.html) + [Task Breakdown module 0](../task-breakdown/00-baseline.md)
- Task/effort/timeline → [Task Breakdown by Module](../task-breakdown/_index.md) + [Dependencies & Timeline](../task-breakdown/_timeline.md)
- Field-level schema → [Database Schema](../data/schema.md) · topology/policy → [Data Model v3](../data/data-model.md) · planes/endpoints → [API Contract](../data/api-contract.md) *(ชุด docs/data เดิม retired 2026-06-11)*
- Role/permission → [Role Permission Matrix](role-permission-matrix.html)
- Full-project source → [proposal](../source/psu-smart-shelter-f-20260522.pdf)
