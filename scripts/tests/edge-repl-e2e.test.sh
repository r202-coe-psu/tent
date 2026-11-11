#!/usr/bin/env bash
# End-to-end test of edge <-> central CouchDB replication with the per-shelter replication user
# (CR-247, AC-1..AC-10 + FR-9). Everything runs in THROWAWAY docker containers: one central, one edge
# (plus a second edge for the migration test AC-9) on private docker networks. Never touches the repo's compose
# CouchDB or deployment/ data; everything is removed on exit.
#
# Usage:  bash scripts/tests/edge-repl-e2e.test.sh          (takes ~3 minutes)
#         KEEP=1 bash scripts/tests/edge-repl-e2e.test.sh   (leave containers + network behind for debugging)
#
# Needs: docker (images couchdb:3.5, curlimages/curl), curl, python3, and `pnpm install` done in frontend/
# (tsx generates the REAL validate_doc_update functions of shelter_<code>, registry and catalog).
# AC-9 needs `git show origin/develop:scripts/edge-init.sh` (the pre-#1298 edge-init); skipped when unavailable.
#
# What it builds
#   central  : registry, catalog, shelter_sh001/2/3 with the real VDUs + _security, staff users like user-service,
#              scripts/central-repl-user.sh run for SH001 and SH002
#   edge     : scripts/edge-init.sh (inside curlimages/curl, like docker-compose.edge.yml) for SH001
# Output: PASS/FAIL per acceptance criterion with evidence, a summary table, exit code 1 if anything FAILed.
set -u
here=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$here/../.." && pwd)
CRU="$ROOT/scripts/central-repl-user.sh"
EDGE_INIT="$ROOT/scripts/edge-init.sh"
T0=$(date +%s)

for c in docker curl python3; do command -v "$c" >/dev/null || { echo "$c is required"; exit 2; }; done
TSX="$ROOT/frontend/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "frontend/node_modules/.bin/tsx missing — run 'pnpm install' in frontend/"; exit 2; }

SUF="$$"
NET="edge-e2e-net-$SUF"
NET2="edge-e2e-net2-$SUF"
C_CENTRAL="edge-e2e-central-$SUF"
C_EDGE="edge-e2e-edge-$SUF"
C_EDGE2="edge-e2e-edge2-$SUF"
WORK=$(mktemp -d)
cleanup() {
	if [ "${KEEP:-0}" = 1 ]; then
		echo "KEEP=1: leaving $C_CENTRAL $C_EDGE $C_EDGE2 / networks $NET $NET2 / $WORK (central $CU, edge $EU, edge2 $E2U)"
		return
	fi
	[ -z "${COPY_PID:-}" ] || kill "$COPY_PID" >/dev/null 2>&1
	docker rm -f "$C_CENTRAL" "$C_EDGE" "$C_EDGE2" >/dev/null 2>&1
	docker network rm "$NET" "$NET2" >/dev/null 2>&1
	rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

freeport() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
CPORT=$(freeport); EPORT=$(freeport); E2PORT=$(freeport)
CU="http://127.0.0.1:$CPORT"; EU="http://127.0.0.1:$EPORT"; E2U="http://127.0.0.1:$E2PORT"
CA=centraladmin; CPW="c-$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
EA=edgeadmin; EPW="e-$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
SYNC=http://central:5984

# ------------------------------------------------------------------ helpers
cadm() { curl -sS -u "$CA:$CPW" -H 'Content-Type: application/json' "$@"; }
eadm() { curl -sS -u "$EA:$EPW" -H 'Content-Type: application/json' "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
jget() { python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
for k in sys.argv[1].split("."):
    d=d.get(k) if isinstance(d,dict) else None
print(json.dumps(d,sort_keys=True) if isinstance(d,(dict,list)) else ("" if d is None else d))' "$1"; }
retry() { # retry <seconds> <cmd...>
	local n=$1 i
	shift
	for i in $(seq 1 "$n"); do "$@" && return 0; sleep 1; done
	return 1
}
now_iso() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
ulid() { python3 -c 'import random;print("".join(random.choice("0123456789ABCDEFGHJKMNPQRSTVWXYZ") for _ in range(26)))'; }
bkk_date() { python3 -c 'import sys,datetime as d;print((d.datetime.now(d.timezone(d.timedelta(hours=7)))-d.timedelta(days=int(sys.argv[1]))).strftime("%Y-%m-%d"))' "$1"; }
step() { echo; echo "== $*"; }

fails=0
declare -A AC_ST AC_EV
ORDER=()
ck() { # ck <AC> <PASS|FAIL> <evidence>
	local ac=$1 st=$2 msg=$3
	if [ -z "${AC_ST[$ac]:-}" ]; then ORDER+=("$ac"); AC_ST[$ac]=PASS; fi
	if [ "$st" = SKIP ] && [ "${AC_ST[$ac]}" = PASS ]; then AC_ST[$ac]=SKIP; fi
	if [ "$st" = FAIL ]; then AC_ST[$ac]=FAIL; fails=$((fails + 1)); fi
	AC_EV[$ac]+="${AC_EV[$ac]:+; }$msg"
	echo "  $st $ac: $msg"
}
ck_eq() { if [ "$3" = "$4" ]; then ck "$1" PASS "$2 = $3"; else ck "$1" FAIL "$2 = '$3' (want '$4')"; fi; }
ck_code() { # ck_code <AC> <desc> <got> <allowed regex>
	if [[ "$3" =~ $4 ]]; then ck "$1" PASS "$2 -> $3"; else ck "$1" FAIL "$2 -> $3 (want $4)"; fi
}
ck_ok() { if eval "$3"; then ck "$1" PASS "$2"; else ck "$1" FAIL "$2"; fi; }

# ------------------------------------------------------------------ containers
start_couch() { # start_couch <container> <alias> <network> <host port> <admin> <password> <ini>
	docker run -d --name "$1" --network "$3" --network-alias "$2" -p "127.0.0.1:$4:5984" \
		-e COUCHDB_USER="$5" -e COUCHDB_PASSWORD="$6" -v "$7:/opt/couchdb/etc/local.d/session.ini" \
		couchdb:3.5 >/dev/null || { echo "cannot start $1"; exit 2; }
}
wait_couch() { # wait_couch <url> <admin> <pw> — up + single node setup (creates _users, _replicator, _global_changes)
	up() { [ "$(code -u "$2:$3" "$1/_up")" = 200 ]; }
	retry 90 up "$@" || { echo "CouchDB at $1 did not come up"; exit 2; }
	curl -sS -u "$2:$3" -H 'Content-Type: application/json' -X POST "$1/_cluster_setup" \
		-d "{\"action\":\"enable_single_node\",\"bind_address\":\"0.0.0.0\",\"username\":\"$2\",\"password\":\"$3\",\"port\":5984,\"singlenode\":true}" >/dev/null
}

step "setup: networks, throwaway central + edge CouchDB (couchdb:3.5)"
docker network create "$NET" >/dev/null && docker network create "$NET2" >/dev/null || { echo "cannot create networks"; exit 2; }
cat >"$WORK/central.ini" <<EOF
[chttpd_auth]
timeout = 86400
allow_persistent_cookies = true
secret = central-secret-$SUF
[chttpd]
bind_address = 0.0.0.0
port = 5984
[cluster]
n = 1
EOF
# the edge config of the repo (replicator auth_plugins = couch_replicator_auth_noop etc.) with its own secret
sed 's/^secret = .*/secret = edge-secret-'"$SUF"'/' "$ROOT/couchdb-edge-example.ini" >"$WORK/edge.ini"
start_couch "$C_CENTRAL" central "$NET" "$CPORT" "$CA" "$CPW" "$WORK/central.ini"
docker network connect --alias central "$NET2" "$C_CENTRAL"
start_couch "$C_EDGE" couchdb "$NET" "$EPORT" "$EA" "$EPW" "$WORK/edge.ini"
wait_couch "$CU" "$CA" "$CPW"
wait_couch "$EU" "$EA" "$EPW"
echo "central $CU  edge $EU"

# ------------------------------------------------------------------ central fixture
step "central fixture: real VDUs, _security, staff users"
(cd "$ROOT/frontend" && "$TSX" ../scripts/tests/edge-repl-e2e.gen.ts "$WORK/designs" SH001 SH002 SH003) ||
	{ echo "design generator failed"; exit 2; }
for d in registry catalog shelter_sh001 shelter_sh002 shelter_sh003; do cadm -X PUT "$CU/$d" >/dev/null; done
LEGACY='"shelter_manager","registration_staff","kitchen_staff","warehouse_staff"'
for d in registry catalog; do
	cadm -X PUT "$CU/$d/_security" -d "{\"admins\":{\"roles\":[\"system_admin\"]},\"members\":{\"roles\":[$LEGACY,\"shelter:SH001\",\"shelter:SH002\",\"shelter:SH003\"]}}" >/dev/null
done
for c in SH001 SH002 SH003; do
	cadm -X PUT "$CU/shelter_${c,,}/_security" -d "{\"admins\":{\"roles\":[\"system_admin\"]},\"members\":{\"roles\":[\"shelter:$c\"]}}" >/dev/null
	r=$(cadm -X PUT "$CU/shelter_${c,,}/_design/access" -d @"$WORK/designs/shelter_${c,,}.json")
	case "$r" in *'"ok":true'*) ;; *) echo "VDU deploy shelter_${c,,} failed: $r"; exit 2 ;; esac
done
for f in "registry/_design/app:registry_app" "catalog/_design/access:catalog_access"; do
	r=$(cadm -X PUT "$CU/${f%%:*}" -d @"$WORK/designs/${f##*:}.json")
	case "$r" in *'"ok":true'*) ;; *) echo "VDU deploy ${f%%:*} failed: $r"; exit 2 ;; esac
