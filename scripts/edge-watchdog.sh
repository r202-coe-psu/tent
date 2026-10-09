#!/bin/sh
# Edge replication watchdog (CR-064) — runs as the `edge-watchdog` service in docker-compose.edge.yml.
#
# Why: after a WAN/central outage CouchDB's replicator backs off exponentially on every failed retry
# (30s, 60s, 120s, ... per consecutive error). A job that crashed 8 times can sit in `crashing` for an hour+
# even though central is reachable again, so the edge silently stops receiving central's changes.
# This loop notices that situation and restarts only those jobs (checkpoints survive, nothing re-syncs).
#
# Every WATCHDOG_INTERVAL seconds it looks at _scheduler/docs/_replicator and restarts a job when ALL hold:
#   - state is `crashing` with error_count >= WATCHDOG_MIN_ERRORS (ignores one-off blips)
#   - the error is NOT a credential rejection (session_request_unauthorized = 401, session_request_forbidden
#     = 403, which also covers CouchDB's auth lockout): restarting cannot fix those and every retry feeds
#     chttpd_auth_lockout (5 failures -> 403 for 5 minutes). Connectivity errors that CouchDB also wraps in
#     replication_auth_error (session_request_failed: nxdomain, conn_failed, connection closed) DO qualify.
#   - central answers GET <SYNC_URL>/_up with CouchDB's JSON {"status":"ok"} (otherwise restarting would just crash
#     again; a bare HTTP 200 is not enough — if the app's domain resolves to this edge, /sync/_up lands on the
#     edge's web app and returns HTML)
#   - this job was not restarted within the last WATCHDOG_COOLDOWN seconds
# "Restart" = delete the job doc, then re-run edge-init.sh (idempotent) which recreates it from the
# current environment.
#
# Env (same as edge-init): COUCHDB_USER COUCHDB_PASSWORD SHELTER_CODE SYNC_URL CENTRAL_*; plus optional
#   WATCHDOG_INTERVAL=60  WATCHDOG_MIN_ERRORS=3  WATCHDOG_COOLDOWN=300
#   WATCHDOG_DRY_RUN=1 (log only)   WATCHDOG_ONCE=1 (single pass, then exit)
set -u

: "${COUCHDB_USER:?}" "${COUCHDB_PASSWORD:?}" "${SYNC_URL:?}"

E="http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@couchdb:5984"
CEN="${SYNC_URL%/}"
INTERVAL="${WATCHDOG_INTERVAL:-60}"
MIN_ERRORS="${WATCHDOG_MIN_ERRORS:-3}"
COOLDOWN="${WATCHDOG_COOLDOWN:-300}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"
ONCE="${WATCHDOG_ONCE:-0}"
STATE_DIR="${TMPDIR:-/tmp}/edge-watchdog"
INIT_SCRIPT="${EDGE_INIT_SCRIPT:-/edge-init.sh}"
mkdir -p "$STATE_DIR"

log() { echo "$(date -u +%FT%TZ) edge-watchdog: $*"; }

# central_up — true only if CouchDB itself answers (not whatever web server the name currently points at)
central_up() { curl -sf -m 5 "$CEN/_up" 2>/dev/null | grep -q '"status":"ok"'; }

# field <name> <json line> — first string value of "name":"..."
field() { printf '%s' "$2" | sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" | head -1; }

pass() {
	docs_file="$STATE_DIR/docs.json"
	todo="$STATE_DIR/todo.txt"
	: >"$todo"
	if ! curl -s -m 10 "$E/_scheduler/docs/_replicator" | grep '"doc_id"' >"$docs_file"; then
		:
	fi
	if [ ! -s "$docs_file" ]; then
		log "no replication docs readable yet (CouchDB starting or none created) — skipping"
		return
	fi

	now=$(date +%s)
	while IFS= read -r line; do
		id=$(field doc_id "$line")
		state=$(field state "$line")
		[ "$state" = "crashing" ] || continue
		errs=$(printf '%s' "$line" | sed -n 's/.*"error_count":\([0-9][0-9]*\).*/\1/p' | head -1)
		errs="${errs:-0}"
		if [ "$errs" -lt "$MIN_ERRORS" ]; then
			log "$id crashing (errors=$errs < $MIN_ERRORS) — waiting"
			continue
		fi
		if printf '%s' "$line" | grep -q -E 'session_request_unauthorized|session_request_forbidden'; then
			log "$id crashing: central REJECTED the credentials (401/403 or lockout) — not restarting; fix .env / wait out the lockout (retries feed CouchDB's lockout)"
			continue
		fi
		last=0
		[ -f "$STATE_DIR/kick.$id" ] && last=$(cat "$STATE_DIR/kick.$id")
		if [ $((now - last)) -lt "$COOLDOWN" ]; then
			log "$id crashing (errors=$errs) — restarted $((now - last))s ago, cooling down"
			continue
		fi
		echo "$id $errs" >>"$todo"
	done <"$docs_file"

	[ -s "$todo" ] || return

	if ! central_up; then
		log "jobs stuck ($(cut -d' ' -f1 "$todo" | tr '\n' ' ')) but central $CEN/_up is not answering as CouchDB — leaving them"
		return
	fi

	while read -r id errs; do
		if [ "$DRY_RUN" = 1 ]; then
			log "DRY RUN: would restart $id (errors=$errs)"
			continue
		fi
		rev=$(curl -s -m 10 "$E/_replicator/$id" | sed -n 's/.*"_rev":"\([^"]*\)".*/\1/p' | head -1)
		if [ -z "$rev" ]; then
			log "$id: cannot read its _rev — skipping"
			continue
		fi
		if curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$E/_replicator/$id?rev=$rev" | grep -q '^20'; then
			echo "$now" >"$STATE_DIR/kick.$id"
			log "$id stuck (errors=$errs) while central is up — deleted, will be recreated"
			recreate=1
		else
			log "$id: delete failed — skipping"
		fi
	done <"$todo"

	if [ "${recreate:-0}" = 1 ] && [ "$DRY_RUN" != 1 ]; then
		out=$(sh "$INIT_SCRIPT" 2>&1)
		rc=$?
		if [ "$rc" = 0 ]; then
			log "edge-init re-run ok: $(printf '%s\n' "$out" | grep -c '^ok .*_replicator') job(s) recreated"
		else
			log "edge-init re-run FAILED (exit $rc): $(printf '%s\n' "$out" | tail -3 | tr '\n' ' ')"
		fi
		recreate=0
	fi
}

log "started: every ${INTERVAL}s, min_errors=$MIN_ERRORS, cooldown=${COOLDOWN}s, central=$CEN, dry_run=$DRY_RUN"
while :; do
	pass
	[ "$ONCE" = 1 ] && exit 0
	sleep "$INTERVAL"
done
