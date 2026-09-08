---
id: CR-114
title: Staff UI — ผู้ติดต่อหลัก for `head_evacuee_id` (schema field unchanged)
status: approved
date: 2026-09-08
updated: 2026-09-08
requested_by: เจ้าของโครงการ (grilling #249 code-review Q4=B)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - CONTEXT.md (glossary already documents Primary Contact; no schema change)
  - frontend/src/lib/features/people/domain/unified-registration.ts (`PRIMARY_CONTACT_LABEL`)
  - frontend/src/lib/features/people/ui/unified-registration-member-card.svelte
  - frontend/src/lib/features/people/ui/unified-registration-form.svelte
why: >-
  Unified registration must not use hierarchical 「หัวหน้าเอกสาร」 wording for member[0].
  Staff-facing copy that means `head_evacuee_id` uses ผู้ติดต่อหลัก (Primary Contact).
  Couch field name `head_evacuee_id` stays unchanged.
migration: N/A — UI/copy only; no schema_v bump
tracking_note: >-
  track=CR file. Owner locked Q4=B in #249 grill/code-review 2026-09-08.
  Remaining 「หัวหน้าครัวเรือน」 strings for household-head *management* flows are out of
  this CR surface (different UX concept); optional follow-up issue if a full audit is desired.
---

# CR-114: ผู้ติดต่อหลัก for `head_evacuee_id` surfaces

## สรุป (TL;DR)

บนฟอร์มลงทะเบียนครอบครัวแบบรวม (#249) สมาชิกคนแรกแสดงเป็น **ผู้ติดต่อหลัก** (Primary Contact)
และผูกเป็น `head_evacuee_id` ใต้ฝากล่อง — **ไม่** ใช้คำว่า 「หัวหน้าเอกสาร」 · ชื่อฟิลด์ใน schema
(`head_evacuee_id`) **ไม่เปลี่ยน**

## Why

Field study / grill #249 Q4=B: wording แบบลำดับชั้นบนฟอร์มลงทะเบียนทำให้เข้าใจผิดว่าสมาชิกคนอื่น
ด้อยกว่า · ต้องการคำว่าผู้ติดต่อหลักบน UI โดยคง SoR field เดิม

## Change (before → after)

| Surface | Before | After |
| --- | --- | --- |
| Unified member card[0] title | ผู้ติดต่อหลัก (already) + hint 「หัวหน้าเอกสาร」 | ผู้ติดต่อหลัก + hint ไม่ใช้หัวหน้าเอกสาร |
| `PRIMARY_CONTACT_LABEL` | ผู้ติดต่อหลัก | unchanged |
| Schema `head_evacuee_id` | string id | **unchanged** |
| CONTEXT.md glossary | already notes Primary Contact | no further edit required |

## Impact

- Code: unified registration form / member card / domain label constant
- Docs: this CR; CONTEXT already aligned — **no** schema.md / schema_v change
- Out of scope: 「หัวหน้าครัวเรือน」 on household profile / post-arrival / import (role-management UX)

## Migration

N/A

## Decision log

- 2026-09-08 — proposed+approved in #249 grill (Q4=B); implement with #249 merge blockers
