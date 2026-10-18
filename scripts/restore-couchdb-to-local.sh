#!/usr/bin/env bash
# Restore *.couchbackup files (made by dump-couchdb.sh) into the LOCAL CouchDB.
# Docs with the same _id are overwritten, so this refuses non-local targets unless
# ALLOW_REMOTE_RESTORE=1 is set.
#
# Usage:
#   LOCAL_USER=admin LOCAL_PASS=... \
#     ./scripts/restore-couchdb-to-local.sh [dump_dir]   # default: ~/couchdb-dumps
#
# Notes:
#   - Attachments are NOT restored: couchbackup does not store them, so `_attachments`
#     stubs are stripped from docs (otherwise: 412 missing_stub). Docs like `image:*`
#     exist locally without the file.
#   - _design/app comes from the dump; if it is older than the app expects, run
#     `pnpm deploy:shelter-views` in frontend/ (see view-version-guard).
#   - After restoring, stop the worker and run: uv run --project worker sync-worker --bootstrap
set -euo pipefail

LOCAL_URL="${LOCAL_URL:-http://localhost:5984}"
: "${LOCAL_USER:?}"
: "${LOCAL_PASS:?}"
DUMP_DIR="${1:-$HOME/couchdb-dumps}"

host=${LOCAL_URL#*://}
host=${host%%/*}
host=${host##*@}
host=${host%%:*}
case "$host" in
localhost | 127.0.0.1 | ::1 | '[::1]') ;;
*)
	if [ "${ALLOW_REMOTE_RESTORE:-}" != "1" ]; then
		echo "!! LOCAL_URL host '$host' is not local; refusing to overwrite docs there." >&2
		echo "   Set ALLOW_REMOTE_RESTORE=1 only if you really mean it." >&2
		exit 1
	fi
	;;
esac

urlenc() { jq -rn --arg v "$1" '$v | @uri'; }

with_auth() { # <url> <user> <pass>
	local u p
	u=$(urlenc "$2")
	p=$(urlenc "$3")
	echo "${1/\/\//\/\/$u:$p@}"
}

shopt -s nullglob
files=("$DUMP_DIR"/*.couchbackup)
if [ ${#files[@]} -eq 0 ]; then
	echo "!! no *.couchbackup files in $DUMP_DIR" >&2
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
	jq -c 'if type == "array" then map(del(._attachments)) else . end' <"$f" |
		npx -y --package @cloudant/couchbackup couchrestore --url "$url" --db "$db"
done
echo ">> done"
