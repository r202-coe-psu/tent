#!/bin/sh
# Provision edge CouchDB สำหรับ 1 ศูนย์ (CR-064) — รันโดย service `edge-init` ใน docker-compose.edge.yml
#
#   1. สร้าง registry / catalog / shelter_<code> + _security (ไม่ replicate จาก central — data-model §6)
#   2. _design/edge_readonly บน registry / catalog (one-way — staff เขียนที่ edge ไม่ได้)
#   3. _replicator jobs: registry / catalog / shelter pull, shelter push, filtered _users pull
#
# Idempotent: DB ที่มีอยู่แล้ว (412) และ doc ที่มีอยู่แล้ว (409) จะถูกข้าม · job ใน _replicator ที่ config
# (SYNC_URL / credential / SHELTER_CODE) ไม่ตรงกับ .env ปัจจุบันจะถูกลบแล้วสร้างใหม่ (`stale`) — แก้ .env แล้ว
# รัน `docker compose -f docker-compose.edge.yml run --rm edge-init` ได้เลย ไม่ต้อง kick เอง
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

# job <doc-id> <source-url> <source-auth> <target-url> <target-auth> [extra-json]
# doc ของ job เก็บ `edge_init_hash` (sha256 ของ config ทั้งก้อน รวม URL + credential) ไว้เทียบรอบถัดไป:
# ตรง = ข้าม · ไม่ตรง/ไม่มี (เช่นแก้ SYNC_URL หรือรหัสใน .env) = ลบแล้วสร้างใหม่ ไม่ปล่อยให้ job ชี้ค่าเก่าแบบเงียบ ๆ
# อ่าน job ไม่ได้ (HTTP อื่นนอกจาก 200/404 เช่น 500 หรือต่อไม่ติด = 000) = FAILED exit 1 ไม่เดาว่า "ยังไม่มี" แล้วสร้างทับ
job() {
	body="\"source\":{\"url\":\"$2\",\"auth\":$3},\"target\":{\"url\":\"$4\",\"auth\":$5},\"continuous\":true${6:+,$6}"
	hash=$(printf '%s' "$body" | sha256sum | cut -c1-32)
	: >/tmp/edge-init.cur # ต่อไม่ติด (000) curl ไม่เขียนไฟล์ — กันข้อความค้างจากรอบก่อน
	cur_status=$(curl -s -o /tmp/edge-init.cur -w '%{http_code}' "$E/_replicator/$1")
	case "$cur_status" in
	200 | 404) ;;
	*)
		echo "FAILED  อ่าน _replicator/$1 ไม่ได้ (HTTP $cur_status): $(cat /tmp/edge-init.cur)"
		exit 1
		;;
	esac
	cur=$(cat /tmp/edge-init.cur)
	case "$cur" in
	*"\"edge_init_hash\":\"$hash\""*)
		echo "exists  _replicator/$1"
		return
		;;
	*'"_rev":"'*)
		rev=$(printf '%s' "$cur" | sed -n 's/.*"_rev":"\([^"]*\)".*/\1/p' | head -1)
		status=$(curl -s -o /tmp/edge-init.out -w '%{http_code}' -X DELETE "$E/_replicator/$1?rev=$rev")
		case "$status" in
		2??) echo "stale   _replicator/$1 (config ไม่ตรงกับ .env) — สร้างใหม่" ;;
		*)
			echo "FAILED  _replicator/$1 ลบ job เก่าไม่ได้ (HTTP $status): $(cat /tmp/edge-init.out)"
			exit 1
			;;
		esac
		;;
	esac
	put "_replicator/$1" "{$body,\"edge_init_hash\":\"$hash\"}"
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
#    credential ฝั่ง central ชุดเดียวทุก job (central admin — decision sync 2026-10-05)
LOC_AUTH=$(auth "$COUCHDB_USER" "$COUCHDB_PASSWORD")
CEN_AUTH=$(auth "$CENTRAL_REPL_USER" "$CENTRAL_REPL_PASSWORD")

job registry_pull "$CEN/registry" "$CEN_AUTH" "$LOC/registry" "$LOC_AUTH"
job catalog_pull "$CEN/catalog" "$CEN_AUTH" "$LOC/catalog" "$LOC_AUTH"
job "${CODE_LC}_pull" "$CEN/$SHELTER_DB" "$CEN_AUTH" "$LOC/$SHELTER_DB" "$LOC_AUTH"
job "${CODE_LC}_push" "$LOC/$SHELTER_DB" "$LOC_AUTH" "$CEN/$SHELTER_DB" "$CEN_AUTH"

# _users ที่ central อ่านได้เฉพาะ server admin → CENTRAL_REPL_USER ต้องเป็น central admin
# CR-171: selector ประเมินเฉพาะ revision ใหม่ — revision ที่ถอด role ออกจะหลุด selector `roles` และไม่ถึง edge
# จึงกรองด้วย `edge_shelters` (append-only; ไม่เคยถูกถอด) แล้ว OR กับ `roles` กันช่วงก่อน backfill
# (`pnpm backfill:edge-shelters`). SHELTER_CODE เป็นตัวพิมพ์ใหญ่เหมือนใน roles (SH001)
job "users_${CODE_LC}_pull" "$CEN/_users" "$CEN_AUTH" "$LOC/_users" "$LOC_AUTH" \
	"\"selector\":{\"\$or\":[{\"edge_shelters\":{\"\$elemMatch\":{\"\$eq\":\"${SHELTER_CODE}\"}}},{\"roles\":{\"\$elemMatch\":{\"\$eq\":\"${ROLE}\"}}}]}"

echo "== done — ดูสถานะ: curl -s \$E/_scheduler/docs/_replicator"
