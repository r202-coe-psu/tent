# Contributing

Working agreement for the **`frontend`** package (the SvelteKit frontend of _tent / CouchDB Lab_).
Read this before opening a PR. It captures the conventions the codebase already enforces — most
are checked by ESLint, `svelte-check`, tests, and the **Lefthook pre-commit hook** (§1), so "the
hook is green" and "this doc is honored" should mean the same thing for lint/check/test.

> The stale `agent-role.md` still describes the original sveltekitten template (JWT auth, flat
> `api.ts`/`queries.ts` features). **This document and the actual `src/` tree win** where they
> disagree: staff data is remote-first CouchDB; the **public plane** uses FastAPI +
> `openapi-fetch` (see §4.2) — that is intentional, not leftover template code.

**New to the codebase?** Start with §3.1 (step-by-step walkthrough). Copy patterns from
`src/lib/features/people/` — that is the canonical reference feature. Naming, file layout, and
coding details beyond this doc live in `CONVENTIONS.md`.

---

## 1. Toolchain & commands

- **Package manager: pnpm only** (lockfiles: `frontend/pnpm-lock.yaml` for the app;
  `pnpm-lock.yaml` at repo root for Lefthook). Don't add `package-lock.json`/`yarn.lock`.
- **First-time setup after clone** — install git hooks from the repo root, then app deps:

  ```bash
  pnpm install          # repo root — installs lefthook, runs `lefthook install`
  cd frontend && pnpm install
  ```

- Run app commands from `frontend/`.

| Task                      | Command                                                       |
| ------------------------- | ------------------------------------------------------------- |
| Dev server                | `pnpm dev` (binds `0.0.0.0`)                                  |
| Type-check                | `pnpm check`                                                  |
| Lint + format check       | `pnpm lint`                                                   |
| Auto-format               | `pnpm format`                                                 |
| Unit tests (run once)     | `pnpm test`                                                   |
| Unit tests (watch)        | `pnpm test:watch`                                             |
| E2E (Playwright)          | `pnpm test:e2e`                                               |
| Regenerate OpenAPI types  | `pnpm openapi:update` (requires FastAPI on `:9000`; see §4.2) |
| Pre-commit hook (dry run) | `pnpm exec lefthook run pre-commit` (from repo root)          |

The CouchDB + MongoDB + sync worker stack runs via the repo-root `docker compose up` (CouchDB 3.5).
Copy `.env.example` to `.env` first. The frontend also needs `frontend/.env` (copy
`frontend/.env.example`) — include `PUBLIC_FASTAPI_PROXY=http://localhost:9000` for Vite
proxies and `FASTAPI_INTERNAL_URL` + `EXTERNAL_API_SECRET` for the BFF → FastAPI donation path.

### Pre-commit quality gate (Lefthook)

[`lefthook.yml`](../lefthook.yml) at the repo root enforces a **basic code-smell check** before
every commit that stages `frontend/` files. Commands run sequentially (fail-fast), matching
Jenkins staging CI:

1. `pnpm lint` — Prettier + ESLint
2. `pnpm check` — `svelte-check`
3. `pnpm test` — Vitest

Hooks register automatically via the root `prepare` script when you `pnpm install` at the repo
root. Commits that only touch docs, infra, or other non-`frontend/` paths skip the gate.

Bypass only when necessary: `LEFTHOOK=0 git commit` or `git commit --no-verify`.

## 2. Definition of done

A change is not ready until **all** of these pass locally:

1. `pnpm lint` — Prettier (tabs, single quotes, no trailing comma, printWidth 100) **and** ESLint clean.
2. `pnpm check` — zero `svelte-check` errors.
3. `pnpm test` — unit tests green; new domain/data logic ships with tests (see §6).
4. Every `.svelte` file you touched has been run through the **`svelte-autofixer`** (Svelte MCP)
   until it reports no issues.

Items **1–3** run automatically on `git commit` when `frontend/` files are staged (Lefthook
pre-commit). Run them manually (`pnpm lint`, `pnpm check`, `pnpm test` in `frontend/`) before
you stage if you want faster feedback. Item **4** is not hooked — verify it yourself before opening
a PR.

