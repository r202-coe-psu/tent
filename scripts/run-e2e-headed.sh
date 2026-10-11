#!/usr/bin/env bash

# Local debugging only — not used by Jenkins, not used by pnpm test:e2e. Runs
# one test (or a grep-matched group) headed, in slow motion, against either
# target:
#   local    playwright.config.ts          — builds + previews the app locally
#   staging  playwright.staging.config.ts  — hits the real remote target
#
# One-time setup: cd frontend && npx playwright install --with-deps chromium

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly FRONTEND_DIR="${REPO_ROOT}/frontend"

usage() {
	printf 'Usage: %s <local|staging> [--critical] ["<grep pattern>"] [extra playwright args...]\n' "${0##*/}"
	printf '\n'
	printf '  local    playwright.config.ts         — builds + previews the app,\n'
	printf '           reads frontend/e2e/.env\n'
	printf '  staging  playwright.staging.config.ts — hits the real remote target,\n'
	printf '           reads frontend/e2e/.env.staging\n'
	printf '           (override either path with E2E_ENV_FILE)\n'
	printf '\n'
	printf '  No pattern           run everything in that config'"'"'s own scope\n'
	printf '  --critical           only @critical (live-write) tests\n'
	printf '  --critical "<text>"  @critical tests whose title also matches <text>\n'
	printf '  "<grep pattern>"     any other grep pattern, e.g. one test or describe title\n'
	printf '\n'
	printf '  Set PW_SLOWMO in the env file or this shell to change the delay (default: 500ms).\n'
	printf '\n'
	printf 'Examples:\n'
	printf '  %s local --critical\n' "${0##*/}"
	printf '  %s staging "SA creates a shelter via system-management"\n' "${0##*/}"
}

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' || $# -eq 0 ]]; then
	usage
	exit "$([[ $# -eq 0 ]] && echo 1 || echo 0)"
fi

target="$1"
shift

case "${target}" in
	local)
		playwright_config='playwright.config.ts'
		default_env_file="${FRONTEND_DIR}/e2e/.env"
		;;
	staging)
		playwright_config='playwright.staging.config.ts'
		default_env_file="${FRONTEND_DIR}/e2e/.env.staging"
		;;
	*)
		printf 'Error: first argument must be "local" or "staging" (got "%s")\n' "${target}" >&2
		usage >&2
		exit 1
		;;
esac
readonly ENV_FILE="${E2E_ENV_FILE:-${default_env_file}}"

grep_pattern=''
mode_label="everything in ${playwright_config}'s own scope"
if [[ "${1:-}" == '--critical' ]]; then
	shift
	if (($# >= 1)) && [[ "$1" != --* ]]; then
		grep_pattern="(?=.*@critical)(?=.*${1})"
		mode_label="@critical matching \"${1}\""
		shift
	else
		grep_pattern='@critical'
		mode_label='@critical only'
	fi
elif (($# >= 1)) && [[ "$1" != --* ]]; then
	grep_pattern="$1"
	mode_label="custom pattern \"${1}\""
	shift
fi

if [[ -f "${ENV_FILE}" ]]; then
	# Parse KEY=VALUE lines ourselves (not `source`) so values containing spaces —
	# e.g. E2E_SEARCH_SHELTER_NAME=E2E Search Fixture — load correctly instead of
	# being word-split as shell commands.
	while IFS= read -r line || [[ -n "${line}" ]]; do
		line="${line%$'\r'}"
		[[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
		[[ "${line}" == *=* ]] || continue
		key="${line%%=*}"
		value="${line#*=}"
		export "${key}=${value}"
	done <"${ENV_FILE}"
elif [[ "${target}" == 'staging' ]]; then
	printf 'Error: env file not found: %s (set E2E_ENV_FILE to override)\n' "${ENV_FILE}" >&2
	exit 1
fi
# local mode: a missing .env is fine — playwright.config.ts defaults to localhost:4173.

export PW_SLOWMO="${PW_SLOWMO:-${PW_SLOW_MO:-500}}"

printf 'Target: %s\n' "${target}"
printf 'Config: %s\n' "${playwright_config}"
if [[ -f "${ENV_FILE}" ]]; then
	printf 'Env file: %s\n' "${ENV_FILE}"
else
	printf 'Env file: %s (not found — using config defaults)\n' "${ENV_FILE}"
fi
printf 'Mode: %s\n' "${mode_label}"
printf 'Slow motion: %sms\n' "${PW_SLOWMO}"
if [[ "${target}" == 'staging' ]]; then
	if [[ "${ALLOW_REMOTE_WRITES:-}" == 'true' ]]; then
		printf '@critical journeys will write to staging (ALLOW_REMOTE_WRITES=true).\n'
	else
		printf '@critical journeys stay read-only/skipped (ALLOW_REMOTE_WRITES is not "true").\n'
	fi
fi

cd "${FRONTEND_DIR}"

skip_build=false
for arg in "$@"; do
	[[ "${arg}" == '--list' ]] && skip_build=true
done

# Kill anything already bound to the local webServer ports before each run,
# instead of letting Playwright's reuseExistingServer silently reuse a server
# from an earlier run — adapter-node's preview process runs the real backend
# (not just static files), so once one request crashes it, every later test
# gets ERR_CONNECTION_REFUSED with no obvious cause tying back to that crash.
if [[ "${target}" == 'local' && "${skip_build}" == false ]]; then
	app_port="4173"
	if [[ -n "${PLAYWRIGHT_TEST_BASE_URL:-}" ]]; then
		port_from_url="$(printf '%s' "${PLAYWRIGHT_TEST_BASE_URL}" | sed -En 's#^[a-zA-Z]+://[^/:]+:([0-9]+).*#\1#p')"
		[[ -n "${port_from_url}" ]] && app_port="${port_from_url}"
	fi
	for port in "${app_port}" 9001; do
		# `|| true`: under `set -e -o pipefail`, grep finding nothing (the common
		# case — no stale process) makes the whole pipeline exit non-zero, which
		# would silently kill this script right here with no other output.
		pids="$(ss -tlnp 2>/dev/null | grep -E ":${port}\b" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
		for pid in ${pids}; do
			printf 'Killing stale process on port %s (pid %s) from an earlier run...\n' "${port}" "${pid}"
			kill "${pid}" 2>/dev/null || true
		done
	done

	printf 'Building the app (vite build --mode test)...\n'
	pnpm exec vite build --mode test
fi

grep_args=()
if [[ -n "${grep_pattern}" ]]; then
	grep_args=(-g "${grep_pattern}")
fi
exec npx playwright test \
	--config="${playwright_config}" \
	--headed \
	--workers=1 \
	--timeout=120000 \
	"${grep_args[@]}" \
	"$@"
