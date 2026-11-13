#!/usr/bin/env bash
# Integration test for central-repl-user.sh (CR #1298 FR-1..FR-4, FR-8, FR-10, FR-12, FR-13)
# The copy itself is the separate edge-users-copy service (worker/tests covers it); here its docs are hand-written. against a REAL CouchDB.
#
# Usage: bash scripts/tests/central-repl-user.test.sh
#
# By default it starts a throwaway `couchdb:3.5` container on a random 127.0.0.1 port (removed on exit) so it
# never touches the dev data under deployment/. To run against an already running CouchDB instead:
#   TEST_COUCHDB_URL=http://localhost:5984 COUCHDB_USER=admin COUCHDB_PASSWORD=password bash scripts/tests/central-repl-user.test.sh
# (uses throwaway shelter codes ZZT01 / ZZT02 / ZZT03 and removes everything it created)
set -u
here=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$here/../central-repl-user.sh"

command -v curl >/dev/null || { echo "curl is required"; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 2; }

CONTAINER=""
CREATED_DBS=()
if [ -n "${TEST_COUCHDB_URL:-}" ]; then
	URL="${TEST_COUCHDB_URL%/}"
	ADMIN="${COUCHDB_USER:?set COUCHDB_USER}"
	APW="${COUCHDB_PASSWORD:?set COUCHDB_PASSWORD}"
else
	command -v docker >/dev/null || { echo "docker is required (or set TEST_COUCHDB_URL)"; exit 2; }
	ADMIN=admin
	APW="testpw-$RANDOM$RANDOM"
	PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
	CONTAINER="central-repl-user-test-$$"
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
		for c in ZZT01 ZZT02 ZZT03; do bash "$SCRIPT" "$c" --remove --url "$URL" >/dev/null 2>&1; done
		for d in "${CREATED_DBS[@]}" edge_users_zzt98 edge_users_zzt99; do adm -X DELETE "$URL/$d" >/dev/null 2>&1; done
		for u in staff_a staff_b staff_c; do
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
for d in _users _replicator; do adm -X PUT "$URL/$d" >/dev/null; done

echo "== fixture: registry / catalog / shelter DBs, shelter staff"
mkdb() { # mkdb <db> — create if missing, remember it so a non-container run cleans it
	if [ "$(code -u "$A" "$URL/$1")" = 404 ]; then
		adm -X PUT "$URL/$1" >/dev/null
		CREATED_DBS+=("$1")
	fi
}
for d in registry catalog shelter_zzt01 shelter_zzt02 shelter_zzt03; do mkdb "$d"; done
adm -X PUT "$URL/shelter_zzt01/_security" -d '{"members":{"roles":["shelter:ZZT01","public_writer"]},"admins":{"roles":["system_admin"]}}' >/dev/null
adm -X PUT "$URL/shelter_zzt02/_security" -d '{"members":{"roles":["shelter:ZZT02"]},"admins":{"roles":["system_admin"]}}' >/dev/null
adm -X PUT "$URL/shelter_zzt02/seed" -d '{"secret":"zzt02 data"}' >/dev/null
adm -X PUT "$URL/_users/org.couchdb.user:staff_a" -d '{"name":"staff_a","password":"x","type":"user","roles":["shelter:ZZT01"]}' >/dev/null
adm -X PUT "$URL/_users/org.couchdb.user:staff_b" -d '{"name":"staff_b","password":"x","type":"user","roles":[],"edge_shelters":["ZZT01"]}' >/dev/null
adm -X PUT "$URL/_users/org.couchdb.user:staff_c" -d '{"name":"staff_c","password":"x","type":"user","roles":["shelter:ZZT02"]}' >/dev/null