## 3. Architecture: feature-sliced, remote-first

### Mental model (read this first)

The app is **remote-first**: the browser talks to CouchDB directly over HTTP (via the `/couch`
dev proxy), using the user's login cookie. There is **no PouchDB** and **no local database** on
the device.

```
Browser  →  /couch  →  CouchDB central   (normal path)
```

If the network is down, the app shows a disconnected banner — it does **not** fall back to
reading cached data offline.

Every feature is split into four layers with a strict dependency direction
(`ui → application → data → domain`):

```
features/<name>/
  domain/        pure entities, Zod schemas, factories, invariants — no I/O, no Svelte, no DB client
  data/          repository INTERFACE + concrete remote endpoint adapter (*.remote.ts)
  application/   TanStack Query hooks (createQuery/createMutation) + live-update wiring
  ui/            feature-specific .svelte components
  index.ts       the public barrel — the ONLY entry point other code may import
```

**Rules (the first is lint-enforced — `no-restricted-imports`):**

- **Cross-feature & route code imports a feature only through its barrel** `$lib/features/<name>`.
  Reaching into `…/domain/*`, `…/data/*`, `…/application/*`, `…/ui/*` from outside is an error.
  A feature may import its own internals freely.
- **Domain is persistence-agnostic.** Put ID generation, validation, and "turn input into a valid
  entity" factories here (see `features/people/domain/people.ts`). Keep `_id`/`_rev` tolerated but
  never let domain code call database/network clients directly.
- **The application layer depends on a repository _interface_, not a concrete store**
  (`people.repository.ts` defines the contract; `people.remote.ts` implements it against CouchDB).
  This is what makes the in-memory test double possible — keep the repo injectable.
- **Add a new UI/query export by widening `index.ts`**, not by importing the inner module elsewhere.

When you add a feature, mirror `src/lib/features/people/`. Protected pages go in
`src/routes/(protected)/<feature>/+page.svelte`.

### 3.1 Quick start — building a feature step by step

Use `people` as your template. Work through the layers in order:

#### Step 1 — Domain (`features/people/domain/people.ts`)

Pure TypeScript only. No `fetch`, no CouchDB imports, no Svelte.

- Define document interfaces (`Evacuee`, `Household`, …)
- Write Zod input schemas and factory functions (`buildEvacuee`, `buildHousehold`, …)
- Write type guards (`isEvacuee`, `isHousehold`, …)
- Add unit tests: `domain/people.test.ts`

#### Step 2 — Data interface (`features/people/data/people.repository.ts`)

Define what the application layer can ask for — without saying _how_ data is stored:

```ts
export interface PeopleRepository {
	listEvacuees(): Promise<Evacuee[]>;
	createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee>;
	// …
}
```

#### Step 3 — Data implementation (`features/people/data/people.remote.ts`)

This is where CouchDB HTTP happens. Use `createRemoteRepository` — do **not** call `fetch`
directly from UI or application code:

```ts
import { createRemoteRepository } from '$lib/db/repository';

export class PeopleRemoteRepository implements PeopleRepository {
	private readonly repo = createRemoteRepository(dbName);

	async createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee> {
		const evacuee = buildEvacuee(input, ctx); // domain factory
		return this.repo.put(evacuee); // HTTP PUT to CouchDB
	}

	listEvacuees(): Promise<Evacuee[]> {
		return this.repo.allByType('evacuee', isEvacuee);
	}
}
```

Low-level HTTP (retry, error mapping) lives in `$lib/db/couch-db.ts`. You rarely need to touch
it — `createRemoteRepository` covers the common `get` / `put` / `remove` / `allByType` operations.

Export a singleton accessor at the bottom of the file (see `peopleRepository()` in
`people.remote.ts`).

#### Step 4 — Application (`features/people/application/queries.ts`)

Wire TanStack Query hooks. UI components call these — never the repository directly.

**Read data:**

```ts
export const useEvacuees = () =>
	createQuery(() => ({
		queryKey: peopleKeys.evacuees(),
		queryFn: () => peopleRepository().listEvacuees()
	}));
```

