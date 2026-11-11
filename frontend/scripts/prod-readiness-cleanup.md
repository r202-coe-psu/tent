# Prod-readiness cleanup — runbook

Script: `frontend/scripts/prod-readiness-cleanup.ts` (`pnpm migrate:prod-cleanup`).
One-off: clears test operations so the system can go live. Run in this order:
**local → staging → production**. Do not move on to the next environment until the
previous one passes every check in [Verify](#verify).

## What it does

| Area                                                                                        | Action                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Evacuee already `pre_registered` / `cancelled`                                              | untouched                                                                                                                                     |
| Evacuee with `registered_via` ∈ `web`, `api` (pre-registration channels; `--keep-channels`) | `current_stay` → `{ status: pre_registered, zone: null, since: <run time> }`                                                                  |
| Every other evacuee (walk-in: `staff`, `kiosk`, `backoffice`, `import`, `paper`, `app`)     | deleted + its `medical` doc, `evacuee_qr` print log and photo `image`                                                                         |
| `movement`, `screening`, `station_log`, `people_import_log`                                 | all deleted (check-in and import history). Kept people keep their `evacuee_qr`, so a printed Person QR still scans                            |
| `household`                                                                                 | no member left → deleted (+ pet/asset images); otherwise status re-derived, `checkout_destination` cleared, head moved to a kept member       |
| central_ops `referral`, `referral_close_job`, `referral_close_lock`                         | deleted                                                                                                                                       |
| `stock`                                                                                     | `stock_ledger`, `lot_counter`, `stock_lot_reservation`, `stock_threshold_override`, shelter-local `item_master`; central_ops `stock_transfer` |
| `food`                                                                                      | `meal_plan`, `kitchen_requisition`, `meal_service`, `meal_service_receipt`, `fuel_cylinder`, `gas_ledger`, `daily_calc`                       |
| `distribution`                                                                              | `distribution_*`, `bulk_return_*`, `loan_return_reservation`                                                                                  |
| `tickets`                                                                                   | `requisition_ticket`                                                                                                                          |
| `donations`                                                                                 | `donation`, `donation_redirect`, `donation_campaign`, donor photos (`image` with `purpose: donation`)                                         |

**Kept:** registry (shelters, config, master data), the central `catalog` DB (`item_master`,
recipes, units, SOP), `_users`, volunteers / jobs / shifts, incidents, audits, `donation_slot`,
`sop_override`, printing DBs, MongoDB-only collections (`third_party_clients`,
`external_bookings`, `unassigned_registrations`, …).

MongoDB is never written by the script. The **sync worker must be running** during `--apply`:
it turns the CouchDB deletes/updates into `public_persons`, `shelter_occupants`,
`shelter_stocks`, `public_shelters` occupancy and donation projection changes. The worker must
be a build that includes this branch's `shelter_stocks` fix (rows of items with no ledger left
are removed); an older worker leaves the old stock visible on the partner API.

## Safety

- Dry-run is the default. Nothing is written without `--apply`.
- `--apply` / `--restore --apply` need `COUCHDB_ADMIN_URL` set explicitly (environment or
  `frontend/.env`). They never fall back to the seed default `admin:password@localhost:5984`.
- A flag given without a value (`--shelter=`, `--shelter --apply`, `--only=`) is an error. It
  never widens to "all".
- `--apply` on any host other than `localhost` / `127.0.0.1` / `::1` needs:
  - `--confirm-host=<hostname>` (staging and production reach CouchDB as `couchdb`, so use
    `--confirm-host=couchdb` there), and
  - `--expect-shelters=<n>`, the shelter count from the dry-run. The hostname is the same on
    staging and production, so this count is what tells the two apart.
- `--apply` first exports every database it is about to change (all docs + attachments) to
  `--backup-dir` (default `frontend/backups/prod-cleanup/<host>-<timestamp>/`). If the export
  fails nothing is written.
- **The backup contains PII** (ID numbers, phones, medical data, photos):
  - the folder is created `0700` and the files `0600`
  - keep it on the server, never commit it (`/backups` is gitignored)
  - delete it once production is confirmed good. Files written by the container belong to root,
    so delete them with `sudo rm -rf frontend/backups/prod-cleanup/<dir>`.
- Re-runnable: a run that stops part-way (e.g. on a conflict) can be run again. A dry-run after
  `--apply` must print `Nothing to do.`
- Undo: `--restore=<backup-dir>` (dry-run) then `--restore=<backup-dir> --apply` puts every doc
  whose revision changed since the backup back to its backed-up content. That includes docs
  edited after the cleanup, so restore before anyone uses the system again. Docs created after
  the backup are not touched.

Useful flags: `--shelter=SH001` (one shelter; central_ops is only touched with `all`),
`--only=stock,food` (subset of `people,stock,food,distribution,tickets,donations`),
`--keep-channels=web,api`.

## 0. Before you start — design docs

The cleanup never touches `_design/*`. But a shelter DB whose design docs are older than the app
build looks broken after the cleanup even though the cleanup did not cause it:

- stale `_design/app` views → **every dashboard widget returns 500** (`registrations`, `zones`,
  `occupancy`, `demographics`, `station-times`)
- stale `_design/access` (VDU) → new doc types are refused, e.g. stock-in fails with
  `403 doc type not allowed yet: lot_counter` (the cleanup deletes the day's `lot_counter`, so the
  next stock-in has to create it)