done
cadm -X PUT "$CU/registry/shelter:01E2ESHELTER00000000000001" -d '{"type":"shelter","code":"SH001","name":"E2E shelter"}' >/dev/null
cadm -X PUT "$CU/catalog/item:e2e-rice" -d '{"type":"item_master","name":"rice"}' >/dev/null
SEED1="evacuee:$(ulid)"; SEED2="evacuee:$(ulid)"
cadm -X PUT "$CU/shelter_sh001/$SEED1" -d '{"type":"evacuee","shelter_code":"SH001","name":"central seed"}' >/dev/null
cadm -X PUT "$CU/shelter_sh002/$SEED2" -d '{"type":"evacuee","shelter_code":"SH002","name":"SH002 secret"}' >/dev/null

mkuser() { # mkuser <name> <password> <roles json> <edge_shelters json> — the shape user-service.createUser writes
	cadm -X PUT "$CU/_users/org.couchdb.user:$1" -d "$(python3 -c '
import json,sys
n,pw,roles,es=sys.argv[1:5]
print(json.dumps({"name":n,"password":pw,"display_name":n,"roles":json.loads(roles),"type":"user","active":True,
  "must_change_password":False,"edge_shelters":json.loads(es),"deleted_at":None,"deleted_by":None}))' "$1" "$2" "$3" "$4")" >/dev/null
}
SPW1="staff-pw-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
SPW1B="staff-pw-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
SPW2="staff-pw-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
SPW3="staff-pw-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
mkuser staff_sh001 "$SPW1" '["SH001:shelter_manager","shelter:SH001"]' '["SH001"]'
mkuser staff2_sh001 "$SPW1B" '["SH001:shelter_manager","shelter:SH001"]' '["SH001"]'
mkuser staff_sh002 "$SPW2" '["SH002:shelter_manager","shelter:SH002"]' '["SH002"]'
mkuser staff_sh003 "$SPW3" '["SH003:shelter_manager","shelter:SH003"]' '["SH003"]'

run_cru() { out=$(COUCHDB_USER=$CA COUCHDB_PASSWORD=$CPW bash "$CRU" "$@" --url "$CU" 2>&1); rc=$?; }
repl_creds() { # sets RU / RP from the last run_cru output
	RU=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_USER=//p')
	RP=$(printf '%s\n' "$out" | sed -n 's/^ *EDGE_REPL_PASSWORD=//p')
}
step "central-repl-user.sh SH001 / SH002"
run_cru SH001; [ "$rc" = 0 ] || { echo "$out"; echo "central-repl-user.sh SH001 failed"; exit 2; }
repl_creds; R1U=$RU; R1P=$RP
run_cru SH002; [ "$rc" = 0 ] || { echo "$out"; echo "central-repl-user.sh SH002 failed"; exit 2; }
repl_creds; R2U=$RU; R2P=$RP
echo "SH001 repl user: $R1U   SH002 repl user: $R2U"

# CR-247: the _users copy into edge_users_<code> is no longer a _replicator job created by central-repl-user.sh;
# it is the central service `edge-users-copy` (worker/). Run the real one against the throwaway central CouchDB
# in the background (it finds edge_users_* every ~30 s, backfills, then follows _users/_changes).
# Needs `uv` on the host; takes only COUCHDB_URL / COUCHDB_USER / COUCHDB_PASSWORD, no CLI flags.
command -v uv >/dev/null || { echo "uv is required to run edge-users-copy"; exit 2; }
COPY_LOG="$WORK/edge-users-copy.log"
COUCHDB_URL="$CU" COUCHDB_USER="$CA" COUCHDB_PASSWORD="$CPW" \
	uv run --project "$ROOT/worker" edge-users-copy >"$COPY_LOG" 2>&1 &
COPY_PID=$!

