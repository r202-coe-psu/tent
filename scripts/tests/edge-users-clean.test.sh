#!/usr/bin/env bash
# Integration test for edge-users-clean.sh (CR-247: orphans left in edge_users_<code> after a hard delete in
# central _users). Runs against a REAL CouchDB; the copy service is not involved, its docs are hand-written.
#
# Usage: bash scripts/tests/edge-users-clean.test.sh
#
# By default it starts a throwaway `couchdb:3.5` container on a random 127.0.0.1 port (removed on exit) so it
# never touches the dev data under deployment/. To run against an already running CouchDB instead:
#   TEST_COUCHDB_URL=http://localhost:5984 COUCHDB_USER=admin COUCHDB_PASSWORD=password bash scripts/tests/edge-users-clean.test.sh
# (uses throwaway DBs edge_users_zzt01 / edge_users_zzt02 and users ect_a / ect_b / ect_c, removed afterwards)
set -u
here=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$here/../edge-users-clean.sh"

command -v curl >/dev/null || { echo "curl is required"; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 2; }

CONTAINER=""
if [ -n "${TEST_COUCHDB_URL:-}" ]; then
	URL="${TEST_COUCHDB_URL%/}"
	ADMIN="${COUCHDB_USER:?set COUCHDB_USER}"
	APW="${COUCHDB_PASSWORD:?set COUCHDB_PASSWORD}"
else
	command -v docker >/dev/null || { echo "docker is required (or set TEST_COUCHDB_URL)"; exit 2; }
	ADMIN=admin
	APW="testpw-$RANDOM$RANDOM"
	PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
	CONTAINER="edge-users-clean-test-$$"
	docker run -d --rm --name "$CONTAINER" -e COUCHDB_USER="$ADMIN" -e COUCHDB_PASSWORD="$APW" \
		-p "127.0.0.1:$PORT:5984" couchdb:3.5 >/dev/null || { echo "cannot start couchdb container"; exit 2; }
	URL="http://127.0.0.1:$PORT"
fi
export COUCHDB_USER="$ADMIN" COUCHDB_PASSWORD="$APW"
A="$ADMIN:$APW"

adm() { curl -sS -u "$A" -H 'Content-Type: application/json' "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
jget() { python3 -c 'import sys,json
d=json.load(sys.stdin)
for k in sys.argv[1].split("."):
    d=d.get(k) if isinstance(d,dict) else None
print(json.dumps(d,sort_keys=True) if isinstance(d,(dict,list)) else ("" if d is None else d))' "$1"; }

cleanup() {
	if [ -n "$CONTAINER" ]; then
		docker rm -f "$CONTAINER" >/dev/null 2>&1
	else
		for d in edge_users_zzt01 edge_users_zzt02; do adm -X DELETE "$URL/$d" >/dev/null 2>&1; done
		for u in ect_a ect_b ect_c; do
			rev=$(adm "$URL/_users/org.couchdb.user:$u" | jget _rev)
			[ -z "$rev" ] || adm -X DELETE "$URL/_users/org.couchdb.user:$u?rev=$rev" >/dev/null
		done
	fi
}
trap cleanup EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', want '$3')"; fi; }
has() { case "$2" in *"$3"*) pass "$1" ;; *) fail "$1 (missing '$3' in: $2)" ;; esac; }
hasnt() { case "$2" in *"$3"*) fail "$1 (unexpected '$3' in: $2)" ;; *) pass "$1" ;; esac; }
retry() { # retry <seconds> <cmd...> — run until it succeeds
	local n=$1 i
	shift
	for i in $(seq 1 "$n"); do "$@" && return 0; sleep 1; done
	return 1
}
run() { out=$(bash "$SCRIPT" "$@" --url "$URL" 2>&1); rc=$?; }

echo "== waiting for CouchDB at $URL"
up() { [ "$(code -u "$A" "$URL/_up")" = 200 ]; }
retry 90 up || { echo "CouchDB did not come up"; exit 2; }
if [ -n "$CONTAINER" ]; then
	adm -X POST "$URL/_cluster_setup" -d "{\"action\":\"enable_single_node\",\"bind_address\":\"0.0.0.0\",\"username\":\"$ADMIN\",\"password\":\"$APW\",\"port\":5984,\"singlenode\":true}" >/dev/null
fi
adm -X PUT "$URL/_users" >/dev/null

echo "== fixture: 3 users, edge_users_zzt01 + edge_users_zzt02 with copies and _design/readonly"
vdu='function(newDoc, oldDoc, userCtx) { if (userCtx.roles.indexOf("_admin") === -1) { throw({forbidden: "read-only copy of _users"}); } }'
for u in ect_a ect_b ect_c; do
	adm -X PUT "$URL/_users/org.couchdb.user:$u" -d "{\"name\":\"$u\",\"password\":\"x\",\"type\":\"user\",\"roles\":[]}" >/dev/null
done
for d in edge_users_zzt01 edge_users_zzt02; do
	adm -X PUT "$URL/$d" >/dev/null
	python3 -c 'import json,sys;print(json.dumps({"validate_doc_update":sys.argv[1]}))' "$vdu" | adm -X PUT "$URL/$d/_design/readonly" -d @- >/dev/null
	for u in ect_a ect_b ect_c; do
		adm -X PUT "$URL/$d/org.couchdb.user:$u" -d "{\"name\":\"$u\",\"type\":\"user\",\"roles\":[]}" >/dev/null
	done
