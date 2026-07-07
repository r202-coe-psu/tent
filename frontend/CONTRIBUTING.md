# Contributing

Working agreement for the **`frontend`** package (the SvelteKit frontend of _tent / CouchDB Lab_).
Read this before opening a PR. It captures the conventions the codebase already enforces — most
are checked by ESLint, `svelte-check`, tests, and the **Lefthook pre-commit hook** (§1), so "the
hook is green" and "this doc is honored" should mean the same thing for lint/check/test.

> The stale `agent-role.md` still describes the original sveltekitten template (JWT + `openapi-fetch`,
> flat `api.ts`/`queries.ts` features). **This document and the actual `src/` tree win** where they
> disagree: this project is a remote-first CouchDB app with layered features.

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

| Task                      | Command                                              |
| ------------------------- | ---------------------------------------------------- |
| Dev server                | `pnpm dev` (binds `0.0.0.0`)                         |
| Type-check                | `pnpm check`                                         |
| Lint + format check       | `pnpm lint`                                          |
| Auto-format               | `pnpm format`                                        |
| Unit tests (run once)     | `pnpm test`                                          |
| Unit tests (watch)        | `pnpm test:watch`                                    |
| E2E (Playwright)          | `pnpm test:e2e`                                      |
| Regenerate OpenAPI types  | `pnpm openapi:update` (only when a task requires it) |
| Pre-commit hook (dry run) | `pnpm exec lefthook run pre-commit` (from repo root) |

The CouchDB backend runs via the repo-root `docker compose up` (CouchDB 3.5). Copy `.env.example`
to `.env` first.

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

Features live in `src/lib/features/<name>/` and are split into four layers with a strict
dependency direction (`ui → application → data → domain`):

```
features/<name>/
  domain/        pure entities, Zod schemas, factories, invariants — no I/O, no Svelte, no DB client
  data/          repository INTERFACE + concrete remote endpoint adapter + seed/admin helpers
  application/   TanStack Query hooks (createQuery/createMutation) + endpoint-state wiring
  ui/            feature-specific .svelte components
  index.ts       the public barrel — the ONLY entry point other code may import
```

**Rules (the first is lint-enforced — `no-restricted-imports`):**

- **Cross-feature & route code imports a feature only through its barrel** `$lib/features/<name>`.
  Reaching into `…/domain/*`, `…/data/*`, `…/application/*`, `…/ui/*` from outside is an error.
  A feature may import its own internals freely.
- **Domain is persistence-agnostic.** Put ID generation, validation, and "turn input into a valid
  entity" factories here (see `features/notes/domain/note.ts`). Keep `_id`/`_rev` tolerated but never
  let domain code call database/network clients directly.
- **The application layer depends on a repository _interface_, not a concrete store** (`note.repository.ts`
  defines the contract; a concrete endpoint adapter implements it). This is what makes the in-memory
  test double possible — keep the repo injectable.
- **Add a new UI/query export by widening `index.ts`**, not by importing the inner module elsewhere.

When you add a feature, mirror an existing one (`notes` is the reference; the quarantined
`demo/lib/features/shelter` shows the multi-database variant — read it as a pattern only, it is
demo code excluded from the build). Protected pages go in
`src/routes/(protected)/<feature>/+page.svelte`.

## 4. Data, endpoint & auth — do not bypass

สถาปัตยกรรมใหม่เป็น **remote-first**. Treat these as load-bearing:

- Writes go to the **active endpoint** directly (no local-only write queue). The active endpoint
  priority is strict and single-target: central CouchDB first (via `/couch` proxy), edge CouchDB
  on LAN only when WAN/central is unreachable.
- If both central and edge are unreachable, enter disconnected **status-only** mode (no read-only local cache); run automatic retry up to 3 attempts, then show a clear "cannot connect" banner with a force-retry action.
- **Reactivity/live update** must use the canonical **app-level event channel** for endpoint-aware invalidation (mutation outcomes + endpoint transitions). Do not poll, and do not introduce alternate live-update mechanisms per feature.
- **Auth is the CouchDB `_session` cookie.** Central and edge sessions are separate by origin/remote.
  Always login central first; use edge login only during central outage via filtered `_users` replica.
- Edge `AuthSession` does **not** grant `/api/v1/*` service access (central-only). When central
  returns, re-validate/re-login against central and fail back the active endpoint to central.
- On 401/403 from the active endpoint, stop further protected mutations and set `needsReauth`;
  do not force an unrelated global logout/redirect loop.
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
  (use injectable repository doubles for fast tests; use dedicated integration tests when
  validating CouchDB endpoint behavior).
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