# ------------------------------------------------------------------ edge-init
run_edge_init() { # run_edge_init <network> <code> <central user> <central password> [script] [var prefix EDGE_REPL|CENTRAL_REPL]
	local prefix=${6:-EDGE_REPL}
	docker run --rm --network "$1" -e COUCHDB_USER="$EA" -e COUCHDB_PASSWORD="$EPW" -e SHELTER_CODE="$2" \
		-e SYNC_URL="$SYNC" -e "${prefix}_USER=$3" -e "${prefix}_PASSWORD=$4" \
		-v "${5:-$EDGE_INIT}:/edge-init.sh:ro" --entrypoint sh curlimages/curl:latest /edge-init.sh 2>&1
}
sched_states() { # sched_states <edge url> — "<job>=<state>" per job
	curl -sS -u "$EA:$EPW" "$1/_scheduler/docs/_replicator" | python3 -c '
import sys,json
for x in json.load(sys.stdin).get("docs",[]):
    if not x["doc_id"].startswith("_design"):
        print(x["doc_id"]+"="+str(x.get("state")))'
}
all_running() { # all_running <edge url> <expected job count>
	local s
	s=$(sched_states "$1")
	[ "$(printf '%s\n' "$s" | grep -c .)" = "$2" ] && ! printf '%s\n' "$s" | grep -qv '=running$'
}
job_field() { # job_field <edge url> <job> <dotted path in scheduler doc>
	curl -sS -u "$EA:$EPW" "$1/_scheduler/docs/_replicator/$2" | jget "$3"
}

step "edge-init.sh for SH001 (inside curlimages/curl, like docker-compose.edge.yml)"
ei=$(run_edge_init "$NET" SH001 "$R1U" "$R1P"); eirc=$?
echo "$ei" | sed 's/^/    /'
[ "$eirc" = 0 ] || { echo "edge-init failed"; exit 2; }
step "wait for the 5 edge jobs to run"
retry 90 all_running "$EU" 5 && echo "all 5 running" || { echo "jobs not all running: $(sched_states "$EU" | tr '\n' ' ')"; }

# ------------------------------------------------------------------ AC-1
step "AC-1: no central admin credentials on the edge"
if grep -rq 'CENTRAL_REPL' "$ROOT/docker-compose.edge.yml" "$ROOT/.env.edge.example" "$ROOT/scripts/edge-init.sh" "$ROOT/scripts/edge-watchdog.sh" 2>/dev/null; then
	ck AC-1 FAIL "CENTRAL_REPL_* still referenced in compose / .env.edge.example / edge scripts"
else
	ck AC-1 PASS "no CENTRAL_REPL_* in docker-compose.edge.yml, .env.edge.example, edge-init.sh, edge-watchdog.sh"
fi
repl_dump=$(eadm "$EU/_replicator/_all_docs?include_docs=true")
printf '%s' "$repl_dump" >"$WORK/edge-replicator.json"
if grep -q "$CPW" "$WORK/edge-replicator.json" || grep -q "\"$CA\"" "$WORK/edge-replicator.json"; then
	ck AC-1 FAIL "central admin name/password found in edge _replicator docs"
else
	ck AC-1 PASS "central admin name/password not found in any edge _replicator doc"
fi
users=$(python3 - "$WORK/edge-replicator.json" "$EA" <<'EOF'
import sys, json
rows = json.load(open(sys.argv[1]))["rows"]
out = set()
for r in rows:
    d = r["doc"]
    if r["id"].startswith("_design"):
        continue
    for side in ("source", "target"):
        u = ((d.get(side) or {}).get("auth") or {}).get("basic", {}).get("username")
        if u and u != sys.argv[2]:
            out.add(u)
print(" ".join(sorted(out)))
EOF
)
n_jobs=$(python3 -c 'import json,sys;print(len([r for r in json.load(open(sys.argv[1]))["rows"] if not r["id"].startswith("_design")]))' "$WORK/edge-replicator.json")
if [ "$users" = "$R1U" ] && [ "$n_jobs" = 5 ]; then
	ck AC-1 PASS "5 jobs; the only non-edge username in them is $R1U"
else
	ck AC-1 FAIL "job count $n_jobs, usernames: '$users' (want only $R1U)"
fi
ck_eq AC-1 "users_sh001_pull source" "$(eadm "$EU/_replicator/users_sh001_pull" | jget source.url)" "http://central:5984/edge_users_sh001"
ck_eq AC-1 "users_sh001_pull selector skips _design/* only" "$(eadm "$EU/_replicator/users_sh001_pull" | jget selector)" '{"_id": {"$not": {"$regex": "^_design/"}}}'

# ------------------------------------------------------------------ AC-2 / AC-3 / AC-4 / FR-9
step "AC-2/3/4 + FR-9: what repl_sh001_* can and cannot do on central"
R1="$R1U:$R1P"
ck_code AC-2 "repl_sh001 GET shelter_sh002" "$(code -u "$R1" "$CU/shelter_sh002")" '^(401|403)$'
ck_code AC-2 "repl_sh001 GET shelter_sh002/_all_docs" "$(code -u "$R1" "$CU/shelter_sh002/_all_docs")" '^(401|403)$'
ck_code AC-2 "repl_sh001 GET _users/_changes" "$(code -u "$R1" "$CU/_users/_changes")" '^(401|403)$'
ck_code AC-2 "repl_sh001 GET _users/_all_docs" "$(code -u "$R1" "$CU/_users/_all_docs")" '^(401|403)$'
ck_code AC-2 "repl_sh001 GET edge_users_sh002" "$(code -u "$R1" "$CU/edge_users_sh002")" '^(401|403)$'
ck_code AC-2 "repl_sh001 GET _replicator/_all_docs (would show the central admin password)" "$(code -u "$R1" "$CU/_replicator/_all_docs")" '^(401|403)$'
ck_code AC-2 "sanity: repl_sh001 GET shelter_sh001" "$(code -u "$R1" "$CU/shelter_sh001")" '^200$'
for p in registry catalog edge_users_sh001; do
	ck_code AC-3 "repl_sh001 PUT $p/x" "$(code -u "$R1" -X PUT -H 'Content-Type: application/json' -d '{}' "$CU/$p/x")" '^403$'
