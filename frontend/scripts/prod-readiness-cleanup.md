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
| Every other evacuee (walk-in: `staff`, `kiosk`, `backoffice`, `import`, `paper`, `app`)     | deleted + its `medical` doc + photo `image`                                                                                                   |
| `movement`, `screening`, `station_log`, `evacuee_qr`                                        | all deleted (check-in history)                                                                                                                |
| `household`                                                                                 | no member left → deleted (+ pet/asset images); otherwise status re-derived, `checkout_destination` cleared, head moved to a kept member       |
| central_ops `referral`, `referral_close_job`, `referral_close_lock`                         | deleted                                                                                                                                       |
| `stock`                                                                                     | `stock_ledger`, `lot_counter`, `stock_lot_reservation`, `stock_threshold_override`, shelter-local `item_master`; central_ops `stock_transfer` |
| `food`                                                                                      | `meal_plan`, `kitchen_requisition`, `meal_service`, `meal_service_receipt`, `fuel_cylinder`, `gas_ledger`, `daily_calc`                       |
| `distribution`                                                                              | `distribution_*`, `bulk_return_*`, `loan_return_reservation`                                                                                  |
| `tickets`                                                                                   | `requisition_ticket`                                                                                                                          |
| `donations`                                                                                 | `donation`, `donation_redirect`, `donation_campaign`, donor photos (`image` with `purpose: donation`)                                         |

**Kept:** registry (shelters, config, master data), catalog (`item_master`, recipes, units, SOP),
`_users`, volunteers / jobs / shifts, incidents, audits, `people_import_log`, `donation_slot`,
`sop_override`, printing DBs, MongoDB-only collections (`third_party_clients`,
`external_bookings`, `unassigned_registrations`, …).

MongoDB is never written by the script. The **sync worker must be running** during `--apply`:
it turns the CouchDB deletes/updates into `public_persons`, `shelter_occupants`,
`shelter_stocks`, `public_shelters` occupancy and donation projection changes.

## Safety

- Dry-run is the default. Nothing is written without `--apply`.
- `--apply` on any host other than `localhost` / `127.0.0.1` / `::1` needs
  `--confirm-host=<hostname>` (staging and production reach CouchDB as `couchdb`, so use
  `--confirm-host=couchdb` there).
- `--apply` first exports every database it is about to change (all docs + attachments) to
  `--backup-dir` (default `frontend/backups/prod-cleanup/<host>-<timestamp>/`). If the export
  fails nothing is written. **The backup contains PII** — keep it on the server, never commit it
  (`/backups` is gitignored), delete it once production is confirmed good.
- Re-runnable: a second dry-run after `--apply` must print `Nothing to do.`
- Undo: `--restore=<backup-dir>` (dry-run) then `--restore=<backup-dir> --apply` puts every doc
  whose revision changed since the backup back to its backed-up content. Docs created after the
  backup are not touched. Running restore twice rewrites the same docs again (harmless).

Useful flags: `--shelter=SH001` (one shelter; central_ops is only touched with `all`),
`--only=stock,food` (subset of `people,stock,food,distribution,tickets,donations`),
`--keep-channels=web,api`.

## 1. Local

From `frontend/` with `COUCHDB_ADMIN_URL` in `frontend/.env`, worker running
(`docker compose up -d`):

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

The last one must end with `Nothing to do.` Then do the [Verify](#verify) checks.

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
network and credentials):

```bash
export NET=<network from above> COUCH_URL='http://<COUCHDB_USER>:<COUCHDB_PASSWORD>@couchdb:5984'
```

Dry-run:

```bash
docker run --rm --network "$NET" -v "$PWD/frontend:/app" -w /app -e COUCHDB_ADMIN_URL="$COUCH_URL" node:24-slim node_modules/.bin/tsx --tsconfig .svelte-kit/tsconfig.json scripts/prod-readiness-cleanup.ts
```

Check the counts against what you expect for that environment, make sure the worker container
(`tent-worker-staging` / `tent-worker-production`) is up, then apply:

```bash
docker run --rm --network "$NET" -v "$PWD/frontend:/app" -w /app -e COUCHDB_ADMIN_URL="$COUCH_URL" node:24-slim node_modules/.bin/tsx --tsconfig .svelte-kit/tsconfig.json scripts/prod-readiness-cleanup.ts --apply --confirm-host=couchdb
```

The backup lands in `frontend/backups/prod-cleanup/couchdb-<timestamp>/` on the server. Re-run the
dry-run command; it must print `Nothing to do.` Then do the [Verify](#verify) checks.

To undo (same container command):

```text
... scripts/prod-readiness-cleanup.ts --restore=backups/prod-cleanup/couchdb-<timestamp>
... scripts/prod-readiness-cleanup.ts --restore=backups/prod-cleanup/couchdb-<timestamp> --apply --confirm-host=couchdb
```

## Verify

1. Dry-run prints `Nothing to do.` for every shelter and `central_ops: delete -`.
2. Staff app, per shelter: dashboard "ในศูนย์" = 0; people list shows only pre-registered
   (and cancelled) people; stock, kitchen, distribution and ticket pages are empty.
3. Public site `/shelters`: occupancy 0 for every shelter; pre-registered people still forecast.
4. MongoDB, after the worker has caught up (mongo container `tent-mongodb`,
   `tent-mongodb-staging` or `tent-mongodb-production`; database from `DATABASE_URI`):

   ```bash
   docker exec tent-mongodb-staging mongosh --quiet tentdb --eval 'printjson({persons: db.public_persons.countDocuments(), occupants: db.shelter_occupants.countDocuments(), stocks: db.shelter_stocks.countDocuments()})'
   ```

   `persons` should equal the kept evacuees (reset + untouched, minus search-excluded),
   `occupants` 0, `stocks` 0. If rows remain, restart the worker with a forced bootstrap
   (`sync-worker --bootstrap`) and check again.
