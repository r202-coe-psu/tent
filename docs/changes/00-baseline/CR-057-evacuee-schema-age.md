---
id: CR-057
title: Evacuee `age` — เพิ่ม field เก็บอายุตอนนี้ ในชั้น domain เท่านั้น (snapshot, อิสระจาก `birth_year`); schema_v evacuee → 5
status: done
date: 2026-07-28
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1 (evacuee)
  - schema_v evacuee 3 (code) → 5
  - frontend/src/lib/features/people/domain/people.ts
  - frontend/src/lib/features/people/index.ts
---

# CR-057 — Evacuee `age`

> **สรุป (TL;DR):** เพิ่ม field `age` (int, opt) ใน `Evacuee`/`evacueeInputSchema` เป็น snapshot
> อายุตอนนี้ อิสระจาก `birth_year` (ไม่ derive ไปมา), bump `schema_v` evacuee จาก `3` (ค่าปัจจุบัน
> ใน code) เป็น `5`, และ export helper `evacueeAgeYears()` ผ่าน barrel — **เฉพาะชั้น domain**
> (`docs/data/schema.md`, `people.ts`, `index.ts`) เท่านั้น. **ไม่แก้ UI** — ฟอร์มลงทะเบียน 3 จุดที่
> มีช่อง "อายุ" อยู่แล้ว (ที่ปัจจุบันแปลงค่าเป็น `birth_year` แล้วทิ้ง) และการ์ดแสดงผลอายุยังคงพฤติกรรม
> เดิมทุกจุด — จะเดินสาย UI ให้เขียน/อ่าน field `age` จริงเป็น CR แยกในอนาคต (scope ถูกจำกัดโดย
> project owner ให้อยู่แค่ domain ก่อน)

## Why

Staff จำนวนมากรู้ "อายุประมาณ" แต่ไม่รู้ปีเกิดจริง — เก็บอายุตรงๆ เป็น field แยกจาก `birth_year`
(ซึ่งเป็น พ.ศ. คงที่) ทำให้ข้อมูลตรงกับสิ่งที่กรอกมากกว่าการ derive ไปมา `docs/data/schema.md` §1.1
เดิมมีแค่ `birth_year`; CR นี้เปิด field ใหม่ในชั้น domain ให้พร้อมใช้ก่อน โดย **จงใจไม่แตะ UI** ในรอบนี้
(project owner ตัดสินใจจำกัด scope ให้เหลือแค่ `schema.md` + `people.ts` + `index.ts` เพื่อลด blast
radius ของการเปลี่ยนแปลงรอบนี้)

## Change

### 1. Database Schema (`docs/data/schema.md` §1.1 `evacuee`)

**Before (schema_v 4 ตามที่ doc บันทึกไว้ — เพิ่ม `photo`, CR-054 approved แต่ยังไม่ implement ในโค้ด):**
- ไม่มี field เก็บอายุ — มีแค่ `birth_year`

**After (schema_v: 5):**

| Field | ชนิด | req | สถานะ | คำอธิบาย / หมายเหตุ |
| --- | --- | --- | --- | --- |
| `age` | int | opt | **[NEW]** | อายุ (ปี) ณ ตอนกรอกล่าสุด — snapshot ตรงๆ ไม่ derive จาก/ไปเป็น `birth_year`; ทั้งสอง field เก็บอิสระจากกัน |

`birth_year` ไม่เปลี่ยนแปลง (ยังคง int, opt, พ.ศ. 4 หลัก, อิสระจาก `age`)

### 2. Domain Layer (`frontend/src/lib/features/people/domain/people.ts`)

- เพิ่ม `age?: number` ใน `Evacuee` interface และ `age: z.number().int().min(0).max(150).optional()`
  ใน `evacueeInputSchema` — ใช้ `z.number()` ธรรมดา ไม่ใช่ `z.coerce.number()` (ต่างจาก `birth_year`)
  เพราะ `z.coerce` ทำให้ `z.input` type ของ `age` กลายเป็น `unknown` ซึ่งพัง type-check ที่
  `household-pre-register-head.svelte` (spread `...initialData` เข้า `$formData` โดยไม่มี explicit
  override ให้ `age` เหมือนที่ `birth_year` มี) — เลือกใช้ `z.number()` เพื่อแก้ให้จบในไฟล์นี้ไฟล์เดียว
  โดยไม่ต้องแตะ UI (ไม่กระทบอะไรเพราะยังไม่มีจุดใน UI ที่ผูก `age` เข้ากับ form ตอนนี้)
