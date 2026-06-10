---
title: Full-System PRD Artifacts Index
status: draft
created: 2026-06-03
updated: 2026-06-05
---

# Smart Shelter — Full-System PRD (Post-MVP)

ชุดเอกสาร PRD สำหรับการพัฒนา Smart Shelter Management Platform **หลัง July MVP จนจบส่วน software platform** build R2/R3/R4 = **Aug-Oct 2026 (3 phase)**, **deadline จริง = ธ.ค. 2026** (Oct-Dec = hardening + buffer, ไม่ตัด scope) ทีม **14 student developers / 7 vertical squads** scope **software platform เท่านั้น**

สร้างด้วย bmad-prd skill · ต่อยอดจาก [MVP PRD (2026-05-30)](../prd-smart-shelter-spec-2026-05-30/index.html)

## Documents

- [**Full-System Kickoff**](kickoff.html) — เอกสารตัวเดียวรวม full scope + timeline + team + man-power + สิ่งที่ทีมต้องรู้ ฐานสำหรับทำ slide ประชุม kickoff
- [**Full-System Release Roadmap**](roadmap.html) — master timeline Aug-Dec, gates, squad model, dependency order, September 80%-testable milestone, risks. แทนที่ §9 ของ MVP PRD
- [**Phase R2 — Foundation**](phase-r2-foundation.html) *(สิงหาคม)* — Household, Zoning, Inventory/Supply (Module C), Donation intake, RBAC extension. FR-21..FR-34
- [**Phase R3 — Operations**](phase-r3-operations.html) *(กันยายน)* — Donation full, Kitchen (Module D), Volunteer (Module A), SOP calculator (Module B), Security+Referral (Modules E+F). FR-35..FR-48
- [**Phase R4 — Integration & Handover**](phase-r4-integration-handover.html) *(ตุลาคม)* — EOC dashboard + Open API, public family search, SOP simulation, RoPA, cross-module UAT, handover. FR-49..FR-56
- [**Master Task Breakdown & Man-Power Plan**](task-breakdown.html) — WBS ทุก task (T-01..T-46) + man-power table ราย squad/phase คิด AI uplift (Cursor/Copilot/Antigravity). Generate จาก `_tasks.py`

## ID continuity

| | MVP (R1) | R2 | R3 | R4 |
| --- | --- | --- | --- | --- |
| FR | 1–20 | 21–34 | 35–48 | 49–56 |
| NFR | 1–11 | 12–16 | 17–21 | 22–26 |
| UJ | 1–4 | 5–6 | 7–8 | 9–10 |
| SM | 1–6 | 7–10 | 11–15 | 16–20 |

## Source-of-truth

- Scope/FR/NFR ราย phase → เอกสารในชุดนี้
- FR-1..FR-20 / NFR-1..NFR-11 baseline → [MVP PRD](../prd-smart-shelter-spec-2026-05-30/prd.html)
- Field-level schema → [Data Dictionary](../../data/smart-shelter-data-dictionary.html) (ขยาย additive)
- Delivery gates → [Project Delivery Agreement](../../delivery/project-delivery-agreement.html)
- Team/RACI → [Team Operating Model](../../org/teams.html)
- Full-project source → [proposal](../../../source/psu-smart-shelter-f-20260522.pdf)
- Decision trail → `.decision-log.md` (workspace)
