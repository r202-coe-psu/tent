---
name: couchdb-pouchdb-bestpractices
description: Best practices and guidelines for using CouchDB and PouchDB in the Smart Shelter project. Load this skill whenever writing or editing data models, database interactions, or API endpoints.
---

# CouchDB & PouchDB Best Practices (Smart Shelter)

The Smart Shelter project uses an **Offline-First** architecture utilizing both CouchDB and PouchDB. All data operations must follow strict patterns to prevent conflicts and security leaks.

## Core Principles

1. **Write to Local First**: Always write data to the local PouchDB instance first. Do not query or write to CouchDB directly from the frontend UI.
2. **Repository Pattern**: All database operations must go through the Repository pattern (`frontend/src/lib/db/repository.ts` and feature-specific repositories like `people.pouch.ts`).
3. **Replication Topology (Multi-DB)**: The system replicates from two primary sources:
   - `shelter_{code}`: Read/Write database for daily shelter operations.
   - `catalog`: Read-Only database for central master data (e.g., `sop_profile`).
   Note: PouchDB cannot perform joins across databases. Any cross-database aggregation (Master vs Override) must be handled in the application/domain layer.
4. **Live Query**: Use the changes feed (`frontend/src/lib/db/live-query.ts`) to convert PouchDB changes into Svelte/TanStack Query reactivity.
5. **MVCC and `_rev`**: CouchDB uses Multi-Version Concurrency Control. Always fetch the latest `_rev` before updating or deleting an existing document to avoid `409 Conflict`.
6. **Admin Operations**: Database creation, `_security` updates, and user management must be done via the server-side admin client (`$lib/server/couch-admin.ts`) to keep credentials secure.

## Code Patterns

### 1. Repository Pattern (No direct PouchDB in UI)

Do not instantiate or call PouchDB directly in your Svelte components. Always use the feature's repository.

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
import PouchDB from 'pouchdb-browser';

async function save() {
    const db = new PouchDB('shelter_sh001');
    await db.put(data); // Breaks abstraction layer!
}
```

### 2. Admin Operations & Security

Privileged operations (creating databases, users, or modifying `_security`) must NEVER happen on the client side. Use the server-side admin client in `+server.ts` files.

```typescript
// do this (inside src/routes/api/.../+server.ts)
import { adminRaw } from '$lib/server/couch-admin';

export async function POST() {
    const { status, data } = await adminRaw('/shelter_sh002', 'PUT');
    // ...
}
```

```typescript
// don't do this (leaking credentials or making direct HTTP calls to CouchDB from UI)
export async function POST() {
    // SECURITY RISK: Hardcoded credentials
    await fetch('http://admin:password@localhost:5984/shelter_sh002', { method: 'PUT' });
}
```

### 3. Handling MVCC and `_rev`

CouchDB uses Multi-Version Concurrency Control. When updating or deleting an existing document, you must always provide the latest `_rev` or it will result in a `409 Conflict`.

```typescript
// do this (Read-Modify-Write)
const { data: existing } = await adminRaw(`/db/${docId}`, 'GET');

await adminRaw(`/db/${docId}`, 'PUT', {
    ...newContent,
    _id: docId,
    ...(existing?._rev ? { _rev: existing._rev } : {})
});
```

```typescript
// don't do this (Blind overwrite)
await adminRaw(`/db/${docId}`, 'PUT', newContent); // Fails with 409 Conflict if doc exists
```

### 4. Granting Access (Read-Modify-Write on `_security`)

When adding a user to a database, you must fetch the existing `_security` object, modify it, and push it back. Never blind-overwrite `_security`.

```typescript
// do this
const security = await adminFetch('/db/_security');
security.members ??= { names: [], roles: [] };
security.members.names ??= [];

if (!security.members.names.includes(username)) {
    security.members.names.push(username);
}

await adminFetch('/db/_security', {
    method: 'PUT',
    body: JSON.stringify(security)
});
```

```typescript
// don't do this (Wipes out all other members and roles)
await adminFetch('/db/_security', {
    method: 'PUT',
    body: JSON.stringify({ members: { names: [username] } })
});
```

### 5. Live Query Pattern (Reactivity)

Do not use polling (`setInterval` or `refetchInterval`) to fetch live data from PouchDB. Instead, use the changes feed via `startLiveQuery` to invalidate TanStack Query keys when data changes. This ensures that remote syncs, local writes, and cross-tab writes all reactively update the UI.

```typescript
// do this (inside your feature's queries.ts or store)
import { startLiveQuery } from '$lib/db/live-query';

