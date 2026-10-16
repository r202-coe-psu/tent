---
id: CR-116
title: Volunteer Shift Check-Out — Record Actor and Manual-Override Reason
status: approved
updated: 2026-09-11
date: 2026-09-09 (approved 2026-09-11)
requested_by: Dev Team B
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §2.9
  - schema_v shift_assignment 3 → 4
  - frontend/src/lib/features/volunteers/domain/shift-assignment.schema.ts
  - frontend/src/lib/features/volunteers/data/shift-assignment.remote.ts
  - frontend/src/lib/features/volunteers/data/volunteer.repository.ts
  - frontend/src/lib/features/volunteers/application/queries.ts
  - frontend/src/lib/features/volunteers/ui/roster-row.svelte
  - frontend/src/lib/features/volunteers/ui/roster-manual-checkin-dialog.svelte
  - frontend/src/lib/features/volunteers/ui/volunteer-check-in.svelte
  - frontend/src/lib/features/volunteers/ui/volunteer-result-card.svelte
  - frontend/src/lib/features/volunteers/ui/roster-audit-trail-dialog.svelte
why: >
  Check-out (`ShiftAssignmentRepository#checkOut`) recorded only `check_out_at`.
  Unlike check-in, there was no record of WHO performed the check-out and no
  way to attach a reason when staff checked a volunteer out manually
  ("เช็คเอาต์แทน") — `roster-manual-checkin-dialog.svelte` already flagged this
  gap in its own header comment ("ระบบยังไม่มีช่องบันทึกเหตุผลสำหรับ
  เช็คเอาต์แทน"). Project owner asked to close this gap: add a note/remark for
  manual check-out, and show who performed a check-out action.
migration: >
  `check_out_by`/`check_out_method`/`check_out_reason` are new required
  (nullable) keys on `shift_assignment`, always populated by `makeShiftAssignment`
  and `ShiftAssignmentRemoteRepository#checkOut` going forward. Local/dev data
  must be reseeded (unseed + seed) to satisfy the new refine on any doc that
  goes through a write path other than checkOut (e.g. unassign/acceptDispatch),
  since `isShiftAssignment`/`shiftAssignmentSchema.parse` require the new keys
  to be present.
---

# CR-116 — Volunteer Shift Check-Out: Actor and Manual-Override Reason

## Why this amendment exists

`shift_assignment.checkOut()` only ever set `check_out_at` — there was no `check_out_by` (who
performed it) and no `check_out_method`/`check_out_reason` pair to mirror check-in's
`check_in_method`/`check_in_reason` (CR-094 §3.2 / FR-VOL-11.2). Concretely:

- The roster's "เช็คเอาต์แทน (Manual Override)" dialog (`roster-manual-checkin-dialog.svelte`)
  collected no reason for check-out and shipped with a banner admitting the gap.
- The roster row, the on-site check-in screen's result card, and the check-in audit trail
  dialog all showed check-in's actor/method but always rendered check-out as a hardcoded,
  unconditional "self-service" — never the actual staff member who tapped the button.

## Decisions under implementation

1. `shift_assignment` gains three fields, mirroring the existing check-in fields exactly:
   - `check_out_by: string | null` — the actor who performed the check-out.
   - `check_out_method: 'qr' | 'manual_override'` — default `qr`.
   - `check_out_reason: string | null` — required (non-empty) when
     `check_out_method === 'manual_override'`, enforced by the same `.refine()` pattern as
     `check_in_reason`.
2. `schema_v` bumps 3 → 4 (additive).
3. `ShiftAssignmentRepository#checkOut` signature changes from `checkOut(id)` to
   `checkOut(id, actor, method?, reason?)`, mirroring `checkIn`. `useCheckOut` now sends
   `authStore.user?.name ?? 'unknown'` as the actor, same as `useCheckIn`.
4. `roster-manual-checkin-dialog.svelte`'s check-out mode now collects a reason (same textarea
   UX as check-in) instead of showing the "not supported yet" banner.
5. Actor + method now surface wherever check-in's already did: roster row ("ออกกะล่าสุด... โดย
   {check_out_by}"), the on-site check-in screen's result card (new checked-out confirmation
   banner, mirroring the check-in one), and the check-in/check-out audit trail dialog (source
   badge + self/staff filter now apply symmetrically to check-out events).

## Non-goals

- No append-only check-in/check-out log — same known limitation as before (flagged in
  `roster-audit-trail-dialog.svelte`'s header comment); this CR only extends the existing
  latest-snapshot fields.

## Decision log

- 2026-09-09 — proposed by Dev Team B (PR #262)
- 2026-09-11 — approved by Project Owner (อนุมัติหมายเลขทางการ CR-116, ปรับแก้ schema_v 3 → 4 ให้สอดคล้องกับ baseline develop)
