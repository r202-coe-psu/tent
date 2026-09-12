---
id: CR-107
title: Volunteer Shift Identity and Capacity Reconciliation
status: implementing
date: 2026-09-04
requested_by: Project Owner & Dev Team
decided_by: pending implementation approval
layer: volatile
affects:
  - docs/changes/CR-104-volunteer-backoffice-and-user-management-v10.md
  - docs/data/schema.md
  - frontend/src/lib/features/volunteers/**
  - backend/apiapp/modules/volunteers/**
  - worker/src/worker/**
  - packages/tent-model/src/tent_model/**
---

# CR-107 — Volunteer Shift Identity and Capacity Reconciliation

## Why this amendment exists

CR-104 is the approved product direction, but its documented v3 shapes do not match the current runtime: the document specifies `job.shifts[].shift_id` and per-shift counters while the frontend still writes `shifts[].id`; `shift_assignment` v3 is missing `shift_id`; and public apply still stores a date/time snapshot only. The current roster consequently joins by `duty_window`, which can merge separate shifts with identical times.

## Decisions under implementation

1. `shift_id` is the only canonical child-to-parent reference. It is paired with `job_id` and is not reversed into an assignment-ID array on the job.
2. The deployed job document remains `schema_v: 3` for compatibility with the current writer. The worker/projector normalizes `shifts[].shift_id` and legacy `shifts[].id` to the public `shift_id`; `shift_assignment` advances v3→v4 and `job_application` advances v2→v3.
3. The current one-click UX selects one shift. `job_application` therefore carries one `shift_id` and retains `selected_shift` as a display snapshot. Multi-shift applications are deferred.
4. CR-104's Job Board model is canonical: dispatch/yellow state is compatibility-only and is not used by new writes.
5. Public application follows the two-plane path: BFF → FastAPI → Mongo buffer/counter → worker → CouchDB. The legacy `/api/public/v1/volunteer/apply` URL remains as a compatibility adapter only and forwards to the same FastAPI contract; it does not access CouchDB.
6. Roster current count includes distinct volunteers in `assigned`, `standby` (legacy compatibility), or `checked_in`; completed/no_show/cancelled are history and do not count as current.
7. This implementation does not add a production migration runner. Legacy records remain readable through the duty-window compatibility fallback; local/dev data is refreshed through the updated seed.

## Current implementation amendment (2026-09-04)

The public application write path is now aligned with the public pre-register flow:
`BFF → public CouchDB writer → shelter CouchDB`. Both the canonical
`/api/public/v1/volunteer/jobs/:id/apply` endpoint and the legacy
`/api/public/v1/volunteer/apply` adapter use the same server-side writer service.
The route still owns CAPTCHA and rate limiting; the writer verifies the job and concrete
shift, performs the CouchDB quota update with MVCC retries, and writes the volunteer plus
`job_application` documents. The raw ticket token is returned only to the applicant;
CouchDB stores its hash, and the existing Mongo buffer/worker remains for older requests
and other volunteer inbound flows.

## Non-goals

- Cross-shelter volunteer transfer documents.
- Multi-shift or partial application approval.
- Changing the approved role taxonomy or check-in UX.