done
ck_code AC-3 "repl_sh001 PUT registry/_design/x (FR-7: also no design docs)" "$(code -u "$R1" -X PUT -H 'Content-Type: application/json' -d '{}' "$CU/registry/_design/x")" '^403$'
ck_code AC-3 "sanity: repl_sh001 GET registry" "$(code -u "$R1" "$CU/registry")" '^200$'
ck_code AC-3 "sanity: repl_sh001 GET catalog" "$(code -u "$R1" "$CU/catalog")" '^200$'
ck_code AC-4 "anonymous GET edge_users_sh001" "$(code "$CU/edge_users_sh001")" '^(401|403)$'
ck_code AC-4 "staff_sh001 GET edge_users_sh001" "$(code -u "staff_sh001:$SPW1" "$CU/edge_users_sh001")" '^(401|403)$'
ck_code AC-4 "staff_sh001 GET edge_users_sh001/_all_docs" "$(code -u "staff_sh001:$SPW1" "$CU/edge_users_sh001/_all_docs")" '^(401|403)$'
ck_code AC-4 "repl_sh002 GET edge_users_sh001" "$(code -u "$R2U:$R2P" "$CU/edge_users_sh001")" '^(401|403)$'
# FR-9
ck_code FR-9 "repl_sh001 PUT central shelter_sh001/_design/x" "$(code -u "$R1" -X PUT -H 'Content-Type: application/json' -d '{"views":{}}' "$CU/shelter_sh001/_design/x")" '^403$'
ACC_REV=$(cadm "$CU/shelter_sh001/_design/access" | jget _rev)
ck_code FR-9 "repl_sh001 PUT central shelter_sh001/_design/access?rev=$ACC_REV (overwrite the VDU)" "$(code -u "$R1" -X PUT -H 'Content-Type: application/json' -d '{"validate_doc_update":"function(){}"}' "$CU/shelter_sh001/_design/access?rev=$ACC_REV")" '^403$'
ck_code FR-9 "repl_sh001 DELETE central shelter_sh001/_design/access?rev=$ACC_REV" "$(code -u "$R1" -X DELETE "$CU/shelter_sh001/_design/access?rev=$ACC_REV")" '^403$'
ck_code FR-9 "repl_sh001 PUT central shelter_sh002/_design/x" "$(code -u "$R1" -X PUT -H 'Content-Type: application/json' -d '{"views":{}}' "$CU/shelter_sh002/_design/x")" '^(401|403)$'
# a _design doc created at the edge must not land on central: not via the job (selector) ...
eadm -X PUT "$EU/shelter_sh001/_design/evil" -d '{"views":{},"validate_doc_update":"function(n,o,u){}"}' >/dev/null
# ... and not via a push that has no selector (VDU/_security of central refuse it)
rep=$(eadm -X POST "$EU/_replicate" -d "{\"source\":{\"url\":\"http://127.0.0.1:5984/shelter_sh001\",\"auth\":{\"basic\":{\"username\":\"$EA\",\"password\":\"$EPW\"}}},\"target\":{\"url\":\"http://central:5984/shelter_sh001\",\"auth\":{\"basic\":{\"username\":\"$R1U\",\"password\":\"$R1P\"}}},\"doc_ids\":[\"_design/evil\"]}")
wf=$(printf '%s' "$rep" | python3 -c 'import sys,json;d=json.load(sys.stdin);h=(d.get("history") or [{}])[0];print(h.get("doc_write_failures","?"), h.get("docs_written","?"))')
ck_eq FR-9 "forced push of _design/evil as repl_sh001: doc_write_failures docs_written" "$wf" "1 0"
sleep 12 # long enough for the continuous push job (which filters _design/*) to have acted
ck_code FR-9 "central shelter_sh001/_design/evil after push" "$(code -u "$CA:$CPW" "$CU/shelter_sh001/_design/evil")" '^404$'
rev=$(eadm "$EU/shelter_sh001/_design/evil" | jget _rev)
[ -z "$rev" ] || eadm -X DELETE "$EU/shelter_sh001/_design/evil?rev=$rev" >/dev/null

# ------------------------------------------------------------------ AC-10
step "AC-10: edge-init refuses a central admin / another shelter's credential (FR-16)"
o=$(run_edge_init "$NET" SH001 "$CA" "$CPW"); rc=$?
echo "$o" | grep -E 'FAILED|ok ' | sed 's/^/    /'
if [ "$rc" != 0 ] && echo "$o" | grep -q 'FAILED' && echo "$o" | grep -q '_admin'; then
	ck AC-10 PASS "edge-init with the central admin: exit $rc, FAILED (EDGE_REPL_USER has role _admin)"
else
	ck AC-10 FAIL "edge-init with the central admin: exit $rc: $(echo "$o" | tail -3)"
fi
o=$(run_edge_init "$NET" SH001 "$R2U" "$R2P"); rc=$?
if [ "$rc" != 0 ] && echo "$o" | grep -q 'FAILED' && echo "$o" | grep -q 'repl:SH001'; then
	ck AC-10 PASS "edge-init with SH002's repl user: exit $rc, FAILED (no role repl:SH001)"
else
	ck AC-10 FAIL "edge-init with SH002's repl user: exit $rc: $(echo "$o" | tail -3)"
fi
ck_ok AC-10 "the failed runs changed nothing: all 5 jobs still running" 'all_running "$EU" 5'

# ------------------------------------------------------------------ AC-7
step "AC-7: two-way sync of shelter_sh001"
has_doc() { [ "$(code -u "$1" "$2")" = 200 ]; } # has_doc <user:pw> <url>
stuser() { has_doc "$EA:$EPW" "$EU/_users/org.couchdb.user:staff_sh001"; }
t=$(date +%s)
retry 60 stuser && ck AC-7 PASS "staff_sh001 reached the edge _users in $(($(date +%s) - t))s" || ck AC-7 FAIL "staff_sh001 not in edge _users after 60s"
ck_code AC-7 "edge _users/staff_sh002 (other shelter)" "$(code -u "$EA:$EPW" "$EU/_users/org.couchdb.user:staff_sh002")" '^404$'
ck_code AC-7 "edge _users/staff_sh003 (other shelter)" "$(code -u "$EA:$EPW" "$EU/_users/org.couchdb.user:staff_sh003")" '^404$'
ck_code AC-7 "edge _users/$R1U (repl users are never copied)" "$(code -u "$EA:$EPW" "$EU/_users/org.couchdb.user:$R1U")" '^404$'
edge_ids=$(eadm "$EU/_users/_all_docs" | python3 -c 'import sys,json;print(",".join(sorted(r["id"].replace("org.couchdb.user:","") for r in json.load(sys.stdin)["rows"])))')
ck_code AC-7 "edge _users docs (design docs aside) are only the staff of SH001" "$(printf '%s' "$edge_ids" | tr ',' '\n' | grep -v '^_design/' | paste -sd,)" '^staff2_sh001,staff_sh001$'
case "$edge_ids" in
*_design/readonly*) ck AC-7 FAIL "edge _users holds edge_users_sh001's _design/readonly (users pull must skip _design/*)" ;;
*) ck AC-7 PASS "edge _users has no _design/readonly from edge_users_sh001" ;;
esac
ses=$(curl -sS -c "$WORK/staff.jar" -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"staff_sh001\",\"password\":\"$SPW1\"}")
ck_eq AC-7 "POST edge /_session as staff_sh001: ok" "$(printf '%s' "$ses" | jget ok)" True
ck_eq AC-7 "staff_sh001 roles at edge" "$(printf '%s' "$ses" | jget roles)" '["SH001:shelter_manager", "shelter:SH001"]'
ck_code AC-7 "POST edge /_session as staff_sh002" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"staff_sh002\",\"password\":\"$SPW2\"}")" '^401$'

# central -> edge
CDOC="evacuee:$(ulid)"
cadm -X PUT "$CU/shelter_sh001/$CDOC" -d '{"type":"evacuee","shelter_code":"SH001","name":"written at central"}' >/dev/null
on_edge() { has_doc "$EA:$EPW" "$EU/shelter_sh001/$1"; }
retry 60 on_edge "$CDOC" && ck AC-7 PASS "central -> edge: $CDOC arrived" || ck AC-7 FAIL "central -> edge: $CDOC did not arrive in 60s"
retry 60 on_edge "$SEED1" && ck AC-7 PASS "central -> edge: seed doc $SEED1 arrived" || ck AC-7 FAIL "central -> edge: seed doc missing"
ck_ok AC-7 "central -> edge: _design/access (real VDU) arrived on edge" '[ "$(eadm "$EU/shelter_sh001/_design/access" | jget validate_doc_update | grep -c "repl:SH001")" -ge 1 ]'
ck_code AC-7 "registry_pull: registry shelter doc on edge" "$(code -u "$EA:$EPW" "$EU/registry/shelter:01E2ESHELTER00000000000001")" '^200$'
ck_code AC-7 "catalog_pull: catalog doc on edge" "$(code -u "$EA:$EPW" "$EU/catalog/item:e2e-rice")" '^200$'
ck_code AC-7 "edge shelter_sh002 does not exist (never replicated)" "$(code -u "$EA:$EPW" "$EU/shelter_sh002")" '^404$'