Check both in each environment before running the cleanup (read-only):

```bash
pnpm redeploy:access
```

```bash
pnpm deploy:shelter-views --verify
```

If `redeploy:access` says `would redeploy` or any shelter fails `--verify`, sync the design docs
(central sync + access + views), then check again:

```bash
pnpm db:sync
```

On staging/production the CI deploy normally does this. If you need it by hand, run the same
commands through the container command from [§2](#2-staging--3-production), with the matching
script (`scripts/redeploy-access.ts`, `scripts/deploy-shelter-views.ts`) in place of
`scripts/prod-readiness-cleanup.ts`.

## 1. Local

From `frontend/` with `COUCHDB_ADMIN_URL` in `frontend/.env`, worker running
(`docker compose up -d`). Stop `pnpm dev` (and anything else writing to CouchDB) first:

```bash
pnpm migrate:prod-cleanup
```

Read the per-shelter breakdown (`delete by via/status`, `reset by via/status`). If the split
between deleted and reset people is wrong, stop and adjust `--keep-channels` before applying.

```bash
pnpm migrate:prod-cleanup --apply
```

```bash
pnpm migrate:prod-cleanup
```

The last one must end with `Nothing to do.` Start `pnpm dev` again, then do the
[Verify](#verify) checks.

## 2. Staging / 3. Production

CouchDB has no published port; run the script in a one-off Node container on the stack's
Docker network (same pattern as `docker-compose.seed.yml`). On the server, in a checkout of this
branch, once:

```bash
cd frontend && pnpm install --frozen-lockfile && pnpm exec svelte-kit sync && cd ..
```

Find the network (staging: `tent-couchdb-staging`, production: `tent-couchdb-production`):

```bash
docker inspect tent-couchdb-staging --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}'
```

Set these in the shell (values from the server's `.env`; for production use the production
network and credentials). Percent-encode the password if it has `@ : / ? # %`. Type it with a
leading space or clear the shell history afterwards so it is not saved there:

```bash
export NET=<network from above> COUCH_URL='http://<COUCHDB_USER>:<COUCHDB_PASSWORD>@couchdb:5984'
```

**Maintenance window.** Nothing may write to CouchDB while the plan is applied. Otherwise, for
example, a walk-in added to a household the plan deletes ends up pointing at a deleted
household. Stop the web app (it serves both staff and public writes) and keep the worker
running (staging shown; production: `tent-frontend-production`, `tent-worker-production`):

```bash
docker stop tent-frontend-staging
```

Dry-run (do it again right before applying — the plan is a snapshot):

```bash
docker run --rm --network "$NET" -v "$PWD/frontend:/app" -w /app -e COUCHDB_ADMIN_URL="$COUCH_URL" node:24-slim node_modules/.bin/tsx --tsconfig .svelte-kit/tsconfig.json scripts/prod-readiness-cleanup.ts
```

Check the counts against what you expect for that environment, count the `shelter_*` sections it
printed, make sure `tent-worker-staging` / `tent-worker-production` is up, then apply with that
count:

```bash
docker run --rm --network "$NET" -v "$PWD/frontend:/app" -w /app -e COUCHDB_ADMIN_URL="$COUCH_URL" node:24-slim node_modules/.bin/tsx --tsconfig .svelte-kit/tsconfig.json scripts/prod-readiness-cleanup.ts --apply --confirm-host=couchdb --expect-shelters=<n>
```

The backup lands in `frontend/backups/prod-cleanup/couchdb-<timestamp>/` on the server. Re-run the
dry-run command; it must print `Nothing to do.` Start the web app again and do the
[Verify](#verify) checks:

```bash
docker start tent-frontend-staging
```

To undo (same container command, web app stopped):

```text
... scripts/prod-readiness-cleanup.ts --restore=backups/prod-cleanup/couchdb-<timestamp>
... scripts/prod-readiness-cleanup.ts --restore=backups/prod-cleanup/couchdb-<timestamp> --apply --confirm-host=couchdb
```

## Verify

1. The dry-run ends with `Nothing to do.` (one line for the whole run) and shows
   `central_ops: delete -`.
2. Staff app, per shelter: dashboard "ในศูนย์" = 0; people list shows only pre-registered
   (and cancelled) people; stock, kitchen, distribution and ticket pages are empty. Every
   dashboard widget errors (HTTP 500), or stock-in fails with a 403? The design docs are stale,
   not the data — see [§0](#0-before-you-start--design-docs).
3. Public site `/shelters`: occupancy 0 for every shelter; pre-registered people still forecast.
4. MongoDB, after the worker has caught up (mongo container `tent-mongodb`,
   `tent-mongodb-staging` or `tent-mongodb-production`; database from `DATABASE_URI`):

   ```bash
   docker exec tent-mongodb-staging mongosh --quiet tentdb --eval 'printjson({persons: db.public_persons.countDocuments(), occupants: db.shelter_occupants.countDocuments(), stocks: db.shelter_stocks.countDocuments()})'
   ```

   `persons` should equal the kept evacuees (reset + untouched, minus search-excluded),
   `occupants` 0, `stocks` 0. If `stocks` rows remain, check that the worker build includes the
   `shelter_stocks` fix. Then restart the worker with a forced bootstrap (`sync-worker --bootstrap`),
   which rescans every shelter's stock, and check again.
