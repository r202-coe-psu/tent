---
title: 'Remove back-office shelter Excel import'
type: 'chore'
created: '2026-07-24'
status: 'done'
route: 'one-shot'
baseline_commit: '97035db3'
---

# Remove back-office shelter Excel import

## Intent

**Problem:** The back-office shelter workspace exposes Excel import even though this bulk operation should remain available only to central system management.

**Approach:** Remove the back-office import button and route, preserve the central system-management import flow, and point its E2E coverage and fallback links at the remaining central route.

## Suggested Review Order

**Back-office surface**

- Remove the obsolete Excel entry from the per-shelter workspace.
  [`+page.svelte:38`](../../frontend/src/routes/%28protected%29/back-office/shelters/+page.svelte#L38)

**Centralized import flow**

- Keep the Excel action on the system-wide shelter registry.
  [`+page.svelte:54`](../../frontend/src/routes/%28protected%29/portal/system-management/shelters/+page.svelte#L54)

- Default import links to the remaining central shelter route.
  [`shelter-import-page.svelte:26`](../../frontend/src/lib/features/shelter-import/ui/shelter-import-page.svelte#L26)

- Keep import-history navigation aligned with central management.
  [`import-log-history.svelte:9`](../../frontend/src/lib/features/shelter-import/ui/import-log-history.svelte#L9)

**Regression coverage**

- Exercise the Excel flow through the central system-management route.
  [`shelter-import.test.ts:15`](../../frontend/e2e/shelter-import.test.ts#L15)
