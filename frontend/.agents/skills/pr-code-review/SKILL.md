---
name: pr-code-review
description: Comprehensive code review checklist and guidelines for evaluating Pull Requests. Use this skill when asked to review code, analyze a PR, or check code quality before merging.
---

# PR Code Review Guidelines (Smart Shelter)

When reviewing code for a Pull Request in this project, evaluate the changes against the following core principles and project-specific standards. Your goal is to ensure high quality, security, and architectural consistency.

## 1. Architecture & Data Flow (Offline-First)

- **Repository Pattern**: Are database operations routed through the proper repository layer (`$lib/db/repository.ts`) rather than directly querying PouchDB/CouchDB from components?
- **Data Mutation**: Does the code write to local PouchDB first?
- **Concurrency & `_rev`**: Do update/delete operations properly fetch and provide the latest `_rev` to avoid `409 Conflict` errors?
- **Live Queries**: Does the UI use the standard PouchDB changes feed (`$lib/db/live-query.ts`) to reactively update data?
- **Schema Documentation**: If the PR modifies or adds data structures in the database, was `docs/data/schema.md` updated accordingly?

## 2. Security & Access Control

- **Admin Boundaries**: Are privileged CouchDB operations (creating DBs, changing `_security`, creating users) strictly kept on the server side using `$lib/server/couch-admin.ts`? Are any admin credentials leaking to the frontend?
- **RBAC / Auth**: Are routes and data operations properly protected by role-based access control?
- **Data Privacy**: Are sensitive fields (PII, medical data, national ID) properly handled and excluded from public or EOC/Open API endpoints?

## 3. Frontend & Framework Standards

- **Svelte 5 (Runes)**: Does the component use modern Svelte 5 syntax (`$state`, `$derived`, `$effect`) correctly? Are there unnecessary reactive statements?
- **Styling**: Are Tailwind CSS v4 utility classes used appropriately? Are custom CSS classes avoided when standard utilities exist? (If using `shadcn-svelte`, are the components used correctly?)
- **Performance**: Are there any unnecessary re-renders or heavy computations inside `$effect` or rendering loops?
- **Accessibility (a11y)**: Does the UI support keyboard navigation? Are semantic HTML and proper ARIA attributes used (e.g. for screen readers)?

## 4. Code Quality & General Principles

- **TypeScript Strictness**: Are there missing types, excessive use of `any`, or ignored TypeScript warnings?
- **DRY & YAGNI**: Is the code duplicating existing utility functions? Is it over-engineering features (You Aren't Gonna Need It)?
- **Error Handling**: Are errors caught and handled gracefully? Is the user informed of failures appropriately?
- **Clean Code**: Are functions small, focused, and well-named? Are magic numbers or hardcoded strings extracted into constants?
- **Test Coverage**: Does the new feature or bug fix include Unit/Integration tests? Do all tests pass?
- **Leftover Code**: Has the code been cleaned of leftover `console.log`, `debugger` statements, and commented-out code before opening the PR?

## Review Process Workflow

1. **Analyze the Diff**: Read the provided code diff or files carefully.
2. **Load Related Skills**: Depending on the PR contents, you MUST read and apply the following agent skills before concluding the review:
   - **General Architecture**:
     - `project-structure-architecture` (for correct placement of files in `$lib/features`, `domain`, `data`, `ui`)
   - **Frontend Changes (Svelte/Tailwind)**:
     - `svelte-core-bestpractices` (for reactivity and modern Svelte 5 logic)
     - `shadcn-svelte` (for UI component standards)
     - `svelte-code-writer` (to optionally run Svelte CLI autofixer or look up docs)
   - **Database / Data Model Changes**:
     - `couchdb-pouchdb-bestpractices` (for offline-first architecture, repository pattern, and MVCC rules)
   - **Security / Authentication**:
     - `security-rbac-bestpractices` (for Role checks, Shelter Scope isolation, and PII Redaction)
   - **Testing / QA**:
     - `testing-bestpractices` (for Vitest/Playwright standards, mock data, and project DoD checks)
3. **Check the Checklist**: Evaluate the code against the 4 sections above, cross-referencing with the relevant skills loaded in step 2.
4. **Provide Actionable Feedback**: Group your feedback by severity (e.g., 🔴 Critical/Blocker, 🟡 Suggestion, 🟢 Nitpick).
5. **Approve or Request Changes**: Clearly state whether the code is ready to merge or if revisions are required based on your findings.
