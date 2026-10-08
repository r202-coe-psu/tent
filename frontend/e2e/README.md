# E2E testing — strategy, rules and handoff

> Status (2026-10-08): phase 0 (pre-register pilot) **done** — PRs #391, #392, #394, #395, #396 merged.
> Step A (coverage audit) **done** — see §8 verified table + gap list. Next: B1/B2/B3 (§9.B).
> Current goal: the **release gate** (§8) — six user journeys must be proven working on staging
> before anything is promoted to production. Agents picking this up: read §4, §8 and §9 first.

## 1. Current state

| Item                           | Today                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright                     | 1.61, Chromium only                                                                                                                                                  |
| `playwright.config.ts`         | local: `vite preview` (:4173) + `e2e/mock-api.js` (:9001)                                                                                                            |
| `playwright.staging.config.ts` | remote, runs only `staging/smoke.test.ts`                                                                                                                            |
| `playwright.public.config.ts`  | remote read-only public suites (incl. pre-register) — **not wired to any job**                                                                                       |
| Suites                         | 33 files, mixed: mocked, live-stack, some mutate shared data; only the pre-register suites are tagged                                                                |
| Automation                     | Jenkins runs staging smoke after a `staging` deploy (`Jenkinsfile` → `Jenkinsfile.e2e-staging`); failure only marks the build `UNSTABLE`, **it does not block prod** |
| Pre-push (lefthook)            | lint / check / unit tests only — no e2e                                                                                                                              |

Known problems:

- `registration-evacuee.test.ts` flips SH001 policy toggles that it cannot fully restore — unsafe on shared DBs.
- Query-based teardown (`?q=<run id>`) once deleted unrelated dev records (server search matches digit substrings).
- `pnpm test:e2e:pre-register` can hang on exit after tests finish.
- ~~Repo-wide `playwright test --list` failed because `public-portal-faq-crud.test.ts` imported
  `completeUserOnboarding` (removed when `helpers/couch.ts` renamed it to `seedSecurityQuestion`).~~
  **Fixed in Step A** — the suite now calls `seedSecurityQuestion`; `npx playwright test --list`
  loads the whole repo (353 tests / 33 files verified 2026-10-08).
- `vite dev` may hit inotify `ENOSPC` — use `vite build --mode test` + `vite preview`.
- `pnpm test` (vitest) can crash with "Worker exited unexpectedly" under memory pressure — use
  `pnpm exec vitest run --maxWorkers=2`.
- `vite.config.ts` (`couchInit`) sends idempotent `PUT`s for `_users` / `_replicator` /
  `_global_changes` whenever vitest or vite starts.

## 2. Test layers

Write one suite per feature. Tags select the layer, so tests are never duplicated.

| Layer         | When                       | What runs                                                    | Target time | Status     |
| ------------- | -------------------------- | ------------------------------------------------------------ | ----------- | ---------- |
| 1. Pre-push   | every push (lefthook)      | lint, check, unit + BFF/FastAPI contract tests               | 1–3 min     | ✅ exists  |
| 2. PR gate    | every PR → `develop`       | `@regression` (mocked, no DB)                                | ~10 min     | ❌ phase 3 |
| 3. Nightly    | nightly on `develop`       | `@critical` on an ephemeral docker stack, zero-leak teardown | 30–60 min   | ❌ phase 4 |
| 4. Staging    | after every staging deploy | `@release` (the six journeys, §8) + `@smoke` of every suite  | 15–30 min   | ⚠️ step C  |
| 5. Production | after prod deploy          | `@prod` — 2–3 read-only smoke pages                          | < 2 min     | ❌ step C  |

Integration bugs between BFF ↔ FastAPI must be caught in layer 1 by contract tests (e.g. the
registrations/status BFF test), not first discovered on staging.

## 3. Tags

Use Playwright's native `{ tag: [...] }` on `test` / `test.describe`. Every test has **exactly one**
layer tag (`@smoke` / `@critical` / `@regression`) plus one feature tag. `@prod`, `@release` and
`@quarantine` are optional extras.

