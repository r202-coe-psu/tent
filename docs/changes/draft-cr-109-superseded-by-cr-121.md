---
id: draft
title: ปิด CR-109 (`meal_distribution`) เป็น superseded โดย CR-121 + ทิ้งร่าง `draft-meal-distribution-onsite-scan` + แก้ข้อความค้างใน schema.md §2.7
status: proposed
date: 2026-10-07
updated: 2026-10-07
requested_by: ทีม frontend (Distribution Desk / Station 4 — ตรวจ branch ร่างที่ค้าง)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/CR-109-meal-distribution-onsite-scan.md (frontmatter `status` + หมายเหตุ superseded)
  - docs/changes/_index.md แถว CR-109
  - docs/data/schema.md §2.7 ย่อหน้า "`actual_yield` vs `served` (CR-084)"
  - branch `docs/draft-meal-distribution-onsite-scan` (local + origin) — ไม่ merge
  - schema_v — ไม่เปลี่ยน
  - code — ไม่กระทบ (`features/meal-distribution` ไม่มีบน `develop` แล้ว; flow จริงคือ `features/distribution`)
---

# ปิด CR-109 เป็น superseded โดย CR-121

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** mark CR-109 `approved → superseded` (โดย CR-121); ทิ้ง branch ร่าง `docs/draft-meal-distribution-onsite-scan` โดยไม่ merge; แก้ schema.md §2.7 ที่ยังบอกว่า flow แจกหน้างาน "ยังไม่มีในระบบ" ให้ชี้ไป §2.30 `distribution_log`
> - **ทำไม:** CR-121 ผนวก `meal_distribution` เข้า `distribution_log` แล้ว ("Absorbs & Supersedes CR-109", CR-121 §1.2 ข้อ 2) แต่ CR-109 และ `_index.md` ยังเป็น `approved` และ schema.md §2.7 ยังเป็นข้อความก่อน CR-121
> - **dev ต้อง build:** ไม่มี เป็นงานเอกสารล้วน
> - **กระทบ:** ทะเบียน CR + schema.md §2.7 (ข้อความอ้างอิง) — ไม่เปลี่ยนรูป doc, ไม่เปลี่ยนกติกา

## Why

**ที่มาของร่างที่ค้าง:** branch `docs/draft-meal-distribution-onsite-scan` (commit `d14f85469`, 2026-09-05, ยังไม่ merge) มีไฟล์เดียว `docs/changes/draft-meal-distribution-onsite-scan.md` ซึ่งเป็น **ร่างก่อนอนุมัติของ CR-109** (หัวเรื่อง/field/FR-MD-01..04 ตรงกัน). เนื้อหาทุกข้อถูกตัดสินหรือถูกแทนที่แล้ว:

| ข้อในร่าง | ผลลัพธ์ปัจจุบัน |
| --- | --- |
| doc type ใหม่ `meal_distribution:{ulid}` | CR-109 อนุมัติ (2026-09-06) → CR-121 ผนวกเข้า `distribution_log` (schema.md §2.30) |
| FR-MD-02 เพดาน `Σ portions ≤ actual_yield` แบบ hard-block | CR-109 เปลี่ยนเป็น soft warning → ความขัดแย้งกับ cap `allocated_qty` ติดตามใน `draft-meal-quota-window` FR-MQW-04 |
| FR-MD-03 กันรับซ้ำ (คน + เมนู + มื้อ) แบบ hard-block | CR-121 FR-DST-02 เปลี่ยนเป็นโควตาต่อมื้อ + override → ติดตามใน `draft-meal-quota-window` FR-MQW-01/05 |
| FR-MD-04 void แทน hard-delete | อยู่ใน `distribution_log` (`status='voided'`, `voided_at`, `voided_by`) |
| OQ1 ความหมายของ `meal_service.served` | CR-109 เคาะ Option 1A (กรอกมือเหมือนเดิม) |
| OQ2 `override_reason` | CR-109 ตัดออก → CR-121 นำกลับมาใน `distribution_log.override_reason` |
| OQ3 `recipe_id` req/opt | `distribution_log.meal_service_id` / `recipe_id` เป็น opt (§2.30) |

