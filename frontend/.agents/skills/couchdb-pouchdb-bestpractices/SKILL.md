---
name: couchdb-pouchdb-bestpractices
description: Best practices and guidelines for using CouchDB and PouchDB in the Smart Shelter project. Load this skill whenever writing or editing data models, database interactions, or API endpoints.
---

# CouchDB & PouchDB Best Practices (Smart Shelter)

The Smart Shelter project uses an **Offline-First** architecture utilizing both CouchDB and PouchDB. All data operations must follow strict patterns to prevent conflicts and security leaks.

## Core Principles

1. **Write to Local First**: Always write data to the local PouchDB instance first. Do not query or write to CouchDB directly from the frontend UI.
2. **Repository Pattern**: All database operations must go through the Repository pattern (`frontend/src/lib/db/repository.ts` and feature-specific repositories like `people.pouch.ts`).
3. **Replication Topology**: `device (PouchDB) ⇄ WAN ⇄ central (CouchDB 3.5)`. The active remote is single-target (Central normally, or LAN Edge as a fallback).
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