echo "== create ZZT01 (FR-1, FR-2, FR-3, FR-8, FR-10)"
run ZZT01
eq "create exits 0" "$rc" 0
USER1=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_USER=//p')
PW1=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_PASSWORD=//p')
[[ "$USER1" =~ ^repl_zzt01_[0-9a-f]{8}$ ]] && pass "username repl_zzt01_<8 hex> ($USER1)" || fail "username shape: '$USER1'"
[[ "$PW1" =~ ^[0-9a-f]{32}$ ]] && pass "password is 32 hex chars" || fail "password shape: '$PW1'"
has "tells operator EDGE_REPL_USER/EDGE_REPL_PASSWORD" "$out" "EDGE_REPL_PASSWORD="
udoc=$(adm "$URL/_users/org.couchdb.user:$USER1")
eq "user doc name" "$(printf '%s' "$udoc" | jget name)" "$USER1"
eq "user doc type" "$(printf '%s' "$udoc" | jget type)" user
eq "user doc roles exactly [repl:ZZT01]" "$(printf '%s' "$udoc" | jget roles)" '["repl:ZZT01"]'
eq "user doc has no edge_shelters" "$(printf '%s' "$udoc" | jget edge_shelters)" ""
for d in registry catalog shelter_zzt01; do
	has "role repl:ZZT01 in $d members" "$(adm "$URL/$d/_security" | jget members.roles)" 'repl:ZZT01'
done
has "existing member public_writer survives in shelter_zzt01" "$(adm "$URL/shelter_zzt01/_security" | jget members.roles)" 'public_writer'
hasnt "role not added to shelter_zzt02" "$(adm "$URL/shelter_zzt02/_security")" 'repl:ZZT01'
eq "edge_users_zzt01 _security exact" "$(adm "$URL/edge_users_zzt01/_security" | python3 -c 'import sys,json;print(json.dumps(json.load(sys.stdin),sort_keys=True))')" \
	'{"admins": {"names": [], "roles": []}, "members": {"names": [], "roles": ["repl:ZZT01"]}}'
vdu=$(adm "$URL/edge_users_zzt01/_design/readonly" | jget validate_doc_update)
has "_design/readonly VDU checks _admin" "$vdu" '_admin'
eq "no _replicator job created" "$(code -u "$A" "$URL/_replicator/edge_users_zzt01")" 404
has "verification ran: write probe 403" "$out" "edge_users_zzt01/verify_probe -> 403"

echo "== repl user is read-only on its edge_users DB (docs hand-written as the copy service would)"
adm -X PUT "$URL/edge_users_zzt01/org.couchdb.user:staff_a" -d '{"name":"staff_a","type":"user","roles":["shelter:ZZT01"]}' >/dev/null
R="$USER1:$PW1"
eq "repl reads edge_users_zzt01" "$(code -u "$R" "$URL/edge_users_zzt01")" 200
eq "repl reads copied user doc" "$(code -u "$R" "$URL/edge_users_zzt01/org.couchdb.user:staff_a")" 200
eq "repl writes edge_users_zzt01 -> 403" "$(code -u "$R" -X PUT -H 'Content-Type: application/json' -d '{}' "$URL/edge_users_zzt01/x")" 403
eq "repl reads _users -> 403" "$(code -u "$R" "$URL/_users")" 403
eq "repl reads shelter_zzt01" "$(code -u "$R" "$URL/shelter_zzt01")" 200

echo "== create ZZT02: ZZT01's account cannot see ZZT02"
run ZZT02
eq "create ZZT02 exits 0" "$rc" 0
USER2=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_USER=//p')
PW2=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_PASSWORD=//p')
[ "$USER1" != "$USER2" ] && pass "distinct accounts per shelter" || fail "same username for both shelters"
for p in shelter_zzt02 shelter_zzt02/seed edge_users_zzt02 edge_users_zzt02/_all_docs; do
	c=$(code -u "$USER1:$PW1" "$URL/$p")
	[ "$c" = 401 ] || [ "$c" = 403 ] && pass "ZZT01 account on $p -> $c" || fail "ZZT01 account on $p -> $c (want 401/403)"
done
c=$(code -u "$USER2:$PW2" "$URL/edge_users_zzt01")
[ "$c" = 401 ] || [ "$c" = 403 ] && pass "ZZT02 account on edge_users_zzt01 -> $c" || fail "ZZT02 account on edge_users_zzt01 -> $c"

echo "== rerun is idempotent (FR-2)"
run ZZT01
eq "rerun exits 0" "$rc" 0
has "says password unchanged" "$out" "already exists"
hasnt "does not print a password" "$out" "EDGE_REPL_PASSWORD"
eq "old password still works" "$(code -u "$R" "$URL/edge_users_zzt01")" 200
eq "still exactly one account" "$(adm -G "$URL/_users/_all_docs" --data-urlencode 'startkey="org.couchdb.user:repl_zzt01_"' --data-urlencode 'endkey="org.couchdb.user:repl_zzt01_\ufff0"' | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["rows"]))')" 1