| Tag           | Meaning                                                                     | Runs in                 |
| ------------- | --------------------------------------------------------------------------- | ----------------------- |
| `@smoke`      | read-only; safe on staging/prod; not skipped when `IS_REMOTE`               | staging, prod, local    |
| `@critical`   | writes real data (creates registrations, shelters…) with zero-leak teardown | nightly, staging, local |
| `@regression` | API mocked via `page.route` / `mock-api.js`; no DB                          | PR gate, local          |
| `@release`    | part of a release-gate journey (§8); combined with `@smoke` or `@critical`  | staging (blocks `main`) |
| `@prod`       | a few `@smoke` tests: compact production smoke (< 2 min)                    | prod, staging           |
| `@quarantine` | violates §4; excluded by default (`grepInvert`) until rewritten             | nowhere                 |
| `@<feature>`  | e.g. `@pre-register`, `@public`, `@onsite`, `@back-office`, `@system-admin` | filtering               |

Select a feature and a layer: `playwright test --grep "(?=.*@pre-register)(?=.*@smoke)"`.

## 4. Data safety rules (mandatory)

1. Everything a test creates is fictitious and marked: names start with `E2E`, the run id comes from
   `LOCAL_RUN_ID`, Thai national IDs start with `0` (never a real person) with a valid checksum.
2. **Teardown deletes only ids recorded by this run** (ledger). Never delete by search/query results.
3. Never modify seeded or real records (e.g. SH001–SH004, `config:app`). A test that needs a
   shelter creates its own `E2E …` shelter through the staff UI and removes it with `teardownShelter`.
   Shelter settings a journey needs (e.g. `enable_medical_screening`, `accepts_pre_registration`)
   are set **on that E2E shelter** through the UI.
4. Setup goes through the UI; admin APIs (`couchReq`, staff DELETE) are for teardown only.
5. Production is always read-only (`@smoke`/`@prod` only). Staging may run `@critical` (decision 2);
   any other remote target is read-only and write tests skip via `IS_REMOTE`.
6. Every live suite ends with a zero-leak assertion (no `E2E`/run-id records left).
7. Suites that violate these rules are tagged `@quarantine` until rewritten.

## 5. Feature suite template (from the pre-register pilot)

Reference implementation: `public-pre-register-flow.test.ts` + `helpers/pre-register.ts`.

- **Render contract** — every section, field and option visible/enabled with bound labels; ARIA
  snapshot (`toMatchAriaSnapshot`) and visual snapshots (`toHaveScreenshot`, dynamic regions masked).
- **Error contract** — a matrix of every validation message ↔ trigger ↔ field; each row asserts the
  literal message at the field, `aria-invalid` + `aria-describedby`, the summary/jump behavior, and
  that nothing is sent.
- **Server/page errors** — 409/422/429/500/network abort produce one readable toast and keep input.
- **Critical flows** — the real happy paths end to end, persisted data read back and compared.
- **Roles** — staff journeys log in as the real role that uses the page (helpers: `helpers/login.ts`,
  `helpers/couch.ts`, `users/access-control.test.ts` patterns) and assert other roles are refused.
- **Hygiene** — no `pageerror`, `console.error/warning`, or unexpected ≥400 responses.
- Known app bugs are `test.fixme` with a `GAP:` title; flip to `test` in the PR that fixes them.

## 6. Roadmap

| Phase / step | Scope                                                                                                                    | Status / depends on |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| 0            | Pre-register pilot: #391 (ticket status), #392 (form UX), #394 (suite + tags), #395 (submit toasts), #396 (field errors) | ✅ merged           |
| A            | Release-gate coverage audit (read-only) — §9.A                                                                           | ✅ done (this PR)   |
| B1–B3        | Close the gaps per journey + phase-1 conventions for the touched suites — §9.B                                           | next                |
| C            | Pipeline: staging runs `@release` + `@smoke`, commit status required on `main`, janitor, prod `@prod` — §9.C             | after B             |
| 3            | PR gate Jenkins job: build + `@regression`                                                                               | after C             |
| 4            | Nightly: ephemeral docker stack + `@critical` (confirm `mgmt` capacity first)                                            | after C             |
| 5            | Template rollout to the remaining features (donations, volunteer, stock, distribution…) + tag every remaining suite      | after C             |