export function startFeatureLiveQuery(queryClient: QueryClient) {
    return startLiveQuery(db, queryClient, (type) => {
        if (type === 'my_feature_doc') {
            return [['my_feature_query_key']]; // Invalidates this query key
        }
        return [];
    });
}
```

```typescript
// don't do this (Polling or manual fetch in Svelte $effect)
$effect(() => {
    const interval = setInterval(() => {
        db.find(...).then(data => myState = data);
    }, 5000);
    return () => clearInterval(interval);
});
```

## 6. CouchDB View Naming Conventions

All views live in a **single design document per database**: `_design/app`. Never create additional design docs (e.g. `_design/analytics`, `_design/reports`) — deploy all views together at provisioning time.

### View name pattern: `{subject}[_{qualifier}]`

`snake_case` only. The subject is the entity or metric being aggregated (noun). The qualifier narrows the meaning.

| Qualifier type | Pattern | Examples |
|---|---|---|
| None (bare aggregate) | `{subject}` | `occupancy` |
| State/filter | `{subject}_{state}` | `needs_open` |
| Computed metric / running total | `{subject}_{metric}` | `stock_balance`, `meals_served`, `slot_availability` |
| Most-recent per entity | `latest_{subject}` | `latest_screening` |
| Grouped by dimension | `{subject}_by_{dimension}` | `registrations_by_date`, `demographics_by_age`, `demographics_by_nationality` |

**Rules:**
1. Subject is always a noun — never a verb or action word.
2. Use `latest_` prefix only for views that return the most recent document per entity key (combine with `reduce=false` and `descending=true` or use `_count` reduce on a composite key).
3. Use `_by_{dimension}` when the view's primary purpose is breakdown/grouping (query with `?group=true`).
4. A view that fits multiple patterns — pick the most descriptive qualifier, not the shortest.
5. Never abbreviate: `registrations` not `regs`, `demographics` not `demo`.

### Map key conventions

| Purpose | Key shape | Notes |
|---|---|---|
| Single aggregate | `emit(null, value)` | Single reduced result, no grouping |
| Group by state/field | `emit(doc.field, value)` | Query with `?group=true` |
| Time-series | `emit([doc.date, doc.sub_key], value)` | Coarsest dimension first; use `startkey`/`endkey` for range |
| Latest-per-entity | `emit([doc.entity_id, doc.occurred_at], null)` | Descending + limit=1 per entity |
| Composite breakdown | `emit([doc.primary, doc.secondary], value)` | `?group_level=1` for top-level only |

Value conventions: `1` for count, `doc.quantity` (or numeric field) for sum, `null` for map-only views.

### Query parameter conventions

| Scenario | Parameters |
|---|---|
| Single aggregate value | `?reduce=true` (default) |
| Per-key breakdown | `?group=true` |
| Top-level group only | `?group_level=1` |
| Date range | `?startkey=["2026-01-01"]&endkey=["2026-12-31￰"]` |
| Raw map rows (no reduce) | `?reduce=false` |

The `￰` high-value sentinel at the end of string ranges ensures all sub-keys under a date prefix are included.

### Calling views from `+server.ts`

```typescript
// do this — always via adminRaw in +server.ts, never from the client
import { adminRaw } from '$lib/server/couch-admin';

const db = `shelter_${params.code}`;

// Single aggregate
const { data: occ } = await adminRaw(`/${db}/_design/app/_view/occupancy`, 'GET');
// data.rows[0].value = { total, present, checked_out }

// Per-key breakdown
const { data: demo } = await adminRaw(
  `/${db}/_design/app/_view/demographics_by_age?group=true`, 'GET'
);
// data.rows = [{ key: "0-4", value: 12 }, { key: "5-11", value: 8 }, ...]

// Date range
const start = '2026-06-01';
const end = '2026-06-30￰';
const { data: reg } = await adminRaw(
  `/${db}/_design/app/_view/registrations_by_date?group=true&startkey="${start}"&endkey="${end}"`,
  'GET'
);
```

```typescript
// don't do this — never query views from the browser/client
const res = await fetch(`/couch/shelter_sh001/_design/app/_view/occupancy`);
// Bypasses server auth guard and leaks DB structure to the client
```

## Reference Documentation

- **Database Setup & Lab**: `docs/create-database.html` - Guide on DB creation, security, validation, user creation, and status codes.
- **Database Schema**: `docs/data/schema.md` - Comprehensive documentation of CouchDB document types, fields, and indices.
- **Data Model**: `docs/data/data-model.md` - Business rules and domain modeling.
- **Sync/Replication**: `frontend/src/lib/db/pouch.ts` - Code handling PouchDB connections and replication logic.

## Workflow

1. **When adding a new feature**: Define the schema in `docs/data/schema.md` first.
2. **When creating a repository**: Build it on top of the base `createRepository` from `frontend/src/lib/db/repository.ts`.
3. **When modifying documents**: Ensure your code fetches the document first to get the correct `_rev`, or handle conflicts if offline updates merge.
4. **When writing API endpoints**: Use `adminRaw` or `adminFetch` from `couch-admin.ts` if administrative privileges are required (e.g., creating users, granting access). Do not expose admin credentials to the frontend.
