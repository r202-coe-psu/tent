---
title: 'Async shelter Excel import job with worker progress'
type: 'feature'
created: '2026-09-14'
status: 'done'
baseline_commit: '25eae6fd8625d05ab47712ac32aae5e95bd0908d'
review_loop_iteration: 0
context:
  - '/home/saktanuthpeak/tent/docs/changes/CR-039-shelter-excel-import.md'
  - '/home/saktanuthpeak/tent/frontend/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Excel import currently performs every shelter provisioning request in the browser and writes one final log after the whole loop. Large imports are vulnerable to browser/proxy timeouts, provide no live per-row progress, and make retrying partial failures difficult.

**Approach:** Create a durable asynchronous import job with one persisted item per shelter. A dedicated Node/TypeScript import worker claims and provisions one item at a time, records each outcome, and the frontend polls a job-status API to show progress and retryable failures.

## Boundaries & Constraints

**Always:** Revalidate normalized shelter payloads on the server; preserve partial success; process one shelter item at a time; use CouchDB revision compare-and-swap plus lease expiry for claims; make retries idempotent; preserve the existing `shelter_import_log` audit history; keep system-admin authorization; expose explicit per-item statuses and errors.

**Never:** Do not put the queue only in process memory; do not modify the existing Python sync worker to duplicate TypeScript shelter-provisioning logic; do not make one synchronous request wait for an entire workbook; do not remove the existing single-shelter API; do not silently report failed provisioning as success.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Valid job with several rows | API returns job id immediately; worker creates each shelter sequentially; UI reaches completed | N/A |
| Partial failure | One item times out or receives a server error | Other items continue; failed item records error and job ends completed-with-errors | Retry only failed items |
| Worker restart | Item is processing and lease expires | Another worker can reclaim it without duplicating a completed shelter | Idempotency check and bounded retry |
| Concurrent claim | Two workers see the same pending item | Only the revision winner processes it | 409 claim conflict is skipped |
| Invalid payload | Browser sends stale or malformed row | Item is marked validation_error; no provisioning call | Server returns item-level detail |

</frozen-after-approval>

## Code Map

- `frontend/src/lib/features/shelter-import/server/` -- durable job/item documents, claim/lease, and orchestration contracts.
- `frontend/src/routes/api/back-office/shelter-import/jobs/` -- admin-only create, status, and retry endpoints.
- `frontend/src/lib/features/shelters/server/` and `frontend/src/routes/api/back-office/shelter/+server.ts` -- shared single-shelter provisioning and safe status handling.
- `frontend/server/shelter-import-worker.mjs` -- Node worker loop that claims and processes one item at a time.
- `frontend/src/lib/features/shelter-import/application/queries.ts` -- create-job and status polling queries.
- `frontend/src/lib/features/shelter-import/ui/shelter-import-page.svelte` and `ui/import-progress.svelte` -- progress, item outcomes, and retry UI.
- `frontend/src/lib/features/shelter-import/domain/import-log.ts` -- compatibility audit log assembled from job results.
- `docker-compose*.yml`, `frontend/Dockerfile.prod`, `frontend/package.json` -- worker command/container wiring.

## Tasks & Acceptance

**Execution:**
- [x] Extract provisioning into a shared service, enforce every CouchDB response status, and allocate codes safely for retries/concurrency.
- [x] Add job/item schemas and registry persistence with revision-based claim, lease expiry, bounded retry, and idempotency.
- [x] Add admin APIs to create a job, read job/items, and retry failed items; validate every item server-side.
- [x] Add a Node import-worker command/container that processes one item at a time and writes item/job progress.
- [x] Replace browser-side provisioning loop with job creation and polling; render accessible progress and per-shelter outcomes.
- [x] Preserve and generate `shelter_import_log` after terminal completion; add unit/API/worker/UI regression tests.

**Acceptance Criteria:**
- Given a valid workbook with N valid shelters, when the user starts import, then the initial request returns quickly with a job id and the worker processes exactly one shelter item at a time.
- Given mixed success and failure, when processing finishes, then the UI shows exact counts, codes, and error messages per shelter and the audit log matches them.
- Given a worker restart or expired lease, when the job resumes, then completed items are not recreated and pending items continue.
- Given two workers claim the same item, when one revision write loses, then only one worker provisions it.
- Given a failed item, when the user selects retry, then only failed items are re-queued and the final progress remains accurate.

## Design Notes

Use separate `shelter_import_job` and `shelter_import_item` documents so progress updates do not rewrite a large batch document. The existing Python worker remains a CouchDB-to-Mongo projection worker; the import worker is Node/TypeScript so it can reuse the shelter provisioning service without cross-language schema duplication. Polling is the primary status mechanism, with existing changes-feed invalidation as an optimization.

## Verification

**Commands:**
- `pnpm --dir frontend check` -- expected: Svelte/TypeScript checks pass.
- `pnpm --dir frontend exec vitest run src/lib/features/shelter-import` -- expected: import domain, API, worker, and UI tests pass without requiring a live CouchDB.
- `pnpm --dir frontend lint` -- expected: formatting and lint checks pass.

## Suggested Review Order

**Request boundary and durable job lifecycle**

- Server validates payloads, limits request size, and returns a durable job id quickly.
  [`+server.ts:40`](../../frontend/src/routes/api/back-office/shelter-import/jobs/+server.ts#L40)

- CouchDB item documents stage before job visibility, then claims use revision-based leases.
  [`job-store.ts:314`](../../frontend/src/lib/features/shelter-import/server/job-store.ts#L314)

- Terminal recomputation derives exact counters and refreshes the compatibility audit log.
  [`job-store.ts:404`](../../frontend/src/lib/features/shelter-import/server/job-store.ts#L404)

**One-at-a-time worker and provisioning safety**

- Private worker endpoint claims exactly one item and serializes same-name imports.
  [`+server.ts:46`](../../frontend/src/routes/api/back-office/shelter-import/worker/next/+server.ts#L46)

- Shared provisioning enforces CouchDB responses and persists collision-safe shelter codes.
  [`provisioner.ts:46`](../../frontend/src/lib/features/shelters/server/provisioner.ts#L46)

- Long-running Node process polls privately, times out safely, and handles shutdown signals.
  [`shelter-import-worker.mjs:28`](../../frontend/server/shelter-import-worker.mjs#L28)

**Frontend progress and recovery**

- Import mutation now creates a job and polls until terminal state instead of looping in-browser.
  [`queries.ts:71`](../../frontend/src/lib/features/shelter-import/application/queries.ts#L71)

- The page persists the active job and invalidates shelter/audit queries after completion.
  [`shelter-import-page.svelte:97`](../../frontend/src/lib/features/shelter-import/ui/shelter-import-page.svelte#L97)

- Accessible progress, per-row outcomes, codes, errors, and retryable failures are rendered together.
  [`import-progress.svelte:66`](../../frontend/src/lib/features/shelter-import/ui/import-progress.svelte#L66)

**Supporting deployment and verification**

- Compose runs the worker beside the frontend with one shared deployment secret.
  [`docker-compose.production.yml:129`](../../docker-compose.production.yml#L129)

- Focused import tests cover the existing domain contracts; build/check/lint were run for integration.
  [`package.json:6`](../../frontend/package.json#L6)
