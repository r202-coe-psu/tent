# Frontend Conventions

Developer standards for the **Smart Shelter** frontend (`frontend/`). Read alongside
`CONTRIBUTING.md` (toolchain, definition of done, architecture overview). This document
covers the _how_ — naming, structure, and coding patterns every contributor must follow.

---

## Contents

1. [Git workflow](#1-git-workflow) — branches, commits, PRs, **pre-commit quality gate**
2. [File & directory naming](#2-file--directory-naming)
3. [TypeScript conventions](#3-typescript-conventions)
4. [Feature architecture in practice](#4-feature-architecture-in-practice)
5. [CouchDB document patterns](#5-couchdb-document-patterns)
6. [Quantity arithmetic (`qty_str` + Decimal)](#6-quantity-arithmetic-qty_str--decimal)
7. [Svelte 5 component patterns](#7-svelte-5-component-patterns)
8. [Forms (Superforms + Zod)](#8-forms-superforms--zod)
9. [Data fetching (TanStack Query)](#9-data-fetching-tanstack-query)
10. [UI & feedback patterns](#10-ui--feedback-patterns)
11. [Testing conventions](#11-testing-conventions)
12. [Public plane (OpenAPI ↔ FastAPI)](#12-public-plane-openapi--fastapi)

---

## 1. Git workflow

### Branch naming

```
<type>/<short-slug>
```

| Type        | When to use                              |
| ----------- | ---------------------------------------- |
| `feat/`     | new feature or user-visible capability   |
| `fix/`      | bug fix                                  |
| `refactor/` | internal restructure, no behavior change |
| `chore/`    | tooling, deps, CI, docs                  |
| `test/`     | tests only                               |

Examples: `feat/person-intake-form`, `fix/sync-conflict-toast`, `chore/upgrade-tanstack-query`

### Commit messages

Follow **Conventional Commits**:

```
<type>(<scope>): <imperative summary>

[optional body — the WHY, not the WHAT]
```

- Summary: imperative mood, ≤ 72 chars, lowercase after the colon
- Scope: feature name or module, e.g. `shelter`, `auth`, `db`
- Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`

Good examples:

```
feat(shelter): add check-out flow with timestamp
fix(sync): stop redirecting to login on 401 during background sync
chore(deps): bump pnpm to 9.x
```

Bad examples:

```
updated stuff
WIP
fixed bug in shelter
```

### PR rules

- One PR = one feature or one concern. Domain + UI in the same feature = fine.
  Cross-feature barrel changes = separate PR.
- PR description must include: what changed, and how it was verified (§2 checklist in `CONTRIBUTING.md`).
- Rebase on `main` before requesting review — no merge commits.
- Squash is allowed when the commit history inside the PR is noise (WIP commits);
  keep it when commits tell a meaningful story.

### Pre-commit quality gate

The repo root runs **[Lefthook](https://github.com/evilmartians/lefthook)** (`lefthook.yml`) as a
pre-commit hook. When staged files touch `frontend/`, it runs — in order, fail-fast:

| Step | Command      | What it catches                                  |
| ---- | ------------ | ------------------------------------------------ |
| 1    | `pnpm lint`  | formatting drift, ESLint violations              |
| 2    | `pnpm check` | TypeScript / Svelte type errors (`svelte-check`) |
| 3    | `pnpm test`  | broken domain/data logic (Vitest)                |

This mirrors the Jenkins staging pipeline (lint → type-check → unit tests). Hooks are installed
when you run `pnpm install` at the **repo root** (see `CONTRIBUTING.md` §1).

- **Scope:** only runs when `frontend/` files are staged. Pure docs/config commits at the repo
  root skip the gate.
- **Manual run:** `pnpm exec lefthook run pre-commit` from the repo root.
- **Bypass (emergency only):** `LEFTHOOK=0 git commit` or `git commit --no-verify`. Don't make
  this the default — fix the failure instead.

Treat a green pre-commit the same as the §2 definition-of-done checklist for items 1–3. Item 4
(`svelte-autofixer`) is still manual before you push.

---

## 2. File & directory naming

| Artifact                            | Convention                                   | Example                       |
| ----------------------------------- | -------------------------------------------- | ----------------------------- |
| Svelte component                    | `kebab-case.svelte`                          | `intake-form.svelte`          |
| TypeScript module (general)         | `kebab-case.ts`                              | `shelter-sync.ts`             |
| TypeScript module (layer qualifier) | `<name>.<qualifier>.ts`                      | `shelter.repository.ts`       |
| Test file                           | `<module>.test.ts` (colocated)               | `shelter.test.ts`             |
| Feature barrel                      | `index.ts`                                   | `features/shelter/index.ts`   |
| Layer subdirectory                  | singular noun                                | `domain/`, `data/`, `ui/`     |
| Feature root                        | singular kebab-case noun                     | `features/shelter/`           |
| Route directory                     | SvelteKit conventions (`[param]`, `(group)`) | `routes/(protected)/shelter/` |
| shadcn-svelte component files       | `<component>.svelte` + `index.ts`            | `button/button.svelte`        |

Use dot notation (`<name>.<qualifier>.ts`) when the suffix describes the **layer role** of the
file — it groups related files together in editor tabs and avoids ambiguity between e.g. a
domain entity and a repository interface of the same feature. Use plain kebab for everything else.

```
shelter.ts             ← domain entity / factories
shelter.repository.ts  ← data layer interface  (dot: layer qualifier)
shelter.remote.ts      ← data layer concrete endpoint adapter
shelter.admin.ts       ← data layer admin helpers
shelter.seed.ts        ← data layer seed metadata
shelter-sync.ts        ← application sync wiring (kebab: compound word, not a layer suffix)
queries.ts             ← application TanStack Query hooks
```

---

## 3. TypeScript conventions

### Types vs interfaces

- Use `interface` for shapes that represent domain objects or repository contracts.
- Use `type` for unions, intersections, and utility aliases.

```ts
// Good
export interface Occupant {
	_id: string;
	name: string;
	status: 'in' | 'out';
}
export type OccupantStatus = Occupant['status'];

// Avoid
type Occupant = { _id: string; name: string }; // prefer interface for domain shapes
```

### Naming

| Kind                 | Style                           | Example                          |
| -------------------- | ------------------------------- | -------------------------------- |
| Type / Interface     | PascalCase                      | `ShelterConfig`, `OccupantInput` |
| Zod schema           | camelCase + `Schema` suffix     | `occupantInputSchema`            |
| Inferred Zod type    | PascalCase (same stem)          | `OccupantInput`                  |
| Enum-like const      | SCREAMING_SNAKE + `as const`    | `SHELTER_IDS`                    |
| Query key factory    | camelCase + `Keys` suffix       | `shelterKeys`                    |
| Repository interface | PascalCase + `Repository`       | `ShelterRepository`              |
| Concrete impl        | PascalCase + `RemoteRepository` | `ShelterRemoteRepository`        |

### Prefer explicit return types on exported functions

```ts
// Good — intent is clear at the call site
export function createOccupant(input: OccupantInput): Occupant { … }

// Acceptable for simple one-liners inferred from context
export const isShelterConfig = (d: unknown): d is ShelterConfig => …
```

### No `any`; prefer `unknown` at boundaries

```ts
// Boundary (CouchDB/endpoint doc result, raw API response)
function parseDoc(raw: unknown): ShelterDoc { … }

// Type guards narrow from unknown
if (isOccupant(raw)) { /* raw is Occupant here */ }
```

---

## 4. Feature architecture in practice

Every feature follows the strict four-layer model. The most complete reference is the quarantined
**`demo/lib/features/shelter`** feature — read it as a structural pattern before building a new
feature, but note it is demo code (excluded from the build); don't import from it or copy its
demo authz/seed into prod. The `shelter`/`Shelter`/`Occupant` names used as examples throughout
this doc come from it.

```
features/<name>/
  domain/        pure logic — entities, schemas, factories, type guards, derived computations
  data/          repository interface + remote endpoint adapter + seed/admin helpers
  application/   TanStack Query hooks + endpoint-state wiring
  ui/            .svelte components
  index.ts       THE only public barrel
```

### Layer rules (summary)

- **domain** — zero I/O, zero DB/network client, zero Svelte. Only imports from `zod` and
  other domain modules. Contains: entity interfaces, Zod input schemas, factory functions
  (`create*`, `make*`), type guards (`is*`), and pure derived computations.
- **data** — defines a repository interface (`*.repository.ts`) that the application layer
  depends on. The concrete remote endpoint implementation (`*.remote.ts`) is injected via the
  application layer or a DI helper. Never imported directly by routes or UI.
- **application** — `createQuery`/`createMutation` hooks (TanStack Query) plus active-endpoint
  state handling and query invalidation wiring. Depends on the repository _interface_, never on
  the concrete endpoint adapter.
- **ui** — `.svelte` components that consume application hooks. No direct DB/network client calls,
  no direct `fetch`. Only imports from `application/` and shared `$lib/components/ui/`.
- **index.ts** — the barrel re-exports everything routes and other features may use.
  Adding a new export = widening `index.ts`, not importing the inner path elsewhere.

### Adding a new feature — step by step

```
1. Create features/<name>/domain/<name>.ts
   - Define interfaces for your documents
   - Define Zod input schemas
   - Write factory functions + type guards
   - Write pure derived computations (no I/O)
   - Add unit tests: features/<name>/domain/<name>.test.ts

2. Create features/<name>/data/<name>.repository.ts
   - Define the ShelterRepository-style interface

3. Create features/<name>/data/<name>.remote.ts
   - Implement the repository against the active endpoint contract (central first, edge fallback)

4. Create features/<name>/application/queries.ts
   - Define a queryKeys factory
   - Write createQuery / createMutation hooks
   - Wire invalidation from mutation outcomes + endpoint-state updates (avoid polling)

5. Create features/<name>/ui/*.svelte
   - Compose from application hooks + $lib/components/ui/

6. Create features/<name>/index.ts
   - Export every public symbol; keep internals private

7. Create src/routes/(protected)/<name>/+page.svelte
   - Import only from the barrel
```

---

## 5. CouchDB document patterns

### Document `_id` conventions

IDs are human-readable and type-prefixed to allow range queries:

```
<type>:<uuid>          →  occupant:550e8400-e29b-41d4-a716-446655440000
<type>:<slug>          →  config  (singleton, no UUID)
<type>:<date>:<uuid>   →  txn:2026-06-10:550e8400…  (sortable by date)
```

Prefix choices:

- Use the exact `type` string of the document, e.g. `occupant:`, `item:`, `txn:`.
- Singletons use a plain key (`config`).
- Event-sourced / time-ordered documents prefix with ISO date for natural sort.

### Document type field

Every document must carry a `type` string literal:

```ts
export interface Occupant {
  _id: string;
  _rev?: string;   // always optional — absent on create
  type: 'occupant';
  …
}
```

Write a corresponding type guard:

```ts
export const isOccupant = (d: unknown): d is Occupant =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'occupant';
```

### Event-sourced quantities

Never store a running total. Use append-only transactions (see `StockTxn`) and compute
current values in domain functions (`deriveQuantities` / `stockBalance`). This avoids write
conflicts when two clients update stock concurrently. Sum ledger deltas with `$lib/utils/qty`
(see §6) — never native `number` arithmetic.

### Live update reactivity

Do not poll. Canonical live updates use the app-level event channel; invalidate TanStack Query keys from that channel plus endpoint transition events (central↔edge failover/failback), with one shared wiring per feature:

```ts
mutation.onSuccess(() => queryClient.invalidateQueries({ queryKey: featureKeys.all }));
endpointState.onChange(() => queryClient.invalidateQueries({ queryKey: featureKeys.all }));
```

Canonical mechanism is locked: use the app-level event channel for near-real-time push updates and keep one shared pattern across features.

### CouchDB View naming conventions

All views deploy in a single design document per database: **`_design/app`**. Never create additional design docs.

View names follow the pattern **`{subject}[_{qualifier}]`** in `snake_case`:

| Qualifier type                  | Pattern                    | Examples                                             |
| ------------------------------- | -------------------------- | ---------------------------------------------------- |
| None (bare aggregate)           | `{subject}`                | `occupancy`                                          |
| State / filter                  | `{subject}_{state}`        | `needs_open`                                         |
| Computed metric / running total | `{subject}_{metric}`       | `stock_balance`, `meals_served`, `slot_availability` |
| Most-recent per entity          | `latest_{subject}`         | `latest_screening`                                   |
| Grouped by dimension            | `{subject}_by_{dimension}` | `registrations_by_date`, `demographics_by_age`       |

Rules:

- Subject is always a **noun** — never a verb.
- `latest_` only for views returning the most recent document per entity key.
- `_by_{dimension}` only for views queried with `?group=true`.
- No abbreviations: `registrations` not `regs`, `demographics` not `demo`.

Map key conventions:

| Purpose           | Key shape                                                         |
| ----------------- | ----------------------------------------------------------------- |
| Single aggregate  | `emit(null, value)`                                               |
| Group by field    | `emit(doc.field, value)`                                          |
| Time-series       | `emit([doc.date, doc.sub_key], value)` — coarsest dimension first |
| Latest-per-entity | `emit([doc.entity_id, doc.occurred_at], null)`                    |

Value: `1` for count, numeric field for sum, `null` for map-only views.
For transactional stock balances prefer **client** Decimal sum of `qty_str` (CR-038 / §6) over
relying on CouchDB `_sum` of floats for correctness.

Views are called **server-side only** from `+server.ts` via `adminRaw`. Never call `_design/app/_view/*` from the browser.

---

## 6. Quantity arithmetic (`qty_str` + Decimal)

Transactional quantities (stock ledger, donation items, campaign targets, kitchen
requisition, recipe ingredient qty, UOM multipliers, gas cylinder rates, …) follow CR-038.

### Persist as `qty_str`

- CouchDB fields are JSON **strings** matching `^-?\d+(\.\d{1,4})?$` (≤4 fractional digits).
- Scale constant: `QTY_DECIMALS` in `$lib/utils/qty`.
- Canonical write: `persistQty(value)` before put. Never store transactional qty as a JSON
  `number` (IEEE-754).
- Ledger `qty` is always in `item_master.base_unit`.
- Counts / grams stay **int**: `meal_plan.recipes[].planned_qty`, headcount, capacity, etc.

### Compute only through `$lib/utils/qty`

| Helper                              | Use                                             |
| ----------------------------------- | ----------------------------------------------- |
| `parseQty` / `persistQty`           | boundary in/out                                 |
| `addQty` / `subQty`                 | sum / shortfall                                 |
| `qtyGt` / `qtyGte` / `qtyLte`       | comparisons (issue vs on-hand, needs remaining) |
| `qtyAbs` / `qtyNeg`                 | signed ledger deltas                            |
| `qtyStrCoercePositiveSchema` (etc.) | Zod input schemas                               |

**Do:**

```ts
import { addQty, persistQty, qtyGte, qtyStrCoercePositiveSchema } from '$lib/utils/qty';
import Decimal from 'decimal.js';

const qty = qtyStrCoercePositiveSchema.parse(raw); // → "7.5"
balance.set(id, addQty(balance.get(id) ?? '0', entry.qty));
if (qtyGte(onHand, requested)) {
	/* issue full */
}
// grams (int) → kg (qty_str)
qty_requested: persistQty(new Decimal(planned_qty).div(1000));
```

**Don't:**

```ts
z.coerce.number().positive(); // for transactional qty
Number(input.value); // then add / compare
onHand + delta; // native number math
// CouchDB `_sum` of floats as source of truth for stock_balance
```

- Prefer constructing from **strings** (`'0.1'`), not floats already damaged by IEEE-754.
- UI: read `<input>` as string → Zod / `parseQty`; write docs with `persistQty`.
- SOP ratios / `daily_calc` numeric snapshots are still `number` for now — use
  `roundQtyNumber` only at that boundary; anything that enters a ledger/requisition must become
  `qty_str` via `persistQty`.

Spec: `docs/data/schema.md` (`qty_str`), CR-038.

---

## 7. Svelte 5 component patterns

### Component file structure

```svelte
<script lang="ts">
	// 1. imports
	// 2. $props (destructured immediately)
	// 3. $state / $derived
	// 4. functions / handlers
	// 5. $effect (last resort only)
</script>

<!-- markup -->

<style>
	/* only when Tailwind utility classes aren't sufficient */
</style>
```

### Props

Always destructure `$props()` with explicit types:

```svelte
<script lang="ts">
	import type { Occupant } from '$lib/features/shelter';

	const { occupant, onCheckOut }: { occupant: Occupant; onCheckOut: () => void } = $props();
</script>
```

### Reactivity

```svelte
<!-- Good: $derived for computed values -->
let checkedIn = $derived(occupants.filter(o => o.status === 'in'));

<!-- Bad: computing inside $effect -->
$effect(() => { checkedIn = occupants.filter(o => o.status === 'in'); });

<!-- Good: $state.raw for large API objects -->
let docs = $state.raw<Occupant[]>([]);

<!-- Always key {#each} blocks -->
{#each occupants as occupant (occupant._id)}
  …
{/each}
```

### Events / callbacks

Use callback props instead of `createEventDispatcher`:

```svelte
<!-- Component -->
const { onSave }: { onSave: (item: OccupantInput) => void } = $props();

<!-- Parent -->
<IntakeForm onSave={handleSave} />
```

### Snippets over slots

```svelte
<!-- Good -->
{#snippet actions()}
	<Button>Save</Button>
{/snippet}
{@render actions()}

<!-- Avoid -->
<slot name="actions" />
```

### No `console.log` — toast only

```ts
import { toast } from 'svelte-sonner';

// Success
toast.success('Occupant checked in');

// Error
toast.error('Failed to save — check your connection');
```

---

## 8. Forms (Superforms + Zod)

### Schema location

Define the Zod schema in `domain/<name>.ts`, not inside the form component:

```ts
// domain/shelter.ts
export const occupantInputSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	note: z.string().trim().default('')
});
export type OccupantInput = z.infer<typeof occupantInputSchema>;
```

### Superforms wiring

```svelte
<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { occupantInputSchema } from '$lib/features/shelter';

	const form = superForm(
		{ name: '', note: '' },
		{
			SPA: true,
			validators: zod4Client(occupantInputSchema),
			onUpdate: ({ form }) => {
				if (!form.valid) return;
				mutation.mutate(form.data);
			}
		}
	);
	const { form: formData, errors, enhance } = form;
</script>

<form use:enhance>
	<input bind:value={$formData.name} />
	{#if $errors.name}<p>{$errors.name}</p>{/if}
	…
</form>
```

### Rules

- Always use `SPA: true` — there are no server actions.
- Never call `superForm` with a `+page.server.ts` `data` prop.
- Reset the form after a successful mutation inside `onUpdate` or the mutation's `onSuccess`.

---

## 9. Data fetching (TanStack Query)

### Query key factory

Define a keys factory in `application/queries.ts`:

```ts
export const shelterKeys = {
	all: ['shelter'] as const,
	occupants: (shelterId: string) => ['shelter', shelterId, 'occupants'] as const,
	config: (shelterId: string) => ['shelter', shelterId, 'config'] as const
};
```

### Query hooks

```ts
export function useOccupants(shelterId: string) {
	return createQuery({
		queryKey: shelterKeys.occupants(shelterId),
		queryFn: () => repo.listOccupants()
	});
}
```

### Mutation hooks

```ts
export function useCheckIn(shelterId: string) {
	const client = useQueryClient();

	return createMutation({
		mutationFn: (input: OccupantInput) => repo.saveOccupant(createOccupant(input)),
		onSuccess: () => client.invalidateQueries({ queryKey: shelterKeys.occupants(shelterId) }),
		onError: () => toast.error('Failed to check in occupant')
	});
}
```

### Rules

- **Never use `refetchInterval`** for live data — use mutation/endpoint-driven invalidation wiring.
- Keep `queryFn` thin: it calls a repository method, nothing else.
- Business logic (factory calls, validation) belongs in the mutation function or the domain layer.
- Handle loading and error states in the UI — every `createQuery` result has `.isLoading` and `.isError`.

---

## 10. UI & feedback patterns

### Loading state

```svelte
{#if query.isLoading}
	<Skeleton class="h-8 w-full" />
{:else if query.isError}
	<p class="text-destructive">Failed to load data.</p>
{:else}
	<!-- data -->
{/if}
```

### Empty state

Always show an explicit empty state — never render an empty list silently:

```svelte
{:else if occupants.length === 0}
  <p class="text-muted-foreground">No occupants checked in.</p>
```

### Component composition

- Use shadcn-svelte components from `$lib/components/ui/` as building blocks.
- Do not hand-edit files under `src/lib/components/ui/` — they are generated. Add via
  the shadcn-svelte CLI.
- Feature-specific components go in `features/<name>/ui/`, not in `$lib/components/`.

### Tailwind

- Use utility classes directly. No `@apply` outside of base styles in `app.css`.
- Prefer Tailwind tokens over raw colour values (`text-destructive` not `text-red-500`).
- Dark-mode variants go last: `bg-white dark:bg-zinc-900`.

---

## 11. Testing conventions

### What to test

| Layer       | Test focus                                                      | Adapter                                           |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------- |
| domain      | factories, invariants, derived computations, type guards        | Node (no DOM)                                     |
| data        | repository CRUD, conflict handling, failover behavior           | in-memory repo double + mocked endpoint responses |
| application | query hooks behaviour under success / error                     | in-memory repo                                    |
| ui          | only if there is significant render logic (conditional renders) | jsdom via Svelte Testing Library                  |

### File placement

Colocate tests with the code they test:

```
features/shelter/domain/shelter.ts
features/shelter/domain/shelter.test.ts   ← same directory
```

### Test style

```ts
import { describe, it, expect } from 'vitest';
import { createOccupant, countCheckedIn } from './shelter';

describe('createOccupant', () => {
	it('sets status to in and records checkInAt', () => {
		const occ = createOccupant({ name: 'Alice', note: '' });
		expect(occ.status).toBe('in');
		expect(occ.checkInAt).toMatch(/^\d{4}-/);
	});
});
```

- Use `describe` to group by function/behaviour, `it` for individual cases.
- Keep assertions focused — one logical assertion per `it` is fine; avoid
  multi-concern tests that are hard to diagnose.
- Prefer `expect(result).toEqual(…)` for data shapes; use `.toMatchObject` when
  you only care about a subset of properties.
- Do not bind unit tests to one storage engine. Prefer repository contract tests with deterministic doubles;
  add integration tests for central/edge endpoint behavior where needed.

### Naming

Test descriptions should read as specifications:

```
✓ createOccupant sets status to in and records checkInAt
✓ checkOutOccupant sets status to out and adds checkOutAt
✓ parseAccessibleShelters grants all shelters to _admin users
```

---

## 12. Public plane (OpenAPI ↔ FastAPI)

Staff features talk to CouchDB (remote-first). The **public plane** talks to FastAPI over
`/public/v1/*` with types generated from OpenAPI. End-to-end local stack and “do not bypass”
rules: **`CONTRIBUTING.md` §4.2**.

### Shared artifacts

| File                              | Role                                                     |
| --------------------------------- | -------------------------------------------------------- |
| `src/lib/api-specs/fastapi.json`  | Checked-in OpenAPI snapshot from FastAPI                 |
| `src/lib/api/openapi.d.ts`        | Generated by `openapi-typescript` — **do not hand-edit** |
| `src/lib/api/public-client.ts`    | `openapi-fetch` client (`baseUrl: ''`, same-origin)      |
| `src/lib/features/public-portal/` | Layered feature that wraps the client                    |

Regenerate after FastAPI schema changes (backend must be on `:9000`):

```bash
pnpm openapi:update
```

Commit **both** `fastapi.json` and `openapi.d.ts` in the same PR as the consumer change.

### Feature layout

Mirror other features; public-portal currently owns the typed public API surface:

```
features/public-portal/
  domain/        types from OpenAPI components + pure mappers (status, card shape)
  data/          public-api.ts — thin wrappers around publicClient.GET/POST
  application/   query key factory + createQuery / createMutation
  ui/            presentational components
  index.ts       barrel only
```

### Client wrappers

```ts
// data/public-api.ts — prefer this pattern; never raw fetch to /public/v1/* for typed routes
import { publicClient } from '$lib/api/public-client';

export async function familySearch(query: string) {
	const { data, error, response } = await publicClient.POST('/public/v1/family-search', {
		body: { search: query }
	});
	if (error || !data) throw new Error(/* unwrap ApiErrorResponse or status */);
	return data;
}
```

### Rules

- Derive request/response TypeScript from `components['schemas'][…]` / `paths` in `openapi.d.ts`
  — don’t duplicate DTOs by hand unless you need a UI-only view model (then map in `domain/`).
- Adapt Mongo/API shapes in **domain mappers** (e.g. `open` → `OPEN`, capacity-only cards). Do not
  reshape inside `.svelte` files.
- Routes and other features import only `$lib/features/public-portal` (barrel).
- Do not mix `serviceFetch` (staff BFF) with `publicClient` for the same endpoint.
- When adding a new FastAPI public route: (1) implement + test in `backend/`, (2) add an
  **exact-path** Vite proxy entry if the browser must call it same-origin, (3) `pnpm openapi:update`,
  (4) wrap in `public-portal` data/application, (5) wire UI.

---

_Last updated: 2026-07-16_
