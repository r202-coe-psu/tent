#!/usr/bin/env bash
# Create (or rotate / remove / check) the per-shelter replication user that an edge server uses to sync with
# this central CouchDB (CR-064, per-shelter user: #1298). Run on the central side; one user per shelter that has
# an edge. The edge puts the printed credentials into its .env as EDGE_REPL_USER / EDGE_REPL_PASSWORD and uses
# them for every job it runs against central (registry / catalog / shelter pull+push, and the _users copy).
#
#   scripts/central-repl-user.sh SH001              # create repl_sh001_<8 hex> + edge_users_sh001 + copy job
#   scripts/central-repl-user.sh SH001 --rotate     # new password for the existing user
#   scripts/central-repl-user.sh SH001 --remove     # delete the user(s), the role, the copy job and edge_users_sh001
#   scripts/central-repl-user.sh SH001 --status     # state of the _users copy job (exit != 0 unless running/pending)
#
# What `create` sets up (in this order):
#   1. edge_users_<code>   DB with _security members = ONLY role repl:<CODE> and a _design/readonly VDU that
#                          only lets _admin write (an empty members list would make the DB public)
#   2. _replicator/edge_users_<code> on central: continuous copy of the shelter's _users docs
#                          (edge_shelters or roles match, same selector the edge used to pull directly) into (1),
#                          run as the central admin. Stores a config hash; re-running recreates the job when
#                          the hash differs (admin password or --repl-url changed).
#   3. user repl_<code>_<8 random hex> with roles ["repl:<CODE>"] only, random 32-hex password
#   4. role repl:<CODE> in _security.members.roles of registry, catalog and shelter_<code>
#
# At most one account per shelter: an existing repl_<code>_* account is reused. A legacy repl_<code> account
# (no suffix) makes the script stop: --remove first, then create again.
#
# Every action also scans ALL edge_users_* databases and stops if one has members.names set, or members.roles
# other than exactly ["repl:<CODE of that DB>"] (empty members = the DB is PUBLIC).
#
# Idempotent: re-running `create` keeps the existing password. `_security` of registry/catalog/shelter_<code>
# is read-modify-written, never overwritten, so existing members (public_writer, shelter roles, ...) survive.
#
# Admin credentials come from COUCHDB_USER / COUCHDB_PASSWORD (env) or the repo-root .env;
# the target from --url or COUCHDB_URL (default http://localhost:5984).
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: central-repl-user.sh <SHELTER_CODE> [--rotate | --remove | --status] [--password PW] [--url URL]
                            [--repl-url URL]

  <SHELTER_CODE>   e.g. SH001 (role repl:SH001, user repl_sh001_<8 hex>, DB edge_users_sh001)
  --rotate         set a new password for the existing user (creates it if missing)
  --remove         delete the user(s), the role in registry/catalog/shelter_<code>, the _users copy job
                   and the edge_users_<code> DB
  --status         show state / error_count / last_updated of the _users copy job;
                   exit != 0 unless it is running or pending
  --password PW    use PW instead of a generated one (no spaces, no " or \)
  --url URL        CouchDB base URL for this script (default: $COUCHDB_URL or http://localhost:5984)
  --repl-url URL   CouchDB base URL as seen from INSIDE the CouchDB server, used in the _replicator doc
                   (default: http://127.0.0.1:5984). The replicator job runs in the CouchDB process, so
                   --url (e.g. a docker-published or proxy address) is usually not reachable from there.
EOF
}

die() {
	echo "error: $*" >&2
	exit 1
}

URL="${COUCHDB_URL:-http://localhost:5984}"
REPL_URL="http://127.0.0.1:5984"
ACTION=create
PW=""
CODE=""
while [ $# -gt 0 ]; do
	case "$1" in
	--url) URL="${2:?--url needs a value}"; shift 2 ;;
	--repl-url) REPL_URL="${2:?--repl-url needs a value}"; shift 2 ;;
	--password) PW="${2:?--password needs a value}"; shift 2 ;;
	--rotate) ACTION=rotate; shift ;;
	--remove) ACTION=remove; shift ;;
	--status) ACTION=status; shift ;;
	-h | --help) usage; exit 0 ;;
	-*) usage >&2; die "unknown option: $1" ;;
	*) [ -z "$CODE" ] || die "only one shelter code allowed"; CODE="$1"; shift ;;
	esac
