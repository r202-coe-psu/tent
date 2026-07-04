---
title: SOP Ratio Reference Table — T-18.1 audit artifact
status: signed off
created: 2026-06-29
updated: 2026-07-01
task: T-18.1 (Audit SOP handbooks → reference); sign-off ปิดที่ T-18.5
related: [CR-006, CR-021, QR-001-T18-Clarification]
provenance:
  repo_head: c16e487
  sources:
    - source_file: docs/source/handbooks/thai.txt        # ปภ. 2565
      sha256: 5307305300cf767c46c23a6deb894cacee4dc9e25f942e6d3389e40a77151d94
      commit: 7e1e840
    - source_file: docs/source/handbooks/sphere.txt      # Sphere Handbook 2018
      sha256: 256b3e4163b5bd0ec8191deecd56b4a90c65b639ee4962136701a5d349cd54fe
      commit: 7e1e840
---

# SOP Ratio Reference Table

## Purpose

เอกสารอ้างอิงสำหรับเตรียม **sign-off ค่า SOP ratio (T-18.5)** — ตาราง 20 keys ตาม scope CR-021
(19 keys จาก handbook + อัตราอาสา 1 ค่า). เป็น **reference artifact ไม่ใช่ schema truth** — การอนุมัติค่าใน
เอกสารนี้ไม่ถือว่าอนุมัติ schema change หรือ runtime adoption.

## Inputs

Inputs are used for traceability and sign-off preparation only. If conflicts exist, governance decisions
take precedence.
- `thai.txt` — คู่มือศูนย์พักพิง ปภ. 2565 (handbook)
- `sphere.txt` — Sphere Handbook 2018 (handbook)
- `QR-001-T18-Clarification.md` — source verbatim + line origin
- `CR-006` (ratio model) + `CR-021` (scope) — reference set (governance), ไม่ใช่ evidence source

## Ratio Reference Table (20 rows)

> `recommended_default` = documentation recommendation derived from cited sources or explicit
> recommendation_rule only. **Non-binding** — does not imply schema, seed, runtime, or implementation
> defaults. ค่าจริงต้องผ่าน PO sign-off.

| # | key | kind | source_basis (ปภ. / Sphere · line) | recommendation_rule | recommended_default | decision_status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `water_l_per_person_day` | multiply | 7.5–15 (TH L2308) / ≥15 (SP L5846) | conflict → stricter | **15** | approved 2026-07-01 |
| 2 | `drinking_water_l_per_person_day` | multiply | 2.5–3 (TH L2315) / 2.5–3 (SP L5913) | agree → upper bound | **3** | approved 2026-07-01 |
| 3 | `cooking_water_l_per_person_day` | multiply | 3–6 (TH L2315) / 3–6 (SP L5916) | agree → upper bound | **6** | approved 2026-07-01 |
| 4 | `hygiene_water_l_per_person_day` | multiply | 2–6 (TH L2316) / 2–6 (SP L5915) | agree → upper bound | **6** | approved 2026-07-01 |
| 5 | `kcal_per_adult_day` | multiply | 1,500–2,000 (TH L1993) / ~2,100 (SP) | upper bound ปภ. | **2,000** | approved 2026-07-01 |
| 6 | `people_per_tap` | divide | 80 (TH L2505) / 250 (SP L5850) | conflict → stricter (น้อยกว่า) | **80** | approved 2026-07-01 |
| 7 | `people_per_handpump` | divide | — / 500 (SP L5851) | use source | **500** | approved 2026-07-01 |
| 8 | `people_per_open_well` | divide | — / 400 (SP L5852) | use source | **400** | approved 2026-07-01 |
| 9 | `people_per_laundry` | divide | ≥100 (TH L2512) / 100 (SP L5853) | agree | **100** | approved 2026-07-01 |
| 10 | `people_per_bathing` | divide | — / 50 (SP L5854) | use source | **50** | approved 2026-07-01 |
| 11 | `people_per_toilet_female` | divide | 20 (TH L2508) / 20 (SP L6328) | agree | **20** | approved 2026-07-01 |
| 12 | `people_per_toilet_male` | divide | 35 (TH L2510) / — | use source (ปภ.) | **35** | approved 2026-07-01 |
| 13 | `people_per_dining_point_adult` | divide | 20–50 (TH L2523) / — | stricter (น้อยกว่า) | **20** | approved 2026-07-01 |
| 14 | `people_per_dining_point_child` | divide | 10–20 (TH L2525) / — | stricter (น้อยกว่า) | **10** | approved 2026-07-01 |
| 15 | `m2_per_person_living` | multiply (min) | 3.5 (TH L2504) / 3.5 (SP L13035) | agree (min) | **3.5** | approved 2026-07-01 |
| 16 | `m2_per_person_living_cold` | multiply (min) | — / 4.5–5.5 (SP L13037) | min requirement | **4.5** | approved 2026-07-01 |
| 17 | `m2_per_person_total` | multiply (min) | 30–45 (TH L2502) / 30·45 (SP L12893) | upper (min ที่มากกว่า) | **45** | approved 2026-07-01 |
| 18 | `max_waterpoint_distance_m` | threshold | 500 (TH L2505) / <500 (SP L5864) | ceiling | **500** | approved 2026-07-01 |
| 19 | `max_queue_minutes` | threshold | — / <30 (SP L5867) | ceiling | **30** | approved 2026-07-01 |
| 20 | `people_per_volunteer` | divide | — / — (ไม่มีใน handbook) | **project policy (ไม่ใช่ handbook)** | **50** | approved 2026-07-01 (provisional — may be revised) |

