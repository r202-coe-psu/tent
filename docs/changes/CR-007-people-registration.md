---
id: CR-007
title: "People Registration Schema — เพิ่ม Country"
status: approved
date: 2026-06-22
updated: 2026-06-23
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1 — schema_v 1 → 2 (เพิ่ม country)
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/src/lib/features/people/data/people.pouch.ts
  - frontend/src/lib/features/people/ui/evacuee-form.svelte
---

# CR-007 — People Registration Schema & Form

## Why

ปัจจุบัน Schema ของ `evacuee` ตาม Spec เดิมใน `docs/data/schema.md` ขาดข้อมูลประเทศต้นทาง (Country) ซึ่งต้องเพิ่มเข้าไปเพื่อสอดคล้องกับ Requirement การจัดเก็บข้อมูลผู้อพยพจริง

## Change

### 1. Spec mockup ↔ canonical schema reconciliation

| Spec เดิม (`docs/data/schema.md` §1.1) | การปรับปรุง | Decision |
| --- | --- | --- |
| ไม่มี `country` | เพิ่ม `country` | **Required field** (ชนิด enum สำหรับ map ภาษาอังกฤษกับภาษาไทย) ค่าเริ่มต้น `'THAILAND'` |
| `religion` เป็น `opt` | ปรับเป็น `req` | เพื่อประโยชน์ในการคำนวณ Food/Meal Plan ให้มีความถูกต้องและใช้วางแผนอาหาร Halal ได้แม่นยำขึ้น โดยใช้ `'buddhist'` เป็น default |

> **ตัดออก (2026-06-23):** `nationality` (สัญชาติ) และ `ethnicity` (เชื้อชาติ) ตัดออกจาก scope นี้แล้ว เหลือเฉพาะ `country` เพียงพอต่อความต้องการปัจจุบัน

### 2. Schema_v bump: 1 → 2

สำหรับเอกสาร `evacuee:{ulid}` เพิ่ม fields ใหม่:

| Field | Before (v1) | After (v2) |
| --- | --- | --- |
| `country` | ไม่มี | `str`, req, default `"THAILAND"` |
| `schema_v` | `1` | `2` |

*Migration Rules (v1 -> v2):* หากระบบดึง evacuee เดิมมาอ่านและ `schema_v` เป็น 1 จะ default `country` เป็น `"THAILAND"` อัตโนมัติ

*หมายเหตุ* การเก็บค่า `country` ให้เก็บเป็นตัวอักษรภาษาอังกฤษ (Uppercase) ตาม `schema.md` ส่วนการแสดงผลใน UI ให้ใช้การ map เพื่อแปลงเป็นภาษาไทย

### 3. Client-side & UI Form changes

| Layer | Before | After |
| --- | --- | --- |
| `domain/people.ts` | `Evacuee` interface ไม่มี `ประเทศ` | เพิ่ม field `country` |

## Impact

- `docs/data/schema.md` §1.1 — จำเป็นต้องอัปเดตเพื่อเพิ่ม `country` เปลี่ยน `religion` เป็นบังคับ และแก้ `schema_v`
- `docs/changes/_index.md` — เพิ่มแถวบันทึก CR-007
- `frontend/src/lib/features/people/domain/people.ts` — เพิ่ม field `country` เข้า interface `Evacuee` และ input schema; **ห้ามเพิ่ม `nationality` และ `ethnicity`** — ตัดออกจาก scope แล้ว หากมีใน branch/PR ให้ remove ออก

## Decision log

- 2026-06-22 — proposed
- 2026-06-22 — id field: ตัดสินใจเก็บ country เข้าสู่ root ของ `evacuee` document
- 2026-06-23 — scope reduced: ตัด `nationality` และ `ethnicity` ออก เหลือแค่ `country`
- 2026-06-23 — **approved** by project owner