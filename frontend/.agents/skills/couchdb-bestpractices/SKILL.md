---
name: couchdb-bestpractices
description: Best practices for CouchDB usage in the Smart Shelter project under the remote-first architecture. Load this skill whenever editing data models, database interactions, endpoint-state handling, or API endpoints.
---

# CouchDB Best Practices (Smart Shelter)

The Smart Shelter project now uses a **remote-first** architecture with CouchDB as the canonical operational store.
All data operations must follow strict patterns to prevent conflicts, scope leaks, and session mistakes.

## Core Principles

1. **Remote-first write path**: App writes to the **active endpoint** directly (central first, edge fallback). Do not introduce local-only write queues.
2. **Single active endpoint**: Exactly one endpoint at a time (`central` OR `edge`). Never write to both concurrently.
3. **Repository pattern**: UI code must go through feature repositories/services, not raw database calls.
4. **MVCC and `_rev` discipline**: Read-modify-write for updates/deletes; handle `409 Conflict` explicitly.
5. **Session boundary**: Central and edge `_session` cookies are distinct. Edge session cannot call central `/api/v1/*`.
6. **Admin operations are server-only**: DB creation, `_security`, design docs, and user management go through `$lib/server/couch-admin.ts`.
7. **No polling by default**: Canonical live updates must use the app-level event channel for TanStack Query invalidation; avoid blind `refetchInterval` loops.

## Code Patterns

### 1) Repository-first in UI

Do not instantiate DB clients or call CouchDB endpoints directly from Svelte components.

```typescript
// do this
import { getPeopleRepo } from '$lib/features/people';

async function save() {
	const repo = getPeopleRepo();
	await repo.savePerson(data);
}
```

```typescript
// don't do this
async function save() {
	await fetch('/couch/shelter_sh001/person:123', {
		method: 'PUT',
		body: JSON.stringify(data)
	}); // bypasses repository + endpoint-state policy
}
```

### 2) Endpoint-state aware writes

Write operations must respect active endpoint state and the locked fail/retry UX policy (automatic 3 attempts; then clear cannot-connect banner; user can force retry).

```typescript
// do this
const endpoint = endpointState.getActive(); // central or edge
await repo.savePerson(data, { endpoint });
```

```typescript
// don't do this
await Promise.all([
	repo.savePerson(data, { endpoint: 'central' }),
	repo.savePerson(data, { endpoint: 'edge' })
]); // split-brain risk
```

### 3) Admin and privileged operations

Privileged calls stay in `+server.ts` and use admin client helpers.

```typescript
import { adminRaw } from '$lib/server/couch-admin';

export async function POST() {
	const { status, data } = await adminRaw('/shelter_sh002', 'PUT');
	return Response.json({ status, data });
}
```

### 4) MVCC `_rev` handling

```typescript
const { data: existing } = await adminRaw(`/db/${docId}`, 'GET');

await adminRaw(`/db/${docId}`, 'PUT', {
	...newContent,
	_id: docId,
	...(existing?._rev ? { _rev: existing._rev } : {})
});
```

Blind overwrite without `_rev` causes `409 Conflict`.

### 5) `_security` update safety

Always read-modify-write `_security`; never replace with partial payload.

## View Naming and Query Conventions

All views live in one design doc per DB: `_design/app`.

- View pattern: `{subject}[_{qualifier}]` in `snake_case`
- Examples: `occupancy`, `needs_open`, `stock_balance`, `latest_screening`, `registrations_by_date`
- Call views from server (`+server.ts`) via `adminRaw`, not from browser

## Reference Documentation

- `docs/data/schema.md` — document types, fields, and indexes
- `docs/data/data-model.md` — topology, conflict policy, retention
- `docs/data/api-contract.md` — endpoint/session contract and service boundary
- `frontend/src/lib/server/couch-admin.ts` — privileged CouchDB operations

## Workflow

1. Update `docs/data/schema.md` first when data shape/rules change.
2. Implement via repository interfaces in feature layers.
3. For updates/deletes, fetch latest `_rev` or handle conflict path explicitly.
4. Keep central-first + edge fallback behavior consistent with `data-model.md` and `api-contract.md`.
