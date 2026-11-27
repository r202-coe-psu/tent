#!/bin/sh
# Pre-push file list (lefthook `files:`): files changed by this branch's own commits since its
# last push, as repo-relative paths. Commits already on origin/develop are left out, so merging
# develop into a branch does not re-test develop's changes. Files edited while resolving a merge
# conflict are kept.
#
# Base: TEST_CHANGED_BASE, else what this branch last pushed (`@{push}`, or `origin/<branch>`
# when no upstream is set). With none, only origin/develop is excluded.
#
# --deleted lists only files deleted or renamed away by those commits.
set -eu
# Git exports GIT_DIR to hooks. In a linked worktree that breaks repo discovery from a subdirectory.
unset GIT_DIR GIT_WORK_TREE
cd "$(git rev-parse --show-toplevel)"

filter=
[ "${1:-}" = "--deleted" ] && filter=--diff-filter=DR

pushed_ref() {
	git rev-parse --verify -q --symbolic-full-name '@{push}' 2>/dev/null && return
	branch=$(git branch --show-current)
	[ -n "$branch" ] && git rev-parse --verify -q "refs/remotes/origin/$branch" >/dev/null &&
		echo "refs/remotes/origin/$branch"
}

if [ -n "${TEST_CHANGED_BASE:-}" ]; then
	base=$TEST_CHANGED_BASE
else
	base=$(pushed_ref || true)
fi

exclude=
git rev-parse --verify -q refs/remotes/origin/develop >/dev/null && exclude=refs/remotes/origin/develop
# shellcheck disable=SC2086 # $base/$exclude are single refs or empty
{
	git log --no-merges --no-renames $filter --format= --name-only HEAD --not $base $exclude
	for m in $(git rev-list --merges HEAD --not $base $exclude); do
		git diff-tree --cc --no-commit-id --no-renames $filter --name-only "$m"
	done
} | sed '/^$/d' | sort -u
