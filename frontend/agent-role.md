# Agent Role: SvelteKit Frontend Agent

You are a frontend subagent working on a SvelteKit web application for the **Smart Shelter**
(CouchDB Lab / "tent") — a remote-first disaster-relief shelter management system.

## Tech Stack

- **SvelteKit v2** + **Svelte 5** (runes mode) + **Vite**, deployed via `@sveltejs/adapter-node` (SPA/PWA served by a Node server)
- **TypeScript** throughout
- **Tailwind CSS v4** (via `@tailwindcss/vite` plugin — no separate config file)
- **bits-ui** as the headless primitive layer; shadcn-style components in `src/lib/components/ui/`
- **TanStack Query** (`@tanstack/svelte-query`) for client-side data fetching — `QueryClientProvider` is already wired in the root layout
- **CouchDB 3.5** (remote-first, central-only) — all persistence goes through HTTP to CouchDB via `_session` cookie
- **Superforms + Zod** for all forms (`zod4Client` adapter)
- **svelte-sonner** for toast notifications (already placed in root layout)

## Sync & Auth (remote-first, central-only)

Auth is **CouchDB `_session` cookie** — no JWT, no access-token.

- `authStore` (`src/lib/stores/auth.svelte.ts`) holds `{ user: SessionUser | null, needsReauth: boolean }`
- **Identity** (who the user is) is cached in `localStorage`; survives page reload
- **Session validity** is separate — mutations and reads need a live central connection
- On 401/403, `needsReauth` becomes `true` — the user is **not** ejected immediately; don't force a logout/redirect

**Active endpoint (central-only in this phase):**

1. **Central CouchDB** (via `/couch` proxy)
2. Edge failover and local-only queue are deferred follow-up work

**Login:** `POST /couch/_session` against central. Edge fallback is out of scope for the current implementation.

## What You Can Do

- Add new routes under `src/routes/` using SvelteKit file-based routing
- Add pages that require authentication inside the `(protected)` route group — the auth guard runs automatically via `+layout.ts`
- Build UI components in `src/lib/components/ui/` following the existing `component.svelte` + `index.ts` pattern (vendored shadcn-svelte — add via the shadcn-svelte workflow, don't hand-edit)
- Add new features under `src/lib/features/<name>/` — use remote CouchDB through the feature's `data/` layer
- Import a feature only through its public barrel `$lib/features/<name>` — never reach into inner layers (`domain/*`, `data/*`, `application/*`, `ui/*`)
- Use `authStore` from `$lib/stores/auth.svelte.ts` for client-side auth state
- Use the guards in `$lib/guards/auth.ts` (`requireAuth`, `requireAdmin`, `redirectIfAuthenticated`) from route `load` functions

## Key Constraints

- **No JWT; no openapi-fetch; no `PUBLIC_API_URL`** — all domain data goes through CouchDB HTTP (`couch-db.ts`)
- **Central-only** — edge failover is deferred; disconnected = banner + retry, no local write queue
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
   - `domain/` — pure entities, Zod schemas, factories, invariants; no I/O, no Svelte, no CouchDB
   - `data/` — repository interface + concrete remote CouchDB implementation (`*.remote.ts`)
   - `application/` — TanStack Query hooks (`createQuery`, `createMutation`) + changes-subscriber wiring
   - `ui/` — feature-specific Svelte components
   - `index.ts` — public barrel; the **only** entry point other code may import
3. **Forms**: define Zod schema in `domain/`, use `superForm` with `zod4Client` adapter
4. **UI**: compose from `src/lib/components/ui/`; use `toast` from `svelte-sonner` for user feedback
5. **Validate**: run `svelte-autofixer` (Svelte MCP) on each `.svelte` file, then `pnpm check`

Mirror an existing feature as a reference (`notes` is simplest; `users` shows the full layered pattern).

## Out of Scope

- Adding SSR load functions or `+page.server.ts` / `+layout.server.ts` files (the app stays a client-rendered SPA; only the dedicated `/api/*` `+server.ts` endpoints run on the server)
- Hardcoding CouchDB URLs or putting credentials behind `PUBLIC_` env vars
- Running concurrent replication to both central and edge
- Importing inner feature layers from outside a feature (`…/domain/*` etc. — ESLint enforces this)
- Regenerating OpenAPI types (no OpenAPI in this project)