### Decisions (2026-10-08)

1. **Jenkins agent** — the `mgmt` agent already builds and runs Docker containers
   (`scripts/run-staging-e2e.sh` → `frontend/Dockerfile.e2e-staging`, base
   `mcr.microsoft.com/playwright:v1.61.1-noble`), so Playwright-in-Docker works today. Still to
   confirm for phase 4: enough CPU/RAM/ports on `mgmt` to run a full `docker compose` stack.
2. **Staging may be written to** by `@critical` tests, on the condition that cleanup is guaranteed:
   ledger-only teardown (§4.2), a zero-leak assertion at the end of each run, and a scheduled
   staging janitor that removes leftover records carrying the exact `E2E` + run-id marker (never
   by fuzzy search) older than a few hours.
3. **A failed staging E2E blocks promotion to prod.** Staging and prod are separate pipelines
   (prod deploys when `staging` is merged into `main`), so the gate is: the commit being merged to
   `main` must have a green staging E2E status (Jenkins reports a GitHub commit status; branch
   protection on `main` requires it). Remove the `catchError → UNSTABLE` wrapper.
4. **Production smoke: yes, compact.** After the prod deploy (`Jenkinsfile.prod`, branch `main`)
   run a small read-only subset tagged `@prod` (also `@smoke`): landing page, pre-register form
   renders, shelter search — target under 2 minutes, never writes.

## 7. Running locally

```bash
docker compose up -d            # CouchDB, MongoDB, sync worker, FastAPI (:9000)
cd frontend
pnpm test:e2e                                 # full local suite (build + preview + mock-api)
pnpm test:e2e:pre-register                    # pilot feature suites (live + mocked)
pnpm test:e2e:pre-register:smoke              # pre-register, read-only only
pnpm test:e2e:regression                      # mocked suites only
```

Live suites also need platform init (`pnpm seed:master`, `pnpm db:sync`); see each file's header.

## 8. Release gate — six journeys that must pass before prod

Nothing is merged `staging → main` unless every journey below is green on staging (`@release`).
"Works" means the §5 template: render contract, error contract, the real critical flow end to end
with data read back, correct role access, hygiene.

**Decision (2026-10-08):** `/onsite/scan-check-in-out` is part of **J4** (Station 1 register → QR →
scan), not a separate journey and not J3. B2 owns the rewrite that covers scan on an own `E2E`
shelter.

### 8.1 Verified coverage (Step A audit, 2026-10-08)

`--list` loadability: all suites below load under `npx playwright test --list` after the
`seedSecurityQuestion` fix. Tags: only J2 suites carry `@smoke` / `@critical` / `@regression`;
**no suite yet carries `@release` or `@quarantine`.**

