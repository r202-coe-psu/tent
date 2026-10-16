---
id: CR-036
title: daily_calc doc type — persisted daily resource-calc snapshot (T-31.4)
status: approved        
date: 2026-07-08
requested_by: TEAM D -- T-31.4 (daily resource calc engine — data/repository layer)
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §2.15 (doc type ใหม่)
  - schema_v daily_calc 1 (ตั้งต้น)
  - frontend/src/lib/features/resource-calc/data/daily-calc.repository.ts
  - frontend/src/lib/features/resource-calc/data/daily-calc.remote.ts
  - frontend/src/lib/features/resource-calc/index.ts
  - docs/task-breakdown/07-B-sop.md T-31 (DoD — persistence)
---

# CR-036 — daily_calc doc type (persisted daily resource-calc snapshot)

## สรุป (TL;DR)
- **เปลี่ยนอะไร:** เพิ่ม doc type ใหม่ `daily_calc` ใน DB `shelter_{code}` — snapshot ผลการคำนวณทรัพยากรประจำวันของ engine T-31
- **เพื่อใคร/ทำไม:** T-31.4 เริ่ม persist ผลลัพธ์จริงลง CouchDB (T-31.1–31.3 เป็น domain ล้วน ยังไม่แตะ storage); ต้องลงทะเบียน doc type ให้ schema.md เป็น source-of-truth
- **dev ต้อง build อะไร:** repository (`get`/`runOnDemand`/`listRange`) เขียน/อ่าน `daily_calc:{date}` แบบ deterministic + idempotent; ก่อนเขียนทับต้องเก็บ revision เก่าลง `audit:{action:retro_edit}` ก่อน
- **กระทบ schema/scope:** schema.md **§2.15 ใหม่**, `schema_v daily_calc 1`; ไม่แตะ stable core (envelope/auth/sync); ไม่แก้ enum `audit` (ใช้ `retro_edit` ที่มีอยู่แล้ว)

## Why
- T-31 (FR-45) engine ผลิตผลการคำนวณ need/have/gap รายวัน. T-31.1–31.3 ส่งมอบเฉพาะ **domain** (สูตร `calc.formula.ts`, Zod `calc.schema.ts`, edge status) — ไฟล์ schema เขียนกำกับไว้ชัดว่า *"does NOT persist, touch schema.md, or define a CouchDB doc type (persisting `DailyCalcDoc` needs a CR — change-management §2)"*.
- T-31.4 คือขั้นแรกที่ **เขียน `daily_calc` ลงฐานข้อมูลจริง** → เข้าเงื่อนไข change-management §2 (เพิ่ม persisted doc shape + ตั้ง `schema_v`) ต้องมี CR ก่อน merge.
- ต้อง snapshot-lock ทุก input ที่ใช้ ณ เวลาคำนวณ (ratio / occupancy / stock / version) เพื่อให้ผลที่บันทึกไว้ **reproducible** แม้ profile/occupancy/stock จะเปลี่ยนภายหลัง (T-32 dashboard + drill-down อ่านค่านี้).

## Change
เพิ่ม `docs/data/schema.md §2.15` — doc type ใหม่ (before → after: ไม่มี → มี):

### 2.15 `daily_calc` — `daily_calc:{date}` (deterministic — 1 doc/วัน/ศูนย์) · **schema_v 1**

> Snapshot ผลการคำนวณทรัพยากรประจำวันของ engine T-31 (FR-45). `_id` deterministic ต่อวัน (`daily_calc:2026-07-08`) → **idempotent**: รันซ้ำวันเดียวกันเขียนทับ doc เดิม (ไม่สร้างซ้ำ). Input ทั้ง 3 (occupancy, effective ratio, stock) อ่านผ่าน barrel ของ peer feature เท่านั้น (people / sop-ratios / operations). ค่าทุกตัวถูก freeze ณ เวลาคำนวณเพื่อให้ผล reproducible. ทับข้อมูลเดิม → เขียน `audit:{action:retro_edit}` (เก็บ `_rev` + ผลเดิม) **ก่อน** เขียนทับ.

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `formula_v` | str | req | เวอร์ชันสูตร (`FORMULA_V`) ที่ผลิตผลชุดนี้ — algorithm version ไม่ใช่ schema |
| `sop_profile_version` | int>0 | req | `version` ของ effective SOP profile (override active ?? master) ที่ใช้ (CR-006) |
| `ratio_snapshot` | {str:num} | req | ratio ทุกคีย์ที่ freeze ตอนคำนวณ. คีย์ **generic string** (ไม่ผูก whitelist 20 keys — engine domain-agnostic); `{}` ว่างได้ |
| `occupancy_snapshot` | num≥0 | req | headcount ที่ `current_stay.status = active` (physically present, CR-035 stay-status v3) ณ เวลาคำนวณ |
| `as_of` | ts | req | ISO-8601 UTC ตอนจัดทำ snapshot |
| `stock_snapshot` | {str:num\|null} | req | ยอดคงเหลือต่อ resource ที่ใช้; `null` = ไม่ sync / ไม่มี mapping |
| `results` | ResourceCalcResult[] | req | ผลรายแถว: `ordinal,key,kind,input_valid,ratio,need,have,gap,status,data_status,as_of` (T-31.1/31.3) |

