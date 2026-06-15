# Contributing

Working agreement for the **`frontend`** package (the SvelteKit frontend of _tent / CouchDB Lab_).
Read this before opening a PR. It captures the conventions the codebase already enforces — most
are checked by ESLint, `svelte-check`, and tests, so "the CI is green" and "this doc is honored"
should mean the same thing.

> The stale `agent-role.md` still describes the original sveltekitten template (JWT + `openapi-fetch`,
> flat `api.ts`/`queries.ts` features). **This document and the actual `src/` tree win** where they
> disagree: this project is a local-first CouchDB app with layered features.

---

## 1. Toolchain & commands

- **Package manager: pnpm only** (the lockfile is `pnpm-lock.yaml`). Don't add `package-lock.json`/`yarn.lock`.
- Run everything from `frontend/`.

| Task                     | Command                                              |
| ------------------------ | ---------------------------------------------------- |
| Dev server               | `pnpm dev` (binds `0.0.0.0`)                         |
| Type-check               | `pnpm check`                                         |
| Lint + format check      | `pnpm lint`                                          |
| Auto-format              | `pnpm format`                                        |
| Unit tests (run once)    | `pnpm test`                                          |
| Unit tests (watch)       | `pnpm test:watch`                                    |
| E2E (Playwright)         | `pnpm test:e2e`                                      |
| Regenerate OpenAPI types | `pnpm openapi:update` (only when a task requires it) |

The CouchDB backend runs via the repo-root `docker compose up` (CouchDB 3.5). Copy `.env.example`
to `.env` first.

## 2. Definition of done

A change is not ready until **all** of these pass locally:

1. `pnpm lint` — Prettier (tabs, single quotes, no trailing comma, printWidth 100) **and** ESLint clean.
2. `pnpm check` — zero `svelte-check` errors.
3. `pnpm test` — unit tests green; new domain/data logic ships with tests (see §6).
4. Every `.svelte` file you touched has been run through the **`svelte-autofixer`** (Svelte MCP)
   until it reports no issues.

## 3. Architecture: feature-sliced, local-first

Features live in `src/lib/features/<name>/` and are split into four layers with a strict
dependency direction (`ui → application → data → domain`):

```
features/<name>/
  domain/        pure entities, Zod schemas, factories, invariants — no I/O, no Svelte, no PouchDB
  data/          repository INTERFACE + concrete PouchDB impl + seed/admin helpers
  application/   TanStack Query hooks (createQuery/createMutation) + live-sync wiring
  ui/            feature-specific .svelte components
  index.ts       the public barrel — the ONLY entry point other code may import
```

**Rules (the first is lint-enforced — `no-restricted-imports`):**

- **Cross-feature & route code imports a feature only through its barrel** `$lib/features/<name>`.
  Reaching into `…/domain/*`, `…/data/*`, `…/application/*`, `…/ui/*` from outside is an error.
  A feature may import its own internals freely.
- **Domain is persistence-agnostic.** Put ID generation, validation, and "turn input into a valid
  entity" factories here (see `features/notes/domain/note.ts`). Keep `_id`/`_rev` tolerated but never
  let domain code call PouchDB.
- **The application layer depends on a repository _interface_, not a concrete store** (`note.repository.ts`
  defines the contract; `note.pouch.ts` implements it). This is what makes the in-memory test double
  possible — keep the repo injectable.
- **Add a new UI/query export by widening `index.ts`**, not by importing the inner module elsewhere.

When you add a feature, mirror an existing one (`notes` is the reference; the quarantined
`demo/lib/features/shelter` shows the multi-database variant — read it as a pattern only, it is
demo code excluded from the build). Protected pages go in
`src/routes/(protected)/<feature>/+page.svelte`.

## 4. Data, sync & auth — do not bypass

This app is **offline-first**. Treat these as load-bearing:

- All persistence goes through **PouchDB** (`$lib/db/pouch.ts`), which **live-syncs** to CouchDB.
  UI never talks to a remote DB directly — it reads/writes the local PouchDB; sync propagates changes.
- **Reactivity comes from the changes feed**, not from manual refetching: the `live-sync` hook
  invalidates the relevant TanStack Query keys on PouchDB `change` events. Follow that pattern instead
  of polling.
- **Auth is the CouchDB `_session` cookie.** Identity is cached in `localStorage` so the app stays
  usable offline; only _sync_ needs a live session. On a 401/403 the sync stops and the store flags
  `needsReauth` — **the user is not logged out of the local experience.** Don't "fix" this by forcing
  a logout/redirect on sync errors.
- **Sync target has a strict priority — one active remote at a time:**
  central CouchDB first (via `/couch` proxy); edge CouchDB on LAN only when
  WAN/central is unreachable; local-only when neither is reachable. Never run
  live replication to both simultaneously — stop the current sync before switching targets.
- **Login uses the same priority:** always attempt central first. Edge fallback login
  works because `_users` is filtered-replicated to the edge server. An edge `AuthSession`
  cookie does NOT grant access to `/api/v1/*` service endpoints (central-only). When
  central returns, the app must re-login against central and switch the active remote back.
- Use the guards in `$lib/guards/auth.ts` (`requireAuth`, `requireAdmin`, `redirectIfAuthenticated`)
  from route `+layout.ts`/`+page.ts` `load` functions. Don't roll your own redirect logic.
- **Admin credentials (`COUCHDB_ADMIN_URL`) are server-only.** They may only be used in the dev-server
  API routes under `src/routes/api/**` and `$lib/server/couch-admin.ts`. Never import server code into
  client bundles, and never put credentials behind a `PUBLIC_` env var.

## 5. SPA / SvelteKit constraints

- Built via `@sveltejs/adapter-node` — a SPA/PWA served by a Node server, `ssr = false`. **No SSR data
  loading**: no `+page.server.ts`, no `+layout.server.ts`, no server `load`. All page data fetching is
  client-side.
- The `src/routes/api/**` `+server.ts` endpoints run on the Node server in **both dev and production**
  (they hold the admin secret). They are marked `prerender = false` so they stay dynamic; an
  `api/+layout.ts` documents this intent at the group level. Keep secrets server-side only — never
  expose them to client bundles.
- Keep CouchDB same-origin in dev via the Vite `/couch` proxy (`PUBLIC_COUCH_PROXY`) so the session
  cookie is first-party — don't hardcode absolute CouchDB URLs in feature code.

## 6. Testing

- Unit tests are **Vitest**, colocated as `*.test.ts` next to the code (`environment: node`,
  globals on). Prioritize **domain** logic (factories, invariants, guards) and **data** repositories
  (use `pouchdb-adapter-memory` for an in-memory PouchDB rather than hitting a real CouchDB).
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
- **User feedback is toast only** (`svelte-sonner`). No `console.log` in committed code (the PouchDB
  sync-error `console.warn` paths are the deliberate exception).

## 8. Commits & PRs

- Branch off `main`; don't commit straight to it.
- Keep each PR to one feature/concern; respect the layer boundaries above (a domain change and a
  UI change in the same feature are fine; reaching across feature barrels to make something work is not).
- A PR description should say what changed and how it was verified (the §2 checklist).
