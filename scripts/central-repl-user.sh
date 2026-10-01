#!/usr/bin/env bash
# Create (or rotate / remove) the per-shelter replication user that an edge server uses to sync with
# this central CouchDB (CR-064). Run on the central side; one user per shelter that has an edge.
#
#   scripts/central-repl-user.sh SH001              # create repl_sh001 + grant on registry/catalog/shelter_sh001
#   scripts/central-repl-user.sh SH001 --rotate     # new password for an existing user
#   scripts/central-repl-user.sh SH001 --remove     # delete the user and take the role out of _security
#
# Idempotent: re-running `create` keeps the existing password. `_security` is read-modify-written, never
# overwritten, so existing members (public_writer, shelter roles, ...) survive.
#
# Admin credentials come from COUCHDB_USER / COUCHDB_PASSWORD (env) or the repo-root .env;
# the target from --url or COUCHDB_URL (default http://localhost:5984).
# Details: docs/couchdb-replication/SETUP-CENTRAL.md (step 3).
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: central-repl-user.sh <SHELTER_CODE> [--rotate | --remove] [--password PW] [--url URL]

  <SHELTER_CODE>   e.g. SH001 (DB shelter_sh001, role repl:SH001, user repl_sh001)
  --rotate         set a new password for an existing user (creates it if missing)
  --remove         delete the user and remove its role from registry/catalog/shelter_<code>
  --password PW    use PW instead of a generated one (no spaces, no " or \)
  --url URL        CouchDB base URL (default: $COUCHDB_URL or http://localhost:5984)
EOF
}

die() {
	echo "error: $*" >&2
	exit 1
}

URL="${COUCHDB_URL:-http://localhost:5984}"
ACTION=create
PW=""
CODE=""
while [ $# -gt 0 ]; do
	case "$1" in
	--url) URL="${2:?--url needs a value}"; shift 2 ;;
	--password) PW="${2:?--password needs a value}"; shift 2 ;;
	--rotate) ACTION=rotate; shift ;;
	--remove) ACTION=remove; shift ;;
	-h | --help) usage; exit 0 ;;
	-*) usage >&2; die "unknown option: $1" ;;
	*) [ -z "$CODE" ] || die "only one shelter code allowed"; CODE="$1"; shift ;;
	esac
done
[ -n "$CODE" ] || { usage >&2; exit 2; }
URL="${URL%/}"

[[ "$CODE" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "invalid shelter code: $CODE"
CODE_UC=$(printf '%s' "$CODE" | tr '[:lower:]' '[:upper:]')
CODE_LC=$(printf '%s' "$CODE" | tr '[:upper:]' '[:lower:]')
REPL_USER="repl_${CODE_LC}"
REPL_ROLE="repl:${CODE_UC}"
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
code_of() { # code_of <url> [curl auth args...] — HTTP status only
	local u="$1"
	shift
	curl -s -o /dev/null -w '%{http_code}' "$@" "$u"
}
admin_code() { code_of "$1" -u "$ADMIN_USER:$ADMIN_PW"; }

[ "$(admin_code "$URL/_up")" = 200 ] || die "cannot reach CouchDB at $URL as $ADMIN_USER (check --url and credentials)"

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
	case "$out" in *'"ok":true'*) ;; *) die "writing $2/_security failed: $out" ;; esac
}

user_url="$URL/_users/org.couchdb.user:${REPL_USER}"
user_status=$(admin_code "$user_url")
user_rev=""
if [ "$user_status" = 200 ]; then
	user_rev=$(cj "$user_url" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_rev"])')
fi

if [ "$ACTION" = remove ]; then
	if [ -n "$user_rev" ]; then
		cj -X DELETE "$user_url?rev=$user_rev" >/dev/null
		echo "removed user $REPL_USER"
	else
		echo "user $REPL_USER not found (nothing to delete)"
	fi
	for db in "${DBS[@]}"; do
		if [ "$(admin_code "$URL/$db")" = 200 ]; then
			edit_member_role remove "$db" "$REPL_ROLE"
			echo "removed role $REPL_ROLE from $db/_security"
		fi
	done
	exit 0
fi

# create / rotate — the three DBs must already exist (shelter opened or seeded on central first)
for db in "${DBS[@]}"; do
	[ "$(admin_code "$URL/$db")" = 200 ] || die "database $db not found on $URL — open/seed shelter $CODE_UC first"
done

new_pw=""
if [ -z "$user_rev" ] || [ "$ACTION" = rotate ]; then
	if [ -z "$PW" ]; then
		PW=$(openssl rand -hex 12 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(12))')
	fi
	doc=$(python3 -c '
import json, sys
name, role, pw, rev = sys.argv[1:5]
d = {"name": name, "password": pw, "type": "user", "roles": [role]}
if rev:
    d["_rev"] = rev
print(json.dumps(d))' "$REPL_USER" "$REPL_ROLE" "$PW" "$user_rev")
	out=$(cj -X PUT "$user_url" -d "$doc")
	case "$out" in *'"ok":true'*) ;; *) die "writing user $REPL_USER failed: $out" ;; esac
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
	check() { # check <path> <expected> — a new password can take a few seconds to take effect (auth cache)
		local got="" i
		for i in $(seq 1 30); do
			got=$(code_of "$URL/$1" -u "$REPL_USER:$new_pw")
			[ "$got" = "$2" ] && break
			sleep 0.5
		done
		if [ "$got" = "$2" ]; then echo "  ok   $1 -> $got"; else echo "  FAIL $1 -> $got (expected $2)"; bad=1; fi
	}
	echo "verifying as $REPL_USER (may wait a few seconds for CouchDB to pick up the password):"
	for db in "${DBS[@]}"; do check "$db" 200; done
	check "_users" 403
	[ "$bad" = 0 ] || die "verification failed"
fi

echo
if [ -n "$new_pw" ]; then
	cat <<EOF
Put these in the edge server's .env (shown once — store the password now):

  SHELTER_CODE=${CODE_UC}
  SYNC_URL=http://<this host's IP>:5984        # lab; real: https://sync.<domain>
  CENTRAL_REPL_USER=${REPL_USER}
  CENTRAL_REPL_PASSWORD=${new_pw}
  CENTRAL_USERS_REPL_USER=<central admin>      # job _users still needs admin (docs/couchdb-replication/README.md "คำถามเปิด" ข้อ 2)
  CENTRAL_USERS_REPL_PASSWORD=<central admin password>

Already-running edge jobs keep the old credentials: delete them and re-run edge-init (SETUP-EDGE.md, "kick").
EOF
else
	echo "Nothing printed for the password: it is only shown when created or rotated."
fi
