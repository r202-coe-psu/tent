---
name: pr-code-review
description: Comprehensive code review checklist and guidelines for evaluating Pull Requests. Use this skill when asked to review code, analyze a PR, or check code quality before merging.
---

# PR Code Review Guidelines (Smart Shelter)

## Trigger Commands

**Default — analyze only (never auto-post):**
- `/pr-code-review <PR_LINK_OR_NUMBER>`
- `@[pr-code-review] review <PR>`
- Any request to review a PR or local changes

For these triggers you MUST analyze the changes and **display the review in chat only**. Do **not** call `gh pr review`, `gh pr comment`, or any other command that writes to GitHub unless the user explicitly asks you to post (see below).

**Local staged changes (pre-PR):**
- `@[pr-code-review] review staged`
- Review local / unstaged diff when asked

Use `git diff --cached` (staged) or `git diff` (unstaged) as appropriate, evaluate, and output the review in chat.

**Post to GitHub — explicit command only:**
- `/pr-code-review post <PR_LINK_OR_NUMBER>`
- User says e.g. "post this review", "submit review to GitHub", "approve/request-changes on PR #N"

Only then may you run `gh pr review`. Use the **most recent in-chat review** the user approved (or ask which items to include). Never post without an explicit post command in the same or a follow-up message.

## Human Review First (mandatory)

1. Analyze → display findings in chat grouped by severity.
2. Human reads, edits, or drops items.
3. Human explicitly commands post → then and only then post to GitHub.

If the user has not said to post, end your response with a short note that the review is for human review only and that they can ask you to post when ready.

## Output Format (chat)

Always structure the in-chat review with these four severity levels:

| Level | When to use |
| --- | --- |
| **Blocker** | Must fix before merge — bugs, security holes, architecture violations, missing tests for critical paths |
| **Warning** | Should fix — likely issues, missing edge-case handling, spec drift, weak error handling |
| **Suggestion** | Nice to have — clearer naming, small refactors, better patterns |
| **Nitpick** | Optional polish — style, minor wording, trivial consistency |

Template:

```markdown
## PR Review — <title or number>

**Verdict:** <Approve / Request changes / Comment — for human context only; not posted>

### Blockers
- …

### Warnings
- …

### Suggestions
- …

### Nitpicks
- …

---
*Review displayed for human review. Say "post review to GitHub" (or `/pr-code-review post <PR>`) when ready to submit.*
```

When suggesting code changes, use **Markdown diff blocks** (` ```diff `) with `-` / `+` lines, not plain code blocks.

If a section has no items, write `None.`

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

## 5. Fetching PR Data (GitHub CLI — read-only)

When reviewing a GitHub Pull Request, use `gh` to **fetch only**:

- `gh pr view <number>` — PR description, title, labels, checks
- `gh pr diff <number>` — full diff

Do **not** write to GitHub during the analyze step.

## 6. Posting to GitHub (explicit command only)

After the human approves posting:

- `gh pr review <number> --comment -b "<markdown>"` — general review comment
- `gh pr review <number> --approve -b "<markdown>"` — only if no blockers remain and user asked to approve
- `gh pr review <number> --request-changes -b "<markdown>"` — only if blockers remain and user asked to request changes

Confirm the PR number and review body with the user if they edited the in-chat review or if anything is ambiguous.

## Review Process Workflow

1. **Fetch and analyze the diff**
   - **PRs:** `gh pr view` + `gh pr diff`
   - **Local:** `git diff --cached` or `git diff`
2. **Load related skills** (read and apply before concluding):
   - `project-structure-architecture` — feature layering, file placement
   - `svelte-core-bestpractices` / `shadcn-svelte` / `svelte-code-writer` — Svelte/UI changes
   - `couchdb-pouchdb-bestpractices` — data model, offline-first, MVCC
   - `security-rbac-bestpractices` — roles, shelter scope, PII
   - `testing-bestpractices` — Vitest/Playwright, DoD
3. **Check the checklist** — sections 1–4 above.
4. **Formulate feedback** — Blocker / Warning / Suggestion / Nitpick; use diff blocks for fixes.
5. **Display in chat** — always; never skip human review.
6. **Post to GitHub** — only when the user explicitly commands it (section 6).
