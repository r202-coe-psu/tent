#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly FRONTEND_DIR="${REPO_ROOT}/frontend"
readonly IMAGE_NAME="${STAGING_E2E_IMAGE:-tent-staging-e2e:local}"

export STAGING_URL="${STAGING_URL:-https://shelter.importstar.dev}"

build_image=true

usage() {
	printf 'Usage: %s [--no-build]\n' "${0##*/}"
	printf '  --no-build  Reuse STAGING_E2E_IMAGE without rebuilding it.\n'
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

command -v docker >/dev/null 2>&1 || fail 'Docker is required to run the Staging E2E suite.'
docker info >/dev/null 2>&1 || fail 'Docker daemon is not available to the current user.'

[[ "${STAGING_URL}" =~ ^https://[^/]+/?$ ]] || fail 'STAGING_URL must be an HTTPS origin without a path.'
[[ -n "${E2E_USERNAME:-}" ]] || fail 'Set E2E_USERNAME to the Staging bot username.'

if [[ -z "${E2E_PASSWORD:-}" ]]; then
	if [[ -t 0 ]]; then
		read -r -s -p 'Staging E2E password: ' E2E_PASSWORD
		printf '\n'
		export E2E_PASSWORD
	else
		fail 'Set E2E_PASSWORD when running non-interactively.'
	fi
fi

[[ -n "${E2E_PASSWORD}" ]] || fail 'E2E_PASSWORD must not be empty.'
trap 'unset E2E_PASSWORD' EXIT

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

printf 'Running Staging smoke tests against %s...\n' "${STAGING_URL}"
set +e
docker run --rm \
	--ipc=host \
	--user "$(id -u):$(id -g)" \
	--env CI \
	--env STAGING_URL \
	--env E2E_USERNAME \
	--env E2E_PASSWORD \
	--env HOME=/tmp \
	--volume "${FRONTEND_DIR}/test-results:/work/frontend/test-results" \
	--volume "${FRONTEND_DIR}/playwright-report:/work/frontend/playwright-report" \
	"${IMAGE_NAME}"
status=$?
set -e

printf 'HTML report: %s\n' "${FRONTEND_DIR}/playwright-report/staging/index.html"
exit "${status}"
