---
id: CR-047
title: ตัด Household Shelter ID/QR (FR-22 / T-05) — household check-in/out ใช้ Person ID/QR ของหัวหน้าครัวเรือนแทน
status: proposed
date: 2026-07-24
requested_by: developer team-B
decided_by: project owner
layer: volatile
affects:
  - docs/prd/phase-r2-foundation.md §2.1, §2.3 (UJ-5), §3 (Glossary), §4.1, FR-22, §6.1
  - docs/task-breakdown/02-people.md T-04, T-05 (removed), T-06, effort totals, flow diagrams
  - FR-23 (wording only — drops the Household ID bullet)
---

# CR-047 — Remove Household Shelter ID/QR (FR-22 / T-05)

## TL;DR

Household ไม่มี Shelter ID/QR ของตัวเองอีกต่อไป — household check-in/out, รับของแจก, และค้นหาทั้งครัวเรือน
ใช้ **Person ID/QR ของหัวหน้าครัวเรือน (head)** แทน FR-22 และ T-05 ถูกตัดออกจาก scope (ID สงวนไว้ ไม่นำไปใช้ซ้ำ)
dev ต้องอัปเดต PRD (`phase-r2-foundation.md`) และ task-breakdown (`02-people.md`) ตาม §Change ด้านล่าง
ไม่กระทบ schema_v หรือ data model — household ไม่เคยมีฟิลด์ QR/Shelter ID แยกที่ persist อยู่แล้ว และโค้ดปัจจุบัน
(`household-pre-register-summary.svelte` ฯลฯ) ก็ออก QR ให้เฉพาะ head evacuee (`EvacueeQrModal`) อยู่แล้ว ไม่มี
household-level QR ที่ implement ไว้ให้ต้องรื้อ

## Why

T-05 (Household Shelter ID/QR generation) ยังไม่เคย implement — เมื่อลง code จริง (household pre-registration /
post-arrival grouping, PR ปัจจุบันของ Team B) พบว่า household ระบุตัวได้ผ่าน Person ID/QR ของหัวหน้าครัวเรือน
ที่ออกอยู่แล้วตาม baseline (FR-x) การออก Shelter ID/QR อีกชุดที่ผูกกับ household โดยเฉพาะเป็นการทำงานซ้ำซ้อน
(สแกน 2 QR เพื่อสื่อความหมายเดียวกันคือ "ครัวเรือนนี้") โดยไม่ได้เพิ่มความสามารถอะไรที่ Person ID/QR ของ head
ทำไม่ได้อยู่แล้ว — เจ้าของโครงการตัดสินใจตัดออกทั้ง PRD และ task-breakdown แทนที่จะ build ตามสเปกเดิม

## Change

### 1. `docs/prd/phase-r2-foundation.md`

