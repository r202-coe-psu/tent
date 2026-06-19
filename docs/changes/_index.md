---
title: Change Records — Index
status: active
created: 2026-06-16
updated: 2026-06-18
note: ดัชนี Change Record ทุกตัว — กติกาอยู่ใน ../change-management.md
---

# Change Records

ดัชนีการเปลี่ยนแปลง spec/docs ทั้งหมด. กติกา + รูปแบบ CR ดู [Change Management Policy](../change-management.md).
หนึ่ง CR = หนึ่งไฟล์ `CR-NNN-slug.md` ในโฟลเดอร์นี้. เริ่ม template จาก [`_template.md`](_template.md).

> ก่อนเปิด CR ใหม่ทุกครั้ง **ถามเจ้าของโครงการก่อน** ว่าจะ track ช่องทางไหน (CR ไฟล์ / Notion /
> decision sync note) — Policy §6.

| CR | Title | Status | Layer | Date | Affects |
| --- | --- | --- | --- | --- | --- |
| [CR-001](CR-001-people-dod-permission-sync.md) | 02-people.md: household gaps — permission cross-ref, lifecycle, screening, UI split, bulk ops, pre-registration | done | volatile | 2026-06-18 | docs/task-breakdown/02-people.md DoD T-04..T-09 |
| [CR-002](CR-002-registration-staff-affiliation-tags.md) | Rename RBAC volunteer role to registration_staff and add user affiliation_tags | done | volatile | 2026-06-18 | role-permission matrix, _users metadata, task/PRD role references |
| [CR-003](CR-003-kitchen-lpg-cylinder-management.md) | เพิ่ม task T-56 — LPG cylinder management ใน Module D (Kitchen & Food) | approved | volatile | 2026-06-18 | docs/task-breakdown/05-D.md, _index.md |
| [CR-004](CR-004-shelter-create-edit.md) | Shelter create + edit — เพิ่ม capacity field, PATCH endpoint, edit UI, schema_v bump | approved | volatile | 2026-06-18 | schema.md §3.1, features/shelters/*, api/back-office/shelter/+server.ts |
