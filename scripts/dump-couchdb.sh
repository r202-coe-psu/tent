#!/usr/bin/env bash
# Dump every non-system CouchDB database from a remote CouchDB (e.g. prod) to files.
# Uses @cloudant/couchbackup (fetched via npx). Dumps are real PII: they default to
# OUT_DIR outside the repo; never commit them. Load them with restore-couchdb-to-local.sh.
#
# Usage:
#   PROD_URL=https://prod-host/couch PROD_USER=readonly PROD_PASS=... \
#     ./scripts/dump-couchdb.sh [out_dir]      # default: ~/couchdb-dumps
#
# Notes:
#   - Skips system dbs (_users, _replicator, ...). _security is NOT included.
#   - Attachment bodies are NOT included (couchbackup does not store them).
#   - Credentials are URL-encoded, so special characters in passwords are safe.
set -euo pipefail

: "${PROD_URL:?}" # e.g. https://prod-host/couch
: "${PROD_USER:?}"
: "${PROD_PASS:?}"
OUT_DIR="${1:-$HOME/couchdb-dumps}"

urlenc() { jq -rn --arg v "$1" '$v | @uri'; }

with_auth() { # <url> <user> <pass>
	local u p
	u=$(urlenc "$2")
	p=$(urlenc "$3")
	echo "${1/\/\//\/\/$u:$p@}"
}

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
