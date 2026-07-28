---
title: 'Harden shelter management review findings'
type: 'bugfix'
created: '2026-07-26'
status: 'done'
baseline_commit: '10425ddbafa222978163708b61492bb2b9eadfab'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shelter-management pagination can display a clamped page while retaining an obsolete `currentPage`, causing a surprising jump back to an old page when the dataset grows again. The master-data endpoint also accepts shelter query codes with surrounding whitespace inconsistently.

**Approach:** Keep the derived clamp for immediate rendering, but synchronize the writable pagination state whenever the available page count shrinks. Normalize `shelter_code` query parameters by trimming them before scope validation and add regression coverage for the normalized value.

## Boundaries & Constraints

**Always:** Pagination must show valid shelter rows after delete/filter changes; once a page is clamped, `currentPage` must hold the valid page so later data growth does not restore stale state. Shelter-code validation must continue enforcing the existing 1–20 character allowlist after trimming. Preserve existing RBAC, schema-v3 cleanup, and pagination behavior for normal page selection.

**Ask First:** None.

**Never:** Do not broaden accepted shelter-code characters, change tenant authorization, remove schema cleanup, or redesign the pagination component/API.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Page shrink | `currentPage = 3`, data drops to one page | Rows and active page use page 1; writable state becomes 1 | N/A |
| Page regrowth | Previously clamped dataset grows back to three pages | UI remains on page 1 until the user selects another page | N/A |
| Query normalization | `shelter_code=\u0020SH001\u0020` | Scope uses `SH001` | N/A |
| Invalid query | Trimmed code fails the allowlist | Existing validation error is returned | 422 VALIDATION |

</frozen-after-approval>

## Code Map

- `frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte` -- shelter list pagination state, derived page clamp, and pagination binding.
- `frontend/src/routes/api/back-office/master-data/[type]/+server.ts` -- parses and validates shelter scope for master-data requests.
- `frontend/src/routes/api/back-office/master-data/[type]/server.test.ts` -- endpoint regression tests and request/auth mocks.

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte` -- synchronize `currentPage` downward when `totalPages` shrinks while retaining clamped rendering -- prevents stale pagination state and surprising page jumps.
- [x] `frontend/src/routes/api/back-office/master-data/[type]/+server.ts` -- trim the shelter-code query parameter before combining it with body scope and validating it -- normalizes incidental whitespace without weakening validation.
- [x] `frontend/src/routes/api/back-office/master-data/[type]/server.test.ts` -- add coverage for a whitespace-padded query code -- locks in normalized scope behavior.

**Acceptance Criteria:**
- Given a user is on page 3, when shelter data changes to one page, then page 1 is displayed and `currentPage` is synchronized to 1.
- Given the same list later grows to three pages, when no page link is selected, then the UI remains on page 1.
- Given a request contains a padded valid `shelter_code`, when the endpoint parses scope, then authorization and document access use the trimmed code.
- Given a request contains an invalid trimmed code, when the endpoint parses scope, then it returns the existing validation error and performs no write.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --dir frontend exec vitest run 'src/routes/api/back-office/master-data/[type]/server.test.ts'` -- expected: all endpoint tests pass.
- `pnpm --dir frontend check` -- expected: Svelte and TypeScript checks pass.

## Suggested Review Order

**Pagination state normalization**

- Lower- and upper-bound normalization keeps every derived slice index valid.
  [`+page.svelte:18`](../../frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte#L18)

- The effect persists the normalized page and prevents stale state restoration.
  [`+page.svelte:23`](../../frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte#L23)

- The pagination binding exposes the safe derived page while retaining user selection.
  [`+page.svelte:77`](../../frontend/src/routes/(protected)/portal/system-management/shelters/+page.svelte#L77)

**Shelter-code canonicalization**

- Query and body scope values now compare using the same trimmed representation.
  [`+server.ts:197`](../../frontend/src/routes/api/back-office/master-data/[type]/+server.ts#L197)

**Regression coverage**

- GET coverage verifies padded query scope is authorized and read canonically.
  [`server.test.ts:117`](../../frontend/src/routes/api/back-office/master-data/[type]/server.test.ts#L117)

- PUT coverage verifies padded query and trimmed body values do not conflict.
  [`server.test.ts:270`](../../frontend/src/routes/api/back-office/master-data/[type]/server.test.ts#L270)
