#!/bin/sh
# Pre-push unit tests (lefthook `frontend-test`). Runs only the Vitest files whose import graph
# reaches a frontend file changed by this branch's own commits since its last push. Commits
# already on origin/develop are left out, so merging develop does not re-test develop
# (../../scripts/hooks/own-push-files.sh; TEST_CHANGED_BASE overrides the base).
#
# The whole suite runs instead when the list has a config, lockfile or test-setup file (the same
# set as forceRerunTriggers in vite.config.ts, which `vitest related` does not apply), or when a
# non-test file was deleted or renamed (Vitest cannot find the importers of a missing file).
set -eu
# Git exports GIT_DIR to hooks. In a linked worktree that makes git treat this cwd (frontend/) as
# the work tree root. Drop it and let git find the repository from the cwd.
unset GIT_DIR GIT_WORK_TREE

own_files="$(git rev-parse --show-toplevel)/scripts/hooks/own-push-files.sh"
frontend_only() { sed -n 's|^frontend/||p'; }

files=$(sh "$own_files" | frontend_only)
echo "test:changed: base ${TEST_CHANGED_BASE:-last push}, $(printf '%s' "$files" | grep -c . || true) frontend file(s)"

if [ -z "$files" ]; then
	echo 'test:changed: no frontend files changed, nothing to run'
	exit 0
fi

removed=$(sh "$own_files" --deleted | frontend_only | grep -vE '\.(test|spec)\.[jt]s$' | head -n 1 || true)
if [ -n "$removed" ]; then
	echo "test:changed: $removed was deleted or renamed, running the full suite"
	exec vitest run
fi

trigger=$(printf '%s\n' "$files" | grep -E \
	'(^|/)(package\.json|pnpm-lock\.yaml|svelte\.config\.js|tsconfig\.json|(vite|vitest)\.config\.[^/]+)$|^src/lib/testing/|^src/app\.css$' |
	head -n 1 || true)
if [ -n "$trigger" ]; then
	echo "test:changed: $trigger changed, running the full suite"
	exec vitest run
fi

# One path per word: frontend paths have no spaces. set -f keeps `[id]` route dirs literal.
set -f
# shellcheck disable=SC2086
exec vitest related --run --passWithNoTests $files