| Section | Before | After |
| --- | --- | --- |
| §2.1 (Registration Officer JTBD) | "...ผูกสมาชิกเข้าด้วยกัน และออก Household Shelter ID/QR โดยไม่ช้ากว่า..." | ตัดวลี "และออก Household Shelter ID/QR" ออก |
| §2.3 UJ-5 Climax | "ระบบออก Household Shelter ID/QR หนึ่งใบ + Person ID รายคน..." | "ระบบออก Person ID/QR รายคน (ใช้ QR ของหัวหน้าครัวเรือนแทนทั้งครัวเรือนได้)..." |
| §3 Glossary — Household | "...มี Household Shelter ID/QR ของตนเอง 1 ต่อ 1 กับครัวเรือน" | ตัดประโยคนี้ออก; เพิ่มหมายเหตุว่า household ระบุตัว/ค้นหาผ่าน Person ID/QR ของ head |
| §4.1 Feature description | "...และออก Household Shelter ID/QR เพิ่มจาก Person ID เดิม..." | ตัดวลีนี้ออก |
| FR-22 | Requirement เต็ม (Household Shelter ID unique + QR scan + ใช้ค้นหา/check-in) | Mark **`[REMOVED — ดู CR-047]`**; เก็บหัวข้อ/เลขไว้ (ไม่ reuse), 1 บรรทัดชี้เหตุผล + ตัวแทน (head's Person ID/QR) |
| FR-23 (Household Search & Check-in/out) | "...ทั้ง Household ID และ Person ID ใช้ค้นหา/check-in ได้" | "...ค้นหา/check-in ผ่าน Person ID/QR ของสมาชิกคนใดก็ได้ในครัวเรือน (ปกติคือ head)" |
| §6.1 In Scope (R2) | "Household registration + Household Shelter ID/QR + household search + household check-in/out" | "Household registration + household search + household check-in/out (ใช้ Person ID/QR ของ head)" |

### 2. `docs/task-breakdown/02-people.md`

- ตัดแถว `T-05` ออกจากตาราง Features/Tasks; ปรับ `Depends` ของ `T-06` จาก `T-05` → `T-04`
- ปรับยอดรวม Raw MD `28 → 24`, Adj MD `18.5 → 16` (ตัด T-05: Raw 4 / Adj 2.5) ทั้งในตารางหลักและ §Effort by phase
- ลบ section `### T-05 — Household Shelter ID/QR generation (FR-22)` ทั้ง block (แทนด้วยหมายเหตุสั้น ๆ ชี้ CR-047)
- T-04 flow (Path A/B/C): แทนทุกจุดที่เขียน "ออก Shelter ID + QR (T-05)" ด้วย "ใช้ Person ID/QR ของหัวหน้าครัวเรือน (head) ที่ออกไปแล้วตอนลงทะเบียน — ไม่ออก QR ระดับ household แยก"
- T-06 DoD: "ค้นหาได้ทั้งจาก scan QR (T-05) และพิมพ์ค้น..." → "ค้นหาได้ทั้งจาก scan Person QR ของสมาชิก (ปกติคือ head) และพิมพ์ค้น..."
- Mermaid flow diagrams (Path A / Path B / Path C, header): ลบ `T-05` ออกจากหัวข้อ chain (`T-04 → T-05 → T-06` → `T-04 → T-06` ฯลฯ) และแทน step `auto-generate Shelter ID + QR (T-05)` ด้วยหมายเหตุว่าใช้ QR ของ head ที่มีอยู่แล้ว
- แก้บรรทัด tagline ใต้ H1 ("People & Search — household, member, **shelter ID/QR**, check-in/out, pet/asset, zone allocation") ตัดคำว่า "shelter ID/QR" ที่หมายถึง household ออก (เหลือ Person QR อยู่ใน baseline อยู่แล้ว)

## Impact

- **Docs:** `docs/prd/phase-r2-foundation.md`, `docs/task-breakdown/02-people.md` (รายละเอียดตาม §Change)
- **Code:** ไม่มี — ไม่เคย implement household-level QR generation; `household-pre-register-summary.svelte` และ flow อื่นออก QR ให้ head evacuee ผ่าน `EvacueeQrModal` (person-level) อยู่แล้ว ไม่ต้องแก้/รื้อ
- **Schema:** ไม่กระทบ — `household` ไม่มีฟิลด์ QR/Shelter ID แยกใน `docs/data/schema.md` อยู่แล้ว, ไม่ bump `schema_v`
- **role-permission-matrix.md, kickoff.md, 00-baseline.md, teamplanning.md:** ยังพูดถึง Household Shelter ID/QR อยู่ — **นอก scope ของ CR นี้ตามที่เจ้าของโครงการสั่ง** (2026-07-24); ทิ้งไว้เป็น follow-up แยกถ้าต้องการ sync ทีหลัง

## Migration

N/A — ไม่มี schema/persisted-doc shape เปลี่ยน ไม่มี data migration

## Decision log

- 2026-07-24 — proposed; scope ยืนยันกับเจ้าของโครงการ: ตัด FR-22/T-05 ออกทั้งหมด (ใช้ Person QR ของ head แทน),
  แก้เฉพาะ `phase-r2-foundation.md` + `02-people.md` เป็นหลัก — ไม่ไล่แก้ `role-permission-matrix.md` /
  `kickoff.md` / `00-baseline.md` / `teamplanning.md` ในรอบนี้
