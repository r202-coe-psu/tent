# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

This repo (`tent`, app title **"CouchDB Lab"**) started from the **sveltekitten** SPA
template and now has a live `frontend/src/` and `frontend/package.json`: the Smart Shelter
domain (auth, register, shelter, admin) is scaffolded, with `/api/*` server endpoints under
`src/routes/api/`. When implementing features, follow the conventions documented below and
treat `frontend/agent-role.md` and `frontend/AGENTS.md` as the binding spec for that work.

The intended backend is **CouchDB 3.5** (see `docker-compose.yml`), reached directly
from the browser with cookie-based session auth via a same-origin dev proxy
(`PUBLIC_COUCH_PROXY=/couch`). Note a discrepancy to resolve as code lands: the template
docs (`agent-role.md`) and the e2e `mock-api.js` describe a generic JWT + `openapi-fetch`
backend (`/v1/auth/login`), while `.env`/`docker-compose.yml` target CouchDB directly.
The CouchDB direction reflects this project; the JWT bits are leftover template boilerplate.

## Commands

Run all frontend commands from `frontend/`. Package manager is **pnpm** (enforced via
corepack in the Dockerfile).

- `pnpm dev` — Vite dev server (port 5173). Docker: `pnpm dev --host 0.0.0.0`
- `pnpm check` — `svelte-check` type-check. **Run before finishing any task.**
- `pnpm openapi` — regenerate `src/lib/api/openapi.d.ts`. Only run if a task explicitly requires it.
- `npx @sveltejs/mcp svelte-autofixer ./src/path/to/Component.svelte` — **must** run (and
  re-run until clean) on every `.svelte` file before delivering it.
- e2e (Playwright): tests live in `frontend/e2e/`; `e2e/mock-api.js` is a standalone mock
  backend used during the run. Tests hit the built preview (`localhost:4173`).

Bring up the CouchDB backend from repo root: `docker compose up` (needs a `.env` with
`COUCHDB_USER`/`COUCHDB_PASSWORD`; copy from `.env.example`). Data persists to
`../deployment/couchdb/data`.

## Architecture

**SPA/PWA on Node** — `@sveltejs/adapter-node` with `ssr = false` (app pages stay
client-rendered). The app is still a SPA/PWA, but it is now served by a Node server, which
also runs the `/api/*` **server endpoints** (`+server.ts` under `src/routes/api/` — admin
and register) in production. Those endpoints hold the admin secret and are marked
`prerender = false`. There are still **no `+page.server.ts` / `+layout.server.ts` SSR load
functions** — all page data fetching is client-side via **TanStack Query**
(`@tanstack/svelte-query`), wired through `QueryClientProvider` in the root layout.

**Stack**: SvelteKit 2 + Svelte 5 (runes only) + Vite + TypeScript + Tailwind CSS v4 (no
config file — `@tailwindcss/vite`). UI is shadcn-svelte over `bits-ui` primitives in
`src/lib/components/ui/`. Forms use Superforms + Zod (`zod4Client` adapter). User feedback
is **toast only** (`svelte-sonner`) — never `console.log`.

**Auth (client-side)**: access token held in memory in `authStore`
(`src/lib/stores/auth.svelte.ts`); refresh token in an httpOnly cookie. Protected pages
live in the `src/routes/(protected)/` route group, where a `+layout.ts` guard calls
`requireAuth()` automatically. Do not modify the token-refresh logic in
`$lib/api/auth-interceptor.ts` or the cookie names/TTLs in `$lib/utils/auth.ts` unless the
task is specifically about them.

### Feature-sliced layering (enforced by ESLint)

Features live under `src/lib/features/<name>/` and are split into layers:
`domain/`, `data/`, `application/`, `ui/`. **Cross-feature and route code may import a
feature only through its barrel** (`$lib/features/<name>`) — reaching into a feature's
internal layers is an ESLint error (`no-restricted-imports`). A feature may freely import
its own internals. (`agent-role.md` also describes an older flat layout —
`api.ts`/`queries.ts`/`schema.ts`/`components/`; the ESLint-enforced layered structure
above is authoritative.)

`src/lib/components/ui/**` is vendored/generated shadcn-svelte and is excluded from lint —
do not hand-maintain it.

## Svelte 5 Conventions

Runes mode only — no Svelte 4 syntax. `$state`/`$derived`/`$props`/`onclick`, snippets +
`{@render}` instead of slots, `<X>` instead of `<svelte:component>`, `{@attach}` instead
of `use:`. Use a class with `$state` fields for shared state, not Svelte stores. Prefer
`$state.raw` for large API objects; derive with `$derived` (never compute in `$effect`);
always key `{#each}` blocks (never by index); use `createContext` for type-safe context.

The Svelte MCP server (`mcp.svelte.dev`) is configured — use `list-sections` then
`get-documentation` for SvelteKit/Svelte topics before answering, and `svelte-autofixer`
to validate components.

## Formatting

Prettier: tabs, single quotes, no trailing comma, printWidth 100, with the svelte and
tailwindcss plugins.
