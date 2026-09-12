---
name: volunteer-shift-link
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: one-way-reference-expand-backfill-contract
scope: Volunteer sub-shift identity, roster membership, per-shift capacity, and public application pipeline
status: draft
created: '2026-09-04'
updated: '2026-09-04'
inherits:
  - ../architecture-tent-2026-08-25/ARCHITECTURE-SPINE.md
binds:
  - volunteer-job
  - volunteer-shift-assignment
  - volunteer-job-application
  - public-volunteer-api
  - volunteer-projection-worker
sources:
  - docs/data/schema.md
  - docs/changes/CR-102-volunteer-job-shifts-personnel-type.md
  - docs/changes/CR-104-volunteer-backoffice-and-user-management-v10.md
companions:
  - IMPLEMENTATION-PLAN.md
---

# Architecture Spine — Volunteer Shift Identity

## Problem

`shift_assignment` does not persist the identity of a row in `job.shifts[]`. The UI therefore joins by `job_id + duty_window`, counts duplicate/history rows, and can mix two shifts that have the same time. Capacity is also mutated only at job level, so a single sub-shift can be overbooked while the job total still has room.

## Canonical relationship

```text
job.shifts[].shift_id  <── shift_assignment.shift_id
                       <── job_application.shift_id
```

The relationship is intentionally one-way. `job.shifts[]` must not contain `assignment_ids[]` or `application_ids[]`; reverse membership is queried by `(job_id, shift_id)`. Date, time, station, and `duty_window` remain immutable operational snapshots, not identity keys.

## Invariants and decisions

### VS-1 — One canonical field name: `shift_id` [PROPOSED]

- Rename `job.shifts[].id` to `job.shifts[].shift_id` during the `job` v3→v4 migration.
- Add required `shift_id` to `shift_assignment` v4 and `job_application` v3.
- Use a singular shift on an application because the current UX reserves one seat per application. Amend the stale `shift_ids[]` documentation rather than introducing partial multi-shift approval semantics.
- `shift_id` is immutable and unique within its job.

### VS-2 — Exact membership and count semantics [PROPOSED]

- Current roster membership requires exact `(job_id, shift_id)` equality.
- “อาสาในกะนี้” counts distinct active seat holders only: `assigned`, `standby`, `checked_in`.
- `completed`, `no_show`, and `cancelled` remain available as history but do not increment the current count.
- A volunteer may have at most one non-terminal assignment for one `(job_id, shift_id)`.

### VS-3 — Per-shift capacity is authoritative [PROPOSED]

- `job` v4 stores `quota`, `slots_confirmed`, `slots_dispatched`, and `slots_remaining` on every `shifts[]` row.
- Job-level counters are the validated sums of the sub-shift counters.
- Back-office mutations update the selected sub-shift and job totals in one CouchDB job-document CAS (`_rev`) operation.
- Public applications reserve an atomic Mongo counter keyed by `(job_id, shift_id)`; the job aggregate is a projection/sum, not a separate competing allocation algorithm.
- Remove earliest-first/greedy distribution from `capacity.ts` after migration.

### VS-4 — Creation validates the reference [PROPOSED]

- Writers receive `job_id + shift_id`, load the job, verify the shift exists and is bookable, and derive `date`, `shift`, and `duty_window` from that shift.
- Client-supplied time data is never trusted as the reference.
- Editing a shift preserves `shift_id`. A shift with applications or assignments cannot be hard-deleted; it is closed/archived so historical references remain valid.

### VS-5 — Application and assignment lifecycle converge [PROPOSED]

- Public job projections expose concrete shifts and their IDs/capacity.
- Apply requests carry `shift_id` through BFF → FastAPI → Mongo buffer → worker → CouchDB.
- A confirmed application must create or link exactly one assignment for the same `(job_id, shift_id, volunteer_id)`; approval/rejection/cancellation adjusts that same shift's capacity idempotently.
- Ticket, schedule, and public assignment projections preserve `shift_id` end to end.

### VS-6 — Safe rollout [PROPOSED]

- Expand: deploy compatibility readers, new fields/models/indexes, and dual-version projections first.
- Backfill: dry-run and then migrate jobs, assignments, and applications. Exact unique matches may be written; missing or ambiguous matches are reported for manual resolution and never guessed.
- Contract: enable strict v4/v3 writers and ID-only joins only after unresolved rows are zero (or explicitly waived), then remove duty-window identity fallback in a later cleanup.
- Migration is idempotent, retries CouchDB 409 conflicts, and emits counts plus document IDs for changed/unresolved/skipped rows.

## Consequences

- This is a cross-plane schema change, not a UI-only count fix.
- `job`, `shift_assignment`, and `job_application` all receive schema-version migrations.
- Mongo public models, worker projections, FastAPI contracts, both SvelteKit apply routes, generated OpenAPI, design indexes, seeds, and tests must move together.
- Existing unrelated working-tree changes are preserved and are not part of this architecture decision.

## Deferred

- Multi-shift applications and partial approval/cancellation.
- Removing compatibility readers before production migration evidence is reviewed.
- A globally unique shift ID across all jobs; uniqueness within a job is sufficient because every reference is paired with `job_id`.