**Write data:**

```ts
export const useCreateEvacuee = () =>
	createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: EvacueeInput; ctx: AuthorContext }) =>
			peopleRepository().createEvacuee(input, ctx)
	}));
```

**In a `.svelte` component:**

```svelte
<script lang="ts">
	import { useEvacuees, useCreateEvacuee } from '$lib/features/people';

	const evacuees = useEvacuees();
	const createEvacuee = useCreateEvacuee();
</script>

<!-- read:  evacuees.data -->
<!-- write: createEvacuee.mutate({ input, ctx }) -->
```

#### Step 5 — UI (`features/people/ui/*.svelte`)

Compose from application hooks + `$lib/components/ui/`. No direct `fetch`, no repository imports.

#### Step 6 — Barrel (`features/people/index.ts`)

Export every symbol that routes or other features need. This is the **only** import path from
outside the feature.

#### Step 7 — Route (`src/routes/(protected)/people/+page.svelte`)

Import only from `$lib/features/people`.

#### Step 8 — Live updates (if the feature has lists that should refresh automatically)

Add `startPeopleLiveQuery` in `application/queries.ts`:

```ts
export function startPeopleLiveQuery(queryClient: QueryClient) {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'evacuee') return [peopleKeys.evacuees()];
		// map each doc type → query keys to invalidate
		return [];
	});
}
```

Export it from `index.ts`, then register it in `src/routes/+layout.svelte` alongside the other
`startXxxLiveQuery` calls. See §4.1 for how the plumbing works.

### 3.2 Key files (bookmark these)

| File                                      | What it does                                                   |
| ----------------------------------------- | -------------------------------------------------------------- |
| `$lib/db/couch-db.ts`                     | Low-level CouchDB HTTP (`getDoc`, `putDoc`, retry 3×)          |
| `$lib/db/repository.ts`                   | `createRemoteRepository(dbName)` — use this in `*.remote.ts`   |
| `$lib/db/event-channel.ts`                | App-wide pub/sub: "a document changed"                         |
| `$lib/db/changes-subscriber.ts`           | Long-polls CouchDB `_changes` → emits to event channel         |
| `$lib/db/subscribe-data-changes.ts`       | Connects event channel → TanStack Query invalidation           |
| `$lib/stores/endpoint.svelte.ts`          | Connection status: `connecting` / `connected` / `disconnected` |
| `$lib/components/ConnectionBanner.svelte` | Red banner + "ลองเชื่อมต่ออีกครั้ง" when offline               |

### 3.3 Do I need `+server.ts`?

Most features do **not**. Use this table:

| Your task                                        | Where to put it                                                     | Example                      |
| ------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------- |
| Normal CRUD (evacuees, stock, kitchen, …)        | `features/<name>/data/<name>.remote.ts`                             | `people.remote.ts`           |
| CouchDB views (`_design/app/_view/*`)            | `src/routes/api/**/+server.ts` (server-side only)                   | back-office dashboard routes |
| Admin-only ops needing `COUCHDB_ADMIN_URL`       | `src/routes/api/**/+server.ts`                                      | shelter provisioning         |
| User is logged in and works inside their shelter | **No `+server.ts` needed** — browser → `/couch` with session cookie |

**Simple rule:** if a normal logged-in shelter user can do it in the UI, implement it in
`*.remote.ts`. Only create a `+server.ts` route when you need server secrets or CouchDB views
that must not be called from the browser.

---

## 4. Data, endpoint & auth — do not bypass

สถาปัตยกรรมเป็น **remote-first**. Treat these as load-bearing:

- **Writes go to the active endpoint directly** (no local write queue, no PouchDB). Priority:
  central CouchDB first (via `/couch` proxy), edge CouchDB on LAN only when WAN/central is
  unreachable.
- **Disconnected = status-only.** If both central and edge are unreachable, there is no read-only
  local cache. HTTP retries automatically 3 times, then `endpointStore` marks `disconnected` and
  `ConnectionBanner` appears. The user can tap force-retry.
- **Do not poll.** No `refetchInterval`, no `setInterval` for live data. Use the event channel
  (§4.1).
