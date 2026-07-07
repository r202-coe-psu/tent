---
name: security-rbac-bestpractices
description: Best practices for implementing Role-Based Access Control (RBAC), Data Privacy, and Shelter Scope isolation. Load this when creating API endpoints, writing data mutations, or designing UI guards.
---

# Security, RBAC & Privacy Guidelines (Smart Shelter)

The Smart Shelter project operates in a multi-tenant environment (Shelters) and handles highly sensitive data (Medical, National IDs, PII). Strict security gates are mandatory.

## 1. Role-Based Access Control (RBAC)

The system uses CouchDB roles to enforce access. There are strictly 5 internal roles plus `system_admin` and the CouchDB admin `_admin`.
- **System Admin**: `["system_admin"]` (Global scope)
- **Shelter Staff**: `["shelter:{code}", "<capability>"]` (e.g. `["shelter:SH001", "shelter_manager"]`)

Capabilities (actual RoleKey strings in `_users.roles`): `shelter_manager`, `registration_staff`, `kitchen_staff`, `warehouse_staff`.

> ⚠️ **CR-002 Note**: You MUST use `registration_staff` as the RoleKey string. The word "volunteer" is now a **domain concept** and a user metadata value in `affiliation_tags`, NOT an RBAC RoleKey. Do not use `'volunteer'` as a role string.
Always use the canonical functions from `$lib/auth/roles.ts` to check permissions in both the UI and Server:
```typescript
import { isSystemAdmin, isShelterManager, shelterCodeFromRoles } from '$lib/auth/roles';

const roles = authStore.user?.roles ?? [];

// Extract the user's isolated scope
const scope = shelterCodeFromRoles(roles); // returns 'SH001' or null

if (isSystemAdmin(roles)) {
    // Has global access
} else if (isShelterManager(roles)) {
    // Has full access but ONLY within their `scope`
} else if (roles.includes('registration_staff')) {
    // Note: Do NOT hallucinate `isRegistrationStaff()`. 
    // `$lib/auth/roles.ts` only exports helpers for SA, Manager, and `isStaffOnly()`.
    // For specific capabilities, use `roles.includes('capability_name')`.
}
```

## 2. Shelter Scope Isolation (Multi-tenant) & Catalog

Data from `SH001` MUST NEVER leak to `SH002`.

- **Write Path (Shelter DB)**: When a user creates a record in `shelter_*`, you must inject the `shelterCode` from their authenticated context (via server-side verification), NOT from their user input payload.
- **Read Path (Shelter DB)**: When fetching data, always filter by the `shelterCode` in the query/view unless the user is a `system_admin`.
- **Catalog DB Access**: The `catalog` DB contains central master data (e.g., `sop_profile`). It is strictly **Read-Only** for shelters. ONLY a `system_admin` is allowed to mutate data in the `catalog` DB.
- **Master vs Override Pattern**: For configurable settings, `system_admin` maintains the master document in `catalog`, while `shelter_manager` creates an override document (e.g., `sop_override`) inside their own `shelter_*` DB.

**Example: Server-side Extraction (`+server.ts`)**
```typescript
import { authorizeUserWrite } from '$lib/server/couch-admin';

export async function POST({ request }) {
    // 1. Authorize the caller via their session cookie
    const caller = await authorizeUserWrite(request.headers.get('cookie'));
    
    // 2. Extract their assigned shelter code (DO NOT trust request body)
    const shelterCode = caller.shelterCode;
    
    // 3. Inject this shelterCode into your CouchDB endpoint mutations
}
```

## 3. Data Privacy & Redaction (PII/Medical)

The system holds highly sensitive data (National IDs, Medical conditions, Vulnerability notes).

- **EOC & Public APIs**: Never expose full `medical`, `vulnerability`, or `national_id` fields to Public APIs or the EOC (Emergency Operation Center) sync endpoints. Redact these fields server-side before returning JSON.
  - **Exception (CR-005 - Public Metrics)**: Aggregate counts such as `vulnerable_count` and `occupancy_total` are allowed on the Public Dashboard (strictly aggregate only, no drill-down to individuals).
  - **Exception (CR-005 - Family Search)**: The Family Search API (`/search`) may return partially masked PII to help relatives (e.g., `national_id` masked as 3-front/3-back, full first name with masked last name, masked origin address). Full PII and medical details must still be strictly omitted.
- **Internal Staff**: Internal staff can see medical/PII data, but ONLY for evacuees within their own shelter scope.
- **Donors**: The "Donor" is NOT an RBAC role; it is a public no-auth surface. Never leak evacuee PII to the donation pages.

## 4. UI Route Guards

Use the pre-built guards from `$lib/guards/auth.ts` in `+layout.ts` or `+page.ts` files. **Do NOT build your own ad-hoc redirect logic.**

```typescript
// src/routes/(protected)/+layout.ts — requires any authenticated user
import { requireAuth } from '$lib/guards/auth';
export const load = async () => {
    await requireAuth(); // redirects to /login if not authenticated
    return {};
};

// src/routes/admin/+layout.ts — requires system_admin
import { requireAdmin } from '$lib/guards/auth';
export const load = async () => {
    await requireAdmin(); // redirects to / if not system_admin
    return {};
};

// src/routes/shelter/users/+layout.ts — requires system_admin OR shelter_manager
import { requireManager } from '$lib/guards/auth';
export const load = async () => {
    await requireManager();
    return {};
};
```

> **Note**: These route guards are UX-only (client-side). The **real authorization gate is always the server-side BFF** (`+server.ts` using `couch-admin.ts`). Never rely solely on a frontend redirect to enforce security.
