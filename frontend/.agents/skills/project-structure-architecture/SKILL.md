---
name: project-structure-architecture
description: Guidelines for the Smart Shelter project's directory structure and architectural patterns (Domain-Driven Design). Load this when creating new files, features, or deciding where to place logic.
---

# Project Structure & Architecture (Smart Shelter)

The Smart Shelter project follows a Feature-Sliced, Domain-Driven Design (DDD) architecture within SvelteKit. Always place files in their correct domains to prevent spaghetti code.

## 1. Feature Modules (`$lib/features/`)
Business logic is grouped by feature (e.g., `people`, `operations`, `shelters`). **Never** put domain logic directly into UI routes.

Inside each feature (`$lib/features/<name>/`), use this structure:
- **`domain/`**: Pure TypeScript. Zod schemas (`schema.ts`), types, business rules, and unit tests (`*.test.ts`). No Svelte, no DOM, no DB calls.
- **`data/`**: Database interactions. Repositories (`*.remote.ts`), API clients (`*.api.ts`), or Queries/Mutations.
- **`application/`**: Use cases, Svelte stores (`*.svelte.ts`), or orchestration logic that glues domain and data together.
- **`ui/`**: Svelte components specific to this feature (`UserList.svelte`, `CreateUserForm.svelte`).
- **`index.ts`**: The public API (Barrel file) for the feature. Export only what other features or routes are allowed to use.

## 2. Shared Libraries (`$lib/`)
Cross-feature code belongs in the root of `$lib`:
- **`components/`**: Generic, reusable UI components (e.g., `shadcn-svelte` buttons, inputs, modals). These should have NO business logic.
- **`db/`**: CouchDB HTTP client (`couch-db.ts`), changes subscriber, event channel, and the base `Repository` class.
- **`auth/` & `guards/`**: The Role kernel (`roles.ts`) and SvelteKit route guards.
- **`utils/`**: Generic helpers (e.g., date formatting, ulid generation).
- **`server/`**: **DANGER ZONE**. Code that must ONLY run on the Node.js server (e.g., `couch-admin.ts`, secret keys). Never import `$lib/server/` into frontend components.

## 3. Routes (`src/routes/`)
Routes should be as thin as possible. They act as wiring:
- **`+page.svelte`**: Import UI components from `$lib/features/...` and render them. Do not write heavy logic here.
- **`+page.ts` / `+layout.ts`**: Perform auth guards and initial data fetching.
- **`api/.../+server.ts`**: Backend BFF endpoints. Import logic from `$lib/server/` and validate using `$lib/features/<name>/domain/schema.ts`.

## 4. Rule of Dependency
- **UI** depends on **Application/Data**.
- **Application/Data** depends on **Domain**.
- **Domain** depends on **NOTHING** (no external libraries like CouchDB clients or Svelte).
- **Features** should rarely depend on other features. If they do, only import via the other feature's `index.ts`.

## 5. Documentation (`docs/`)
The `docs/` folder is not just for reading; it drives the architecture.
- **`docs/data/schema.md`**: This is the **Absolute Single Source of Truth** for the database schema. If you are modifying a data model in `$lib/features/.../domain/schema.ts`, you MUST update `docs/data/schema.md` first.
- **`docs/task-breakdown/`**: Contains the Definition of Done (DoD) for all features.
