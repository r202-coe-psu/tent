---
id: CR-115
title: Station 1 federated intake — hard anti-dupe, always-on pool search, claim CTA RBAC
status: proposed
date: 2026-09-08
requested_by: เจ้าของโครงการ (grilling #251 follow-up)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - frontend/src/lib/features/people/domain/intake-search.ts (hard-gate + override under pool error)
  - frontend/src/lib/features/people/ui/station1-intake-search.svelte
  - frontend/src/routes/(protected)/onsite/people/+page.svelte (header new-reg lock)
  - frontend/src/routes/api/staff/v1/unassigned-registrations/_auth.ts (search vs claim gate)
  - backend/apiapp/core/staff_session.py (`require_shelter_scoped_staff`)
  - backend/apiapp/modules/unassigned_registrations/router.py (search auth)
  - docs / GitHub #251 AC notes (product-rule deltas; no schema_v)
why: >-
  #251 grill locked hard anti-dupe (any federated hit locks new-reg until clear/override),
  always-on local+pool search with claim CTA RBAC only, visible pool rows for non-claim
  roles, confirm-only override (also under pool error), and pool-error suppression of
  silent not-found until override.
migration: N/A — UI/auth/workflow only; no schema_v bump
tracking_note: >-
  track=CR file. Owner chose Q20=1 and review follow-up decision C: assign CR-115 early
  while status stays proposed (not approved/done; not indexed in _index.md yet).
  False-positive / strong-ID hit refinement deferred as non-blocking note on #251 (no new issue).
---

# CR-115: Station 1 federated intake hard anti-dupe (#251)

> **Status: proposed (draft).** Numbered early per owner decision C — not approved yet;
> do not treat as accepted until status moves to `approved`.

## สรุป (TL;DR)

Station 1 ค้นหา **local + คิวกลางพร้อมกันเสมอ** · ปุ่ม claim ค่อย RBAC · มี hit หรือ
**pool-error lock** แล้ว **ปิดลงทะเบียนใหม่** (การ์ด + header) จนกว่า clear/เปลี่ยนคำค้น
หรือ **ยืนยัน override** (confirm อย่างเดียว) แล้วค่อยโชว์ CTA แบบ outlined/warned ·
ตอน pool error ยังอนุญาต override ได้ แต่เตือนว่าคิวกลางตรวจไม่ครบ · ไม่โชว์ not-found
เงียบๆ โดยไม่มี override

## Why

Grill #251 หลัง implement แรก: soft anti-dupe + pool search ที่ผูกกับ `canAccessUnassignedQueue`
ทำให้ AC “search simultaneously” / “without allowing duplicate creation” ไม่ตรงพฤติกรรมจริง

## Change (before → after)

| Surface | Before | After |
| --- | --- | --- |
| New-reg when hits | Soft — outline CTA ยังกดได้ | Hard lock จน override หรือ clear/query change |
| Header new-reg | Always visible | Hide while hard-gate locked (hits or pool-error path, no override) |
| Override | ไม่มี | Confirm dialog (Thai copy) · sticky จน clear/query change |
| Override + pool error | (ซ่อน new-reg ทั้งก้อน) | **อนุญาต override** · เตือนคิวกลางตรวจไม่ครบ · หลังยืนยันโชว์ outlined new-reg |
| Pool search | Role-gated ด้วย claim capability | Always-on สำหรับ shelter-scoped staff / SA |
| FastAPI search auth | bare `require_staff_session` | `require_shelter_scoped_staff` (SA หรือมี shelter scope) — ตรง BFF |
| Claim CTA | ตาม search gate | คง registration desk gate |
| Non-claim + pool hits | ซ่อนส่วนคิวกลาง | เห็นแถว/badge · ไม่มีปุ่ม claim |
| Pool error | ซ่อน not-found + new-reg | ซ่อน silent not-found · มี retry + override path |
| Hit strength | any row | **คง any-row** · false-positive refinement = โน้ตบน #251 |
| Claim UI | Duplicate modal ใน Station 1 | Compose `ClaimDialog` จาก UR feature |

## Impact

- Code: people Station 1 + UR `ClaimDialog` (commit แยก) + BFF/FastAPI search auth
- Docs: this CR (proposed); #251 AC/notes — **no** schema.md / schema_v
- Auth: search wider than claim but shelter-scoped (product intentional)

## Migration

N/A

## Decision log

- 2026-09-08 — grilled lock Q1–Q23 (Q20=1 CR+#251 note; Q23=3 fold false-positive into #251 note)
- 2026-09-08 — proposed as `draft-station1-federated-intake-hard-antidupe`
- 2026-09-08 — review follow-ups: FastAPI search → shelter-scoped; override under pool error (A);
  header new-reg shares lock (A); delete unused `isIntakeNotFoundState`; owner decision C →
  renumber to **CR-115** while status remains **proposed**
