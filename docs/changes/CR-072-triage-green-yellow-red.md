---
id: CR-072
title: คัดกรองผู้พัก 3 ระดับ เขียว / เหลือง / แดง — ยกเลิก ไม่ทำแล้ว
status: superseded
date: 2026-08-13
updated: 2026-09-07
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
parent: CR-066
superseded_by: CR-106-decoupled-registration-medical-screening-flow.md
affects:
  - docs/data/schema.md §1.2 medical.track / §1.5 screening (เลิกใช้ triage_level)
  - docs/task-breakdown/00-baseline.md (T-49 overlap)
  - docs/task-breakdown/02-people.md (T-74)
  - frontend/src/lib/features/people (screening UI)
  - docs/changes/CR-106-decoupled-registration-medical-screening-flow.md
---

# CR-072 — Triage เขียว / เหลือง / แดง — **SUPERSEDED**

## สรุป (TL;DR)

- **สถานะ:** `superseded` (2026-09-07) — **ไม่ทำ** คัดกรองเขียว / เหลือง / แดง ในระบบ
- **แทนที่ด้วย:** ฟอร์มคัดกรอง Station 2 แบบย่อใน [CR-106](CR-106-decoupled-registration-medical-screening-flow.md) (ซักประวัติ + แนวทางดูแล + อาการ textarea + EWAR)
- **dev ต้อง build:** **ห้าม** build UI / enum / zoning แนะนำจาก `triage_level` เขียว/เหลือง/แดง
- **T-74 / FR-75 / D-TRIAGE-RULES / D-TRIAGE-FIELD:** ปิด — ไม่รอ decision อีก

## Why (เดิม)

Owner เคยต้องการคัดกรอง 3 ประเภท แต่เกณฑ์การแพทย์ไม่เคยล็อก และต่อมาตัดสินใจตัดออกจากสโคป intake ทั้งหมด

## Change — สิ่งที่ถูกยกเลิก

| รายการ | การจัดการ |
| --- | --- |
| `triage_level` green/yellow/red | **เลิกใช้** — UI ไม่แสดง; ไม่เขียนใหม่; doc เก่าอ่านได้เป็น legacy |
| เกณฑ์ D-TRIAGE-RULES | **ยกเลิก** — ไม่เคาะ |
| D-TRIAGE-FIELD (A/B/C) | **ยกเลิก** |
| FR-75 / T-74 | **ยกเลิก** — ไม่ implement |
| Zoning แนะนำจากแดง/เหลือง → quarantine | **เลิกพึ่ง triage** — ดู CR-106 (แนะนำจาก EWAR / special needs) |

> **หมายเหตุ:** สี occupancy health ของศูนย์ (CR-069) **คนละเรื่อง** — ไม่ถูกยกเลิกโดย CR นี้

## Requirements

ไม่มี — สโคปนี้ถูกตัดออกจากระบบ

## Impact

- แก้ CR-106 (ฟอร์ม Station 2) ให้ตัด triage / vitals / หมู่เลือด / referral ออก
- โค้ดที่มี `triage_level` UI / `recommendZoneKind(..., triage)` ต้องถอดตอน implement ตาม CR-106
- ไม่ bump schema จาก CR นี้โดยตรง — migration/deprecation note อยู่ใน CR-106

## Migration

N/A สำหรับสโคปใหม่. Doc `screening` ที่มี `triage_level` อยู่แล้ว = legacy อ่านได้ ไม่บังคับ backfill ไม่บังคับลบ

## Out of scope

- occupancy health 5 สี (CR-069)
- `care_track` normal / fast_track (ยังใช้เป็นแนวทางดูแล)
- EWAR checklist (ยังใช้ — ดู CR-106)

## Decision log

- 2026-08-13 — proposed และ **blocked**. รอ D-TRIAGE-RULES + D-TRIAGE-FIELD.
- 2026-08-13 — Wave 1 ล็อกใน CR-066 (D-TRACK-METHOD=CR+Notion). ห้ามเดากฎ triage.
- 2026-08-13 — เจ้าของโครงการ (IMPS) **ไม่ approve** CR นี้. D-TRIAGE-RULES / D-TRIAGE-FIELD = Wave 4 **จอดรอบ CR ถัดไป**.
- 2026-09-01 — ปรับสถานะเป็น **open decision** (รอเจ้าของโครงการเคาะกฎการแพทย์)
- 2026-09-02 — CR-106 เคย ratify `triage_level` ใน screening schema_v 2 (ถูกทับโดยแถวถัดไป)
- **2026-09-07 — เจ้าของโครงการตัดสินใจตัดเขียว/เหลือง/แดงออกจากระบบทั้งหมด.** สถานะ → **`superseded`**. สเปกฟอร์มคัดกรองใหม่บันทึกใน CR-106. T-74 / FR-75 / D-TRIAGE-* ปิด