# edge -> central
on_central() { has_doc "$CA:$CPW" "$CU/shelter_sh001/$1"; }
TS=$(now_iso)
QRU=$(ulid)
QRID="evacuee_qr:$QRU"
QRDOC=$(python3 -c '
import json,sys
u,ts=sys.argv[1:3]
print(json.dumps({"_id":"evacuee_qr:"+u,"type":"evacuee_qr","schema_v":1,"shelter_code":"SH001","evacuee_id":"evacuee:"+u,
 "prints":[{"printed_at":ts,"hash":"a1b2c3","source":"kiosk_checkin","printed_by":"edge-server"}]}))' "$QRU" "$TS")
r=$(eadm -X PUT "$EU/shelter_sh001/$QRID" -d "$QRDOC")
ck_eq AC-7 "evacuee_qr written at edge by edge admin" "$(printf '%s' "$r" | jget ok)" True
r=$(curl -sS -b "$WORK/staff.jar" -H 'Content-Type: application/json' -X PUT "$EU/shelter_sh001/$QRID-x" -d "$QRDOC")
ck_eq AC-7 "sanity: staff session cannot write evacuee_qr (VDU: server only)" "$(printf '%s' "$r" | jget error)" forbidden

INC="shelter_incident:$(ulid)"
INCDOC=$(python3 -c '
import json,sys
i,ts=sys.argv[1:3]
u="staff_sh001"
print(json.dumps({"_id":i,"type":"shelter_incident","schema_v":1,"shelter_code":"SH001","created_at":ts,"updated_at":ts,
 "created_by":u,"reported_by":u,"assigned_to":u,"current_status":"reported","timeline":[],"title":"e2e incident",
 "category":"other","severity":"low","occurred_at":ts,"incident_no":"INC-E2E-1","location_detail":"gate",
 "description":"written at the edge by staff","attachments":[],"complainant":{"type":"anonymous"},"respondent":{"status":"none"}}))' "$INC" "$TS")
r=$(curl -sS -b "$WORK/staff.jar" -H 'Content-Type: application/json' -X PUT "$EU/shelter_sh001/$INC" -d "$INCDOC")
ck_eq AC-7 "shelter_incident (created_by=staff_sh001) written at edge via staff session" "$(printf '%s' "$r" | jget ok)" True

YDAY=$(bkk_date 1); DBY=$(bkk_date 2)
sop_doc() { sed "s/__CODE__/SH001/g; s/__DATE__/$1/g; s/__USER__/$2/g; s/__TS__/$TS/g" "$WORK/designs/sop_med.json"; }
SOP="daily_sop_role_assessment:SH001:$YDAY:MED"
r=$(eadm -X PUT "$EU/shelter_sh001/$SOP" -d "$(sop_doc "$YDAY" staff_sh001)")
ck_eq AC-7 "daily_sop_role_assessment dated $YDAY (Bangkok yesterday) written at edge as edge admin" "$(printf '%s' "$r" | jget ok)" True
r=$(curl -sS -b "$WORK/staff.jar" -H 'Content-Type: application/json' -X PUT "$EU/shelter_sh001/daily_sop_role_assessment:SH001:$DBY:MED" -d "$(sop_doc "$DBY" staff_sh001)")
ck_eq AC-7 "sanity: staff session cannot write a past-dated assessment (VDU: current Bangkok date)" "$(printf '%s' "$r" | jget error)" forbidden

for id in "$QRID" "$INC" "$SOP"; do
	t=$(date +%s)
	if retry 60 on_central "$id"; then ck AC-7 PASS "edge -> central: $id arrived in $(($(date +%s) - t))s"; else ck AC-7 FAIL "edge -> central: $id not on central after 60s"; fi
done
ck_eq AC-7 "central copy of the assessment keeps assessment_date" "$(cadm "$CU/shelter_sh001/$SOP" | jget assessment_date)" "$YDAY"
ck_eq AC-7 "central copy of the incident keeps created_by" "$(cadm "$CU/shelter_sh001/$INC" | jget created_by)" staff_sh001
sleep 3
ck_eq AC-7 "push job info.doc_write_failures" "$(job_field "$EU" sh001_push info.doc_write_failures)" 0
ck_ok AC-7 "push job docs_written >= 3 ($(job_field "$EU" sh001_push info.docs_written))" '[ "$(job_field "$EU" sh001_push info.docs_written)" -ge 3 ]'
ck_ok AC-7 "no job in _active_tasks reports doc_write_failures > 0" '[ "$(eadm "$EU/_active_tasks" | python3 -c "import sys,json;print(sum(t.get(\"doc_write_failures\",0) for t in json.load(sys.stdin)))")" = 0 ]'
ck_ok AC-7 "all 5 jobs running" 'all_running "$EU" 5'

# ------------------------------------------------------------------ WAN down
step "AC-7b: WAN down — central stopped, staff still log in at the edge"
docker stop "$C_CENTRAL" >/dev/null
ck_code AC-7 "central is down" "$(code -m 5 "$CU/_up")" '^000$'
ses=$(curl -sS -c "$WORK/staff2.jar" -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"staff_sh001\",\"password\":\"$SPW1\"}")
ck_eq AC-7b "edge POST /_session as staff_sh001 while central is down: ok" "$(printf '%s' "$ses" | jget ok)" True
ck_code AC-7b "edge POST /_session returns HTTP 200" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"staff_sh001\",\"password\":\"$SPW1\"}")" '^200$'
INC2="shelter_incident:$(ulid)"
r=$(curl -sS -b "$WORK/staff2.jar" -H 'Content-Type: application/json' -X PUT "$EU/shelter_sh001/$INC2" -d "$(printf '%s' "$INCDOC" | python3 -c 'import sys,json;d=json.load(sys.stdin);d["_id"]=sys.argv[1];d["incident_no"]="INC-E2E-OUTAGE";print(json.dumps(d))' "$INC2")")
ck_eq AC-7b "staff writes at the edge during the outage" "$(printf '%s' "$r" | jget ok)" True
sleep 8
docker start "$C_CENTRAL" >/dev/null
up_c() { [ "$(code -u "$CA:$CPW" "$CU/_up")" = 200 ]; }
retry 90 up_c && ck AC-7b PASS "central restarted" || ck AC-7b FAIL "central did not restart"
t=$(date +%s)
if retry 150 on_central "$INC2"; then
	ck AC-7b PASS "backlog written during the outage reached central $(($(date +%s) - t))s after restart"
else
	ck AC-7b FAIL "outage backlog $INC2 not on central after 150s (job states: $(sched_states "$EU" | tr '\n' ' '))"
fi
retry 120 all_running "$EU" 5 && ck AC-7b PASS "all 5 jobs running again" || ck AC-7b FAIL "jobs not all running: $(sched_states "$EU" | tr '\n' ' ')"

# ------------------------------------------------------------------ AC-8
step "AC-8: roles removed / soft delete at central reach the edge"
mod_user() { # mod_user <name> <python expression body mutating d>
	local doc
	doc=$(cadm "$CU/_users/org.couchdb.user:$1")
	printf '%s' "$doc" | python3 -c "import sys,json,secrets
d=json.load(sys.stdin)
$2
print(json.dumps(d))" | cadm -X PUT "$CU/_users/org.couchdb.user:$1" -d @- >/dev/null
}
edge_user_roles() { eadm "$EU/_users/org.couchdb.user:$1" | jget roles; }
# a) like user-service dropping the shelter role: roles [] but edge_shelters kept
mod_user staff_sh001 'd["roles"]=[]; d["shelter_id"]=None'
ck_eq AC-8 "central staff_sh001 edge_shelters kept" "$(cadm "$CU/_users/org.couchdb.user:staff_sh001" | jget edge_shelters)" '["SH001"]'
roles_gone() { [ "$(edge_user_roles staff_sh001)" = "[]" ]; }
t=$(date +%s)
retry 90 roles_gone && ck AC-8 PASS "roles removal reached the edge _users in $(($(date +%s) - t))s" || ck AC-8 FAIL "edge _users/staff_sh001 still has roles $(edge_user_roles staff_sh001) after 90s"
ses=$(curl -sS -c "$WORK/staff3.jar" -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"staff_sh001\",\"password\":\"$SPW1\"}")
ck_eq AC-8 "edge _session roles of the roles-removed user (CouchDB still accepts the password; no roles)" "$(printf '%s' "$ses" | jget roles)" '[]'
ck_code AC-8 "roles-removed user GET edge shelter_sh001" "$(curl -s -o /dev/null -w '%{http_code}' -b "$WORK/staff3.jar" "$EU/shelter_sh001")" '^(401|403)$'
ck_code AC-8 "roles-removed user GET edge shelter_sh001/_all_docs" "$(curl -s -o /dev/null -w '%{http_code}' -b "$WORK/staff3.jar" "$EU/shelter_sh001/_all_docs")" '^(401|403)$'
# b) soft delete exactly as user-service.deleteUser writes it
mod_user staff2_sh001 '
import datetime
d["roles"]=[]; d["shelter_id"]=None; d["active"]=False; d["password"]=secrets.token_hex(32)
d["deleted_at"]=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"); d["deleted_by"]="e2e"
d.pop("password_sha",None); d.pop("salt",None)'
deleted_on_edge() { [ -n "$(eadm "$EU/_users/org.couchdb.user:staff2_sh001" | jget deleted_at)" ]; }
t=$(date +%s)
retry 90 deleted_on_edge && ck AC-8 PASS "soft delete reached the edge _users in $(($(date +%s) - t))s" || ck AC-8 FAIL "soft delete not on edge after 90s"
ck_code AC-8 "soft-deleted user POST edge /_session with the old password" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"staff2_sh001\",\"password\":\"$SPW1B\"}")" '^401$'
ck_eq AC-8 "edge _users/staff2_sh001 roles" "$(edge_user_roles staff2_sh001)" '[]'
ck_ok AC-8 "edge-users-copy is healthy: central-repl-user.sh SH001 --status" 'run_cru SH001 --status; [ "$rc" = 0 ]'

