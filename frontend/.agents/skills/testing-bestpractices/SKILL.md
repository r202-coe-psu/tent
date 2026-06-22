---
name: testing-bestpractices
description: Guidelines and best practices for writing tests in the Smart Shelter project. Load this skill when asked to write or review tests, including Unit, Integration, and End-to-End (E2E) tests.
---

# Testing Best Practices (Smart Shelter)

The Smart Shelter project enforces rigorous testing to ensure data integrity, privacy, and reliability in emergency situations. We use **Vitest** for Unit/Integration tests and **Playwright** for E2E tests.

## 1. Unit & Integration Testing (Vitest)

All domain logic, Zod schemas, and utility functions must have unit tests.

### Framework & Environment
- **Runner**: Vitest (`import { describe, it, expect } from 'vitest'`)
- **Browser Environment**: If the code interacts with the DOM or Browser APIs (like PouchDB), add `// @vitest-environment happy-dom` at the very top of the test file.

### Mocking the Database (PouchDB)
Never test against a real CouchDB instance in unit tests. Use the `memory` adapter for isolated, fast database tests.

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import pouchAdapterMemory from 'pouchdb-adapter-memory';

// Note: Ensure the plugin is registered before creating memory instances
PouchDB.plugin(pouchAdapterMemory);

describe('Repository Tests', () => {
    let db: PouchDB.Database;

    beforeEach(() => {
        // Use a unique random name for true isolation between tests
        db = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
    });

    afterEach(async () => {
        await db.destroy(); // Clean up memory DB after each test to prevent memory leaks
    });

    // your tests go here
});
```

### Mocking Author Context
Many data mutation functions require an `AuthorContext`. Provide a mock context in your tests.
```typescript
const mockCtx = { shelterCode: 'SH001', createdBy: 'tester' };
const result = createStockLedger({ item_id: 'item:rice', qty: 10, unit: 'kg', reason: 'receive' }, mockCtx);
```

## 2. End-to-End Testing (Playwright)

End-to-End tests are located in the `e2e/` directory and test the actual user flows in a real browser.

- **Runner**: Playwright (`import { test, expect } from '@playwright/test'`)
- **Scope**: Focus on critical flows (e.g., Login, Evacuee Registration, Donation Path).
- **Setup**: Avoid mocking where possible to test the real integration, but ensure tests do not leak data across runs.

## 3. Project-Specific Test Requirements (Definition of Done)

Based on the project specifications, tests must cover these critical areas:
1. **Security & Privacy (No-PII)**: Write tests to ensure PII (Personal Identifiable Information), medical data, or national IDs do not leak through EOC or Public APIs. Test parameter manipulation to verify RBAC boundaries.
2. **Anti-Enumeration & Rate Limiting**: Write tests to confirm that rate limits (429) work and endpoints cannot be scraped (e.g., searching requires >3 chars).
3. **Concurrency**: Write tests that simulate concurrent writes (especially to CouchDB/PouchDB) to ensure `409 Conflict` is handled properly via `_rev` read-modify-write loops.
4. **Data Validation**: Ensure Zod schemas are tested for both valid inputs and invalid/malicious inputs.

## 4. Writing Good Tests

- **Arrange, Act, Assert**: Keep your tests structured and readable.
- **Descriptive Names**: Use clear `it` descriptions (e.g., `it('should return 403 when user outside shelter scope requests data')`).
- **Cleanup**: Ensure `afterEach` or `afterAll` cleans up any test pollution if you are not using auto-cleanup utilities.