| #   | Journey                       | Routes                                                                | Suites (mode)                                                                                                                                                                                                                                                                                                                                                         | What is proven today                                                                                                                                                                                                                          | §4 / safety                                                                                                                                                   | Gaps vs §5                                                                                                                                                                                      |
| --- | ----------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | Public portal                 | `/`, `/shelters`, `/search`                                           | `public-home-flow` (live serial; local writes own `E2E` shelter + need via UI, `teardownShelter`; remote skips writes), `public-search-flow` (live; local creates shelter + Station-1 households, teardown by code; remote uses fixtures), `public-shelters-filter` (live; two own shelters, teardown; remote fixtures), `public-portal` (read-only footer 1784/1669) | Navigation, hero→search, language toggle, urgent-need card (local only), search by name/phone/national-id/passport + pagination + PII masking, shelter filters (name/radius/kind/admin cascade), emergency footer                             | Local writes obey §4 (own `E2E` + ledger teardown). No layer tags. Roles: bootstrap admin for setup only; public asserts are anonymous                        | No render/error/ARIA/screenshot contracts; no `@smoke`/`@release`/`@prod`; no server-error matrix on `/` `/shelters` `/search`                                                                  |
| J2  | Pre-registration              | `/pre-register`                                                       | `public-pre-register-flow` (`@pre-register` + `@smoke`/`@critical`; pilot template), `public-register` (`@pre-register` + `@regression`, fully mocked, SH001 fixture names only)                                                                                                                                                                                      | Full §5 pilot: render, validation, error matrix, server/page errors, critical happy paths W*, zero-leak teardown, navigation/layout                                                                                                           | Critical paths skip when `IS_REMOTE`; mocked suite never hits DB. Own `E2E` shelter for live writes                                                           | **Add `@release` only** on the journey describes (nav + critical W* — not every error-matrix row). No other functional gap for the gate                                                         |
| J3  | Onsite S1 → S2 → S3           | `/onsite/people`, `/onsite/medical-screening`, `/onsite/zoning`       | **`onsite-stations-flow`** (live `@onsite`/`@critical`/`@release` on own `E2E` shelter), `intake-pipeline` (**mocked** `@regression`), `household-post-arrival` (live SH001 wizard — not the station pipeline)                                                                                                                                                        | Live: Station 1 walk-in → Station 2 (shelter_manager) → Station 3 zoning on own `E2E` shelter with medical toggle set via UI. Mocked intake-pipeline remains for seam shape only                                                              | Own `E2E` + ledger `teardownShelter`; never SH001. `household-post-arrival` still writes SH001 (out of B2 scope)                                              | Render/error contracts for station pages still thin; medical-OFF path not yet a separate `@release` row                                                                                         |
| J4  | Add evacuee (real) + **scan** | `/onsite/people` → unified reg → QR → **`/onsite/scan-check-in-out`** | **`onsite-stations-flow`** (same suite — QR + scan out/in), `registration-evacuee` (**`@quarantine`**), `intake-pipeline` (mocked, no scan)                                                                                                                                                                                                                           | Live `@release` proves Person QR decode + `/onsite/scan-check-in-out` check-out/in on the E2E shelter. Old `registration-evacuee` kept for reference but excluded by `grepInvert`                                                             | New suite obeys §4. Quarantined suite must not run on shared DBs                                                                                              | Public pre-reg → desk report-in / pets-assets-vehicles matrix still only in quarantined file                                                                                                    |
| J5  | Back office evacuee mgmt      | `/back-office/evacuee-management`, `/back-office/households`          | `household-pre-register`, `household-post-arrival` (both live **SH001**); land on `?tab=household` after wizard / manager glance                                                                                                                                                                                                                                      | Strong household **wizard** coverage (pre-reg + post-arrival) + role access matrix for the wizard. Manager opens household tab once. **No** dedicated suite for the main evacuee list/search/detail/edit on `/back-office/evacuee-management` | Both suites write SH001 people-plane data; cleanup deletes docs created by test accounts in `shelter_sh001`. Not suitable as `@release` until moved off SH001 | Need `@release` on E2E-shelter data: open evacuee-management (evacuee + household tabs), search/list/detail (smallest critical path). Quarantine or leave SH001 household suites non-`@release` |
| J6  | System admin shelter          | `/system-management/shelters`                                         | `shelters.test.ts` (**mocked** POST/PATCH; navigates **`/back-office/shelters/create`**, not system-management), `createShelterViaUi` in `helpers/staff-ui.ts` (live, used by J1/J2 setup — hits `/system-management/shelters/create`, tears down via `teardownShelter`), `shelter-import` (mocked import at system-management)                                       | Mocked form validation/guard/edit on the **back-office** path. Live create+public projection only as **setup helper** inside other suites — no dedicated `@release` assert of SA create → edit → registry + public list                       | Helper obeys §4. Mocked suite creates Couch users but does not provision real shelters. No `@release`                                                         | Live `@release`: SA create + edit one field + assert registry + public projection; teardown with `teardownShelter`. Prefer system-management routes (gate route), not only back-office          |

