#!/bin/sh
# Pre-push unit tests (lefthook `frontend-test`). Runs only the Vitest files whose import graph
# reaches a file changed since the base (plus staged/unstaged edits).
#
# Base: TEST_CHANGED_BASE, else what this branch last pushed (`@{push}`, or `origin/<branch>`
# when no upstream is set), else origin/develop. So a second push re-tests only the new commits;
# the earlier ones already passed this hook when they were pushed.
#
# Vitest cannot find the importers of a file that no longer exists, so when a non-test file under
# frontend/ was deleted or renamed this runs the whole suite instead.
set -eu
# Git exports GIT_DIR to hooks. In a linked worktree that makes git treat this cwd (frontend/) as
# the work tree root, so every file outside it looks deleted and the full suite runs. Drop it and
# let git find the repository from the cwd.
unset GIT_DIR GIT_WORK_TREE

pushed_ref() {
	git rev-parse --verify -q --symbolic-full-name '@{push}' 2>/dev/null && return
	branch=$(git branch --show-current)
	[ -n "$branch" ] && git rev-parse --verify -q "refs/remotes/origin/$branch" >/dev/null &&
		echo "refs/remotes/origin/$branch"
}

if [ -n "${TEST_CHANGED_BASE:-}" ]; then
	base=$TEST_CHANGED_BASE
elif ref=$(pushed_ref) && [ -n "$ref" ]; then
	base=$ref
else
	base=origin/develop
fi
echo "test:changed: base $base"

removed=$(
	{
		git diff --name-only --diff-filter=DR "$base...HEAD" -- .
		git diff --cached --name-only --diff-filter=DR -- .
		git ls-files --deleted -- .
	} | grep -vE '\.(test|spec)\.[jt]s$' | head -n 1
)

if [ -n "$removed" ]; then
	echo "test:changed: $removed was deleted or renamed, running the full suite"
	exec vitest run
fi
exec vitest run --changed "$base" --passWithNoTests