ไม่มีเนื้อหาในร่างที่ยังไม่ถูกบันทึกที่อื่น → merge ร่างนี้จะสร้าง CR ซ้ำซ้อนกับ CR-109.

**ทะเบียนไม่ตรงความจริง:** CR-121 frontmatter + §1.2 ข้อ 2 ระบุว่า supersede CR-109 แต่ `CR-109-meal-distribution-onsite-scan.md` (`status: approved`) และ `_index.md` แถว CR-109 (`approved`) ไม่มีการชี้ไป CR-121. CR อื่นที่ถูกแทนที่ใช้รูปแบบ `status: superseded` + `superseded_by` (เช่น CR-096, CR-102).

**ข้อความค้างใน schema.md §2.7:** ย่อหน้า "`actual_yield` vs `served` (CR-084)" ยังระบุว่าการบังคับเพดาน "เป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ" — flow นั้นมีแล้วคือ `distribution_log` (§2.30) + `/onsite/distribution`.

## Change

### Requirements
- **FR-CRS-01** — `CR-109-meal-distribution-onsite-scan.md` frontmatter: `status: approved` → `superseded`; เพิ่ม `superseded_by: CR-121`, `superseded_date: <วันที่ approve CR นี้>`, `note: ผนวก meal_distribution เข้า distribution_log (schema.md §2.30) ใน CR-121`; อัปเดต `updated:`; เพิ่มบรรทัดใน Decision log. เนื้อหาเดิมของ CR-109 คงไว้ไม่แก้
- **FR-CRS-02** — `_index.md` แถว CR-109: คอลัมน์สถานะ `approved` → `superseded`; ต่อท้ายหัวเรื่องด้วย "— **superseded โดย [CR-121](CR-121-spec-ticket.md)**" (รูปแบบเดียวกับ CR-032/CR-096)
- **FR-CRS-03** — schema.md §2.7 ย่อหน้า "`actual_yield` vs `served` (CR-084)": แทนวลี "การบังคับเพดานจริงเป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ" ด้วยการอ้างอิง "การแจกรายคนบันทึกใน `distribution_log` (§2.30, CR-121); กติกาเพดานยอดแจกดู §2.30". ไม่เปลี่ยนความหมายของ `served`/`actual_yield`/`MealVariance`; อัปเดต `updated:` และ `note:` ของ schema.md
- **FR-CRS-04** — branch `docs/draft-meal-distribution-onsite-scan` ไม่ merge > [NEEDS DECISION: (A) ลบทั้ง local และ `origin` หลัง CR นี้ approve — เนื้อหายังอยู่ใน git history ของ CR-109, (B) เก็บ branch ไว้เป็นประวัติ]

### Acceptance
- `CR-109-*.md` และ `_index.md` แสดง `superseded` + ลิงก์ไป CR-121 ตรงกัน
- ค้น `ยังไม่มีในระบบ` ใน schema.md §2.7 → ไม่พบ; ย่อหน้าชี้ไป §2.30
- ไม่มี field / enum / `schema_v` ใดใน schema.md เปลี่ยน
- branch ร่างถูกจัดการตาม FR-CRS-04 ที่เคาะ

## Impact
- docs: `CR-109-meal-distribution-onsite-scan.md`, `_index.md`, `schema.md` §2.7 (ข้อความอ้างอิงเท่านั้น)
- code / test / VDU: ไม่กระทบ
- ความสัมพันธ์: กติกาเพดานยอดแจกและโควตารับซ้ำที่ CR-109 เคยกำหนด ไม่ได้ตัดสินใน CR นี้ — อยู่ใน `draft-meal-quota-window` (FR-MQW-01, 04, 05). CR นี้ไม่ต้องรอ draft นั้น

## Migration
N/A — ไม่มี doc ที่ persist เปลี่ยนรูป

## Decision log
- 2026-10-07 — proposed (ตรวจ branch `docs/draft-meal-distribution-onsite-scan` แล้วพบว่าเป็นร่างก่อนอนุมัติของ CR-109 ซึ่งถูก CR-121 แทนที่แล้ว)