# ------------------------------------------------------------------ AC-12
step "AC-12: edge-users-copy stopped while changes are pending, then restarted"
kill "$COPY_PID" >/dev/null 2>&1; wait "$COPY_PID" 2>/dev/null
ck_ok AC-12 "edge-users-copy is stopped" '! kill -0 "$COPY_PID" 2>/dev/null'
# changes made while the service is down: a new user, 5 more new users, a password change, a second revision of
# a soft-deleted user (staff_sh001 has roles [] but edge_shelters kept, AC-8 a)
AC12_PW="ac12-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
for i in 1 2 3 4 5; do mkuser "ac12_user$i" "$AC12_PW" '["SH001:shelter_manager","shelter:SH001"]' '["SH001"]'; done
mkuser ac12_new "$AC12_PW" '["SH001:shelter_manager","shelter:SH001"]' '["SH001"]'
mod_user staff_sh001 'd["password"]=secrets.token_hex(8)'
mod_user staff2_sh001 'd["display_name"]="changed while the copy service was down"'
sleep 5
ck_code AC-12 "while the service is down ac12_new is NOT in edge_users_sh001" "$(code -u "$CA:$CPW" "$CU/edge_users_sh001/org.couchdb.user:ac12_new")" '^404$'
COUCHDB_URL="$CU" COUCHDB_USER="$CA" COUCHDB_PASSWORD="$CPW" \
	uv run --project "$ROOT/worker" edge-users-copy >>"$COPY_LOG" 2>&1 &
COPY_PID=$!
AC12_IDS="ac12_new ac12_user1 ac12_user2 ac12_user3 ac12_user4 ac12_user5 staff_sh001 staff2_sh001"
rev_of() { jget _rev; } # stdin: a doc
ac12_synced() { # every pending doc has the same _rev on central and on the edge _users
	local n
	for n in $AC12_IDS; do
		[ "$(cadm "$CU/_users/org.couchdb.user:$n" | rev_of)" = "$(eadm "$EU/_users/org.couchdb.user:$n" | rev_of)" ] || return 1
	done
}
t=$(date +%s)
retry 150 ac12_synced && ck AC-12 PASS "all 8 pending changes reached the edge _users after the restart in $(($(date +%s) - t))s, same _rev as central" || ck AC-12 FAIL "after 150s these differ: $(for n in $AC12_IDS; do [ "$(cadm "$CU/_users/org.couchdb.user:$n" | rev_of)" = "$(eadm "$EU/_users/org.couchdb.user:$n" | rev_of)" ] || printf '%s ' "$n"; done)"
ck_code AC-12 "ac12_new is in edge_users_sh001 on central" "$(code -u "$CA:$CPW" "$CU/edge_users_sh001/org.couchdb.user:ac12_new")" '^200$'
ck_eq AC-12 "edge _users docs with _conflicts" "$(eadm "$EU/_users/_all_docs?conflicts=true&include_docs=true" | python3 -c 'import sys,json;print(sum(1 for r in json.load(sys.stdin)["rows"] if "_conflicts" in r.get("doc",{})))')" 0
ck_code AC-12 "edge login as ac12_new" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$EU/_session" -d "{\"name\":\"ac12_new\",\"password\":\"$AC12_PW\"}")" '^200$'
status_ok() { run_cru SH001 --status; [ "$rc" = 0 ]; }
retry 60 status_ok && ck AC-12 PASS "central-repl-user.sh SH001 --status is healthy after the restart (checkpoint resumed, no last_error)" || ck AC-12 FAIL "--status after restart: $out"

