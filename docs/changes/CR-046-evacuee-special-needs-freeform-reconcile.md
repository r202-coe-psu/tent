---
id: CR-046
title: "evacuee.special_needs enum → free-form string[]"
status: proposed        # proposed | approved | done | rejected | superseded
date: 2026-07-24
requested_by: developer team B (2026-07-24) — code review finding (undocumented change already in code)
decided_by: project owner (2026-07-24) — tracking method + retroactive-keep decided; CR itself pending approval
layer: volatile         # field type change on existing doc type (evacuee) — volatile spec
affects:
  - docs/data/schema.md §1.1 — `special_needs` enum → `[str]`
  - frontend/src/lib/features/people/domain/people.ts
---

# CR-046 — evacuee.special_needs free-form

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** `evacuee.special_needs` เปลี่ยนจาก fixed enum (`elderly`,`disabled`,`pregnant`,
  `infant`,`chronic_illness`,`bedridden`) เป็น free-form `[str]` (nonempty, trimmed) — เปลี่ยนไปแล้วใน
  code (`people.ts:107,220`) โดยไม่มี CR/ไม่แก้ `schema.md`
- **เพื่อใคร/ทำไม:** retroactive-document การเปลี่ยนที่ merge เข้า branch ไปแล้ว ให้ `schema.md`
  ตรงกับ code จริง
- **dev ต้อง build อะไร:** แก้ `schema.md §1.1` field `special_needs` เป็น `[str]`
- **กระทบ schema/scope:** ไม่ bump `schema_v` — เป็น **widening** (enum ⊂ free-form string ไม่ตัด
  backward-compat) ไม่ใช่ breaking change

> ⏳ **`proposed`** — tracking method (CR file) + keep-string[]-retroactively ทั้งสองข้อ **decided by
> owner (2026-07-24)**; รอ owner เคาะ `status: approved`

---

## Why

Code review ของ diff บน branch พบว่า `evacuee.special_needs` ถูกเปลี่ยนจาก hardcoded enum เป็น
free-form `string[]` แล้วใน `people.ts` (ลบ `specialNeedSchema`/`SpecialNeed`/`SPECIAL_NEED_CHIPS`)
โดยไม่มี Change Record และไม่ได้แก้ `docs/data/schema.md` — ขัดกับ `change-management.md` §2 (เปลี่ยน
enum/type ของ field ที่ persist แล้วต้องมี CR) และขัดกับ **CR-023** (line 213) ที่ตั้งใจไว้ว่า
`evacuee.special_needs` จะคง hardcode enum จนกว่าจะมี CR แยกสำหรับ "Phase 2" (wire ไป master_data)

Owner เคาะ (session 2026-07-24, ผ่าน AskUserQuestion):
1. Track ผ่าน **CR file** ใน `docs/changes/` (ไม่ใช่ Notion/decision-sync note)
2. **เก็บ** free-form `string[]` ไว้ (ไม่ revert กลับ enum) — formalize retroactively แทนที่จะรอ
   Phase-2 CR ตามที่ CR-023 เคยตั้งเงื่อนไขไว้ — เท่ากับ CR นี้ **supersede** เงื่อนไขนั้นของ CR-023

## Change (before → after)

| ส่วน | Before | After |
| --- | --- | --- |
| `docs/data/schema.md §1.1` field `special_needs` | `[enum(elderly,disabled,pregnant,infant,chronic_illness,bedridden)]` opt, default `[]` | `[str]` (nonempty, trimmed) opt, default `[]` — free-form, ไม่ผูก whitelist |
| `people.ts` domain type (`Evacuee.special_needs`) | อยู่แล้ว: `string[]` (`people.ts:107`) | ไม่เปลี่ยน — reconcile doc ให้ตรง code |
| `people.ts` Zod (`evacueeInputSchema.special_needs`) | อยู่แล้ว: `z.array(z.string().trim().min(1)).default([])` (`people.ts:220`) | ไม่เปลี่ยน — reconcile doc ให้ตรง code |
| removed symbols | `specialNeedSchema`, `SpecialNeed`, `SPECIAL_NEED_CHIPS` (ยืนยัน 0 hits ใน `frontend/src` — ลบไปแล้วก่อน CR นี้) | N/A — ไม่มีอะไรต้องลบเพิ่ม, บันทึกไว้เป็น record เท่านั้น |
| CR-023 §Proposed Change line 213 | ระบุว่า `evacuee.special_needs` "ยัง hardcode enum … จนกว่า Phase 2 wire" | **superseded โดย CR-046** — ปัจจุบันเป็น free-form แล้ว ไม่รอ Phase 2 CR อีก (matching engine ที่เคย map `children`↔`infant` ต้องอ่าน string ตรงตัวแทน — ดู §Impact) |

## Impact

### Doc
- `docs/data/schema.md §1.1` — แก้ field `special_needs` เป็น `[str]`
- `docs/changes/CR-023-shelter-form-v4.md` — ไม่แก้เนื้อ CR เดิม (ปิดแล้ว/approved) แต่ CR-046 นี้
  cross-ref บันทึกว่า supersede เงื่อนไข "Phase 2 gate" ของบรรทัด 213


### Code
- ไม่มี — `Evacuee` interface, Zod schema, UI form ไม่ต้องแก้ (อยู่ในสภาพ free-form อยู่แล้ว)

### Downstream (ไม่ blocking — ติดตามแยก)
- Matching/suggestion engine (ถ้ามี logic ที่ map ค่าเฉพาะ เช่น `children`↔`infant`) ต้อง handle
  free-form string แทน enum คงที่ — ไม่พบ logic แบบนี้ใน `frontend/src` ตอน review (ค้นหา "infant"/
  "chronic_illness" ใน matching/suggestion code — 0 hits) จึงไม่ block CR นี้; ถ้าพบภายหลังให้เปิด CR แยก
- worker/backend — ค้นหา `special_needs` ใน `backend/` และ `worker/` — 0 hits ไม่มี consumer ฝั่ง
  public plane ที่ผูก enum นี้ ไม่กระทบ

### Test
- `people.test.ts:37` — assertion เดิม (`special_needs` default `[]`) ยังผ่าน ไม่ต้องแก้
- เพิ่ม case ยืนยันรับ arbitrary nonempty string (ไม่ผูก whitelist) — ไม่มี test ปัจจุบันยืนยันพฤติกรรมนี้

## Migration

N/A — ไม่ bump `schema_v`. ค่า enum เดิม (เช่น `"elderly"`) เป็น subset ของ "any nonempty string"
อ่านผ่านได้ตรง ๆ ไม่ต้อง rename/transform, ไม่ต้อง batch migration script

## Decision log
- 2026-07-24 — proposed; source: code review finding บน branch `refactor-ui` (undocumented change,
  no CR, no schema.md update)
- 2026-07-24 — tracking method **RESOLVED (owner, via AskUserQuestion)**: CR file ใน `docs/changes/`
- 2026-07-24 — keep-vs-revert **RESOLVED (owner)**: เก็บ free-form `string[]` ไว้, formalize
  retroactively — **supersede** เงื่อนไข "Phase 2 gate" ที่ CR-023 line 213 ตั้งไว้
- 2026-07-24 — รอ owner review + set `status: approved` ก่อน merge เข้า `docs/data/schema.md` จริง
  (ตาม spec-authoring §1 — ร่างได้ แต่ไม่เคาะ approved เอง)