- `createEvacuee` factory: ส่งผ่าน `age` เมื่อมีค่า, bump `schema_v` จาก `3` (ค่าเดิมใน code) เป็น `5`
- เพิ่ม helper `evacueeAgeYears(doc: { age?: number; birth_year?: number })`: คืนค่า `age` ถ้ามี,
  ไม่งั้น derive จาก `birth_year` (พ.ศ., offset `+543` ถูกต้อง), ไม่งั้น `null` — เตรียมไว้ให้ UI เรียกใช้
  ใน CR ถัดไป (ยังไม่มีจุดเรียกใช้จริงใน UI ตอนนี้)

### 3. Barrel (`frontend/src/lib/features/people/index.ts`)

- export `evacueeAgeYears` เพิ่มจาก `domain/people`

### 4. Test (`frontend/src/lib/features/people/domain/people.test.ts`)

- แก้ assertion เดิมที่ตายเพราะ schema_v bump: `expect(e.schema_v).toBe(3)` → `toBe(5)` (บรรทัดเดียว
  เท่านั้น — ไม่เพิ่ม test ใหม่ในรอบนี้ เพื่อคง scope ตามที่ owner กำหนด)

### สิ่งที่ยังไม่ทำในรอบนี้ (deferred — CR แยกในอนาคต)

- ฟอร์มลงทะเบียน 3 จุด (`evacuee-registration.svelte`, `household-pre-register-head.svelte`,
  `household-pre-register-summary.svelte`) — ช่อง "อายุ (ปี)" ที่มีอยู่แล้วยังคงพฤติกรรมเดิม (แปลง
  เป็น `birth_year` แล้วทิ้งค่า `age` ที่กรอก, ไม่เคยเขียนเข้า field `age` ใหม่)
- การ์ดแสดงผล (`evacuee-profile-personal-card.svelte`, `household-profile-head-card.svelte`,
  `household-profile-members-card.svelte`) — ยังคำนวณอายุจาก `birth_year` inline เหมือนเดิม
  (รวมถึงบั๊ก offset `+543` ที่ขาดใน 2 การ์ดหลัง ซึ่งยังไม่ได้แก้)

## Requirements

- **R-57-1** — `evacueeInputSchema`/`Evacuee` ต้องมี `age` (opt, int, 0–150)
- **R-57-2** — `createEvacuee` ต้องตั้ง `schema_v: 5` และส่งผ่าน `age` เมื่อมีค่า
- **R-57-3** — เอกสาร `evacuee` เก่า (ไม่มี `age`) ต้องอ่านได้ปกติ — ไม่ต้องมี migration function
  เพราะเป็น field เสริมล้วนๆ
- **R-57-4** — `evacueeAgeYears()` helper ต้อง export ผ่าน barrel พร้อมใช้ แต่**ไม่บังคับ**ให้มีจุด
  เรียกใช้จริงใน UI ในรอบนี้ (deferred)

## Impact

**Docs:**
- `docs/data/schema.md` §1.1 (evacuee, +`age`, schema_v → 5)

**Code & Tests:**
- `frontend/src/lib/features/people/domain/people.ts` (+`age`, `evacueeAgeYears`, schema_v bump)
- `frontend/src/lib/features/people/index.ts` (+export `evacueeAgeYears`)
- `frontend/src/lib/features/people/domain/people.test.ts` (1 บรรทัด — schema_v assertion 3→5)

**ไม่กระทบ (out of scope, deferred):** ฟอร์มลงทะเบียน UI และการ์ดแสดงผลอายุทั้งหมด

## Migration

Purely additive optional field — no lazy-migration function needed. Old `evacuee` docs simply lack
`age` (`undefined`) — ไม่กระทบการอ่านใดๆ เพราะไม่มี UI จุดใดอ่าน field นี้อยู่ในรอบนี้

`schema_v` jumps `3 → 5` in code, skipping `4` (`photo`, CR-054) which is `approved` but not yet
implemented in code as of this CR.

## Decision log

- 2026-07-28 — proposed (branch `CR-057-evacuee-schema-age` already named ahead of CR file — user
  asked to implement the `age` field; UI age inputs already existed but only fed `birth_year`)
- 2026-07-28 — owner decided (via clarifying questions): track as CR file in `docs/changes/`;
  `age` is an independent snapshot field, no derivation either direction with `birth_year`; bump
  `schema_v` to `5`, treating the unimplemented `photo` (`4`, CR-054) as a separate pending change
- 2026-07-28 — approved by project owner; implementation started (initially included UI wiring +
  display-card fixes)
- 2026-07-28 — **scope narrowed by project owner**: revert all UI/test-suite changes except the
  domain layer — CR-057 now touches only `docs/data/schema.md`, `people.ts`, and `index.ts` (plus
  one unavoidable one-line test fix to keep the existing suite green); UI wiring deferred to a
  future CR
- 2026-07-28 — done (domain-only scope)
