# Frontend Conventions

Developer standards for the **Smart Shelter** frontend (`frontend/`). Read alongside
`CONTRIBUTING.md` (toolchain, definition of done, architecture overview). This document
covers the _how_ — naming, structure, and coding patterns every contributor must follow.

---

## Contents

1. [Git workflow](#1-git-workflow)
2. [File & directory naming](#2-file--directory-naming)
3. [TypeScript conventions](#3-typescript-conventions)
4. [Feature architecture in practice](#4-feature-architecture-in-practice)
5. [CouchDB / PouchDB document patterns](#5-couchdb--pouchdb-document-patterns)
6. [Svelte 5 component patterns](#6-svelte-5-component-patterns)
7. [Forms (Superforms + Zod)](#7-forms-superforms--zod)
8. [Data fetching (TanStack Query)](#8-data-fetching-tanstack-query)
9. [UI & feedback patterns](#9-ui--feedback-patterns)
10. [Testing conventions](#10-testing-conventions)

---

## 1. Git workflow

### Branch naming

```
<type>/<short-slug>
```

| Type       | When to use                                      |
| ---------- | ------------------------------------------------ |
| `feat/`    | new feature or user-visible capability           |
| `fix/`     | bug fix                                          |
| `refactor/`| internal restructure, no behavior change         |
| `chore/`   | tooling, deps, CI, docs                          |
| `test/`    | tests only                                       |

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

---

## 2. File & directory naming

| Artifact                        | Convention                                    | Example                           |
| ------------------------------- | --------------------------------------------- | --------------------------------- |
| Svelte component                | `kebab-case.svelte`                           | `intake-form.svelte`              |
| TypeScript module (general)     | `kebab-case.ts`                               | `shelter-sync.ts`                 |
| TypeScript module (layer qualifier) | `<name>.<qualifier>.ts`                   | `shelter.repository.ts`           |
| Test file                       | `<module>.test.ts` (colocated)                | `shelter.test.ts`                 |
| Feature barrel                  | `index.ts`                                    | `features/shelter/index.ts`       |
| Layer subdirectory              | singular noun                                 | `domain/`, `data/`, `ui/`         |
| Feature root                    | singular kebab-case noun                      | `features/shelter/`               |
| Route directory                 | SvelteKit conventions (`[param]`, `(group)`)  | `routes/(protected)/shelter/`     |
| shadcn-svelte component files   | `<component>.svelte` + `index.ts`             | `button/button.svelte`            |

Use dot notation (`<name>.<qualifier>.ts`) when the suffix describes the **layer role** of the
file — it groups related files together in editor tabs and avoids ambiguity between e.g. a
domain entity and a repository interface of the same feature. Use plain kebab for everything else.

```
shelter.ts             ← domain entity / factories
shelter.repository.ts  ← data layer interface  (dot: layer qualifier)
shelter.pouch.ts       ← data layer concrete impl
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
export interface Occupant { _id: string; name: string; status: 'in' | 'out' }
export type OccupantStatus = Occupant['status'];

// Avoid
type Occupant = { _id: string; name: string }  // prefer interface for domain shapes
```

### Naming

| Kind              | Style             | Example                       |
| ----------------- | ----------------- | ----------------------------- |
| Type / Interface  | PascalCase        | `ShelterConfig`, `OccupantInput` |
| Zod schema        | camelCase + `Schema` suffix | `occupantInputSchema`  |
| Inferred Zod type | PascalCase (same stem) | `OccupantInput`          |
| Enum-like const   | SCREAMING_SNAKE + `as const` | `SHELTER_IDS`         |
| Query key factory | camelCase + `Keys` suffix | `shelterKeys`            |
| Repository interface | PascalCase + `Repository` | `ShelterRepository`  |
| Concrete impl     | PascalCase + `PouchRepository` | `ShelterPouchRepository` |

### Prefer explicit return types on exported functions

```ts
// Good — intent is clear at the call site
export function createOccupant(input: OccupantInput): Occupant { … }

// Acceptable for simple one-liners inferred from context
export const isShelterConfig = (d: unknown): d is ShelterConfig => …
```

### No `any`; prefer `unknown` at boundaries

```ts
// Boundary (PouchDB `allDocs` result, raw API response)
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
  data/          repository interface + PouchDB implementation + seed/admin helpers
  application/   TanStack Query hooks + live-sync wiring
  ui/            .svelte components
  index.ts       THE only public barrel
```

### Layer rules (summary)

- **domain** — zero I/O, zero PouchDB, zero Svelte. Only imports from `zod` and
  other domain modules. Contains: entity interfaces, Zod input schemas, factory functions
  (`create*`, `make*`), type guards (`is*`), and pure derived computations.
- **data** — defines a repository interface (`*.repository.ts`) that the application layer
  depends on. The concrete PouchDB implementation (`*.pouch.ts`) is injected via the
  application layer or a DI helper. Never imported directly by routes or UI.
- **application** — `createQuery`/`createMutation` hooks (TanStack Query) and the live-sync
  wiring that invalidates query keys on PouchDB change events. Depends on the repository
  _interface_, never on the concrete PouchDB class.
- **ui** — `.svelte` components that consume application hooks. No direct PouchDB calls,
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

3. Create features/<name>/data/<name>.pouch.ts
   - Implement the repository using PouchDB

4. Create features/<name>/application/queries.ts
   - Define a queryKeys factory
   - Write createQuery / createMutation hooks
   - Wire invalidation via PouchDB changes feed (see shelter-sync pattern)

5. Create features/<name>/ui/*.svelte
   - Compose from application hooks + $lib/components/ui/

6. Create features/<name>/index.ts
   - Export every public symbol; keep internals private

7. Create src/routes/(protected)/<name>/+page.svelte
   - Import only from the barrel
```

---

## 5. CouchDB / PouchDB document patterns

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
current values in domain functions (`deriveQuantities`). This avoids write conflicts when
two clients go offline and both update stock.

### Live sync reactivity

Do not poll. Invalidate TanStack Query keys from the PouchDB changes feed:

```ts
db.changes({ live: true, since: 'now', include_docs: false })
  .on('change', () => queryClient.invalidateQueries({ queryKey: featureKeys.all }));
```

See `shelter-sync.ts` for the complete pattern including cleanup on unmount.

---

## 6. Svelte 5 component patterns

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

## 7. Forms (Superforms + Zod)

### Schema location

Define the Zod schema in `domain/<name>.ts`, not inside the form component:

```ts
// domain/shelter.ts
export const occupantInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  note: z.string().trim().default(''),
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
      },
    },
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

## 8. Data fetching (TanStack Query)

### Query key factory

Define a keys factory in `application/queries.ts`:

```ts
export const shelterKeys = {
  all: ['shelter'] as const,
  occupants: (shelterId: string) => ['shelter', shelterId, 'occupants'] as const,
  config:    (shelterId: string) => ['shelter', shelterId, 'config'] as const,
};
```

### Query hooks

```ts
export function useOccupants(shelterId: string) {
  return createQuery({
    queryKey: shelterKeys.occupants(shelterId),
    queryFn: () => repo.listOccupants(),
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
    onError: () => toast.error('Failed to check in occupant'),
  });
}
```

### Rules

- **Never use `refetchInterval`** for live data — use PouchDB changes feed invalidation.
- Keep `queryFn` thin: it calls a repository method, nothing else.
- Business logic (factory calls, validation) belongs in the mutation function or the domain layer.
- Handle loading and error states in the UI — every `createQuery` result has `.isLoading` and `.isError`.

---

## 9. UI & feedback patterns

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

## 10. Testing conventions

### What to test

| Layer       | Test focus                                                     | Adapter          |
| ----------- | -------------------------------------------------------------- | ---------------- |
| domain      | factories, invariants, derived computations, type guards       | Node (no DOM)    |
| data        | repository CRUD, conflict handling, seed helpers               | `pouchdb-adapter-memory` |
| application | query hooks behaviour under success / error                    | in-memory repo   |
| ui          | only if there is significant render logic (conditional renders)| jsdom via Svelte Testing Library |

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
- Do not mock PouchDB — use `pouchdb-adapter-memory` for a real (in-memory) database.

### Naming

Test descriptions should read as specifications:

```
✓ createOccupant sets status to in and records checkInAt
✓ checkOutOccupant sets status to out and adds checkOutAt
✓ parseAccessibleShelters grants all shelters to _admin users
```

---

_Last updated: 2026-06-10_
