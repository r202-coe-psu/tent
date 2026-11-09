#!/bin/sh
# Provision edge CouchDB สำหรับ 1 ศูนย์ (CR-064) — รันโดย service `edge-init` ใน docker-compose.edge.yml
#
#   1. สร้าง registry / catalog / shelter_<code> + _security (ไม่ replicate จาก central — data-model §6)
#   2. _design/edge_readonly บน registry / catalog (one-way — staff เขียนที่ edge ไม่ได้)
#   3. _replicator jobs: registry / catalog / shelter pull, shelter push, _users pull จาก edge_users_<code>
#
# credential ฝั่ง central = user ต่อศูนย์ (role `repl:<SHELTER_CODE>`, ไม่ใช่ admin) สร้างที่ central ด้วย
# `scripts/central-repl-user.sh <CODE>` — edge ไม่ถือ central admin (draft CR #1298, แทน OD-6 ของ CR-064)
#
# Idempotent: DB ที่มีอยู่แล้ว (412) และ doc ที่มีอยู่แล้ว (409) จะถูกข้าม · job ใน _replicator ที่ config
# (SYNC_URL / credential / SHELTER_CODE) ไม่ตรงกับ .env ปัจจุบันจะถูกลบแล้วสร้างใหม่ (`stale`) — แก้ .env แล้ว
# รัน `docker compose -f docker-compose.edge.yml run --rm edge-init` ได้เลย ไม่ต้อง kick เอง
set -eu

: "${COUCHDB_USER:?}" "${COUCHDB_PASSWORD:?}" "${SHELTER_CODE:?}" "${SYNC_URL:?}"
: "${EDGE_REPL_USER:?}" "${EDGE_REPL_PASSWORD:?}"

E="http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@couchdb:5984"
# URL ใน replication doc ถูกเรียกจากภายใน container couchdb เอง
LOC="http://127.0.0.1:5984"
CEN="${SYNC_URL%/}"

CODE_LC=$(printf '%s' "$SHELTER_CODE" | tr 'A-Z' 'a-z')
SHELTER_DB="shelter_${CODE_LC}"
ROLE="shelter:${SHELTER_CODE}"

put() { # put <path> <json> — แสดงเฉพาะ response (payload ของ job มีรหัสผ่าน)
	status=$(curl -s -o /tmp/edge-init.out -w '%{http_code}' -X PUT "$E/$1" \
		-H 'Content-Type: application/json' -d "$2") || true
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
	cur_status=$(curl -s -o /tmp/edge-init.cur -w '%{http_code}' "$E/_replicator/$1") || true
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
		status=$(curl -s -o /tmp/edge-init.out -w '%{http_code}' -X DELETE "$E/_replicator/$1?rev=$rev") || true
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

# 2.5) กัน SYNC_URL ชี้กลับมาที่ edge ตัวเอง (เช่น LAN DNS ยังชี้ domain แอปมาที่ edge) — ถ้าไม่เช็ก job จะขึ้น
#      `running` error_count 0 ทั้งที่ replicate เข้าตัวเอง · เทียบ `uuid` จาก GET / ของ central กับ edge
uuid_of() { # uuid_of <file> — ดึง "uuid" จาก welcome JSON ของ CouchDB
	sed -n 's/.*"uuid":"\([^"]*\)".*/\1/p' "$1" | head -1
}
: >/tmp/edge-init.cen
cen_status=$(curl -s -o /tmp/edge-init.cen -w '%{http_code}' \
	-u "${EDGE_REPL_USER}:${EDGE_REPL_PASSWORD}" "$CEN/") || true
CEN_UUID=$(uuid_of /tmp/edge-init.cen)
if [ "$cen_status" != 200 ] || [ -z "$CEN_UUID" ]; then
	echo "FAILED  อ่าน GET / ของ central (${CEN}/) ไม่ได้ (HTTP $cen_status) — ตรวจ SYNC_URL / credential / network ก่อนสร้าง job"
	exit 1
fi
: >/tmp/edge-init.loc
edge_status=$(curl -s -o /tmp/edge-init.loc -w '%{http_code}' "$E/") || true
EDGE_UUID=$(uuid_of /tmp/edge-init.loc)
if [ "$edge_status" != 200 ] || [ -z "$EDGE_UUID" ]; then
	echo "FAILED  อ่าน GET / ของ edge ไม่ได้ (HTTP $edge_status)"
	exit 1
fi
if [ "$CEN_UUID" = "$EDGE_UUID" ]; then
	echo "FAILED  SYNC_URL (${CEN}) ชี้กลับมาที่ edge ตัวเอง (uuid ตรงกัน: ${EDGE_UUID}) — ตรวจ SYNC_URL ใน .env และ LAN DNS ของ domain central"
	exit 1
fi
echo "ok      central uuid ${CEN_UUID} ≠ edge uuid ${EDGE_UUID}"

# 2.6) FR-16 (draft CR #1298): credential ต้องเป็น user ต่อศูนย์ role `repl:<SHELTER_CODE>` เท่านั้น — ห้ามเป็น `_admin`
#      (กันเอา central admin มาใส่ซ้ำ) · GET /_session ด้วย basic auth ของ EDGE_REPL_*
: >/tmp/edge-init.ses
ses_status=$(curl -s -o /tmp/edge-init.ses -w '%{http_code}' \
	-u "${EDGE_REPL_USER}:${EDGE_REPL_PASSWORD}" "$CEN/_session") || true
if [ "$ses_status" != 200 ]; then
	echo "FAILED  GET ${CEN}/_session ด้วย EDGE_REPL_USER ไม่ผ่าน (HTTP $ses_status) — ตรวจ EDGE_REPL_USER / EDGE_REPL_PASSWORD (สร้างด้วย scripts/central-repl-user.sh ${SHELTER_CODE} ที่ central)"
	exit 1
fi
SES_ROLES=$(sed -n 's/.*"roles":\[\([^]]*\)\].*/\1/p' /tmp/edge-init.ses | head -1)
case "$SES_ROLES" in
*'"_admin"'*)
	echo "FAILED  EDGE_REPL_USER มี role _admin — ห้ามใช้ central admin — สร้าง user ด้วย scripts/central-repl-user.sh ${SHELTER_CODE} ที่ central"
	exit 1
	;;
