#!/usr/bin/env bash
# Remove orphaned user docs from the per-shelter edge_users_<code> databases on the central CouchDB (CR-247).
#
# The central service `edge-users-copy` (worker/) copies `_users` docs into edge_users_<code>. When a user is
# HARD-deleted from central `_users` (the tombstone has no roles) the copy is never removed, so the doc and its
# password hash linger in every edge_users_* DB. The app itself soft-deletes (deleted_at set, doc kept), so only
# direct CouchDB deletes cause orphans. This script reconciles: an orphan is a doc id in edge_users_<code> that
# is not a live doc id of central `_users`.
#
#   scripts/edge-users-clean.sh                 # dry-run, all edge_users_* DBs: print "<db> <id>" per orphan
#   scripts/edge-users-clean.sh SH001 SH002     # dry-run, only edge_users_sh001 and edge_users_sh002
#   scripts/edge-users-clean.sh --apply         # delete the orphans (_bulk_docs, batches of 100)
#
# Safety:
#   - Dry-run is the default; nothing is written without --apply.
#   - The central _users id set is read BEFORE the edge docs are listed, so a user created in between is never
#     taken for an orphan. If that set is empty the script refuses to run (it would delete everything) unless
#     --allow-empty is given.
#   - _design/* docs (e.g. _design/readonly) are never touched; _local/* docs are not returned by _all_docs.
#   - Safe to re-run: a second run finds nothing left to delete. Exit != 0 on any failure.
#
# Edge servers pick the removals up on their next pull of edge_users_<code>.
#
# Admin credentials come from COUCHDB_USER / COUCHDB_PASSWORD (env) or the repo-root .env;
# the target from --url or COUCHDB_URL (default http://localhost:5984).
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: edge-users-clean.sh [SHELTER_CODE...] [--apply] [--allow-empty] [--url URL]

  SHELTER_CODE   restrict to edge_users_<code> of these shelters (default: every edge_users_* DB)
  --apply        delete the orphans (default is a dry-run that only prints "<db> <id>" per orphan)
  --allow-empty  proceed even if central _users has no docs at all (otherwise refused: all docs would be orphans)
  --url URL      CouchDB base URL for this script (default: $COUCHDB_URL or http://localhost:5984)
EOF
}

die() {
	echo "error: $*" >&2
	exit 1
}

URL="${COUCHDB_URL:-http://localhost:5984}"
APPLY=0
ALLOW_EMPTY=0
CODES=()
while [ $# -gt 0 ]; do
	case "$1" in
	--url) URL="${2:?--url needs a value}"; shift 2 ;;
	--apply) APPLY=1; shift ;;
	--allow-empty) ALLOW_EMPTY=1; shift ;;
	-h | --help) usage; exit 0 ;;
	-*) usage >&2; die "unknown option: $1" ;;
	*) CODES+=("$1"); shift ;;
	esac
done
URL="${URL%/}"

for c in ${CODES[@]+"${CODES[@]}"}; do
	[[ "$c" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "invalid shelter code: $c"
done

command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
env_val() { # env_val <KEY> — read from repo-root .env without sourcing it
	[ -f "$ROOT/.env" ] || return 0
	grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true
}
ADMIN_USER="${COUCHDB_USER:-$(env_val COUCHDB_USER)}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PW="${COUCHDB_PASSWORD:-$(env_val COUCHDB_PASSWORD)}"
[ -n "$ADMIN_PW" ] || die "no admin password: set COUCHDB_PASSWORD or put it in $ROOT/.env"

cj() { curl -sS -u "$ADMIN_USER:$ADMIN_PW" -H 'Content-Type: application/json' "$@"; }
code_of() { # code_of <url> [curl args...] — HTTP status only
	local u="$1"
	shift
	curl -s -o /dev/null -w '%{http_code}' "$@" "$u"
}
admin_code() { code_of "$1" -u "$ADMIN_USER:$ADMIN_PW"; }
ok_json() { case "$1" in *'"ok":true'*) return 0 ;; *) return 1 ;; esac; }

[ "$(admin_code "$URL/_up")" = 200 ] || die "cannot reach CouchDB at $URL as $ADMIN_USER (check --url and credentials)"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PAGE=1000