**Unsafe / do-not-run-on-shared-DB suites (name them for B agents):**

| Suite                            | Why unsafe                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `registration-evacuee.test.ts`   | Flips SH001 policy toggles + global reCAPTCHA; incomplete restore; name-based teardown — now `@quarantine` (replaced by `onsite-stations-flow`) |
| `household-pre-register.test.ts` | Live writes on seeded SH001                                                                                                                     |
| `household-post-arrival.test.ts` | Live writes on seeded SH001                                                                                                                     |

(`intake-pipeline` is mocked — safe for local `@regression`, not a live SH001 mutator. Other SH001-named suites outside J1–J6 are out of Step A scope but share the same pattern.)

### 8.2 Gaps ordered by risk (S/M/L) — feed B1/B2/B3

| Priority | Journey | Gap                                                                                                                    | Size  | Owner |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| 1        | J4      | Rewrite live Station 1 → QR → **scan** on own `E2E` shelter; `@quarantine` `registration-evacuee`                      | **L** | B2    |
| 2        | J3      | Live S1→S2→S3 on that same `E2E` shelter (medical toggle via its UI); real station roles                               | **L** | B2    |
| 3        | J5      | Dedicated `@release` for `/back-office/evacuee-management` (+ households) on E2E data — not SH001 wizards              | **M** | B3    |
| 4        | J6      | Live `@release` SA create/edit + public projection (today only a helper / mocked back-office form)                     | **M** | B3    |
| 5        | J1      | Thin render + error contracts for `/`, `/shelters`, `/search`; tag existing live reads `@smoke` (+ `@prod` candidates) | **M** | B1    |
| 6        | J1/J2   | Tag J1 flows; add `@release` to J2 journey describes only                                                              | **S** | B1    |
| 7        | J3      | Keep or tag mocked `intake-pipeline` as `@regression`; do not expand SH001 live coverage                               | **S** | B2    |
| 8        | J5      | Tag SH001 household suites `@quarantine` or explicitly non-`@release` until rewritten                                  | **S** | B3    |

No journey test rewrites in Step A — documentation + `--list` fix only.

## 9. Agent handoff

### 9.0 Rules for every agent (non-negotiable)

- **Data safety (§4).** Never run `@critical`, live-write suites, teardown helpers, DELETE endpoints,
  CouchDB admin writes or Mongo writes **unless your task explicitly says so**, and then only on the
  local docker stack with ledger-based teardown and a final zero-leak assertion. Never touch
  SH001–SH004 or `config:app`. An earlier run deleted other people's dev data through loose
  teardown — if you ever delete something you did not create, stop and report it.
- **Workspace.** Work in your own git worktree branched from `origin/develop`; never modify the
  main checkout. Copy `.env` and `frontend/.env` from it. `cd frontend && pnpm install --frozen-lockfile`.
