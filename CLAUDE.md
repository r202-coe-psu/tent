# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

This repo (`tent`, app title **"CouchDB Lab"**) is a local-first **CouchDB** app built from the
**sveltekitten** SPA template. The frontend now lives under `frontend/src/` with a working
layered feature set (`login`, `me`, `users`, `register`, `health`, `people`, `operations`, …), a
`$lib/db/` PouchDB/CouchDB layer, and dev-server admin API routes. The original template demos
(RBAC `demo` + the shelter A/B/C `shelter` demo) have been quarantined under the repo-root `demo/`
directory — reference only, excluded from the build (see `demo/README.md`).

The backend is **CouchDB 3.5** (see `docker-compose.yml`), reached from the browser with
cookie-based `_session` auth via a same-origin dev proxy (`PUBLIC_COUCH_PROXY=/couch`).

> **Stale docs — ignore where they disagree:** `frontend/agent-role.md` (and `AGENTS.md`) still
> describe the original template (JWT + `openapi-fetch`, flat `api.ts`/`queries.ts` features). The
> JWT/`openapi-fetch` bits are leftover boilerplate. The binding specs are
> **`frontend/CONTRIBUTING.md`** (toolchain, definition of done, architecture, data/sync/auth rules)
> and **`frontend/CONVENTIONS.md`** (naming, structure, coding patterns) — plus the actual `src/`
> tree. When anything here is thinner than those two, **they win; follow them.**

Data model / domain specs for the Smart Shelter system live in `docs/data/` (`data-model.md`,
`schema.md`, `api-contract.md`, `couchdb-mongodb-sync.md`) and `docs/features/`.

## Change Management — track every spec change, ask first

This is a **research project**: requirements are still being gathered while build is already
underway, so spec/docs **will keep changing** throughout. Change is the normal flow, not an
exception — but it must be **tracked strictly**. The binding policy is **`docs/change-management.md`**;
the change log lives in **`docs/changes/`**.

- **Never edit spec/docs silently.** Any change in the categories listed in
  `docs/change-management.md` §2 (a `docs/data/schema.md` field, a business rule/enum/invariant,
  a `docs/task-breakdown/` or `docs/prd/` scope/gate, a role/permission, a `schema_v` bump) needs
  a **Change Record** in `docs/changes/`.
- **Before recording or making any such change, STOP and ask the project owner how to track it**
  — CR file vs Notion vs a `decision sync` frontmatter note, and at what level of detail. There is
  **no default**; do not guess the tracking method. (Trivial typo/format/link fixes are exempt.)
- When you do change a doc, update its `updated:` frontmatter date, and bump `schema_v` + write a
  migration note when a persisted doc shape changes.
- Distinguish **stable core** (envelope, auth, sync, layer boundaries — overlaps the "do not bypass"
  rules below) from **volatile spec** (fields, rules, copy). Stable-core changes need review first.

## Commands

Run all frontend commands from `frontend/`. Package manager is **pnpm only** (lockfile
`pnpm-lock.yaml`; enforced via corepack in the Dockerfile). Don't add npm/yarn lockfiles.

| Task | Command |
| --- | --- |
| Dev server (binds `0.0.0.0`, port 5173) | `pnpm dev` |
| Type-check | `pnpm check` |
| Lint + format check | `pnpm lint` |
| Auto-format | `pnpm format` |
| Unit tests (once / watch) | `pnpm test` / `pnpm test:watch` |
| E2E (Playwright) | `pnpm test:e2e` |
| Regenerate OpenAPI types | `pnpm openapi:update` (only when a task requires it) |

**Definition of done (all must pass locally — see CONTRIBUTING.md §2):** `pnpm lint`, `pnpm check`
(zero errors), `pnpm test` (new domain/data logic ships with tests), and every `.svelte` file you
touched run through **`svelte-autofixer`** (Svelte MCP) until clean.

Bring up CouchDB from repo root: `docker compose up` (needs a `.env` with `COUCHDB_USER`/
`COUCHDB_PASSWORD`; copy from `.env.example`). The frontend also needs `frontend/.env`
(copy `frontend/.env.example`) for the `PUBLIC_*` vars. Data persists to `../deployment/couchdb/data`.

## Architecture

**SPA/PWA on Node** — `@sveltejs/adapter-node` (`ssr = false`). The app stays a
client-rendered SPA/PWA but is served by a Node server, which also runs the `/api/*`
**server endpoints** (`+server.ts` under `src/routes/api/` — admin, register) in production;
those hold the admin secret and are marked `prerender = false`. **No server-side data
loading**: no `+page.server.ts`, no `+layout.server.ts`, no server `load`. All page data
fetching is client-side via **TanStack Query** (`@tanstack/svelte-query`), wired through
`QueryClientProvider` in the root layout.

**Stack**: SvelteKit 2 + Svelte 5 (runes only) + Vite + TypeScript + Tailwind CSS v4 (no config
file — `@tailwindcss/vite`). UI is shadcn-svelte over `bits-ui` primitives in
`src/lib/components/ui/`. Forms use Superforms + Zod (`zod4Client` adapter). User feedback is
**toast only** (`svelte-sonner`) — never `console.log` (the PouchDB sync `console.warn` paths are
the deliberate exception).

### Offline-first data, sync & auth — do not bypass (CONTRIBUTING.md §4)