echo "== --rotate"
run ZZT01 --rotate
eq "rotate exits 0" "$rc" 0
has "says rotated" "$out" "rotated password for $USER1"
PW1B=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_PASSWORD=//p')
USER1B=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_USER=//p')
eq "same username after rotate" "$USER1B" "$USER1"
[ -n "$PW1B" ] && [ "$PW1B" != "$PW1" ] && pass "new password differs" || fail "rotate did not change password"
old_rejected() { [ "$(code -u "$USER1:$PW1" "$URL/edge_users_zzt01")" = 401 ]; }
retry 30 old_rejected && pass "old password rejected (401)" || fail "old password still accepted"
eq "new password works" "$(code -u "$USER1:$PW1B" "$URL/edge_users_zzt01")" 200

echo "== --status (FR-13), copy-service docs hand-written"
CK="$URL/_users/_local/edge_users_copy"
put_ckpt() { # put_ckpt <last_seq> <last_error json|null> <age seconds> — replaces the hand-written checkpoint
	local rev body
	rev=$(adm "$CK" | jget _rev)
	body=$(python3 -c '
import sys, json, datetime
seq, err, age, rev = sys.argv[1:5]
d = {"last_seq": seq, "last_error": json.loads(err), "updated_at": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=int(age))).strftime("%Y-%m-%dT%H:%M:%SZ")}
if rev:
    d["_rev"] = rev
print(json.dumps(d))' "$1" "$2" "$3" "$rev")
	adm -X PUT "$CK" -d "$body" >/dev/null
}
us_seq() { adm "$URL/_users" | jget update_seq; }

run ZZT01 --status
[ "$rc" != 0 ] && pass "no checkpoint doc: exit != 0" || fail "status exit 0 without _local/edge_users_copy"
has "no checkpoint reported" "$out" "ไม่พบ checkpoint"
has "no edge yet" "$out" "edge ยังไม่เคยต่อเข้ามา"
has "backfill pending shown" "$out" "backfill edge_users_zzt01: ยังไม่เสร็จ"

put_ckpt "$(us_seq)" null 5
adm -X PUT "$URL/edge_users_zzt01/_local/backfill_done" -d '{"done_at":"2026-11-11T00:00:00Z"}' >/dev/null
run ZZT01 --status
eq "caught up, no error: exit 0" "$rc" 0
has "shows last_seq vs update_seq" "$out" "ทันแล้ว"
has "backfill done shown" "$out" "backfill edge_users_zzt01: เสร็จแล้ว"
has "still no edge" "$out" "edge ยังไม่เคยต่อเข้ามา"

# a checkpoint doc the way CouchDB's replicator writes it on the SOURCE db (_local/<replication id>)
adm -X PUT "$URL/edge_users_zzt01/_local/abc123def" -d '{"history":[{"end_time":"Wed, 11 Nov 2026 10:00:00 GMT","session_id":"x"}],"replication_id_version":4}' >/dev/null
run ZZT01 --status
eq "with edge checkpoint: exit 0" "$rc" 0
has "shows edge last pull time" "$out" "edge ดึงข้อมูลล่าสุดเมื่อ: Wed, 11 Nov 2026 10:00:00 GMT"
hasnt "backfill_done is not taken as an edge checkpoint" "$out" "edge ยังไม่เคยต่อเข้ามา"

put_ckpt "$(us_seq)" '"boom: 401 from _users"' 5
run ZZT01 --status
[ "$rc" != 0 ] && pass "last_error set: exit != 0" || fail "status exit 0 with last_error"
has "last_error shown" "$out" "boom: 401"

put_ckpt "0-g1AAAA" null 600
run ZZT01 --status
[ "$rc" != 0 ] && pass "behind _users and updated_at > 5 min: exit != 0" || fail "status exit 0 although the service lags > 5 min"
has "lag reported" "$out" "ตามหลัง"
put_ckpt "0-g1AAAA" null 30
run ZZT01 --status
eq "behind but updated 30 s ago: exit 0" "$rc" 0
put_ckpt "$(us_seq)" null 600
run ZZT01 --status
eq "idle service (caught up, old updated_at): exit 0" "$rc" 0