- **Auth is the CouchDB `_session` cookie.** Central and edge sessions are separate by
  origin/remote. Always login central first; edge login is only for central outage.
- Edge `AuthSession` does **not** grant `/api/v1/*` service access (central-only). When central
  returns, re-validate/re-login against central and fail back the active endpoint to central.
- On 401/403 from the active endpoint, stop further protected mutations and set `needsReauth` —
  do not force an unrelated global logout/redirect loop.
- Use the guards in `$lib/guards/auth.ts` (`requireAuth`, `requireAdmin`, `redirectIfAuthenticated`)
  from route `+layout.ts`/`+page.ts` `load` functions. Don't roll your own redirect logic.
- **Admin credentials (`COUCHDB_ADMIN_URL`) are server-only.** They may only be used in
  `src/routes/api/**` and `$lib/server/couch-admin.ts`. Never import server code into client
  bundles, and never put credentials behind a `PUBLIC_` env var.
- **Transactional quantities** (stock, donation items, requisition, recipe qty, UOM multiplier, …)
  must go through `$lib/utils/qty` and persist as `qty_str` (decimal string, ≤4 fractional digits).
  Details and do/don’t examples: `CONVENTIONS.md` §6 (CR-038).

**Do not:**

- Import or recreate PouchDB / `pouch.ts` / `*.pouch.ts`
- Build a local offline database or write queue
- Call `_design/app/_view/*` from the browser
- Persist transactional qty as a JSON `number`, or add/compare qty with native `number` arithmetic
  (`+`, `*`, `Math.min` on floats, `Number(input)` then accumulate)

### 4.1 Live updates — how data refreshes automatically

When any client writes a document, other open tabs (and the same tab after a mutation from
another user) should see fresh data. The flow:

```
CouchDB _changes (longpoll)  →  eventChannel.emit()  →  subscribeDataChanges()  →  queryClient.invalidateQueries()
```

1. `+layout.svelte` starts `startChangesSubscriber([dbNames…])` — one long-poll per database.
2. Each feature exports `startXxxLiveQuery(queryClient)` that calls `subscribeDataChanges` and
   maps `docType` → TanStack Query keys to invalidate.
3. After your own mutation succeeds, the invalidation from step 2 also covers your UI — you do
   **not** need manual `refetch()` in every mutation handler.

Copy `startPeopleLiveQuery` from `features/people/application/queries.ts` when adding a new
feature with live lists.

### 4.2 Public plane — worker, FastAPI, OpenAPI (do not bypass)

Public routes under `/public/*` (family search, shelter directory, …) are **not** CouchDB session
traffic. Contract: [`docs/data/api-contract.md`](../docs/data/api-contract.md) §5 +
[`docs/data/couchdb-mongodb-sync.md`](../docs/data/couchdb-mongodb-sync.md).

```
staff UI  →  CouchDB (SoR)
                ↓ sync worker (CDC)
             MongoDB public_* collections
                ↓
             FastAPI :9000  (/public/v1/*)
                ↑
public SPA  →  same-origin /public-api/*  (Vite proxy in dev; nginx in prod)
```

**Local stack (all three must run for public features that read Mongo):**

| Step                       | Where                                  | Command / note                                                                        |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Infra                   | repo root                              | `docker compose up -d` — CouchDB, MongoDB, sync worker                                |
| 2. Seed / write staff data | `frontend/`                            | `pnpm seed` (or normal staff UI writes) so CouchDB has docs to project                |
| 3. Sync                    | automatic via compose worker, or local | `uv run --project worker sync-worker` / `--bootstrap` for full re-sync                |
| 4. Public API              | `backend/`                             | `./scripts/run-dev` → FastAPI on **:9000** (`APP_ENV=dev`)                            |
| 5. SPA                     | `frontend/`                            | `pnpm dev` → :5173; proxies `/public-api` → FastAPI (strips prefix to `/public/v1/*`) |

Verify projections in Compass: `mongodb://localhost:27017/tentdb` (`public_persons`, `public_shelters`, …).

**Frontend rules for this plane:**