- **All persistence goes through PouchDB** (`$lib/db/pouch.ts`), which **live-syncs** to CouchDB.
  UI never talks to a remote DB directly — it reads/writes local PouchDB; sync propagates changes.
- **Sync target follows a strict priority — one active remote at a time:**
  1. **Central CouchDB** (normal; WAN reachable; via `/couch` proxy)
  2. **Edge CouchDB on LAN** — fallback only when WAN/central is unreachable; edge is a
     LAN-continuity replica, NOT a normal client hub
  3. **Local-only** — when neither central nor edge is reachable

  Never run live replication to both central and edge simultaneously; stop the old sync before
  starting the new one. When central returns, switch the active remote back to central.
- **Login follows the same priority:** always attempt `POST /couch/_session` against central
  first; edge fallback login is possible only because `_users` is filtered-replicated to the
  edge server. Edge `AuthSession` cookies do NOT grant access to `/api/v1/*` service endpoints.
- **Reactivity comes from the changes feed**, not manual refetching: the live-sync wiring
  invalidates the relevant TanStack Query keys on PouchDB `change` events. Never poll / never use
  `refetchInterval` for live data.
- **Auth is the CouchDB `_session` cookie** (`$lib/db/couch.ts`). Identity is cached (localStorage /
  `authStore` in `src/lib/stores/auth.svelte.ts`) so the app stays usable offline; only _sync_ needs
  a live session. On a 401/403 the sync stops and the store flags **`needsReauth`** — the user is
  **not** logged out of the local experience. Don't "fix" this by forcing a logout/redirect on sync
  errors.
- Use the guards in **`$lib/guards/auth.ts`** (`requireAuth`, `requireAdmin`, `redirectIfAuthenticated`)
  from route `+layout.ts`/`+page.ts` `load` functions. Don't roll your own redirect logic.
- **Admin credentials (`COUCHDB_ADMIN_URL`) are server-only** — usable only in dev-server API routes
  under `src/routes/api/**` and `$lib/server/couch-admin.ts`. Those API routes exist **only on the
  dev server** and are absent from the static prod build; client features must not depend on them.
  Never import server code into client bundles; never put credentials behind a `PUBLIC_` env var.
- Keep CouchDB same-origin in dev via the Vite `/couch` proxy (`PUBLIC_COUCH_PROXY`) so the session
  cookie is first-party — don't hardcode absolute CouchDB URLs in feature code.

### Feature-sliced layering (lint-enforced)

Features live under `src/lib/features/<name>/`, split into four layers with a strict dependency
direction **`ui → application → data → domain`**:

```
features/<name>/
  domain/       pure entities, Zod schemas, factories, invariants, type guards — no I/O, no Svelte, no PouchDB
  data/         repository INTERFACE + concrete PouchDB impl + seed/admin helpers
  application/  TanStack Query hooks (createQuery/createMutation) + live-sync wiring (depends on the repo interface)
  ui/           feature-specific .svelte components
  index.ts      the public barrel — the ONLY entry point other code may import
```

- **Cross-feature & route code may import a feature only through its barrel** `$lib/features/<name>`.
  Reaching into `…/domain/*`, `…/data/*`, `…/application/*`, `…/ui/*` from outside is an ESLint error
  (`no-restricted-imports`). A feature may import its own internals freely.
- Add a new public export by **widening `index.ts`**, not by importing an inner module elsewhere.
- When adding a feature, mirror an existing one. The quarantined **`demo/lib/features/shelter`**
  remains the most complete layered reference (multi-database variant) — read it as a pattern, but
  don't import from it or treat its demo authz/seed as prod. Protected pages go in
  `src/routes/(protected)/<feature>/+page.svelte`.
- For all naming/structure/coding details (file naming, types-vs-interface, guard style, doc `_id`
  patterns, query-key factories, test conventions) follow **`frontend/CONVENTIONS.md`** verbatim.
- `src/lib/components/ui/**` is vendored/generated shadcn-svelte and lint-excluded — don't hand-edit;
  add components via the shadcn-svelte workflow.

## Svelte 5 Conventions

Runes mode only — no Svelte 4 syntax. `$state`/`$derived`/`$props`/`onclick`, snippets +
`{@render}` instead of slots, `<X>` instead of `<svelte:component>`, `{@attach}` instead of `use:`.
Use a class with `$state` fields for shared state, not Svelte stores. Prefer `$state.raw` for large
API objects; derive with `$derived` (never compute in `$effect`); always key `{#each}` blocks (never
by index); use `createContext` for type-safe context.

The Svelte MCP server (`mcp.svelte.dev`) is configured — use `list-sections` then `get-documentation`
for SvelteKit/Svelte topics before answering, and `svelte-autofixer` to validate every `.svelte`
file before delivering it.

## Formatting

Prettier: tabs, single quotes, no trailing comma, printWidth 100, with the svelte and tailwindcss
plugins. `pnpm lint` checks Prettier + ESLint; `pnpm format` rewrites.

## Commits & PRs

Conventional Commits (`<type>(<scope>): <imperative summary>`, ≤72 chars, lowercase after colon).
Branch off `main` — don't commit straight to it. One PR = one feature/concern; respect layer
boundaries (domain + UI in the same feature is fine; reaching across feature barrels to make
something work is not). PR description says what changed and how it was verified. See
`frontend/CONVENTIONS.md` §1 and `frontend/CONTRIBUTING.md` §8.
