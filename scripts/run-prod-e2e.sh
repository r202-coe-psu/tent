#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly FRONTEND_DIR="${REPO_ROOT}/frontend"
readonly IMAGE_NAME="${PROD_E2E_IMAGE:-${STAGING_E2E_IMAGE:-tent-staging-e2e:local}}"
readonly ENV_FILE="${E2E_ENV_FILE:-${FRONTEND_DIR}/e2e/.env}"
readonly CONTAINER_NAME="tent-prod-e2e-$(date +%s)-$$"

build_image=true

usage() {
	printf 'Usage: %s [--no-build]\n' "${0##*/}"
	printf '  --no-build  Reuse STAGING_E2E_IMAGE / PROD_E2E_IMAGE without rebuilding it.\n'
	printf '  Runs read-only @prod Playwright smoke against E2E_BASE_URL (< 2 min).\n'
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

command -v docker >/dev/null 2>&1 || fail 'Docker is required to run the production E2E smoke.'
docker info >/dev/null 2>&1 || fail 'Docker daemon is not available to the current user.'

if [[ -n "${PROD_URL:-}" && -z "${E2E_BASE_URL:-}" ]]; then
	export E2E_BASE_URL="${PROD_URL}"
fi

[[ -n "${E2E_BASE_URL:-}" ]] || fail 'Set E2E_BASE_URL (or PROD_URL) to the production HTTPS origin.'
[[ "${E2E_BASE_URL}" =~ ^https://[^/]+/?$ ]] || fail 'E2E_BASE_URL must be an HTTPS origin without a path.'

cleanup() {
	docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p \
	"${FRONTEND_DIR}/test-results" \
	"${FRONTEND_DIR}/playwright-report"

if [[ "${build_image}" == true ]]; then
	printf 'Building the pinned E2E runner (shared staging/prod image)...\n'
	docker build \
		--file "${FRONTEND_DIR}/Dockerfile.e2e-staging" \
		--tag "${IMAGE_NAME}" \
		"${FRONTEND_DIR}"
else
	docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1 ||
		fail "Docker image ${IMAGE_NAME} does not exist; run without --no-build first."
fi

printf 'Running production @prod smoke against %s...\n' "${E2E_BASE_URL}"
docker_env_args=(--env "E2E_BASE_URL=${E2E_BASE_URL}" --env CI --env HOME=/tmp)
if [[ -f "${ENV_FILE}" ]]; then
	docker_env_args+=(--env-file "${ENV_FILE}")
fi

set +e
docker run --name "${CONTAINER_NAME}" \
	--ipc=host \
	"${docker_env_args[@]}" \
	"${IMAGE_NAME}" \
	./node_modules/.bin/playwright test --config=playwright.prod.config.ts
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

printf 'HTML report: %s\n' "${FRONTEND_DIR}/playwright-report/prod/index.html"
if [[ "${status}" -eq 0 && "${artifact_status}" -ne 0 ]]; then
	status=1
fi
exit "${status}"
