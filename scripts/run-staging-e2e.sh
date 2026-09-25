#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly FRONTEND_DIR="${REPO_ROOT}/frontend"
readonly IMAGE_NAME="${STAGING_E2E_IMAGE:-tent-staging-e2e:local}"
readonly ENV_FILE="${E2E_ENV_FILE:-${FRONTEND_DIR}/e2e/.env}"
readonly CONTAINER_NAME="tent-staging-e2e-$(date +%s)-$$"

build_image=true

usage() {
	printf 'Usage: %s [--no-build]\n' "${0##*/}"
	printf '  --no-build  Reuse STAGING_E2E_IMAGE without rebuilding it.\n'
	printf '  Reads frontend/e2e/.env when present; override its path with E2E_ENV_FILE.\n'
}

while (($# > 0)); do
	case "$1" in
		--no-build)
			build_image=false
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

fail() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

if [[ -n "${E2E_ENV_FILE:-}" && ! -f "${ENV_FILE}" ]]; then
	fail "E2E_ENV_FILE does not exist: ${ENV_FILE}"
fi

env_file_has_value() {
	local key="$1"
	[[ -f "${ENV_FILE}" ]] && grep -Eq "^[[:space:]]*${key}[[:space:]]*=[[:space:]]*[^[:space:]]" "${ENV_FILE}"
}

command -v docker >/dev/null 2>&1 || fail 'Docker is required to run the Staging E2E suite.'
docker info >/dev/null 2>&1 || fail 'Docker daemon is not available to the current user.'

if [[ -n "${STAGING_URL:-}" && -z "${E2E_BASE_URL:-}" ]]; then
	export E2E_BASE_URL="${STAGING_URL}"
fi

if [[ -n "${E2E_BASE_URL:-}" ]]; then
	[[ "${E2E_BASE_URL}" =~ ^https://[^/]+/?$ ]] || fail 'E2E_BASE_URL must be an HTTPS origin without a path.'
fi

if [[ -z "${E2E_ADMIN_USERNAME:-}" && -z "${E2E_USERNAME:-}" ]] &&
	! env_file_has_value E2E_ADMIN_USERNAME && ! env_file_has_value E2E_USERNAME; then
	fail 'Set E2E_ADMIN_USERNAME or define it in frontend/e2e/.env.'
fi

if [[ -z "${E2E_ADMIN_PASSWORD:-}" && -z "${E2E_PASSWORD:-}" ]] &&
	! env_file_has_value E2E_ADMIN_PASSWORD && ! env_file_has_value E2E_PASSWORD; then
	if [[ -t 0 ]]; then
		read -r -s -p 'Staging E2E password: ' E2E_ADMIN_PASSWORD
		printf '\n'
		export E2E_ADMIN_PASSWORD
	else
		fail 'Set E2E_ADMIN_PASSWORD or define it in frontend/e2e/.env when running non-interactively.'
	fi
fi

cleanup() {
	docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
	unset E2E_ADMIN_PASSWORD E2E_PASSWORD
}
trap cleanup EXIT

mkdir -p \
	"${FRONTEND_DIR}/test-results" \
	"${FRONTEND_DIR}/playwright-report"

if [[ "${build_image}" == true ]]; then
	printf 'Building the pinned Staging E2E runner...\n'
	docker build \
		--file "${FRONTEND_DIR}/Dockerfile.e2e-staging" \
		--tag "${IMAGE_NAME}" \
		"${FRONTEND_DIR}"
else
	docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1 ||
		fail "Docker image ${IMAGE_NAME} does not exist; run without --no-build first."
fi

printf 'Running Staging smoke tests...\n'
docker_env_args=()
if [[ -f "${ENV_FILE}" ]]; then
	docker_env_args+=(--env-file "${ENV_FILE}")
fi

for env_name in E2E_BASE_URL E2E_ADMIN_USERNAME E2E_ADMIN_PASSWORD E2E_USERNAME E2E_PASSWORD; do
	if [[ -n "${!env_name:-}" ]]; then
		docker_env_args+=(--env "${env_name}")
	fi
done

set +e
docker run --name "${CONTAINER_NAME}" \
	--ipc=host \
	"${docker_env_args[@]}" \
	--env CI \
	--env HOME=/tmp \
	"${IMAGE_NAME}"
status=$?
set -e

artifact_status=0
if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
	for artifact_dir in test-results playwright-report; do
		if ! docker cp \
			"${CONTAINER_NAME}:/work/frontend/${artifact_dir}/." \
			"${FRONTEND_DIR}/${artifact_dir}/"; then
			printf 'Warning: could not copy %s from the E2E container.\n' "${artifact_dir}" >&2
			artifact_status=1
		fi
	done
else
	printf 'Warning: E2E container was not available for artifact collection.\n' >&2
	artifact_status=1
fi

printf 'HTML report: %s\n' "${FRONTEND_DIR}/playwright-report/staging/index.html"
if [[ "${status}" -eq 0 && "${artifact_status}" -ne 0 ]]; then
	status=1
fi
exit "${status}"
