---
title: "Planning artifact — Site / occupancy / booking / triage program"
status: proposed
created: 2026-08-13
updated: 2026-08-13
source: docs/features/site-occupancy-booking-program.md
bmad_note: Canonical developer spec อยู่ที่ docs/ ไม่ใช่ไฟล์นี้. ไฟล์นี้ชี้ไปที่ tent canonical เพื่อให้ BMAD planning_artifacts พบโปรแกรม.
---

# Program pointer (BMAD planning_artifacts)

เอกสารฉบับเต็มสำหรับ developer อยู่ที่:

**[`docs/features/site-occupancy-booking-program.md`](../../docs/features/site-occupancy-booking-program.md)**

Change Records: CR-066 (index) + CR-067..CR-073 ใน `docs/changes/`. Tasks T-66..T-76 ใน `docs/task-breakdown/`.

สถานะ CR = **proposed** (ยังไม่ approve). Wave 1 ล็อก 2026-08-13: D-SITE-MODEL=A, D-HOST-NAV=B′, D-HEALTH-PCT, D-TRACK-METHOD=CR+Notion. Wave 2 ล็อก 2026-08-13: D-STANDBY=A, D-HEALTH-VS-STATUS=B, D-HEALTH-SURFACE=A. Wave 3 ล็อก 2026-08-13: D-BOOK-OCC=C, D-HOLD-TTL=none, D-PRE-REG-AGE, D-HOLD-CANCEL, D-REG-VIA, D-BOOK-TOKEN=A. T-72 ล็อก 2026-08-13: initial stay=A, import permission=RS+SA+SM. Wave 4 ยังเปิด. ห้าม implement จนกว่า approve CR ที่ผูก และห้าม bump `schema.md` ก่อน approve.

## สรุป (TL;DR)

- รวมศูนย์กับบ้านพี่เลี้ยงใน `shelter` + `site_kind` (`evacuation_center` | `host_house`) — **D-SITE-MODEL=A**
- บ้านอยู่หน้ารายการศูนย์ + กรอง `site_kind`; **ถอด** `/host-houses` — **D-HOST-NAV=B′**
- Public map ไอคอนคนละชุด; occupancy health 5 สี derived — **D-HEALTH-PCT** เทาปิด / ฟ้า&lt;60 / เหลือง 60–89 / แดง 90–100 / แดงเข้ม &gt;100
- **Wave 2:** `standby` = เทา ไม่เข้า % (D-STANDBY=A); `full_capacity` บังคับแดง (D-HEALTH-VS-STATUS=B); แสดง staff + public ตอนนี้ ไม่มี EOC dashboard (D-HEALTH-SURFACE=A)
- **Wave 3:** จองนับ occupancy (D-BOOK-OCC=C); ไม่มี TTL; ยกเลิกโดย SA/SM/RS; ตามสถานะด้วย QR หรือรหัส+เบอร์; `registered_via` เพิ่ม `web`+`api`
- **T-72:** ทุกแถว import เริ่ม `pre_registered` (นับ occupancy ตาม D-BOOK-OCC=C; เป็น `active` ที่ประตู/staff เท่านั้น); ใคร import ได้ = RS+SA+SM (ขยายจาก SM+SA)
- จองเว็บ + import คน + inbound API; ยืนยันที่ประตูด้วย QR ที่มีอยู่
- จอด Wave 4: SOP-lite, กฎ triage 3 สี, ONE PLATFORM / external GET payload, D-INBOUND-PLANE

## Assignment board

| T-id | ชื่องาน | ทีม | ready / blocked |
| --- | --- | --- | --- |
| T-66 | `site_kind` + ฟอร์ม + กรองบนหน้ารายการศูนย์ (ไม่มี stub `/host-houses`) | Lead | ready หลัง CR-067 |
| T-67 | Public map ไอคอน | Lead | blocked T-66 |
| T-68 | Excel import `site_kind` | Lead | blocked T-66 |
| T-69 | Occupancy health 5 สี staff + public | Team D + Lead | ready หลัง CR-069 (Wave 2 ล็อกแล้ว; ตัวเศษตาม D-BOOK-OCC=C) |
| T-70 | EOC field health | Lead | blocked T-37 |
| T-71 | Public booking + ประตู | Team B | ready หลัง CR-070 (Wave 3 ล็อกแล้ว) |
| T-72 | People xlsx/csv | Team B | ready หลัง CR-071 (T-72 stay=A + permission RS+SA+SM ล็อกแล้ว; ยังรอ T-48) |
| T-73 | Inbound POST คน | Team B + Lead | blocked partner spec |
| T-74 | Triage 3 สี | Team B | blocked กฎ |
| T-75 | ONE PLATFORM / external GET | Lead | blocked K-14 |
| T-76 | SOP-lite / Sphere / ไม่บังคับ staff | Team D | blocked workshop |

## Next for owner

1. Approve หรือแก้ CR-066..CR-073 (`status: proposed` คงไว้จนกว่าเคาะ)
2. Wave 1–3 + T-72 ล็อกแล้ว — ล็อก Wave 4 เมื่อพร้อม (D-SOP-LITE, D-INBOUND-PLANE, D-TRIAGE-*, D-ONE-PLATFORM)
3. Track = CR ไฟล์ + Notion (D-TRACK-METHOD ล็อกแล้ว) — [Wave 1–3 + T-72 decision log](https://www.notion.so/3bb33537542a81b799d0ce49be001bd4)
4. จ่าย T-66 หลัง approve CR-067 (ไม่มีหน้า stub `/host-houses`); จ่าย T-69 หลัง approve CR-069; จ่าย T-71 หลัง approve CR-070; จ่าย T-72 หลัง approve CR-071
