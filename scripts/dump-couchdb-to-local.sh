#!/usr/bin/env bash
# Dump every non-system CouchDB database from prod to files, then restore them into local.
# Uses @cloudant/couchbackup (fetched via npx). Dumps are real PII: they default to
# OUT_DIR outside the repo; never commit them.
#
# Usage:
#   PROD_URL=https://prod-host/couch PROD_USER=readonly PROD_PASS=... \
#     ./scripts/couchdb-dump.sh dump [out_dir]
#   LOCAL_USER=admin LOCAL_PASS=... \
#     ./scripts/couchdb-dump.sh restore [out_dir]
#
# Notes:
#   - Skips system dbs (_users, _replicator, ...). _security is NOT included.
#   - Attachments (files) are NOT restored: couchbackup does not store them, so restore
#     strips `_attachments` stubs from docs. Use scripts/pull-prod-couchdb.sh if you need files.
#   - Credentials are URL-encoded, so special characters in passwords are safe.
#   - After restoring, stop the worker and run: uv run --project worker sync-worker --bootstrap
set -euo pipefail

mode="${1:-}"
OUT_DIR="${2:-$HOME/couchdb-dumps}"

urlenc() { jq -rn --arg v "$1" '$v | @uri'; }

with_auth() { # <url> <user> <pass>
	local u p
	u=$(urlenc "$2")
	p=$(urlenc "$3")
	echo "${1/\/\//\/\/$u:$p@}"
}

dump() {
	: "${PROD_URL:?}" # e.g. https://prod-host/couch
	: "${PROD_USER:?}"
	: "${PROD_PASS:?}"
	mkdir -p "$OUT_DIR"

	echo ">> listing dbs on $PROD_URL"
	resp=$(curl -sS -w '\n%{http_code}' -u "$PROD_USER:$PROD_PASS" "$PROD_URL/_all_dbs") || {
		echo "!! cannot reach prod: $PROD_URL" >&2
		exit 1
	}
	code=${resp##*$'\n'}
	body=${resp%$'\n'*}
	if [ "$code" != "200" ]; then
		echo "!! prod _all_dbs returned HTTP $code: $body" >&2
		exit 1
	fi
	dbs=$(jq -r '.[] | select(startswith("_") | not)' <<<"$body")
	if [ -z "$dbs" ]; then
		echo "!! no non-system dbs visible to $PROD_USER (check permissions)" >&2
		exit 1
	fi

	url=$(with_auth "$PROD_URL" "$PROD_USER" "$PROD_PASS")
	for db in $dbs; do
		echo ">> dumping $db -> $OUT_DIR/$db.couchbackup"
		npx -y @cloudant/couchbackup --url "$url" --db "$db" >"$OUT_DIR/$db.couchbackup"
	done
	echo ">> done: $OUT_DIR"
}

restore() {
	LOCAL_URL="${LOCAL_URL:-http://localhost:5984}"
	: "${LOCAL_USER:?}"
	: "${LOCAL_PASS:?}"
	shopt -s nullglob
	files=("$OUT_DIR"/*.couchbackup)
	if [ ${#files[@]} -eq 0 ]; then
		echo "!! no *.couchbackup files in $OUT_DIR" >&2
		exit 1
	fi

	url=$(with_auth "$LOCAL_URL" "$LOCAL_USER" "$LOCAL_PASS")
	for f in "${files[@]}"; do
		db=$(basename "$f" .couchbackup)
		echo ">> restoring $db"
		# couchrestore needs the target db to exist; 412 = already exists (fine)
		code=$(curl -sS -o /dev/null -w '%{http_code}' -u "$LOCAL_USER:$LOCAL_PASS" -X PUT "$LOCAL_URL/$db")
		case "$code" in
		201 | 202 | 412) ;;
		*)
			echo "!! cannot create $db in local (HTTP $code)" >&2
			exit 1
			;;
		esac
		# couchbackup does not store attachment bodies, so docs carrying `_attachments` stubs
		# fail with 412 missing_stub. Strip the stubs: docs restore, files are skipped.
		jq -c 'if type == "array" then map(del(._attachments)) else . end' <"$f" |
			npx -y --package @cloudant/couchbackup couchrestore --url "$url" --db "$db"
	done
	echo ">> done"
}

case "$mode" in
dump) dump ;;
restore) restore ;;
*)
	echo "usage: $0 {dump|restore} [out_dir]" >&2
	exit 2
	;;
esac