- **Ports.** Never use or stop `:5173` (owner's dev server) or `:9000` (FastAPI container). Pick a
  unique preview port (e.g. `:4185`–`:4199`) and set `PLAYWRIGHT_TEST_BASE_URL`. Kill what you start.
- **Environment quirks** — see §1 known problems (ENOSPC, `--maxWorkers=2`).
- **Code rules.** `CLAUDE.md`, `frontend/CONTRIBUTING.md`, `frontend/CONVENTIONS.md` (layering,
  barrels, Svelte 5 runes, toast-only feedback). Load skills `frontend:testing-bestpractices`, and
  for `.svelte` edits `frontend:svelte-code-writer` + `frontend:svelte-core-bestpractices` +
  `frontend:civic-design-system`.
- **Spec changes.** Any change in the categories of `docs/change-management.md` §2 → stop and ask
  the owner how to track it before writing it.
- **Definition of done.** `pnpm lint`, `pnpm check` (0 errors), `pnpm test`, `svelte-autofixer`
  clean on touched `.svelte`, plus the step's own acceptance below.
- **Git.** Conventional Commits ≤72 chars, lowercase after colon. Never `--no-verify` or
  `LEFTHOOK=0`. PR to `develop` with `gh`; the body says what changed, how it was verified (real
  command output), and lists any app bugs found.
- **App bugs found while testing** are not fixed silently: add a `test.fixme('GAP: …')` and list
  them in the PR body; the owner decides whether to fix them in a separate PR.
- **Report back**: PR URL, acceptance results, bugs found, data created/left, anything skipped.

### 9.A Coverage audit (read-only)

- **Goal:** know exactly what is and isn't proven for J1–J6 before writing anything.
- **Do:** for each journey, read the suites in §8 and the routes/components they hit. For every
  test record: what it proves, mocked vs live, roles used, data it writes, whether it obeys §4,
  whether it currently loads (`playwright test <file> --list`). Then list gaps against the §5
  template per journey, with a size estimate (S/M/L).
- **Allowed runs:** `--list` only, plus `@regression`/mocked suites on your own preview port.
- **Deliverable:** one PR that updates §8 of this README with a per-journey coverage table and a
  gap list (ordered by risk), and fixes the `completeUserOnboarding` import so `--list` works
  repo-wide. No other code changes.
- **Acceptance:** `npx playwright test --list` loads for the whole repo; every J1–J6 row has a
  verified coverage + gap list; unsafe suites are named.

### 9.B Close the gaps (three agents in parallel, after A is merged)

Split by code area so branches don't conflict:

| Agent | Journeys      | Feature tag                     | Notes                                                                                                                                                 |
| ----- | ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | J1 (+J2 tags) | `@public`, `@pre-register`      | render/error contracts for `/`, `/shelters`, `/search`; add `@release` to the J2 tests that represent the journey                                     |
| B2    | J3, J4        | `@onsite`                       | rewrite Station 1 → 2 → 3 on an own `E2E` shelter (toggle medical screening through its UI); replace or quarantine `registration-evacuee`; real roles |
| B3    | J5, J6        | `@back-office`, `@system-admin` | evacuee/household management flows; admin creates and edits a shelter, then it appears where it should (registry, public projection)                  |

Each B agent, for the suites it touches:

- applies the §5 template and §3 tags (`@release` on the journey tests, one layer tag each);
- tags unsafe tests it cannot fix `@quarantine` and adds `grepInvert: /@quarantine/` to the configs
  if not present;
- may run its own `@critical` tests **only** on the local docker stack, ledger teardown, zero-leak
  assertion at the end;
- fixes the `pnpm test:e2e:*` exit hang if it hits it (first agent to fix it notes it in the PR).

**Acceptance per agent:** its journeys' `@release` tests green once on the local stack; zero-leak
assertion green; `--list` shows every touched test with exactly one layer tag; app bugs found are
`test.fixme('GAP: …')` and listed.

### 9.C Pipeline (after B is merged)

- `Jenkinsfile.e2e-staging` runs `@release` and `@smoke` across suites in the existing Playwright
  Docker image (`scripts/run-staging-e2e.sh`, credentials `tent-staging-e2e-env`); widen
  `playwright.staging.config.ts` `testMatch` accordingly; provision staging `E2E` fixtures per
  `helpers/e2e-env.ts`.
- Remove `catchError → UNSTABLE` around "Trigger Staging E2E" in `Jenkinsfile`; report the result as
  a GitHub commit status on the deployed commit; the owner enables branch protection on `main`
  requiring that status.
- Staging janitor (scheduled job): deletes records whose marker matches exactly `E2E` + run-id and
  that are older than a few hours; dry-run mode first; logs every id it deletes.
- `Jenkinsfile.prod`: after deploy, run `@prod` (read-only, < 2 min); failure alerts the team.
- **Acceptance:** a staging deploy with a deliberately broken journey shows a red commit status and
  blocks the `main` merge; a clean deploy is green; the janitor dry-run lists only `E2E` records.