> numeric guard: ไม่มี value ใน `recommended_default` ที่ trace ไม่กลับ `source_basis` หรือ
> recommendation_rule ยกเว้น #20 (`people_per_volunteer`) — ค่า **50** มาจาก PO decision (ประชุม
> 2026-07-01) ไม่ใช่ handbook source; ทำเครื่องหมาย provisional ตามที่ PO ระบุว่า "อนาคตอาจจะแก้"

## Decisions Required (Q-T18-3) — ปิดแล้ว (ประชุม PO 2026-07-01)

| รายการ | Decision owner | Decision output | สถานะ |
| --- | --- | --- | --- |
| ค่า 19 handbook keys (#1–19) | PO / domain expert | approved ทั้งหมดตามตาราง | ✅ ปิด 2026-07-01 |
| `people_per_volunteer` (#20) | PO | approved = 50 คน/อาสา 1 คน (provisional) | ✅ ปิด 2026-07-01 |
| rice/egg consumption (ย้ายไปครัว — CR-021) | PO + Module C/D | รับทราบ — ค่าจริงเป็นหน้าที่ Module C/D ต่อไป | ✅ ปิด 2026-07-01 |

## T-18.2 Unit-Fit Notes

- 19 handbook keys: unit ตามชื่อ key (ลิตร/คน/วัน, คน/จุด, ตร.ม./คน, เมตร, นาที)
- **potential overlap identified between SOP ratios and item consumption definitions**
  (`item_master.consumption_rate`, CR-013) **for food materials; governance decision pending** — CR-021
  เสนอให้ rice/egg อยู่ที่ครัว (item_master/recipe) ไม่ใช่ sop_profile.ratios

## Provenance

ค่า source ทุกค่า trace กลับ handbook ด้วย `source_file · line` (ดู `source_basis`) + sha256/commit ใน
frontmatter `provenance`. source verbatim เต็มอยู่ใน `QR-001-T18-Clarification.md` (ภาคผนวก Q-T18-2).
ถ้า source ถูก re-extract → re-pin sha256/commit + re-verify line.

## Out of Scope

- เอกสารนี้ **ไม่ใช่ source of truth ของ schema** — schema จริงอยู่ที่ `docs/data/schema.md`
- การ approve ค่าในเอกสารนี้ **≠ approve schema change**
- `Approval of this document does not imply implementation approval or automatic runtime adoption.`
- **rice / egg** = food consumption → Module C/D (`item_master.consumption_rate` / `recipe`, CR-013) —
  ไม่อยู่ในตารางนี้ (ออกจาก sop_profile ตาม CR-021)
