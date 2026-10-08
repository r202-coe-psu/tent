---
id: CR-127
title: Volunteer — permanent per-volunteer tracking token (`tracking_token_hash`)
status: approved
date: 2026-09-16
updated: 2026-09-18
requested_by: Dev Team B
decided_by: Project Owner (Jakee / net-lynx) — approved permanent volunteer tracking_token_hash design 2026-09-18
layer: volatile
affects:
  - docs/data/schema.md §2.8 volunteer (new field `tracking_token_hash`, schema_v 3 → 4)
  - frontend/src/lib/features/volunteers/server/public-application.ts (mint-on-first-apply)
  - frontend/src/lib/features/volunteers/domain/volunteer.schema.ts
  - packages/tent-model/src/tent_model/public_volunteer.py (Mongo `PublicVolunteer` — new field)
  - worker/src/worker/projectors/volunteer.py (sync `tracking_token_hash` → Mongo)
  - backend/apiapp/modules/volunteers/use_case.py (credential resolution, ticket lookup)
  - frontend/src/lib/features/volunteers/ui/volunteer-check-in.svelte + data/domain layer
why: >
  `job_application.tracking_token` (schema.md §2.18, CR-104) is minted fresh per
  application, so a volunteer with more than one application has more than one token and
  no single stable identity to sign into the portal or scan at check-in with. Project
  owner asked for one permanent token per volunteer instead, stored hash-only (unlike
  `job_application.tracking_token`, which is stored plaintext).
migration: >
  schema_v 3 → 4 on `volunteer` (docs/data/schema.md §2.8), additive
  (`tracking_token_hash: str | null`, default absent). No backfill — lazy mint on first
  apply; dual-resolve with `job_application.tracking_token`. Schema.md bump is follow-up #275.
---

# Volunteer — permanent per-volunteer tracking token

## Checked first — no existing CR covers this

`volunteer` schema_v 3 (docs/data/schema.md §2.8) is owned by **CR-104** (which folded in
CR-092/096/101/102/103). Other volunteer CRs since then — **CR-107** (shift/identity
reconciliation; explicitly out of scope: "Changing the approved role taxonomy or check-in
UX"), **CR-116** (`shift_assignment` check-out actor/reason), **CR-117** (volunteer skills
master data) — none of them touch a volunteer-level token or `tracking_token_hash`. This is
a new field, not an amendment to any of those, so it gets its own CR.

## Why this change exists

`job_application.tracking_token` (§2.18) is a plaintext CSPRNG token minted once per
application (CR-104). A volunteer who applies to more than one job ends up
with as many tokens as applications — none of them a stable identity for the volunteer
themself, which the portal sign-in and on-site check-in both need one of.

## Decision

1. `volunteer` gains `tracking_token_hash: str | null` (schema_v 3 → 4, additive):
   SHA-256 of a `TKT-VOL-{32 hex}` token, generated the same way `job_application.tracking_token`
   is, but stored as a hash rather than plaintext. Minted **once**, the first time a volunteer ever
   applies (`frontend/src/lib/features/volunteers/server/public-application.ts`, the
   direct-CouchDB apply writer) — plaintext is returned to the caller exactly once, in that
   apply response, and never persisted. Every later application by the same volunteer
   reuses the existing hash; it is never re-minted or rotated.
2. This token is what portal sign-in and on-site check-in resolve against, alongside the
   existing per-application lookup on `job_application.tracking_token` (unmigrated
   tokens from before this change keep working — see Migration).
3. Synced Mongo-side onto `PublicVolunteer.tracking_token_hash`
   (`packages/tent-model/src/tent_model/public_volunteer.py`) by the CouchDB→Mongo projector
   (`worker/src/worker/projectors/volunteer.py`), so FastAPI-side portal resolution
   (`backend/apiapp/modules/volunteers/use_case.py`) can use it too.

## Migration

- `schema_v` on `volunteer` (docs/data/schema.md §2.8): **3 → 4**, purely additive.
  Schema.md edit is **not** in this ratification; it ships with follow-up #275.
- **Lazy mint:** no backfill. `tracking_token_hash` is absent until the volunteer first
  applies after this change; mint-on-first-apply in `public-application.ts`.
- **Dual-resolve:** portal sign-in and on-site QR check-in resolve
  `volunteer.tracking_token_hash` **and** existing `job_application.tracking_token`
  (plaintext, per application). Unmigrated pre-change tokens keep working.
- **Index later with schema:** Couch/Mongo lookup index on `tracking_token_hash` ships
  with the schema_v bump (#275), not this CR file.
- After schema bump: update `docs/data/couchdb-mongodb-sync.md` to add
  `tracking_token_hash` to the synced field list for `PublicVolunteer`.

## Decision log

- 2026-09-16 — proposed as `draft-volunteer-permanent-tracking-token` (hash-only permanent
  volunteer token; mint-once on first apply).
- 2026-09-18 — Project Owner (Jakee / net-lynx) approved the permanent
  `tracking_token_hash` design. Ratified as **CR-127**. Schema.md bump remains follow-up
  with #275; this record is the design decision only.