*"\"repl:${SHELTER_CODE}\""*) ;;
*)
	echo "FAILED  EDGE_REPL_USER ไม่มี role repl:${SHELTER_CODE} (roles: ${SES_ROLES:-ว่าง}) — ใช้ user ของศูนย์นี้ที่สร้างด้วย scripts/central-repl-user.sh ${SHELTER_CODE} ที่ central"
	exit 1
	;;
esac
echo "ok      central session: EDGE_REPL_USER มี role repl:${SHELTER_CODE} และไม่ใช่ admin"

# 3) replication jobs — edge เป็นฝ่ายเปิด connection ไปหา central เสมอ
#    credential ฝั่ง central ชุดเดียวทุก job = user ต่อศูนย์ role `repl:<SHELTER_CODE>` (ตรวจแล้วที่ 2.6; draft CR #1298)
LOC_AUTH=$(auth "$COUCHDB_USER" "$COUCHDB_PASSWORD")
CEN_AUTH=$(auth "$EDGE_REPL_USER" "$EDGE_REPL_PASSWORD")

job registry_pull "$CEN/registry" "$CEN_AUTH" "$LOC/registry" "$LOC_AUTH"
job catalog_pull "$CEN/catalog" "$CEN_AUTH" "$LOC/catalog" "$LOC_AUTH"
job "${CODE_LC}_pull" "$CEN/$SHELTER_DB" "$CEN_AUTH" "$LOC/$SHELTER_DB" "$LOC_AUTH"
# กรอง `_design/*` ออกจาก push — กันอุบัติเหตุ / edge ที่มี design doc เก่ากว่า central · ไม่ใช่ตัวกั้นความปลอดภัย:
# ของจริงคือ credential ต่อศูนย์ (`repl:<CODE>`) ที่เข้าได้เฉพาะ shelter_<code> / edge_users_<code> และ VDU ของ
# shelter_<code> ที่ central (draft CR #1298 แทน OD-6 — edge ไม่ถือ central admin)
job "${CODE_LC}_push" "$LOC/$SHELTER_DB" "$LOC_AUTH" "$CEN/$SHELTER_DB" "$CEN_AUTH" \
	"\"selector\":{\"_id\":{\"\$not\":{\"\$regex\":\"^_design/\"}}}"

# _users: pull จาก DB `edge_users_<code>` ที่ central ซึ่งมีเฉพาะ _users doc ของศูนย์นี้อยู่แล้ว (FR-15)
# CR-171 selector (`edge_shelters` OR `roles`) ย้ายไปอยู่ใน job `_replicator` ฝั่ง central ที่ copy
# `_users` → `edge_users_<code>` (scripts/central-repl-user.sh) — ฝั่ง edge จึงไม่กรอง user (draft CR #1298)
# กรองแค่ `_design/*`: `_design/readonly` ของ edge_users_<code> (เขียนได้เฉพาะ _admin) ไม่ใช่ของ _users ที่ edge
job "users_${CODE_LC}_pull" "$CEN/edge_users_${CODE_LC}" "$CEN_AUTH" "$LOC/_users" "$LOC_AUTH" \
	"\"selector\":{\"_id\":{\"\$not\":{\"\$regex\":\"^_design/\"}}}"

echo "== done — ดูสถานะ: curl -s \$E/_scheduler/docs/_replicator"
