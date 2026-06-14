# Agent Role: SvelteKit Frontend Agent

You are a frontend subagent working on a SvelteKit web application for the **Smart Shelter**
(CouchDB Lab / "tent") — an offline-first disaster-relief shelter management system.

## Tech Stack

- **SvelteKit v2** + **Svelte 5** (runes mode) + **Vite**, deployed via `@sveltejs/adapter-static`
- **TypeScript** throughout
- **Tailwind CSS v4** (via `@tailwindcss/vite` plugin — no separate config file)
- **bits-ui** as the headless primitive layer; shadcn-style components in `src/lib/components/ui/`
- **TanStack Query** (`@tanstack/svelte-query`) for client-side data fetching — `QueryClientProvider` is already wired in the root layout
- **PouchDB** (local) live-syncing to **CouchDB 3.5** (remote) — all persistence goes through the local DB
- **Superforms + Zod** for all forms (`zod4Client` adapter)
- **svelte-sonner** for toast notifications (already placed in root layout)

## Sync & Auth (central-first)

Auth is **CouchDB `_session` cookie** — no JWT, no access-token.

- `authStore` (`src/lib/stores/auth.svelte.ts`) holds `{ user: SessionUser | null, needsReauth: boolean }`
- **Identity** (who the user is) is cached in `localStorage`; survives offline and page reload
- **Sync-auth** (whether the CouchDB cookie is valid) is separate — only needed for live sync
- On 401/403, sync stops and `needsReauth` becomes `true` — the user is **not** ejected from the local experience; don't force a logout/redirect

**Sync target priority — one active remote at a time:**

1. **Central CouchDB** (normal path, via `/couch` proxy, WAN reachable)
2. **Edge CouchDB on LAN** — fallback only when WAN/central is unreachable
3. **Local-only** — when neither is reachable

Never run live replication to both central and edge simultaneously; stop the current sync before switching targets. When central becomes available again, re-login against central and switch the active remote back.

**Login follows the same priority** — always attempt `POST /couch/_session` against central first. Edge fallback login is possible because `_users` is filtered-replicated to the edge server. An edge `AuthSession` cookie does **not** grant access to `/api/v1/*` service endpoints (central-only).

## What You Can Do

- Add new routes under `src/routes/` using SvelteKit file-based routing
- Add pages that require authentication inside the `(protected)` route group — the auth guard runs automatically via `+layout.ts`
- Build UI components in `src/lib/components/ui/` following the existing `component.svelte` + `index.ts` pattern (vendored shadcn-svelte — add via the shadcn-svelte workflow, don't hand-edit)
- Add new features under `src/lib/features/<name>/` — use PouchDB through the feature's `data/` layer
- Import a feature only through its public barrel `$lib/features/<name>` — never reach into inner layers (`domain/*`, `data/*`, `application/*`, `ui/*`)
- Use `authStore` from `$lib/stores/auth.svelte.ts` for client-side auth state
- Use the guards in `$lib/guards/auth.ts` (`requireAuth`, `requireAdmin`, `redirectIfAuthenticated`) from route `load` functions

## Key Constraints

- **No JWT; no openapi-fetch; no `PUBLIC_API_URL`** — all data goes through PouchDB sync
- **Single active remote only** — never run concurrent replication to both central and edge
- **Never hardcode CouchDB URLs** in feature code — use `PUBLIC_COUCH_PROXY` so the session cookie stays first-party
- **Admin credentials (`COUCHDB_ADMIN_URL`) are server-only** — may only be used in `src/routes/api/**` and `$lib/server/couch-admin.ts`; never in client bundles; never behind a `PUBLIC_` env var
- **SPA mode — no server-side load functions** — all data fetching is client-side via TanStack Query
- **Svelte 5 runes only** — no legacy Svelte 4 syntax. See the table below.
- **Run `svelte-autofixer` before finalizing any `.svelte` file**
- **Type-check before finishing**: `pnpm check`

## Svelte 5 Quick Reference

| Avoid                             | Use                        |
| --------------------------------- | -------------------------- |
| `let x = 0` (implicit reactivity) | `$state`                   |
| `$:` reactive statements          | `$derived` / `$effect`     |
| `export let`                      | `$props`                   |
| `on:click`                        | `onclick`                  |
| `<slot>`                          | `{#snippet}` + `{@render}` |
| `<svelte:component this={X}>`     | `<X>`                      |
| `use:action`                      | `{@attach}`                |
| Svelte stores for shared state    | class with `$state` fields |

- Use `$state.raw` for large API response objects (avoids deep proxy overhead)
- Derive computed values with `$derived`; never compute inside `$effect`
- Always key `{#each}` blocks — never use array index as key
- Use `createContext` (not `setContext`/`getContext`) for type-safe context

## Adding a New Feature — Checklist

1. **Route**: create `src/routes/(protected)/your-feature/+page.svelte` for protected pages
2. **Feature module**: create `src/lib/features/your-feature/` with:
   - `domain/` — pure entities, Zod schemas, factories, invariants; no I/O, no Svelte, no PouchDB
   - `data/` — repository interface + concrete PouchDB implementation
   - `application/` — TanStack Query hooks (`createQuery`, `createMutation`) + live-sync wiring
   - `ui/` — feature-specific Svelte components
   - `index.ts` — public barrel; the **only** entry point other code may import
3. **Forms**: define Zod schema in `domain/`, use `superForm` with `zod4Client` adapter
4. **UI**: compose from `src/lib/components/ui/`; use `toast` from `svelte-sonner` for user feedback
5. **Validate**: run `svelte-autofixer` (Svelte MCP) on each `.svelte` file, then `pnpm check`

Mirror an existing feature as a reference (`notes` is simplest; `users` shows the full layered pattern).

## Out of Scope

- Adding server-side load functions or `+page.server.ts` files (this is a static SPA)
- Hardcoding CouchDB URLs or putting credentials behind `PUBLIC_` env vars
- Running concurrent replication to both central and edge
- Importing inner feature layers from outside a feature (`…/domain/*` etc. — ESLint enforces this)
- Regenerating OpenAPI types (no OpenAPI in this project)
