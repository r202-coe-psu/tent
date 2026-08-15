---
id: CR-066
title: Program index — site kind, occupancy health, booking channels, triage
status: approved
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (IMPS, approved 2026-08-13)
layer: volatile
parent: null
children:
  - CR-067
  - CR-068
  - CR-069
  - CR-070
  - CR-071
  - CR-072
  - CR-073
affects:
  - docs/features/site-occupancy-booking-program.md
  - docs/task-breakdown/_index.md
  - docs/task-breakdown/00-baseline.md
  - docs/task-breakdown/02-people.md
  - docs/task-breakdown/07-B-sop.md
  - docs/task-breakdown/10-eoc.md
  - docs/task-breakdown/12-public.md
  - docs/prd/squad-roster.md (owner mapping only; ไม่เปลี่ยนสมาชิก)
---

# CR-066 — Program index (site / occupancy / booking / triage)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เปิดโปรแกรม backlog 7 แพ็กเกจ (P1–P7) สำหรับชนิดสถานที่, import, occupancy health 5 สี, จองเข้าศูนย์, import/inbound คน, triage 3 สี, ONE PLATFORM
- **เพื่อใคร/ทำไม:** จ่ายงาน Lead / Team B / Team D ได้โดยไม่ปนกับ Team A/C
- **dev ต้อง build อะไร:** ยังไม่ build จาก CR นี้ — ทำตาม child CR + T-66..T-72 ของสไลซ์ที่ approve. T-66 ไม่มีหน้า stub `/host-houses` (D-HOST-NAV=B′)
- **กระทบ schema/scope ไหน:** child CRs; CR นี้ไม่ bump `schema_v`
- **สไลซ์ที่ approve (2026-08-13):** Wave 1–3 + T-72 (P1, P2, P3, P4, P5 slice A). **ไม่รวม** Wave 4 (P1b / P5 slice B / P6 / P7) — จอดรอบ CR ถัดไป

## Why

Gap analysis ของเจ้าของโครงการพบว่าโมเดลศูนย์/บ้านพี่เลี้ยง, การเตือนคนล้น, ช่องจอง, และคัดกรอง 3 สียังไม่ครบ — และส่วนที่ยังไม่เคาะ (SOP workshop, เกณฑ์ triage, SPEC หน่วยงาน) ต้องจอดไม่ให้ทีมเดา.

Spec โปรแกรม: [`docs/features/site-occupancy-booking-program.md`](../features/site-occupancy-booking-program.md)

## Change

### Before → After

| Before | After |
| --- | --- |
| ไม่มีโปรแกรมรวมช่องว่างนี้ | CR-066 เป็น index + assignment board |
| CR-014 เสนอ `host_house` แยก (proposed, ไม่ได้ทำ) | child CR-067: D-SITE-MODEL **A ล็อก** — คง `shelter` + `site_kind`; slice CR-014 นั้น superseded |
| ไม่มี T-id สำหรับงานชุดนี้ (ห้าม reuse T-61/T-62) | T-66..T-76 ใน task-breakdown |

### Child CRs (หนึ่ง concern ต่อไฟล์)

| CR | Package | เรื่อง | สถานะหลังเคาะ 2026-08-13 |
| --- | --- | --- | --- |
| CR-067 | P1 (+ P1b จอด) | `site_kind` บน `shelter`; SOP-lite = phase 2 | **approved** เฉพาะ P1; P1b = รอบ CR ถัดไป |
| CR-068 | P2 | ขยาย CR-039 คอลัมน์ชนิดสถานที่ | **approved** (ตาม D-SITE-MODEL=A) |
| CR-069 | P3 | occupancy health 5 สี (derived) | **approved** |
| CR-070 | P4 | public booking + ยืนยันที่ประตู | **approved** |
| CR-071 | P5 | people import + inbound API | **approved** เฉพาะ slice A (T-72); slice B = รอบ CR ถัดไป |
| CR-072 | P6 | triage เขียว/เหลือง/แดง (blocked กฎ) | **proposed** — Wave 4 รอบ CR ถัดไป |
| CR-073 | P7 | ONE PLATFORM / external GET — **blocked stub** | **proposed** — Wave 4 รอบ CR ถัดไป |

## Impact

- Planning docs ตาม `affects:` — เพิ่ม T-66..T-76; Adj MD ของสไลซ์ที่ approve ยังไม่รวมเข้า 270 (K-16); T-73..T-76 (Wave 4) จอดรอบ CR ถัดไป
- **ไม่แก้** `docs/data/schema.md` จาก CR นี้
- **ไม่ implement โค้ด** จาก CR นี้

## Migration

N/A — index เท่านั้น. Migration อยู่ใน child CR ที่ bump schema หลัง approve.

## Decision log

- 2026-08-13 — proposed. รอเจ้าของโครงการ approve ชุด CR
- 2026-08-13 — **Wave 1 ล็อก** (decision ≠ approve CR): D-SITE-MODEL=A · D-HOST-NAV=B′ · D-HEALTH-PCT · D-TRACK-METHOD=CR ไฟล์ + Notion. รายละเอียดใน [program spec §0](../features/site-occupancy-booking-program.md). Notion: [Wave 1–2 locks](https://www.notion.so/3bb33537542a81b799d0ce49be001bd4). **ไม่ bump schema.md.**
- 2026-08-13 — **Wave 2 ล็อก** (decision ≠ approve CR): D-STANDBY=A · D-HEALTH-VS-STATUS=B (ทับคำแนะนำ A ของ John) · D-HEALTH-SURFACE=A. T-69 ไม่รอ Wave 2 แล้ว — รอ approve CR-069. T-70 ยัง blocked T-37.
- 2026-08-13 — **Wave 3 ล็อก** (decision ≠ approve CR): D-BOOK-OCC=C · D-HOLD-TTL=none · D-PRE-REG-AGE · D-HOLD-CANCEL (SA/SM/RS) · D-REG-VIA=`web`+`api` · D-BOOK-TOKEN=A. T-71 ไม่รอ Wave 3 แล้ว — รอ approve CR-070. Wave 4 (SOP / triage / ONE PLATFORM / D-INBOUND-PLANE) ยังเปิด. **ไม่ bump schema.md.**
- 2026-08-13 — **T-72 ล็อก** (decision ≠ approve CR): T-72 initial stay=A · T-72 import permission=RS+SA+SM (เจ้าของขยายจาก proposed SM+SA). T-72 ไม่รอ stay/permission แล้ว — รอ approve CR-071 + T-48. รายละเอียดใน [program spec §0](../features/site-occupancy-booking-program.md). **ไม่ bump schema.md.**
- 2026-08-13 — **approved** โดยเจ้าของโครงการ (IMPS): สไลซ์ Wave 1–3 + T-72. Wave 4 (D-SOP-LITE / D-HOST-STAFF / D-SPHERE-CAP / D-INBOUND-PLANE / D-TRIAGE-RULES / D-TRIAGE-FIELD / D-ONE-PLATFORM) **จอดรอบ CR ถัดไป**. CR-072 / CR-073 คง `proposed`. **ไม่ bump schema.md** — bump ตอน implement ตาม Migration ของ child CR.
