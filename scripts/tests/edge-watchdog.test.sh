#!/bin/sh
# Multi-job parsing test for edge-watchdog.sh: compact single-line _scheduler/docs JSON, crashing job NOT last.
# Usage: sh scripts/tests/edge-watchdog.test.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir "$T/bin"
cat >"$T/bin/curl" <<'EOF'
#!/bin/sh
case "$*" in
*_scheduler/docs*) printf '%s' '{"total_rows":3,"offset":0,"docs":[{"database":"_replicator","doc_id":"registry_pull","state":"crashing","error_count":9,"info":{"error":"boom"}},{"database":"_replicator","doc_id":"catalog_pull","state":"running","error_count":0,"info":null},{"database":"_replicator","doc_id":"sh001_push","state":"running","error_count":0,"info":null}]}' ;;
*/_up) printf '{"status":"ok"}' ;;
esac
EOF
chmod +x "$T/bin/curl"
out=$(PATH="$T/bin:$PATH" TMPDIR="$T" COUCHDB_USER=u COUCHDB_PASSWORD=p SYNC_URL=http://c/sync \
	WATCHDOG_ONCE=1 WATCHDOG_DRY_RUN=1 sh "$here/../edge-watchdog.sh")
echo "$out" | grep -q 'would restart registry_pull (errors=9)' || { echo "FAIL: $out"; exit 1; }
echo "$out" | grep -q 'sh001_push' && { echo "FAIL: running job evaluated: $out"; exit 1; }
# credential error on one job must not suppress another
sed -i 's/"error":"boom"/"error":"unauthorized"/;s/"doc_id":"catalog_pull","state":"running","error_count":0/"doc_id":"catalog_pull","state":"crashing","error_count":5/' "$T/bin/curl"
out=$(PATH="$T/bin:$PATH" TMPDIR="$T/x" COUCHDB_USER=u COUCHDB_PASSWORD=p SYNC_URL=http://c/sync \
	WATCHDOG_ONCE=1 WATCHDOG_DRY_RUN=1 sh "$here/../edge-watchdog.sh" 2>&1) || true
echo "$out" | grep -q 'registry_pull crashing: central REJECTED' || { echo "FAIL auth: $out"; exit 1; }
echo "$out" | grep -q 'would restart catalog_pull' || { echo "FAIL other job suppressed: $out"; exit 1; }
echo PASS
