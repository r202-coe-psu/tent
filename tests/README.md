# tests — cross-plane tests against a live stack

Tests here talk to the running services over HTTP with no browser. They check what the
servers enforce on their own, which a UI test cannot see: the UI hides a button, but a
staff member's session can still call CouchDB through `/couch` directly.

The `e2e` project drives a real browser against the running app (`pnpm dev` in frontend/,
`APP_BASE_URL`, default `http://localhost:5173`) and keeps a video and a screenshot per
step of every test. Older browser journeys are still in `frontend/e2e`.

| Folder                   | What it checks                                                                                   | UAT                         |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------- |
| `e2e/auth/`              | Password sign-in, wrong password, guard redirects, sign-out, system management guard             | UAT-010, 011, 012, 014, 016 |
| `e2e/portal/`            | Which departments each role sees on `/portal`                                                    | UAT-020, 021, 022           |
| `e2e/system-management/` | SA manages a partner client on the API Keys page; each step is checked against `/external/token` | UAT-142                     |

Run `pnpm exec playwright test --project=e2e`, then `pnpm exec playwright show-report` to
watch the videos and screenshots.

## Suites

| Folder                   | What it checks                                                                                                                                                          | UAT              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `api/couch-permissions/` | Which roles may write evacuee, household, screening and medical docs straight to CouchDB, and that staff of one shelter cannot read or write another shelter's database | UAT-045, UAT-046 |
| `api/external-api/`      | Both external planes of FastAPI, see below                                                                                                                              | UAT-142, UAT-159 |

The expected access in `api/couch-permissions/matrix.ts` is copied from
`docs/prd/role-permission-matrix.md`; `api/external-api/endpoints.ts` from
`docs/data/api-contract.md` §5.1 and `partner-endpoints.ts` from §5.3. Change both sides in the
same PR.

### `api/external-api/`

| File               | What it checks                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `keyed-auth`       | `/external/v1` (CR-062): only a live API key gets in, in `X-API-Key` or as Bearer; revoke is immediate                    |
| `keyed-content`    | Announcements, FAQs and needs match the public plane; paging bounds; M2 routes stay gone                                  |
| `keyed-pii`        | An occupant hit carries only contract fields; a shelter detail names no evacuee                                           |
| `admin-gate`       | `/v1/admin/*` and `/public/v1/*` take only the BFF secret, never an agency key                                            |
| `partner-auth`     | EXT-001 token rules; forged, `alg: none` and expired JWTs; client lifecycle via the admin API                             |
| `partner-scopes`   | Each of the nine scopes opens exactly its endpoints; purpose is checked before scope                                      |
| `partner-data`     | EXT-002…007/011/012 against CouchDB: stock ledger, occupancy, and a probe evacuee through residency, occupants and search |
| `partner-bookings` | EXT-008…010: create, replay, isolation, cancel, the #751 acceptance rule and `booking-bypass`                             |
| `edge-routing`     | Through nginx only `/external/` reaches FastAPI. Runs only with `EDGE_BASE_URL`                                           |

`frontend/e2e/partner-api.test.ts` covers the partner plane through the staff UI and runs on
staging; these files check the same server rules over HTTP only, and compare the data with
CouchDB.

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

`api/external-api/` also needs MongoDB, the sync worker and FastAPI (`docker compose up -d`)
with the seeded people projected. FastAPI's image bakes in `tent_model`: after a pull that
changes `packages/tent-model`, run `docker compose build fastapi worker`, or its routers fail
to load and every `/external/v1` call is 404.

Settings come from `tests/.env` (see `.env.example`), then from `frontend/.env`. Each run
creates throwaway accounts named `permtest_*` and probe docs marked `PERMTEST`, and
removes both at the end (docs with `_purge`). The external suite also:

- issues `PERMTEST external …` API keys and `PERMTEST partner …` clients, then revokes them
  (and soft-deletes the clients); neither can be hard-deleted, so the rows stay in Mongo;
- writes a probe evacuee into shelter A and books into shelter B, then deletes and purges the
  CouchDB docs; the cancelled booking rows stay in Mongo;
- turns shelter B's pre-registration switch on for the booking tests when the seed left it
  off, and puts the original `feature_flags` back at the end.

`partner-auth` signs an expired token as the server only when `THIRDPARTY_JWT_SIGNING_KEY`
matches FastAPI's; otherwise that one test is skipped. `edge-routing` needs `EDGE_BASE_URL`.
For a local edge, run `nginx:alpine` on the compose network with `./nginx` mounted at
`/etc/nginx/conf.d` (as staging does) and a stub answering on `frontend:3000`.

A non-localhost CouchDB is refused unless `ALLOW_REMOTE_WRITES=true`. Never set it for
production.

## Git hooks

Lefthook formats staged files under `tests/` on commit, and on push runs `tsc` and
`prettier --check` here when a pushed file is under `tests/`. Both need `pnpm install` in
`tests/` first. The hooks do not run the suites, because they need a live stack.