done
[ -n "$CODE" ] || { usage >&2; exit 2; }
URL="${URL%/}"
REPL_URL="${REPL_URL%/}"

[[ "$CODE" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "invalid shelter code: $CODE"
CODE_UC=$(printf '%s' "$CODE" | tr '[:lower:]' '[:upper:]')
CODE_LC=$(printf '%s' "$CODE" | tr '[:upper:]' '[:lower:]')
REPL_ROLE="repl:${CODE_UC}"
USER_PREFIX="repl_${CODE_LC}_"
LEGACY_USER="repl_${CODE_LC}"
EDGE_USERS_DB="edge_users_${CODE_LC}"
JOB_ID="edge_users_${CODE_LC}"
DBS=(registry catalog "shelter_${CODE_LC}")

if [ -n "$PW" ]; then
	[[ "$PW" =~ ^[^[:space:]\"\\]+$ ]] || die "password must not contain spaces, \" or \\ (edge-init.sh builds JSON by hand)"
fi

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

# doc_rev <url> — print the _rev of a doc, nothing if it does not exist; die on any other error
doc_rev() {
	cj "$1" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "_rev" in d:
    print(d["_rev"])
elif d.get("error") != "not_found":
    sys.exit("unexpected response: " + json.dumps(d))' || die "reading $1 failed"
}

# Read-modify-write _security: add/remove one role in members.roles, keep everything else.
edit_member_role() { # edit_member_role <add|remove> <db> <role>
	local sec out
	sec=$(cj "$URL/$2/_security")
	out=$(printf '%s' "$sec" | python3 -c '
import sys, json
op, role = sys.argv[1], sys.argv[2]
sec = json.load(sys.stdin) or {}
roles = sec.setdefault("members", {}).setdefault("roles", [])
if op == "add" and role not in roles:
    roles.append(role)
if op == "remove":
    roles[:] = [r for r in roles if r != role]
print(json.dumps(sec))' "$1" "$3" | cj -X PUT "$URL/$2/_security" -d @-)
	ok_json "$out" || die "writing $2/_security failed: $out"
}

# list_accounts — "<doc id> <rev>" per existing repl_<code>_<8 hex> account of THIS shelter. The regex matters:
# the prefix range also covers other shelters whose code starts with "<code>_".
list_accounts() {
	local sk ek
	sk=$(python3 -c 'import json,sys;print(json.dumps("org.couchdb.user:" + sys.argv[1]))' "$USER_PREFIX")
	ek=$(python3 -c 'import json,sys;print(json.dumps("org.couchdb.user:" + sys.argv[1] + "￰"))' "$USER_PREFIX")
	cj -G "$URL/_users/_all_docs" --data-urlencode "startkey=$sk" --data-urlencode "endkey=$ek" |
		python3 -c '
import sys, json, re
d = json.load(sys.stdin)
if "rows" not in d:
    sys.exit("unexpected response: " + json.dumps(d))
pat = re.compile(r"^org\.couchdb\.user:" + re.escape(sys.argv[1]) + r"[0-9a-f]{8}$")
for r in d["rows"]:
    if pat.match(r["id"]):
        print(r["id"], r["value"]["rev"])' "$USER_PREFIX" || die "listing _users accounts for $CODE_UC failed"
}

# FR-12: every edge_users_* DB must be readable by exactly repl:<its own CODE> — nothing else, never empty.
check_edge_users_security() {
	local dbs db sec msg bad=""
	dbs=$(cj "$URL/_all_dbs" | python3 -c '
import sys, json
for d in json.load(sys.stdin):
    if d.startswith("edge_users_"):
        print(d)') || die "listing databases failed"
	for db in $dbs; do
		sec=$(cj "$URL/$db/_security")
		msg=$(printf '%s' "$sec" | python3 -c '
import sys, json
db = sys.argv[1]
m = (json.load(sys.stdin) or {}).get("members") or {}
names, roles = m.get("names") or [], m.get("roles") or []
want = ["repl:" + db[len("edge_users_"):].upper()]
if not names and not roles:
    print("members is empty, so the DB is PUBLIC")
elif names or roles != want:
    print("members must be exactly roles " + json.dumps(want) + " and no names, found names=" + json.dumps(names) + " roles=" + json.dumps(roles))' "$db") || die "reading $db/_security failed"
		[ -z "$msg" ] || bad="${bad}  ${db}: ${msg}"$'\n'
	done
	[ -z "$bad" ] || die $'unsafe _security on edge_users_* (they hold password hashes) — fix or delete before continuing:\n'"${bad%$'\n'}"
}

# job_body — JSON of the _replicator doc incl. central_repl_hash (sha256 of the whole config, credentials
# included, so a changed admin password or --repl-url makes the stored job stale)
job_body() {
	A_USER="$ADMIN_USER" A_PW="$ADMIN_PW" python3 -c '
import sys, os, json, hashlib
repl_url, db, code = sys.argv[1:4]
auth = {"basic": {"username": os.environ["A_USER"], "password": os.environ["A_PW"]}}
cfg = {
    "source": {"url": repl_url + "/_users", "auth": auth},
    "target": {"url": repl_url + "/" + db, "auth": auth},
    "continuous": True,
    "selector": {"$or": [
        {"edge_shelters": {"$elemMatch": {"$eq": code}}},
        {"roles": {"$elemMatch": {"$eq": "shelter:" + code}}},
    ]},
}
cfg["central_repl_hash"] = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:32]
print(json.dumps(cfg))' "$REPL_URL" "$EDGE_USERS_DB" "$CODE_UC"
}
hash_of() { python3 -c 'import sys,json;print(json.load(sys.stdin).get("central_repl_hash",""))'; }

# ensure_edge_users_db — DB + exact _security + _design/readonly (before the account exists, FR-10)
ensure_edge_users_db() {
	local st out sec vdu cur rev
	st=$(admin_code "$URL/$EDGE_USERS_DB")
	case "$st" in
	200) ;;
	404)
		out=$(cj -X PUT "$URL/$EDGE_USERS_DB")
		ok_json "$out" || die "creating $EDGE_USERS_DB failed: $out"
		echo "created database $EDGE_USERS_DB"
		;;
	*) die "cannot check database $EDGE_USERS_DB (HTTP $st)" ;;
	esac
	sec=$(python3 -c '
import json, sys
print(json.dumps({"admins": {"names": [], "roles": []}, "members": {"names": [], "roles": [sys.argv[1]]}}))' "$REPL_ROLE")
	out=$(cj -X PUT "$URL/$EDGE_USERS_DB/_security" -d "$sec")
	ok_json "$out" || die "writing $EDGE_USERS_DB/_security failed: $out"
	echo "_security of $EDGE_USERS_DB: members = only role $REPL_ROLE"

	vdu='function(newDoc, oldDoc, userCtx) { if (userCtx.roles.indexOf("_admin") === -1) { throw({forbidden: "read-only copy of _users"}); } }'
	cur=$(cj "$URL/$EDGE_USERS_DB/_design/readonly")
	rev=$(printf '%s' "$cur" | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d.get("_rev", "") if d.get("validate_doc_update") != sys.argv[1] else "SAME")' "$vdu")
	if [ "$rev" = SAME ]; then
		echo "exists  $EDGE_USERS_DB/_design/readonly"
	else
		out=$(python3 -c '
import json, sys
d = {"validate_doc_update": sys.argv[1]}
if sys.argv[2]:
    d["_rev"] = sys.argv[2]
print(json.dumps(d))' "$vdu" "$rev" | cj -X PUT "$URL/$EDGE_USERS_DB/_design/readonly" -d @-)
		ok_json "$out" || die "writing $EDGE_USERS_DB/_design/readonly failed: $out"
		echo "wrote   $EDGE_USERS_DB/_design/readonly (only _admin may write)"
	fi
}

# ensure_job — _replicator/edge_users_<code>; recreated when its stored hash differs
ensure_job() {
	local body hash cur rev out st
	body=$(job_body)
	hash=$(printf '%s' "$body" | hash_of)
	st=$(admin_code "$URL/_replicator")
	if [ "$st" = 404 ]; then
		cj -X PUT "$URL/_replicator" >/dev/null
	fi
	cur=$(cj "$URL/_replicator/$JOB_ID")
	rev=$(printf '%s' "$cur" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "_rev" in d:
    print(d["_rev"])
elif d.get("error") != "not_found":
    sys.exit("unexpected response: " + json.dumps(d))') || die "reading _replicator/$JOB_ID failed"
	if [ -n "$rev" ]; then
		if [ "$(printf '%s' "$cur" | hash_of)" = "$hash" ]; then
			echo "exists  _replicator/$JOB_ID (config hash matches)"
			return
		fi
		out=$(cj -X DELETE "$URL/_replicator/$JOB_ID?rev=$rev")
		ok_json "$out" || die "deleting stale _replicator/$JOB_ID failed: $out"
		echo "stale   _replicator/$JOB_ID (config changed) — recreating"
	fi
	out=$(printf '%s' "$body" | cj -X PUT "$URL/_replicator/$JOB_ID" -d @-)
	ok_json "$out" || die "writing _replicator/$JOB_ID failed: $out"
	echo "created _replicator/$JOB_ID (continuous copy of $CODE_UC users into $EDGE_USERS_DB)"
}

# ---------------------------------------------------------------- status
if [ "$ACTION" = status ]; then
	check_edge_users_security
	out=$(cj "$URL/_scheduler/docs/_replicator/$JOB_ID")
	line=$(printf '%s' "$out" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("error"):
    print("MISSING " + d.get("reason", d["error"]))
    sys.exit(0)
info = d.get("info") or {}
err = info.get("error") if isinstance(info, dict) else None
print("%s error_count=%s last_updated=%s%s" % (d.get("state"), d.get("error_count"), d.get("last_updated"),
      " error=" + json.dumps(err) if err else ""))') || die "cannot parse scheduler response: $out"
	state="${line%% *}"
	echo "_replicator/$JOB_ID: state=${state} ${line#* }"
	if [ "$state" = MISSING ]; then
		echo "FAIL: copy job missing — run: scripts/central-repl-user.sh $CODE_UC" >&2
		exit 1
	fi
	cur=$(cj "$URL/_replicator/$JOB_ID")
	if [ "$(printf '%s' "$cur" | hash_of)" != "$(job_body | hash_of)" ]; then
		echo "warning: job config hash differs from the current admin credentials / --repl-url — re-run create to rebuild it" >&2
	fi
	case "$state" in
	running | pending) exit 0 ;;
	*)
		echo "FAIL: state is $state (expected running or pending)" >&2
		exit 1
		;;
	esac
fi

# ---------------------------------------------------------------- remove
if [ "$ACTION" = remove ]; then
	found=0
	while read -r id rev; do
		[ -n "$id" ] || continue
		found=1
		out=$(cj -X DELETE "$URL/_users/$id?rev=$rev")
		ok_json "$out" || die "deleting $id failed: $out"
		echo "removed user ${id#org.couchdb.user:}"
	done < <(list_accounts)
	rev=$(doc_rev "$URL/_users/org.couchdb.user:$LEGACY_USER")
	if [ -n "$rev" ]; then
		found=1
		out=$(cj -X DELETE "$URL/_users/org.couchdb.user:$LEGACY_USER?rev=$rev")
		ok_json "$out" || die "deleting legacy $LEGACY_USER failed: $out"
		echo "removed legacy user $LEGACY_USER"
	fi
	[ "$found" = 1 ] || echo "no repl_${CODE_LC} account found (nothing to delete)"

	for db in "${DBS[@]}"; do
		if [ "$(admin_code "$URL/$db")" = 200 ]; then
			edit_member_role remove "$db" "$REPL_ROLE"
			echo "removed role $REPL_ROLE from $db/_security"
		fi
	done

	# the _users copy: job first (so nothing writes while the DB goes away), then the DB itself — it holds
	# password hashes of a shelter that no longer has an edge
	rev=$(doc_rev "$URL/_replicator/$JOB_ID")
	if [ -n "$rev" ]; then
		out=$(cj -X DELETE "$URL/_replicator/$JOB_ID?rev=$rev")
		ok_json "$out" || die "deleting _replicator/$JOB_ID failed: $out"
		echo "removed _replicator/$JOB_ID"
	else
		echo "_replicator/$JOB_ID not found (nothing to delete)"
	fi
	if [ "$(admin_code "$URL/$EDGE_USERS_DB")" = 200 ]; then
		out=$(cj -X DELETE "$URL/$EDGE_USERS_DB")
		ok_json "$out" || die "deleting database $EDGE_USERS_DB failed: $out"
		echo "removed database $EDGE_USERS_DB"
	else
		echo "database $EDGE_USERS_DB not found (nothing to delete)"
	fi
	check_edge_users_security
	exit 0
fi

# ---------------------------------------------------------------- create / rotate
check_edge_users_security

# the three DBs must already exist (shelter opened or seeded on central first)
for db in "${DBS[@]}"; do
	[ "$(admin_code "$URL/$db")" = 200 ] || die "database $db not found on $URL — open/seed shelter $CODE_UC first"
done

# at most one account per shelter; legacy repl_<code> (no suffix) must be removed first
[ -z "$(doc_rev "$URL/_users/org.couchdb.user:$LEGACY_USER")" ] ||
	die "legacy account $LEGACY_USER (no random suffix) exists — run '$0 $CODE_UC --remove' first, then create again"
accounts=$(list_accounts)
[ "$(printf '%s' "$accounts" | grep -c .)" -le 1 ] ||
	die "more than one repl_${CODE_LC}_* account found (expected at most 1): $(printf '%s' "$accounts" | cut -d' ' -f1 | tr '\n' ' ')— run '$0 $CODE_UC --remove' and create again"
user_id=""
user_rev=""
if [ -n "$accounts" ]; then
	user_id="${accounts% *}"
	user_rev="${accounts#* }"
	REPL_USER="${user_id#org.couchdb.user:}"
else
	REPL_USER="${USER_PREFIX}$(openssl rand -hex 4 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(4))')"
	user_id="org.couchdb.user:${REPL_USER}"
fi
user_url="$URL/_users/$user_id"

# FR-10: the DB + its _security + read-only VDU, and the copy job, exist BEFORE the account does
ensure_edge_users_db
ensure_job

new_pw=""
if [ -z "$user_rev" ] || [ "$ACTION" = rotate ]; then
	if [ -z "$PW" ]; then
		PW=$(openssl rand -hex 16 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(16))')
	fi
	doc=$(python3 -c '
import json, sys
name, role, pw, rev = sys.argv[1:5]
d = {"name": name, "password": pw, "type": "user", "roles": [role]}
if rev:
    d["_rev"] = rev
print(json.dumps(d))' "$REPL_USER" "$REPL_ROLE" "$PW" "$user_rev")
	out=$(cj -X PUT "$user_url" -d "$doc")
	ok_json "$out" || die "writing user $REPL_USER failed: $out"
	new_pw="$PW"
	if [ -n "$user_rev" ]; then echo "rotated password for $REPL_USER"; else echo "created user $REPL_USER"; fi
else
	echo "user $REPL_USER already exists — password unchanged (use --rotate to set a new one)"
fi

for db in "${DBS[@]}"; do
	edit_member_role add "$db" "$REPL_ROLE"
	echo "role $REPL_ROLE ensured in $db/_security"
done

# Verify with the replication user itself (only possible when we know its password)
if [ -n "$new_pw" ]; then
	bad=0
	check() { # check <path> <expected> [curl args...] — a new password can take a few seconds to take effect
		local path="$1" want="$2" got="" i
		shift 2
		for i in $(seq 1 30); do
			got=$(code_of "$URL/$path" -u "$REPL_USER:$new_pw" "$@")
			[ "$got" = "$want" ] && break
			sleep 0.5
		done
		if [ "$got" = "$want" ]; then echo "  ok   $path -> $got"; else echo "  FAIL $path -> $got (expected $want)"; bad=1; fi
	}
	echo "verifying as $REPL_USER (may wait a few seconds for CouchDB to pick up the password):"
	for db in "${DBS[@]}"; do check "$db" 200; done
	check "$EDGE_USERS_DB" 200
	check "$EDGE_USERS_DB/verify_probe" 403 -X PUT -H 'Content-Type: application/json' -d '{}'
	check "_users" 403
	# a probe that got through must not stay behind
	probe_rev=$(doc_rev "$URL/$EDGE_USERS_DB/verify_probe")
	[ -z "$probe_rev" ] || cj -X DELETE "$URL/$EDGE_USERS_DB/verify_probe?rev=$probe_rev" >/dev/null
	[ "$bad" = 0 ] || die "verification failed"
fi

check_edge_users_security

echo
if [ -n "$new_pw" ]; then
	cat <<EOF
Credentials for the edge of ${CODE_UC} (shown once — store the password now). Put them into the edge .env:

  EDGE_REPL_USER=${REPL_USER}
  EDGE_REPL_PASSWORD=${new_pw}

The edge uses this account for every job against central (registry / catalog / shelter_${CODE_LC} pull+push and
the _users copy from ${EDGE_USERS_DB}). Check the copy job with: scripts/central-repl-user.sh ${CODE_UC} --status
EOF
else
	echo "Nothing printed for the password: it is only shown when created or rotated."
fi
