# `demo/` — quarantined template-demo code (NOT shipped)

This directory holds the original **sveltekitten template demo** code that used to live under
`frontend/src/`. It was moved out of the app tree on purpose.

## What's here

- **`lib/features/demo/`** — RBAC demonstration (`demo_alpha` / `demo_beta` / `demo_shared`
  databases, `team:alpha` / `team:beta` roles, users `alice` / `bob` / `charlie`).
- **`lib/features/shelter/`** — the "Shelter demo" (shelters A/B/C; `occupant` / `inventory_item` /
  `stock_txn` docs; `manager` / `volunteer` seed users + `validate_doc_update`).
- **`routes/`** — the matching protected pages and dev-server admin API routes
  (`/demo`, `/admin/demo`, `/admin/shelter`, `api/admin/demo`, `api/admin/shelter`).

## Why it's quarantined here

The demo authz (roles, `_security`, `validate_doc_update`, seed users) is **demonstration only** —
it is **not** the real Smart Shelter system. The production data model is schema v3 (see
`docs/data/`), being built under the `people` / `operations` / `health` features.

Living outside `frontend/src/`, this code is:

- **not compiled / bundled** — Vite only bundles what's reachable from `frontend/src/routes`;
- **not routed** — no demo pages exist in the app;
- **not type-checked / linted** — `svelte-check` and ESLint run inside `frontend/` over `src/**`;
- **absent from the prod build** entirely.

It is kept only as a **reference** for the real v3 shelter-registry work that replaces it. The
`$lib/…` / `./$types` imports inside these files no longer resolve — that's expected; this code is
not meant to run as-is.