run ZZT03 --status
[ "$rc" != 0 ] && pass "status of a shelter without edge_users DB exits non-zero" || fail "status of missing DB exited 0"
has "missing DB reported" "$out" "edge_users_zzt03"

echo "== broken edge_users_* _security stops every action (FR-12)"
adm -X PUT "$URL/edge_users_zzt99" >/dev/null
adm -X PUT "$URL/edge_users_zzt99/_security" -d '{}' >/dev/null # members empty = public
run ZZT01
[ "$rc" != 0 ] && pass "create dies on public edge_users_zzt99" || fail "create succeeded with public edge_users DB"
has "message names the DB" "$out" "edge_users_zzt99"
has "message says PUBLIC" "$out" "PUBLIC"
run ZZT01 --status
[ "$rc" != 0 ] && has "status dies too" "$out" "edge_users_zzt99" || fail "status ignored public edge_users DB"
run ZZT01 --rotate
[ "$rc" != 0 ] && pass "rotate dies too" || fail "rotate ignored public edge_users DB"
adm -X PUT "$URL/edge_users_zzt99/_security" -d '{"members":{"names":["bob"],"roles":["repl:ZZT99"]}}' >/dev/null
run ZZT01
[ "$rc" != 0 ] && has "members.names non-empty dies" "$out" "names" || fail "create ignored members.names"
adm -X PUT "$URL/edge_users_zzt99/_security" -d '{"members":{"names":[],"roles":["repl:ZZT99","other"]}}' >/dev/null
run ZZT01
[ "$rc" != 0 ] && pass "extra role dies" || fail "create ignored extra role"
adm -X PUT "$URL/edge_users_zzt99/_security" -d '{"members":{"names":[],"roles":["repl:ZZT01"]}}' >/dev/null
run ZZT01
[ "$rc" != 0 ] && pass "wrong shelter role for the DB dies" || fail "create ignored mismatching role"
adm -X PUT "$URL/edge_users_zzt98" >/dev/null
adm -X PUT "$URL/edge_users_zzt99/_security" -d '{"members":{"names":[],"roles":["repl:ZZT99"]}}' >/dev/null
adm -X PUT "$URL/edge_users_zzt98/_security" -d '{"members":{"names":[],"roles":["repl:ZZT98"]}}' >/dev/null
run ZZT01
eq "correct edge_users_* DBs of other shelters do not block" "$rc" 0
adm -X PUT "$URL/edge_users_zzt98/_security" -d '{"members":{"names":[],"roles":[]}}' >/dev/null
run ZZT01 --remove
[ "$rc" != 0 ] && has "remove still reports the unsafe DB (after removal)" "$out" "edge_users_zzt98" || fail "remove ignored public edge_users DB"
has "remove had already done its work" "$out" "removed database edge_users_zzt01"
eq "edge_users_zzt01 is gone" "$(code -u "$A" "$URL/edge_users_zzt01")" 404
adm -X DELETE "$URL/edge_users_zzt98" >/dev/null
adm -X DELETE "$URL/edge_users_zzt99" >/dev/null
run ZZT01
eq "create works again after cleanup" "$rc" 0
adm -X PUT "$URL/edge_users_zzt01/org.couchdb.user:staff_a" -d '{"name":"staff_a","type":"user","roles":["shelter:ZZT01"]}' >/dev/null
USER1=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_USER=//p')

