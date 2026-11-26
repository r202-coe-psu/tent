# tests — cross-plane tests against a live stack

Tests here talk to the running services over HTTP with no browser. They check what the
servers enforce on their own, which a UI test cannot see: the UI hides a button, but a
staff member's session can still call CouchDB through `/couch` directly.

The `e2e` project drives a real browser against the running app (`pnpm dev` in frontend/,
`APP_BASE_URL`, default `http://localhost:5173`) and keeps a video and a screenshot per
step of every test. Older browser journeys are still in `frontend/e2e`.

| Folder        | What it checks                                                                       | UAT                         |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `e2e/auth/`   | Password sign-in, wrong password, guard redirects, sign-out, system management guard | UAT-010, 011, 012, 014, 016 |
| `e2e/portal/` | Which departments each role sees on `/portal`                                        | UAT-020, 021, 022           |

Run `pnpm exec playwright test --project=e2e`, then `pnpm exec playwright show-report` to
watch the videos and screenshots.

## Suites

| Folder                   | What it checks                                                                                                                                                          | UAT              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `api/couch-permissions/` | Which roles may write evacuee, household, screening and medical docs straight to CouchDB, and that staff of one shelter cannot read or write another shelter's database | UAT-045, UAT-046 |

The expected access in `api/couch-permissions/matrix.ts` is copied from
`docs/prd/role-permission-matrix.md`. Change both in the same PR.

## Known gaps

A gap between the spec and what the server enforces today is listed in `KNOWN_GAPS`
(`matrix.ts`) with its issue. Those tests run as expected failures (`test.fail`): the
suite stays green while the gap is open and turns red once the server is fixed. Then
delete the entry.

## Run locally

Needs CouchDB with the seeded shelters (`SH001`, `SH002`):

```sh
docker compose up -d couchdb
cd frontend && pnpm seed
cd ../tests
pnpm install
pnpm test
```

Settings come from `tests/.env` (see `.env.example`), then from `frontend/.env`. Each run
creates throwaway accounts named `permtest_*` and probe docs marked `PERMTEST`, and
removes both at the end (docs with `_purge`).

A non-localhost CouchDB is refused unless `ALLOW_REMOTE_WRITES=true`. Never set it for
production.
