---
title: 'T-30 DB-managed Master SOP Profiles'
type: 'feature'
created: '2026-08-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'aaf08abd7adf521383bb7c16abc8b3ad1f2d2971'
context:
  - '{project-root}/docs/changes/CR-006-sop-profile-master-override.md'
  - '{project-root}/docs/changes/CR-026-sop-ratio-catalog-scope-and-history-ratification.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Master SOP data is seeded only, so a System Admin cannot create, select, version, or activate centrally managed standards from Back-office. Existing master versions are identified by a mutable name, which cannot safely distinguish multiple standards.

**Approach:** Make catalog `sop_profile` records DB-managed immutable versions grouped by a stable slug, expose their management in the existing SOP Parameters screen, and preserve `sop_override` unchanged. Exactly one master version is active globally; every shelter without an active override resolves to that master.

## Boundaries & Constraints

**Always:** Use Svelte 5 runes, strict TypeScript, feature barrel exports for external imports, TanStack Query and existing sync invalidation, svelte-sonner notifications, and the canonical strict 20-key ratio set. Master writes are System-Admin-only. Preserve the established catalog envelope and decimal-string ratio representation so current Couch validation, calculations, and overrides remain compatible; add stable `slug` identity to masters and use it—not name—for history/version grouping. Every master edit creates a new immutable version and an audit entry. Activating a master deactivates every other active master version globally; deactivation must reject removal of the final active master.

**Ask First:** Changing the document envelope/ratio serialization to the proposed camelCase numeric form, adding a per-shelter master-profile selection, or changing override resolution.

**Never:** Modify `sop_override` behaviour or persistence, alter unrelated `frontend/package.json` work, or overwrite manually managed profiles from the development seed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Create profile | SA submits unique name and all 20 positive ratios | Persist v1 with generated slug, inactive when another global master is active; list and selector refresh | Duplicate slug and invalid values show actionable form/toast errors |
| Create version | SA changes ratios for selected profile | Persist vN+1, deactivate its previous version, preserve history/audit | No effective change does not create a duplicate version |
| Activate profile | A historic/inactive version is selected | It becomes the sole active master; all other active masters become inactive | Conflicts/error leave cached data refetched and notify the SA |
| Deactivate final master | Only one active master exists | No write; current master remains active | Explain that a central active master is required |
| Legacy/seed data | Existing seed master lacks `slug` | It remains readable and is assigned/recognized through a compatible deterministic identity | Do not hide existing valid master records |

</frozen-after-approval>

## Code Map

- `frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts` -- canonical model, schemas, factory/version invariants, legacy-compatible slug identity.
- `frontend/src/lib/features/sop-ratios/data/sop-ratio.repository.ts` and `sop-ratio.remote.ts` -- catalog query/write contract and atomic global activation/deactivation.
- `frontend/src/lib/features/sop-ratios/application/queries.ts`, `use-create-version.ts`, `use-version-history.ts`, `sop-ratio-sync.ts` -- queries, mutations, cache keys, and live invalidation.
- `frontend/src/lib/features/sop-ratios/ui/sop-edit-form.svelte`, `version-history-drawer.svelte`, `index.ts` -- create/edit form and slug-based version display/public APIs.
- `frontend/src/routes/(protected)/back-office/sop-parameters/+page.svelte` -- SA master selector, create, activation, and history actions without changing override flow.
- `frontend/scripts/seed.ts` -- seed guard that skips when any master profile exists.

## Tasks & Acceptance

**Execution:**
- [x] Domain and repository -- add validated slug identity, list/get/history APIs, initial-master persistence, global single-active transitions, and final-active guard; preserve immutable audit-backed version writes.
- [x] Application/barrel -- add all-master and selected-master queries plus create/activate/deactivate mutations with scoped cache invalidation and success/error toasts; retain sync-driven invalidation.
- [x] Back-office UI -- allow SA to choose any master profile, create a named v1 profile, edit a selected profile into a new version, activate/deactivate safely, and inspect/load history; retain all override interactions.
- [x] Form/UI validation -- support explicit `create` and `edit` modes, name/ratio validation, pending controls, API errors, and a read-only historical view using the existing component conventions.
- [x] Seed and tests -- make catalog seed idempotent for any existing master and cover slug, global activation, creation/versioning, query invalidation, and seed guard regressions.

**Acceptance Criteria:**
- Given a System Admin and no master profile, when they create a valid named profile, then v1 is stored and becomes the active global master.
- Given an active master and a newly created profile or activated historic version, when the change succeeds, then exactly one catalog master version is active and shelters without overrides resolve it.
- Given a selected master profile, when the System Admin saves changed ratios, then a higher immutable version is shown and the previous version remains in its slug-based history.
- Given the only active master, when deactivation is requested, then it is blocked and no catalog document changes.
- Given existing seeded/legacy master data, when the feature loads, then it remains selectable and resource calculation does not lose its active baseline.
- Given an existing `sop_override`, when these master controls are used, then override editing and override-first resolution behave as before.

## Design Notes

The project’s authoritative existing persistence contract uses snake_case metadata, `active`, and positive decimal strings. Replacing it with a parallel camelCase/numeric shape would make current schema guards reject existing catalog data and would unintentionally change the untouched override/calc contract. This implementation adds the requested multi-profile identity/version-management behaviour compatibly, with a deterministic fallback identity for existing seed data.

## Verification

**Commands:**
- `pnpm --dir frontend test -- --run src/lib/features/sop-ratios` -- expected: SOP domain/application/data tests pass.
- `pnpm --dir frontend check` -- expected: strict Svelte/TypeScript checks pass.

**Manual checks:**
- As SA, create “WHO Standard 2026”, edit it into v2, inspect version history, activate it, and confirm prior active masters become inactive.
- Attempt to deactivate the sole active master and confirm the UI blocks it.

## Suggested Review Order

**Master identity and lifecycle**

- Stable slugs keep independent standards and their immutable histories distinguishable.
  [`sop-ratio.ts:39`](../../frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts#L39)

- Repository writes create, version, activate, and deactivate central masters safely.
  [`sop-ratio.remote.ts:41`](../../frontend/src/lib/features/sop-ratios/data/sop-ratio.remote.ts#L41)

**Query and access boundary**

- Master mutations enforce SA access and refresh all SOP-derived cache entries.
  [`use-create-version.ts:64`](../../frontend/src/lib/features/sop-ratios/application/use-create-version.ts#L64)

- Public feature exports expose the new profile APIs without deep imports.
  [`index.ts:1`](../../frontend/src/lib/features/sop-ratios/index.ts#L1)

**Back-office workflow**

- Selector, first-profile CTA, and activation controls keep master management SA-scoped.
  [`+page.svelte:35`](../../frontend/src/routes/(protected)/back-office/sop-parameters/+page.svelte#L35)

- Create/edit modes use Superforms and Zod for all twenty ratios and field errors.
  [`sop-edit-form.svelte:39`](../../frontend/src/lib/features/sop-ratios/ui/sop-edit-form.svelte#L39)

- History can load or promote a prior master version without touching overrides.
  [`version-history-drawer.svelte:188`](../../frontend/src/lib/features/sop-ratios/ui/version-history-drawer.svelte#L188)

**Development safety and regression coverage**

- Seed exits before writing whenever catalog already contains a master profile.
  [`seed.ts:760`](../../frontend/scripts/seed.ts#L760)

- Domain tests cover deterministic URL-safe identities for Thai profile names.
  [`sop-ratio.test.ts:25`](../../frontend/src/lib/features/sop-ratios/domain/sop-ratio.test.ts#L25)
