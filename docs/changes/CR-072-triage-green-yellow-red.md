---
id: CR-072
title: คัดกรองผู้พัก 3 ระดับ เขียว / เหลือง / แดง — กฎการแพทย์ยังไม่เคาะ
status: proposed
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
parent: CR-066
affects:
  - docs/data/schema.md §1.2 medical.track / §1.5 screening.track
  - docs/task-breakdown/00-baseline.md (T-49 overlap)
  - docs/task-breakdown/02-people.md (T-74)
  - frontend/src/lib/features/people (screening UI)
---

# CR-072 — Triage เขียว / เหลือง / แดง

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ตั้งใจมีระดับคัดกรอง 3 สี แทน/คู่กับ `normal`/`fast_track`
- **เพื่อใคร/ทำไม:** แยกความเร่งด่วนทางการแพทย์ที่ประตูและบนรายชื่อ
- **dev ต้อง build อะไร:** **ยังไม่ build** จนกว่า D-TRIAGE-RULES ล็อก — T-74 blocked
- **กระทบ schema/scope ไหน:** ยังไม่ bump; ห้ามเดากฎอาการ/โรค

## Why

Owner ต้องการคัดกรอง 3 ประเภท. โค้ดมี `screening.track` / `medical.track` = `normal`|`fast_track` เท่านั้น. เกณฑ์การแพทย์ **ยังไม่เคาะ**.

## Change

### Before → After (เป้าหมาย หลังล็อกกฎ)

| Before | After (รอ decision) |
| --- | --- |
| `track`: normal \| fast_track | เขียว / เหลือง / แดง ตาม D-TRIAGE-FIELD |

> [NEEDS DECISION: D-TRIAGE-RULES] เกณฑ์เข้าแต่ละสี — **ห้ามเดา** (อาการ, อายุ, กลุ่มเปราะบาง, ส่งต่อ)
> [NEEDS DECISION: D-TRIAGE-FIELD]
> - A: ขยาย enum `track`
> - B: field ใหม่ `triage_level` คง `fast_track` เดิม
> - C: แทนที่ `normal`/`fast_track` ทั้งระบบ

**ห้าม** map `fast_track` → แดง หรือ เหลือง โดยไม่มีกฎที่ล็อก.

## Requirements

- **FR-75** — จอด
- เมื่อล็อกกฎ: ฟอร์มคัดกรองบังคับเลือกสี; persist append-only `screening`; sync ไป `medical` ตามแบบ T-49
- UI รายชื่อ/ประตูแสดงสี; ไม่โชว์รายละเอียดการแพทย์บน public

### Acceptance (T-74)

ยังไม่มี DoD implement จนกว่ากฎเข้า. หลังล็อก: test ทุกแยกกฎ + ห้ามค่าที่สี่ + demo 3 เคส.

## Impact

ไม่มีจนกว่า approve + ล็อกกฎ. ตอนนั้น bump schema_v screening/medical ตาม field ที่เลือก.

## Migration

N/A จนกว่ามี field. ถ้าแทนที่ `fast_track` ต้องมีตาราง map ที่เจ้าของโครงการเซ็น — อย่า auto-map.

## Out of scope

- เขียน clinical protocol ใน CR นี้
- เปลี่ยน referral medical-emergency โดยไม่มีกฎ

## Decision log

- 2026-08-13 — proposed และ **blocked**. รอ D-TRIAGE-RULES + D-TRIAGE-FIELD.
- 2026-08-13 — Wave 1 ล็อกใน CR-066 (D-TRACK-METHOD=CR+Notion). ห้ามเดากฎ triage.
- 2026-08-13 — เจ้าของโครงการ (IMPS) **ไม่ approve** CR นี้. D-TRIAGE-RULES / D-TRIAGE-FIELD = Wave 4 **จอดรอบ CR ถัดไป**. คง `proposed`.