# list_docs <db> — "<id>\t<rev>" per non-design doc, paged by $PAGE (startkey of the last id + skip=1)
list_docs() {
	local db="$1" last="" resp page_out n
	while :; do
		if [ -n "$last" ]; then
			resp=$(cj -G "$URL/$db/_all_docs" --data-urlencode "limit=$PAGE" --data-urlencode "skip=1" \
				--data-urlencode "startkey=$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$last")") || return 1
		else
			resp=$(cj -G "$URL/$db/_all_docs" --data-urlencode "limit=$PAGE") || return 1
		fi
		# page_out: first line = number of rows in the page, then the last id, then the non-design rows
		page_out=$(printf '%s' "$resp" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "rows" not in d:
    sys.exit("unexpected response: " + json.dumps(d))
rows = d["rows"]
print(len(rows))
print(rows[-1]["id"] if rows else "")
for r in rows:
    if not r["id"].startswith("_design/"):
        print(r["id"] + "\t" + r["value"]["rev"])') || return 1
		n=$(printf '%s\n' "$page_out" | sed -n 1p)
		last=$(printf '%s\n' "$page_out" | sed -n 2p)
		printf '%s\n' "$page_out" | tail -n +3
		[ "$n" -ge "$PAGE" ] || break
	done
}

# 1. central _users first, before any edge doc is listed
list_docs _users >"$TMP/central.tsv" || die "reading central _users failed"
cut -f1 "$TMP/central.tsv" >"$TMP/central.ids"
central_n=$(grep -c . "$TMP/central.ids" || true)
if [ "$central_n" = 0 ] && [ "$ALLOW_EMPTY" != 1 ]; then
	die "central _users has no docs: every edge copy would count as an orphan. Refusing; pass --allow-empty if that is really intended"
fi
echo "central _users: $central_n live doc(s)"

# 2. the edge_users_* DBs (same key range as the edge-users-copy worker), optionally restricted to given shelters
all_dbs=$(cj -G "$URL/_all_dbs" --data-urlencode 'start_key="edge_users_"' --data-urlencode 'end_key="edge_users_￰"' |
	python3 -c '
import sys, json
d = json.load(sys.stdin)
if not isinstance(d, list):
    sys.exit("unexpected response: " + json.dumps(d))
for n in d:
    if n.startswith("edge_users_"):
        print(n)') || die "listing databases failed"
dbs=()
if [ ${#CODES[@]} -gt 0 ]; then
	for c in "${CODES[@]}"; do
		db="edge_users_$(printf '%s' "$c" | tr '[:upper:]' '[:lower:]')"
		printf '%s\n' "$all_dbs" | grep -qx "$db" || die "database $db not found on $URL"
		dbs+=("$db")
	done
else
	while IFS= read -r db; do [ -z "$db" ] || dbs+=("$db"); done <<<"$all_dbs"
fi
[ ${#dbs[@]} -gt 0 ] || { echo "no edge_users_* databases found (nothing to do)"; exit 0; }

# delete_orphans <db> <file with "<id>\t<rev>" lines> — _bulk_docs with _deleted:true, 100 per request
delete_orphans() {
	local db="$1" file="$2" payload resp bad=0 deleted=0 res
	while IFS= read -r payload; do
		resp=$(printf '%s' "$payload" | cj -X POST "$URL/$db/_bulk_docs" -d @-) || { echo "  FAIL $db: _bulk_docs request failed" >&2; return 1; }
		res=$(printf '%s' "$resp" | python3 -c '
import sys, json
rows = json.load(sys.stdin)
if not isinstance(rows, list):
    sys.exit("unexpected response: " + json.dumps(rows))
ok = 0
for r in rows:
    if r.get("ok"):
        ok += 1
    else:
        print("  FAIL %s %s: %s %s" % (sys.argv[1], r.get("id"), r.get("error"), r.get("reason")), file=sys.stderr)
print(ok)
sys.exit(0 if ok == len(rows) else 1)' "$db") || bad=1
		deleted=$((deleted + ${res:-0}))
	done < <(python3 -c '
import sys, json
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
for i in range(0, len(rows), 100):
    print(json.dumps({"docs": [{"_id": r[0], "_rev": r[1], "_deleted": True} for r in rows[i:i + 100]]}))' "$file")
	echo "deleted $deleted doc(s) from $db"
	[ "$bad" = 0 ]
}

# 3. find (and with --apply delete) the orphans of each DB
total=0
failed=0
for db in "${dbs[@]}"; do
	list_docs "$db" >"$TMP/edge.tsv" || die "reading $db failed"
	python3 -c '
import sys
central = set(l.rstrip("\n") for l in open(sys.argv[1]))
for l in open(sys.argv[2]):
    l = l.rstrip("\n")
    if l and l.split("\t")[0] not in central:
        print(l)' "$TMP/central.ids" "$TMP/edge.tsv" >"$TMP/orphans.tsv"
	n=$(grep -c . "$TMP/orphans.tsv" || true)
	total=$((total + n))
	cut -f1 "$TMP/orphans.tsv" | while IFS= read -r id; do [ -z "$id" ] || echo "$db $id"; done
	if [ "$APPLY" = 1 ] && [ "$n" -gt 0 ]; then
		delete_orphans "$db" "$TMP/orphans.tsv" || failed=1
	fi
done

echo
if [ "$APPLY" = 1 ]; then
	echo "orphans found: $total in ${#dbs[@]} database(s) (applied)"
	[ "$failed" = 0 ] || die "some deletions failed (see above); re-run to retry"
	echo "Edge servers pick up the removals on their next pull of edge_users_<code>."
else
	echo "orphans found: $total in ${#dbs[@]} database(s) (dry-run, nothing deleted; use --apply to delete)"
fi
