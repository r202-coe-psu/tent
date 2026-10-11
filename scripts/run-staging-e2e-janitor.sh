#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly JANITOR_JS="${SCRIPT_DIR}/staging-e2e-janitor.mjs"

dry_run=true
max_age_hours="${JANITOR_MAX_AGE_HOURS:-6}"

usage() {
	printf 'Usage: %s [--dry-run|--execute] [--max-age-hours=N]\n' "${0##*/}"
	printf '  Default is --dry-run. Requires COUCHDB_ADMIN_URL.\n'
	printf '  Optional JANITOR_MAX_AGE_HOURS env (default 6).\n'
}

while (($# > 0)); do
	case "$1" in
		--dry-run)
			dry_run=true
			;;
		--execute)
			dry_run=false
			;;
		--max-age-hours=*)
			max_age_hours="${1#--max-age-hours=}"
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			usage >&2
			printf 'Error: unknown argument: %s\n' "$1" >&2
			exit 2
			;;
	esac
	shift
done

if [[ -z "${COUCHDB_ADMIN_URL:-}" ]]; then
	printf 'Error: COUCHDB_ADMIN_URL is required.\n' >&2
	exit 2
fi

command -v node >/dev/null 2>&1 || {
	printf 'Error: node is required to run the janitor.\n' >&2
	exit 1
}

args=(--max-age-hours="${max_age_hours}")
if [[ "${dry_run}" == true ]]; then
	args+=(--dry-run)
else
	args+=(--execute)
fi

printf 'Running staging E2E janitor (%s, max-age=%sh)...\n' \
	"$([[ "${dry_run}" == true ]] && echo dry-run || echo execute)" \
	"${max_age_hours}"
exec node "${JANITOR_JS}" "${args[@]}"