# ------------------------------------------------------------------ AC-6
step "AC-6: central-repl-user.sh SH001 --remove stops SH001's edge jobs, SH002 unaffected"
run_cru SH001 --remove
ck_eq AC-6 "central-repl-user.sh SH001 --remove exit code" "$rc" 0
ck_code AC-6 "removed repl_sh001 user can no longer read shelter_sh001" "$(code -u "$R1" "$CU/shelter_sh001")" '^(401|403)$'
ck_code AC-6 "edge_users_sh001 DB is gone on central" "$(code -u "$CA:$CPW" "$CU/edge_users_sh001")" '^404$'
ck_code AC-6 "SH002 repl user still reads shelter_sh002" "$(code -u "$R2U:$R2P" "$CU/shelter_sh002")" '^200$'
ck_code AC-6 "SH002 repl user still reads edge_users_sh002" "$(code -u "$R2U:$R2P" "$CU/edge_users_sh002")" '^200$'
ck_code AC-6 "SH002 repl user still reads registry" "$(code -u "$R2U:$R2P" "$CU/registry")" '^200$'
run_cru SH002 --status
ck_eq AC-6 "SH002 edge-users-copy health (--status exit code)" "$rc" 0
# make the jobs issue fresh requests: a write on both sides (long-lived changes connections would otherwise linger)
cadm -X PUT "$CU/shelter_sh001/evacuee:$(ulid)" -d '{"type":"evacuee","shelter_code":"SH001","name":"after remove (central)"}' >/dev/null
eadm -X PUT "$EU/shelter_sh001/evacuee:$(ulid)" -d '{"type":"evacuee","shelter_code":"SH001","name":"after remove (edge)"}' >/dev/null
not_running() { ! sched_states "$EU" | grep -q '=running$'; }
t=$(date +%s)
if retry 90 not_running; then
	ck AC-6 PASS "no SH001 edge job is running any more after $(($(date +%s) - t))s: $(sched_states "$EU" | tr '\n' ' ')"
else
	echo "  some jobs still hold an old connection ($(sched_states "$EU" | tr '\n' ' ')) — restarting the edge CouchDB to force fresh requests"
	docker restart "$C_EDGE" >/dev/null
	wait_up_e() { [ "$(code -u "$EA:$EPW" "$EU/_up")" = 200 ]; }
	retry 60 wait_up_e
	if retry 90 not_running; then
		ck AC-6 PASS "after an edge restart no SH001 job is running: $(sched_states "$EU" | tr '\n' ' ')"
	else
		ck AC-6 FAIL "jobs still running after remove + edge restart: $(sched_states "$EU" | tr '\n' ' ')"
	fi
