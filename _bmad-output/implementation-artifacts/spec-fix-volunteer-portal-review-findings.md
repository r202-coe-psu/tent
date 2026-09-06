---
title: 'Harden volunteer portal review findings'
type: 'bugfix'
created: '2026-09-07'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'f3ee8c49'
context:
  - '{project-root}/docs/reports/code-review-volunteer-portal-2026-09-07.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Volunteer applications can silently fall back to the first shift when a submitted shift identity is invalid, and the public digital-pass fallback can disclose a pass by guessing its CouchDB document ID. The same review also identified a portal restore effect cycle, ambiguous timestamp parsing, and several small UI/performance defects.

**Approach:** Make shift identity validation strict across selection and quota mutation, keep public ticket lookup limited to the unguessable tracking token, and apply the review’s low-risk UI/runtime corrections with regression tests for the security and edge-case behavior.

## Boundaries & Constraints

**Always:** Never register or release quota against a shift other than the one the applicant requested. Public ticket fallback may query only `tracking_token`; never expose a document lookup path as a public credential. Preserve existing error codes and user-facing flows where possible. Treat timestamps without an explicit offset as UTC only when that is the established backend contract; do not silently reinterpret them as local time.

**Ask First:** Any change to token format, public API authentication model, database schema, or FastAPI behavior.

**Never:** Do not weaken rate limiting, disclose raw phone numbers, add a document-ID lookup fallback, or silently choose a different shift when the request is ambiguous or invalid.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Invalid shift id | `shift_id` does not match an advertised shift | No application or quota mutation | `SHIFT_NOT_FOUND`, HTTP 422 |
| Ambiguous date | Multiple shifts share `shift_date` without a matching time | No application or quota mutation | `SHIFT_DATE_AMBIGUOUS`, HTTP 422 |
| Missing shift identity | Job has multiple shifts and request has no usable identity | No application or quota mutation | `SHIFT_ID_REQUIRED`, HTTP 422 |
| Document id probe | Public ticket URL contains a CouchDB `_id`, not a tracking token | No ticket data returned | `TICKET_NOT_FOUND`, HTTP 404 |
| Naive timestamp | Timestamp has no offset | Format according to the documented UTC contract without a second timezone conversion | Stable localized output and regression coverage |

</frozen-after-approval>

## Code Map

- `frontend/src/lib/features/volunteers/server/public-application.ts` -- validates the requested shift and applies/releases its quota.
- `frontend/src/routes/api/public/v1/volunteer/ticket/[token]/+server.ts` -- public digital-pass lookup and fallback response.
- `frontend/src/lib/features/volunteer-portal/ui/volunteer-access-portal.svelte` -- restores one-hop portal sessions.
- `frontend/src/lib/features/volunteer-portal/i18n/ticket.i18n.ts` -- localized timestamp formatting.
- `frontend/src/lib/features/volunteers/components/QuickApplyModal.svelte` -- application UX and post-apply navigation.
- `frontend/src/lib/features/volunteers/components/DigitalPassCard.svelte` -- clipboard action in the legacy pass card.
- `frontend/src/lib/features/volunteers/ui/{assign-roster-row,roster-row,volunteer-card,volunteer-result-card}.svelte` -- skill deduplication view models.
- `frontend/src/routes/api/public/v1/volunteer/ticket/[token]/ticket.test.ts` -- public ticket lookup regression tests.
- `frontend/src/lib/features/volunteer-portal/i18n/ticket.i18n.test.ts` -- date/time formatter regression tests.

## Tasks & Acceptance

**Execution:**
- [x] Strictly reject invalid, ambiguous, or missing multi-shift identities in `public-application.ts`, including live reserve/release reconciliation; add focused tests where the existing test structure supports them.
- [x] Remove `_id` and synthetic document-ID selectors from the public ticket fallback and add a regression test proving a document-ID probe returns 404.
- [x] Move one-time portal session restoration out of the self-writing `$effect` and preserve redirect/cleanup behavior.
- [x] Make timestamp parsing explicit and test the supported UTC/offset cases; do not append `Z` to an already-local value without an explicit contract.
- [x] Replace temporary `SvelteMap` instances with native `Map`, use the canonical singular ticket route with encoded token, and guard clipboard access in insecure contexts.
- [x] Give portal applicants using a token a clear pre-submit warning and a usable phone-entry path so the form does not fail only after completion.
- [x] Remove redundant portal/job-board copy and emoji text decorations from the signed-in and public job-board surfaces.

**Acceptance Criteria:**
- Given a stale or forged shift identifier, when the application endpoint is called, then it returns the matching shift error and does not write an application or change quota.
- Given a public ticket request containing a known CouchDB document ID but no matching tracking token, when the fallback runs, then it returns 404 and performs no ticket disclosure.
- Given a stored portal session, when the portal mounts, then it restores it once, redirects when appropriate, and does not re-run restoration because it assigned the state it just read.
- Given supported timestamps, when the ticket is rendered, then Bangkok-local output is correct for explicit UTC and offset values and the regression suite passes.
- Given an HTTP/non-secure browser context, when the user clicks copy, then no uncaught TypeError occurs and the error toast is shown.

## Verification

**Commands:**
- `pnpm --dir frontend test --runInBand` -- expected: relevant Vitest suites pass.
- `pnpm --dir frontend check` -- expected: Svelte/TypeScript checks pass.
- `pnpm --dir frontend lint` -- expected: formatting and ESLint checks pass.