> ใช้ envelope มาตรฐาน `BaseDoc` (`_id`,`type`,`schema_v`,`shelter_code`,`created_at`,`updated_at`,`created_by`). append หรือ overwrite เท่านั้น — ไม่ mutate in place.
> **Index:** `(_id)` (deterministic; `listRange` ใช้ bounded `startkey`/`endkey` = `daily_calc:{from}`..`daily_calc:{to}` ไม่สแกนทั้ง collection)

## Impact
- **docs:** schema.md §2.15 ใหม่ (หลังจากเคาะ). ไม่แตะ §2.12 `audit` — action `retro_edit` มีอยู่ใน enum แล้ว
- **code:** `features/resource-calc/data/daily-calc.repository.ts` (interface + `DailyCalcRecord` envelope + guard), `daily-calc.remote.ts` (impl), `index.ts` (barrel widen), `daily-calc.remote.test.ts`
- **peers (อ่านผ่าน barrel):** `people` (`listEvacuees` → count `active`/present, CR-035), `sop-ratios` (`getActiveSopProfile`, `SOP_RATIO_KIND`), `operations` (`getBalance`), `shared` (`createAuditEntry`)
- **downstream:** T-32 dashboard / drill-down (FR-46) จะอ่าน `daily_calc` แทน provisional provider ปัจจุบัน

## Migration
Doc type ใหม่ — **ยังไม่มี doc เดิมในฐานข้อมูล ไม่ต้อง backfill**. `schema_v` ตั้งต้น = 1 (`DAILY_CALC_SCHEMA_VERSION`). Zod `dailyCalcDocSchema` (T-31.2) เป็น validation boundary; repository `.parse()` ก่อน persist.

## Open decisions — ปิดแล้ว

> ~~NEEDS DECISION 1~~ → **ปิดที่ [CR-042](CR-042-daily-sop-calc-follow-up.md) OD-1=A** (เพิ่ม `ratio_source` + `sop_override_id` + `sop_override_version` · schema_v 2)

> ~~NEEDS DECISION 2~~ → **ปิดที่ [CR-042](CR-042-daily-sop-calc-follow-up.md) OD-2=B** (hardcode `have` map ใน code + ตารางใน CR-042)

## Decision log
- 2026-07-08 — proposed as CR-035; renumbered CR-035→CR-036 (2026-07-09) to resolve number collision (PM). track = ไฟล์ CR ตามที่เจ้าของสั่ง; code T-31.4 พร้อมและผ่าน gate (`pnpm check` 0 error, unit test 8/8, lint สะอาด) รอเคาะ Open decisions + approve ก่อน apply schema.md §2.15
- 2026-07-09 — approved by project owner. Open decisions will be resolved in a follow-up task.
- 2026-07-12 — applied `schema.md §2.15` (baseline: 7 fields ตรงกับ `dailyCalcDocSchema` ที่ code persist จริง). Open decision #1 (`ratio_source`/`sop_override_id`) + #2 (`have` mapping) ยังเลื่อนเป็น follow-up — ไม่รวมใน baseline นี้.
- 2026-07-15 — Open decision #1/#2 ย้ายไปปิดที่ [CR-042](CR-042-daily-sop-calc-follow-up.md) (`proposed`) พร้อม OD-3 scheduled run + OD-4 downstream feed; คู่ feature flow `docs/features/daily-sop-resource-calc-flow.md`.
- 2026-07-23 — Open decision #1/#2 **ปิด** ผ่าน CR-042 `approved` (OD-1=A · OD-2=B · OD-3=A · OD-4=C). schema.md §2.15 bump เป็น schema_v 2.