fi
errs=$(eadm "$EU/_scheduler/docs/_replicator" | python3 -c '
import sys,json
for x in json.load(sys.stdin)["docs"]:
    if not x["doc_id"].startswith("_design"):
        i=x.get("info") or {}
        print(x["doc_id"], x.get("state"), (i.get("error") if isinstance(i,dict) else i))')
echo "$errs" | sed 's/^/    /'
ck_ok AC-6 "job errors are credential rejections (unauthorized / 401 / forbidden)" '[ "$(echo "$errs" | grep -ciE "unauthor|401|forbidden|403")" -ge 1 ]'

# recreate SH001 (new repl user), point the edge at it: stale jobs are rebuilt
step "AC-6 (follow-up): re-provision SH001, new credentials, edge-init recreates the jobs"
run_cru SH001; [ "$rc" = 0 ] || { echo "$out"; echo "re-create SH001 failed"; }
repl_creds; R1U_OLD=$R1U; R1U=$RU; R1P=$RP; R1="$R1U:$R1P"
ck_ok AC-6 "re-created user has a new suffix ($R1U_OLD -> $R1U)" '[ "$R1U" != "$R1U_OLD" ] && [ -n "$R1U" ]'
ei=$(run_edge_init "$NET" SH001 "$R1U" "$R1P"); eirc=$?
echo "$ei" | grep -E 'stale|FAILED' | sed 's/^/    /'
ck_eq AC-6 "edge-init with the new credentials exit code" "$eirc" 0
ck_eq AC-6 "stale jobs recreated by edge-init" "$(echo "$ei" | grep -c '^stale ')" 5
retry 120 all_running "$EU" 5 && ck AC-6 PASS "all 5 SH001 jobs running again with the new credentials" || ck AC-6 FAIL "jobs not running: $(sched_states "$EU" | tr '\n' ' ')"
ck_ok AC-6 "edge _users still lists staff2_sh001 tombstone (no conflicts: edge_users_sh001 copy rebuilt from the same revs)" '[ "$(eadm "$EU/_users/_all_docs?conflicts=true&include_docs=true" | python3 -c "import sys,json;print(sum(1 for r in json.load(sys.stdin)[\"rows\"] if \"_conflicts\" in r.get(\"doc\",{})))")" = 0 ]'

# ------------------------------------------------------------------ AC-5
step "AC-5: lockout of repl_sh001_* (hammered from the edge's IP) leaves SH002 working"
hammer=$(docker exec "$C_EDGE" sh -c 'for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null -w "%{http_code} " -u "'"$R1U"':wrong-password" http://central:5984/; done')
echo "  wrong-password attempts from the edge IP: $hammer"
ck_ok AC-5 "attempts ended in 403 (lockout) — codes: $hammer" 'echo "$hammer" | grep -q 403'
ck_code AC-5 "repl_sh001 with the CORRECT password from the same IP while locked out" "$(docker exec "$C_EDGE" curl -s -o /dev/null -w '%{http_code}' -u "$R1" http://central:5984/shelter_sh001)" '^403$'
ck_code AC-5 "repl_sh002 from the same edge IP: GET shelter_sh002" "$(docker exec "$C_EDGE" curl -s -o /dev/null -w '%{http_code}' -u "$R2U:$R2P" http://central:5984/shelter_sh002)" '^200$'
ck_code AC-5 "repl_sh002 from the same edge IP: GET edge_users_sh002" "$(docker exec "$C_EDGE" curl -s -o /dev/null -w '%{http_code}' -u "$R2U:$R2P" http://central:5984/edge_users_sh002)" '^200$'
ck_code AC-5 "admin (not hammered) from the same IP is not collateral damage" "$(docker exec "$C_EDGE" curl -s -o /dev/null -w '%{http_code}' -u "$CA:$CPW" http://central:5984/_up)" '^200$'
# SH002's replication job, simulated on this edge with the SH002 repl user: one-shot pull of shelter_sh002 + its _users copy
rep=$(eadm -X POST "$EU/_replicate" -d "{\"source\":{\"url\":\"http://central:5984/shelter_sh002\",\"auth\":{\"basic\":{\"username\":\"$R2U\",\"password\":\"$R2P\"}}},\"target\":{\"url\":\"http://127.0.0.1:5984/shelter_sh002_sim\",\"auth\":{\"basic\":{\"username\":\"$EA\",\"password\":\"$EPW\"}}},\"create_target\":true}")
ck_eq AC-5 "SH002 replication (shelter_sh002 -> edge) while SH001's account is locked out: ok" "$(printf '%s' "$rep" | jget ok)" True
dw=$(printf '%s' "$rep" | python3 -c 'import sys,json;print(json.load(sys.stdin)["history"][0]["docs_written"])')
ck_ok AC-5 "  ...docs_written=$dw (>= 1: the SH002 seed doc, plus its _design/access)" '[ "$dw" -ge 1 ]'
rep=$(eadm -X POST "$EU/_replicate" -d "{\"source\":{\"url\":\"http://central:5984/edge_users_sh002\",\"auth\":{\"basic\":{\"username\":\"$R2U\",\"password\":\"$R2P\"}}},\"target\":{\"url\":\"http://127.0.0.1:5984/edge_users_sh002_sim\",\"auth\":{\"basic\":{\"username\":\"$EA\",\"password\":\"$EPW\"}}},\"create_target\":true}")
ck_eq AC-5 "SH002 _users copy (edge_users_sh002 -> edge) while SH001's account is locked out: ok" "$(printf '%s' "$rep" | jget ok)" True
echo "  SH001 job states now: $(sched_states "$EU" | tr '\n' ' ')"
eadm -X DELETE "$EU/shelter_sh002_sim" >/dev/null; eadm -X DELETE "$EU/edge_users_sh002_sim" >/dev/null

# ------------------------------------------------------------------ AC-9
step "AC-9: edge installed before #1298 (users pulled straight from central _users with admin) migrates cleanly"
OLD="$WORK/edge-init.old.sh"
if ! git -C "$ROOT" show origin/develop:scripts/edge-init.sh >"$OLD" 2>/dev/null || ! grep -q CENTRAL_REPL_USER "$OLD"; then
	ck AC-9 SKIP "origin/develop:scripts/edge-init.sh (pre-#1298) not available here"
else
	start_couch "$C_EDGE2" couchdb "$NET2" "$E2PORT" "$EA" "$EPW" "$WORK/edge.ini"
	wait_couch "$E2U" "$EA" "$EPW"
	E2() { curl -sS -u "$EA:$EPW" -H 'Content-Type: application/json' "$@"; }
	o=$(run_edge_init "$NET2" SH003 "$CA" "$CPW" "$OLD" CENTRAL_REPL); rc=$?
	echo "$o" | grep -E 'FAILED|stale|ok +_replicator' | sed 's/^/    old edge-init: /'
	ck_eq AC-9 "OLD edge-init (central admin, users pulled from central _users) exit code" "$rc" 0
	u3() { [ "$(code -u "$EA:$EPW" "$E2U/_users/org.couchdb.user:staff_sh003")" = 200 ]; }
	retry 90 u3 && ck AC-9 PASS "old flow: staff_sh003 replicated into edge2 _users" || ck AC-9 FAIL "old flow: staff_sh003 never reached edge2"
	REV_OLD=$(E2 "$E2U/_users/org.couchdb.user:staff_sh003" | jget _rev)
	ck_eq AC-9 "old flow: edge2 users job source" "$(E2 "$E2U/_replicator/users_sh003_pull" | jget source.url)" "http://central:5984/_users"
	# switch to the per-shelter user
	run_cru SH003; [ "$rc" = 0 ] || { echo "$out"; }
	repl_creds; R3U=$RU; R3P=$RP
	o=$(run_edge_init "$NET2" SH003 "$R3U" "$R3P"); rc=$?
	echo "$o" | grep -E 'FAILED|stale|created' | sed 's/^/    new edge-init: /'
	ck_eq AC-9 "NEW edge-init (EDGE_REPL_*) exit code" "$rc" 0
	ck_eq AC-9 "new edge-init recreated the jobs as stale" "$(echo "$o" | grep -c '^stale ')" 5
	ck_eq AC-9 "edge2 users job now reads edge_users_sh003" "$(E2 "$E2U/_replicator/users_sh003_pull" | jget source.url)" "http://central:5984/edge_users_sh003"
	retry 90 all_running "$E2U" 5 && ck AC-9 PASS "edge2: all 5 jobs running after migration" || ck AC-9 FAIL "edge2 jobs: $(sched_states "$E2U" | tr '\n' ' ')"
	copied3() { [ "$(code -u "$CA:$CPW" "$CU/edge_users_sh003/org.couchdb.user:staff_sh003")" = 200 ]; }
	retry 60 copied3 && ck AC-9 PASS "central copy edge_users_sh003 has staff_sh003 (backfill from seq 0)" || ck AC-9 FAIL "copy job did not backfill"
	ck_eq AC-9 "edge2 _users/staff_sh003 _rev unchanged by the switch" "$(E2 "$E2U/_users/org.couchdb.user:staff_sh003" | jget _rev)" "$REV_OLD"
	# password change at central (must flow through the NEW path and not conflict with what the old path left)
	NEWPW="changed-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
	doc=$(cadm "$CU/_users/org.couchdb.user:staff_sh003")
	printf '%s' "$doc" | python3 -c 'import sys,json;d=json.load(sys.stdin);d["password"]=sys.argv[1];print(json.dumps(d))' "$NEWPW" | cadm -X PUT "$CU/_users/org.couchdb.user:staff_sh003" -d @- >/dev/null
	newrev_on_edge2() { [ "$(E2 "$E2U/_users/org.couchdb.user:staff_sh003" | jget _rev)" != "$REV_OLD" ]; }
	retry 90 newrev_on_edge2 && ck AC-9 PASS "password change at central reached edge2 via edge_users_sh003" || ck AC-9 FAIL "password change did not reach edge2"
	d=$(E2 "$E2U/_users/org.couchdb.user:staff_sh003?conflicts=true")
	ck_eq AC-9 "edge2 _users/staff_sh003?conflicts=true -> _conflicts" "$(printf '%s' "$d" | jget _conflicts)" ""
	ck_eq AC-9 "edge2 _users docs with _conflicts" "$(E2 "$E2U/_users/_all_docs?conflicts=true&include_docs=true" | python3 -c 'import sys,json;print(sum(1 for r in json.load(sys.stdin)["rows"] if "_conflicts" in r.get("doc",{})))')" 0
	ck_code AC-9 "edge2 login with the NEW password" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$E2U/_session" -d "{\"name\":\"staff_sh003\",\"password\":\"$NEWPW\"}")" '^200$'
	ck_code AC-9 "edge2 login with the OLD password" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$E2U/_session" -d "{\"name\":\"staff_sh003\",\"password\":\"$SPW3\"}")" '^401$'
fi

# ------------------------------------------------------------------ summary
step "summary"
printf '%-7s %-5s %s\n' AC RESULT EVIDENCE
for ac in $(printf '%s\n' "${ORDER[@]}" | sort -V); do
	printf '%-7s %-5s %s\n' "$ac" "${AC_ST[$ac]}" "${AC_EV[$ac]}"
done
dur=$(($(date +%s) - T0))
if [ "$fails" -gt 0 ]; then
	echo "RESULT: FAIL ($fails failed checks) in ${dur}s"
	exit 1
fi
echo "RESULT: PASS in ${dur}s"
