#!/bin/sh
# Pre-push unit tests (lefthook `frontend-test`). Runs only the Vitest files whose import graph
# reaches a file changed since the merge-base with origin/develop (plus staged/unstaged edits).
# Vitest cannot find the importers of a file that no longer exists, so when a non-test file under
# frontend/ was deleted or renamed this runs the whole suite instead.
set -eu
base="${TEST_CHANGED_BASE:-origin/develop}"

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
