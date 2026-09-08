---
id: draft
title: Station 1 federated intake — hard anti-dupe, always-on pool search, claim CTA RBAC
status: proposed
date: 2026-09-08
requested_by: เจ้าของโครงการ (grilling #251 follow-up)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - frontend/src/lib/features/people/domain/intake-search.ts (hard-gate + override copy)
  - frontend/src/lib/features/people/ui/station1-intake-search.svelte
  - frontend/src/routes/api/staff/v1/unassigned-registrations/_auth.ts (search vs claim gate)
  - backend/apiapp/modules/unassigned_registrations/router.py (search auth widen)
  - docs / GitHub #251 AC notes (product-rule deltas; no schema_v)
why: >-
  #251 grill locked hard anti-dupe (any federated hit locks new-reg until clear/override),
  always-on local+pool search with claim CTA RBAC only, visible pool rows for non-claim
  roles, confirm-only override, and pool-error suppression of not-found/new-reg.
migration: N/A — UI/auth/workflow only; no schema_v bump
tracking_note: >-
  track=CR file (draft) + short note on #251. Owner chose Q20=1.
  False-positive / strong-ID hit refinement deferred as non-blocking note on #251 (no new issue).
---

# Draft: Station 1 federated intake hard anti-dupe (#251)

## สรุป (TL;DR)

Station 1 ค้นหา **local + คิวกลางพร้อมกันเสมอ** · ปุ่ม claim ค่อย RBAC · มี hit แล้ว
**ปิดลงทะเบียนใหม่** จนกว่า clear/เปลี่ยนคำค้น หรือ **ยืนยัน override** (confirm อย่างเดียว)
แล้วค่อยโชว์ CTA แบบ outlined/warned · ตอน pool error ซ่อน not-found/new-reg

## Why

Grill #251 หลัง implement แรก: soft anti-dupe + pool search ที่ผูกกับ `canAccessUnassignedQueue`
ทำให้ AC “search simultaneously” / “without allowing duplicate creation” ไม่ตรงพฤติกรรมจริง

## Change (before → after)

| Surface | Before | After |
| --- | --- | --- |
| New-reg when hits | Soft — outline CTA ยังกดได้ | Hard lock จน override หรือ clear/query change |
| Override | ไม่มี | Confirm dialog (Thai copy ชุดเต็ม) · sticky จน clear/query change |
| Pool search | Role-gated ด้วย claim capability | Always-on สำหรับ shelter-scoped staff / SA |
| Claim CTA | ตาม search gate | คง registration desk gate |
| Non-claim + pool hits | ซ่อนส่วนคิวกลาง | เห็นแถว/badge · ไม่มีปุ่ม claim |
| Pool error | (ส่วนหนึ่งซ่อนแล้ว) | ซ่อน not-found + new-reg · copy ขั้นต่ำ retry |
| Hit strength | any row | **คง any-row** · false-positive refinement = โน้ตบน #251 |
| Claim UI | Duplicate modal ใน Station 1 | Compose `ClaimDialog` จาก UR feature |

## Impact

- Code: people Station 1 + UR `ClaimDialog` (commit แยก) + BFF/FastAPI search auth
- Docs: this draft CR; #251 AC/notes — **no** schema.md / schema_v
- Auth: search wider than claim (product intentional)

## Migration

N/A

## Decision log

- 2026-09-08 — grilled lock Q1–Q23 (Q20=1 CR+#251 note; Q23=3 fold false-positive into #251 note)
- 2026-09-08 — proposed as `draft-station1-federated-intake-hard-antidupe`