- Call FastAPI through **`$lib/api/public-client.ts`** (`openapi-fetch` + generated
  `$lib/api/openapi.d.ts`, `baseUrl: '/public-api'`). Feature code lives in
  `$lib/features/public-portal/` (layers + barrel).
- Do **not** use `serviceFetch` / `$lib/api/service.ts` for public-plane routes (that helper is
  staff `/api/v1/*` + BFF).
- Gateway is **`/public-api` only** — do **not** proxy `/public` (SPA) or `/api` (BFF). FastAPI
  route paths remain `/public/v1/*` behind the gateway strip.
- Needs / donations / transparency may still be SvelteKit BFF (`src/routes/api/public/v1/**`) until
  migrated — do not invent a second untyped `fetch` path for endpoints already on FastAPI.
- After changing FastAPI request/response schemas: start backend, then from `frontend/`:

  ```bash
  pnpm openapi:update   # curl :9000/openapi.json → api-specs/fastapi.json → openapi.d.ts
  ```

  Commit both `src/lib/api-specs/fastapi.json` and `src/lib/api/openapi.d.ts` so CI/`pnpm check`
  does not require a running FastAPI.

Coding patterns (client wrappers, mappers, query keys): **`CONVENTIONS.md` §12**.

---

## 5. SPA / SvelteKit constraints

- Built via `@sveltejs/adapter-node` — a SPA/PWA served by a Node server, `ssr = false`. **No SSR data
  loading**: no `+page.server.ts`, no `+layout.server.ts`, no server `load`. All page data fetching is
  client-side via TanStack Query hooks in the application layer.
- The `src/routes/api/**` `+server.ts` endpoints run on the Node server in **both dev and production**
  (they hold the admin secret). They are marked `prerender = false` so they stay dynamic. See §3.3
  for when you actually need one.
- Keep CouchDB same-origin in dev via the Vite `/couch` proxy (`PUBLIC_COUCH_PROXY`) so the session
  cookie is first-party — don't hardcode absolute CouchDB URLs in feature code.
- Keep FastAPI public routes same-origin via `/public-api` (Vite proxy in dev via
  `PUBLIC_FASTAPI_PROXY`; nginx in prod/staging). BFF server calls use `FASTAPI_INTERNAL_URL`
  (+ `EXTERNAL_API_SECRET` for donations) — see §4.2. Don't hardcode `http://localhost:9000`
  in feature code.

## 6. Testing

- Unit tests are **Vitest**, colocated as `*.test.ts` next to the code (`environment: node`,
  globals on). Prioritize **domain** logic (factories, invariants, guards) and **data** repositories
  (use injectable repository doubles or mock `fetch` for fast tests; use `*.remote.integration.test.ts`
  when validating real CouchDB HTTP behavior).
- E2E is **Playwright** in `e2e/`; `pnpm test:e2e` builds in `test` mode first. `e2e/mock-api.js`
  stands in for the backend during those runs.

## 7. Svelte 5 & UI conventions

- **Runes mode only.** `$state`/`$derived`/`$props`/`onclick`; snippets + `{@render}` over slots;
  `<X>` over `<svelte:component>`; `{@attach}` over `use:`. Use a class with `$state` fields for
  shared state — not Svelte stores. Always key `{#each}` blocks (never by index); derive with
  `$derived`, never compute in `$effect`; prefer `$state.raw` for large objects.
- Forms use **Superforms + Zod** (`zod4Client` adapter).
- Compose UI from `src/lib/components/ui/` (vendored shadcn-svelte over `bits-ui`). That directory is
  **generated and lint-ignored — don't hand-edit it**; add components via the shadcn-svelte workflow.
- **User feedback is toast only** (`svelte-sonner`). No `console.log` in committed code (the
  endpoint failover/retry `console.warn` paths are the deliberate exception).

## 8. Commits & PRs

- Branch off `main`; don't commit straight to it.
- Keep each PR to one feature/concern; respect the layer boundaries above (a domain change and a
  UI change in the same feature are fine; reaching across feature barrels to make something work is not).
- A PR description should say what changed and how it was verified (the §2 checklist).