echo "== existing legacy / duplicate accounts (FR-2)"
adm -X PUT "$URL/_users/org.couchdb.user:repl_zzt02" -d '{"name":"repl_zzt02","password":"legacy","type":"user","roles":["repl:ZZT02"]}' >/dev/null
run ZZT02
[ "$rc" != 0 ] && pass "create dies with legacy repl_zzt02 present" || fail "create ignored legacy account"
has "tells operator to --remove first" "$out" "--remove"
adm -X PUT "$URL/_users/org.couchdb.user:repl_zzt01_deadbeef" -d '{"name":"repl_zzt01_deadbeef","password":"dup","type":"user","roles":["repl:ZZT01"]}' >/dev/null
run ZZT01
[ "$rc" != 0 ] && pass "create dies with two suffixed accounts" || fail "create ignored duplicate account"
has "duplicate message" "$out" "more than one"
adm -X PUT "$URL/_users/org.couchdb.user:repl_zzt011_aaaaaaaa" -d '{"name":"repl_zzt011_aaaaaaaa","password":"other","type":"user","roles":["repl:ZZT011"]}' >/dev/null
adm -X DELETE "$URL/_users/org.couchdb.user:repl_zzt01_deadbeef?rev=$(adm "$URL/_users/org.couchdb.user:repl_zzt01_deadbeef" | jget _rev)" >/dev/null
run ZZT01
eq "another shelter's repl_<code>1_* account is not counted" "$rc" 0
adm -X DELETE "$URL/_users/org.couchdb.user:repl_zzt011_aaaaaaaa?rev=$(adm "$URL/_users/org.couchdb.user:repl_zzt011_aaaaaaaa" | jget _rev)" >/dev/null

echo "== --remove ZZT02 (FR-4): legacy + suffixed account, role, job, DB; ZZT01 untouched"
# a leftover pre-CR-247 copy job
adm -X PUT "$URL/_replicator/edge_users_zzt02" -d '{"source":"http://127.0.0.1:1/_users","target":"http://127.0.0.1:1/edge_users_zzt02"}' >/dev/null
eq "old job doc present before remove" "$(code -u "$A" "$URL/_replicator/edge_users_zzt02")" 200
adm -X PUT "$URL/edge_users_zzt02/org.couchdb.user:staff_c" -d '{"name":"staff_c","type":"user","roles":["shelter:ZZT02"]}' >/dev/null
run ZZT02 --remove
eq "remove exits 0" "$rc" 0
has "removed suffixed account" "$out" "removed user $USER2"
has "removed legacy account" "$out" "removed legacy user repl_zzt02"
has "removed old _replicator job" "$out" "removed old _replicator/edge_users_zzt02"
has "removed DB" "$out" "removed database edge_users_zzt02"
eq "suffixed account gone" "$(code -u "$A" "$URL/_users/org.couchdb.user:$USER2")" 404
eq "legacy account gone" "$(code -u "$A" "$URL/_users/org.couchdb.user:repl_zzt02")" 404
eq "old job gone" "$(code -u "$A" "$URL/_replicator/edge_users_zzt02")" 404
eq "edge_users_zzt02 dropped entirely (not a DB with empty members)" "$(code -u "$A" "$URL/edge_users_zzt02")" 404
for d in registry catalog shelter_zzt02; do
	hasnt "role repl:ZZT02 out of $d" "$(adm "$URL/$d/_security")" 'repl:ZZT02'
done
has "ZZT01 role still in registry" "$(adm "$URL/registry/_security")" 'repl:ZZT01'
eq "ZZT01 account still there" "$(code -u "$A" "$URL/_users/org.couchdb.user:$USER1")" 200
eq "ZZT01 edge_users DB still there" "$(code -u "$A" "$URL/edge_users_zzt01")" 200
eq "ZZT01 copied doc still there" "$(code -u "$A" "$URL/edge_users_zzt01/org.couchdb.user:staff_a")" 200
has "other members of shelter_zzt02 survive" "$(adm "$URL/shelter_zzt02/_security" | jget members.roles)" 'shelter:ZZT02'
run ZZT02 --remove
eq "second remove is idempotent (exit 0)" "$rc" 0
has "second remove says nothing to delete" "$out" "nothing to delete"

echo "== --remove ZZT01"
run ZZT01 --remove
eq "remove ZZT01 exits 0" "$rc" 0
eq "ZZT01 account gone" "$(code -u "$A" "$URL/_users/org.couchdb.user:$USER1")" 404
eq "edge_users_zzt01 gone" "$(code -u "$A" "$URL/edge_users_zzt01")" 404
hasnt "no repl role left in registry" "$(adm "$URL/registry/_security")" 'repl:'
has "public_writer kept in shelter_zzt01" "$(adm "$URL/shelter_zzt01/_security" | jget members.roles)" 'public_writer'

echo
if [ "$fails" = 0 ]; then echo PASS; else echo "FAILED: $fails check(s)"; exit 1; fi
