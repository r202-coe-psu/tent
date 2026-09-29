# 0003. Role-scoped Daily SOP snapshots

- Status: proposed
- Date: 2026-09-25
- Updated: 2026-09-25

## Context & Decision

The legacy `daily_sop_assessment` stores one mixed assessment for a shelter and day. The
operational checklist is now selected as 91 checks owned by 9 shelter duties. A single shared
document makes it difficult to assign work to the person responsible, see role-specific progress,
or preserve independent daily sign-off.

**Proposal:** store one `daily_sop_role_assessment` snapshot per shelter, local assessment date,
and role. Keep the legacy document type read-only for historical access. Each new snapshot stores
question text, check method, pass criteria, recorded-value hints, source references, and any metric
formula used, so later question edits do not silently change the evidence already recorded.

Role owners may assess their own role; shelter managers may view and edit each role; database
validation enforces the same write boundary. Results remain counts by Pass, Fail, Pending, and
unanswered, not one combined score.

## Considered Options

- **Mutate the existing daily document:** rejected for this iteration; it would require migrating
  existing records and changing the legacy 19-control validator and ownership model.
- **One document per answer:** rejected; it adds partial-write and aggregation complexity for a
  fixed daily role checklist.
- **One document per shelter/day/role:** proposed; it matches role ownership, supports independent
  completion, and isolates the new contract from legacy snapshots.

## Consequences

- Adds a new schema_v 1 type without migration or deletion of `daily_sop_assessment`.
- Deterministic identity prevents duplicate role/day assessments and enables edits using `_rev`.
- Each role's snapshot records question-set version and source/page labels used on the assessment.
- The question set remains subject to owner review; this ADR and the related change record remain
  proposed until that review is recorded.