done
exists() { code -u "$A" "$URL/$1"; } # exists <path> -> HTTP status

# hard-delete ect_b from central _users
rev=$(adm "$URL/_users/org.couchdb.user:ect_b" | jget _rev)
adm -X DELETE "$URL/_users/org.couchdb.user:ect_b?rev=$rev" >/dev/null
eq "ect_b is gone from central" "$(exists _users/org.couchdb.user:ect_b)" 404

echo "== dry-run lists exactly the orphan in both DBs and deletes nothing"
run
eq "dry-run exits 0" "$rc" 0
has "orphan in edge_users_zzt01" "$out" "edge_users_zzt01 org.couchdb.user:ect_b"
has "orphan in edge_users_zzt02" "$out" "edge_users_zzt02 org.couchdb.user:ect_b"
eq "exactly 2 orphan lines" "$(printf '%s\n' "$out" | grep -c '^edge_users_zzt0[12] ')" 2
hasnt "live user ect_a not listed" "$out" "ect_a"
hasnt "design doc not listed" "$out" "_design"
has "summary says 2 orphans" "$out" "orphans found: 2"
eq "dry-run kept the orphan (zzt01)" "$(exists edge_users_zzt01/org.couchdb.user:ect_b)" 200
eq "dry-run kept the orphan (zzt02)" "$(exists edge_users_zzt02/org.couchdb.user:ect_b)" 200

echo "== shelter-code restriction only touches that DB"
run ZZT01
eq "restricted dry-run exits 0" "$rc" 0
has "lists zzt01 orphan" "$out" "edge_users_zzt01 org.couchdb.user:ect_b"
hasnt "does not list zzt02" "$out" "edge_users_zzt02 "
run ZZT01 --apply
eq "restricted apply exits 0" "$rc" 0
eq "zzt01 orphan deleted" "$(exists edge_users_zzt01/org.couchdb.user:ect_b)" 404
eq "zzt02 orphan untouched" "$(exists edge_users_zzt02/org.couchdb.user:ect_b)" 200
run ZZT09
[ "$rc" != 0 ] && pass "unknown shelter DB: exit != 0" || fail "unknown shelter DB exited 0"
has "names the missing DB" "$out" "edge_users_zzt09"

echo "== --apply removes the orphan, keeps the others and _design/readonly"
run --apply
eq "apply exits 0" "$rc" 0
has "reports the orphan" "$out" "edge_users_zzt02 org.couchdb.user:ect_b"
has "notes edge servers pick it up on next pull" "$out" "next pull"
eq "orphan gone from zzt02" "$(exists edge_users_zzt02/org.couchdb.user:ect_b)" 404
for d in edge_users_zzt01 edge_users_zzt02; do
	eq "$d keeps ect_a" "$(exists $d/org.couchdb.user:ect_a)" 200
	eq "$d keeps ect_c" "$(exists $d/org.couchdb.user:ect_c)" 200
	eq "$d keeps _design/readonly" "$(exists $d/_design/readonly)" 200
	eq "$d _design/readonly unchanged" "$(adm "$URL/$d/_design/readonly" | jget validate_doc_update)" "$vdu"
done

echo "== second run reports 0 orphans"
run --apply
eq "rerun exits 0" "$rc" 0
has "0 orphans" "$out" "orphans found: 0"

echo "== empty central _users is refused without --allow-empty"
for u in ect_a ect_c; do
	rev=$(adm "$URL/_users/org.couchdb.user:$u" | jget _rev)
	adm -X DELETE "$URL/_users/org.couchdb.user:$u?rev=$rev" >/dev/null
done
# a non-container run may hold other users; only the container case has a truly empty _users
if [ "$(adm "$URL/_users/_all_docs" | python3 -c 'import sys,json;print(len([r for r in json.load(sys.stdin)["rows"] if not r["id"].startswith("_design/")]))')" = 0 ]; then
	run --apply
	[ "$rc" != 0 ] && pass "empty central set: exit != 0" || fail "empty central set accepted"
	has "explains the refusal" "$out" "Refusing"
	eq "nothing deleted (ect_a still in zzt01)" "$(exists edge_users_zzt01/org.couchdb.user:ect_a)" 200
	run --allow-empty
	eq "--allow-empty dry-run exits 0" "$rc" 0
	has "--allow-empty lists the now-orphaned docs" "$out" "edge_users_zzt01 org.couchdb.user:ect_a"
	eq "--allow-empty dry-run deleted nothing" "$(exists edge_users_zzt01/org.couchdb.user:ect_a)" 200
	run --allow-empty --apply
	eq "--allow-empty --apply exits 0" "$rc" 0
	eq "ect_a deleted with --allow-empty" "$(exists edge_users_zzt01/org.couchdb.user:ect_a)" 404
	eq "_design/readonly still kept" "$(exists edge_users_zzt01/_design/readonly)" 200
else
	echo "  skip _users is not empty on this server (shared instance): empty-set case only runs in the container"
fi

echo
if [ "$fails" = 0 ]; then echo PASS; else echo "FAILED: $fails check(s)"; exit 1; fi
