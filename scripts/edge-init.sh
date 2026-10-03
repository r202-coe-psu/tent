#!/bin/sh
# Provision edge CouchDB สำหรับ 1 ศูนย์ (CR-064) — รันโดย service `edge-init` ใน docker-compose.edge.yml
#
#   1. สร้าง registry / catalog / shelter_<code> + _security (ไม่ replicate จาก central — data-model §6)
#   2. _design/edge_readonly บน registry / catalog (one-way — staff เขียนที่ edge ไม่ได้)
#   3. _replicator jobs: registry / catalog / shelter pull, shelter push, filtered _users pull
#
# Idempotent: DB ที่มีอยู่แล้ว (412) และ doc ที่มีอยู่แล้ว (409) จะถูกข้าม — ถ้าจะเปลี่ยน credential
# ของ job ให้ลบ doc ใน _replicator ก่อน (docs/couchdb-replication/SETUP-EDGE.md หัวข้อ "งานประจำ" `kick`)
# แล้วรัน `docker compose -f docker-compose.edge.yml run --rm edge-init`
set -eu

: "${COUCHDB_USER:?}" "${COUCHDB_PASSWORD:?}" "${SHELTER_CODE:?}" "${SYNC_URL:?}"
: "${CENTRAL_REPL_USER:?}" "${CENTRAL_REPL_PASSWORD:?}"

E="http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@couchdb:5984"
# URL ใน replication doc ถูกเรียกจากภายใน container couchdb เอง
LOC="http://127.0.0.1:5984"
CEN="${SYNC_URL%/}"

CODE_LC=$(printf '%s' "$SHELTER_CODE" | tr 'A-Z' 'a-z')
SHELTER_DB="shelter_${CODE_LC}"
ROLE="shelter:${SHELTER_CODE}"

put() { # put <path> <json> — แสดงเฉพาะ response (payload ของ job มีรหัสผ่าน)
	status=$(curl -s -o /tmp/edge-init.out -w '%{http_code}' -X PUT "$E/$1" \
		-H 'Content-Type: application/json' -d "$2")
	case "$status" in
	2??) echo "ok      $1" ;;
	409 | 412) echo "exists  $1" ;;
	*)
		echo "FAILED  $1 (HTTP $status): $(cat /tmp/edge-init.out)"
		exit 1
		;;
	esac
}

auth() { printf '{"basic":{"username":"%s","password":"%s"}}' "$1" "$2"; }

job() { # job <doc-id> <source-url> <source-auth> <target-url> <target-auth> [extra-json]
	put "_replicator/$1" "{\"source\":{\"url\":\"$2\",\"auth\":$3},\"target\":{\"url\":\"$4\",\"auth\":$5},\"continuous\":true${6:+,$6}}"
}

echo "== edge-init: ${SHELTER_CODE} ← ${CEN}"

# 1) DB + _security (เหมือน central: members = shelter role, admins = system_admin)
SEC="{\"members\":{\"roles\":[\"${ROLE}\"]},\"admins\":{\"roles\":[\"system_admin\"]}}"
for DB in registry catalog "$SHELTER_DB"; do
	put "$DB" '{}'
	put "$DB/_security" "$SEC"
done

# 2) registry / catalog อ่านอย่างเดียวที่ edge — replicator เขียนด้วย admin จึงผ่าน
RO='{"validate_doc_update":"function(newDoc, oldDoc, userCtx) { if (userCtx.roles.indexOf(\"_admin\") === -1) { throw({forbidden: \"read-only replica on edge\"}); } }"}'
for DB in registry catalog; do
	put "$DB/_design/edge_readonly" "$RO"
done

# 3) replication jobs — edge เป็นฝ่ายเปิด connection ไปหา central เสมอ
LOC_AUTH=$(auth "$COUCHDB_USER" "$COUCHDB_PASSWORD")
CEN_AUTH=$(auth "$CENTRAL_REPL_USER" "$CENTRAL_REPL_PASSWORD")

job registry_pull "$CEN/registry" "$CEN_AUTH" "$LOC/registry" "$LOC_AUTH"
job catalog_pull "$CEN/catalog" "$CEN_AUTH" "$LOC/catalog" "$LOC_AUTH"
job "${CODE_LC}_pull" "$CEN/$SHELTER_DB" "$CEN_AUTH" "$LOC/$SHELTER_DB" "$LOC_AUTH"
job "${CODE_LC}_push" "$LOC/$SHELTER_DB" "$LOC_AUTH" "$CEN/$SHELTER_DB" "$CEN_AUTH"

if [ -n "${CENTRAL_USERS_REPL_USER:-}" ]; then
	USERS_AUTH=$(auth "$CENTRAL_USERS_REPL_USER" "${CENTRAL_USERS_REPL_PASSWORD:-}")
	job "users_${CODE_LC}_pull" "$CEN/_users" "$USERS_AUTH" "$LOC/_users" "$LOC_AUTH" \
		"\"selector\":{\"roles\":{\"\$elemMatch\":{\"\$eq\":\"${ROLE}\"}}}"
else
	echo "skip    users_${CODE_LC}_pull (CENTRAL_USERS_REPL_USER ว่าง — login ที่ edge จะใช้ไม่ได้)"
fi

echo "== done — ดูสถานะ: curl -s \$E/_scheduler/docs/_replicator"
