export interface BulkWriteResult {
	id: string;
	ok?: boolean;
	error?: string;
	reason?: string;
}

/**
 * Return the exclusive ASCII upper bound for a type-prefixed CouchDB `_all_docs` scan.
 *
 * CouchDB's string collation does not reliably treat U+FFF0 as a high sentinel for these
 * persisted IDs. All seed document prefixes end with `:`, so `;` is the next ASCII character
 * and covers every ID beginning with the prefix without relying on Unicode collation.
 */
export function prefixRangeEnd(prefix: string): string {
	if (!prefix.endsWith(':')) {
		throw new Error(`CouchDB prefix must end with ':'; received ${prefix}`);
	}
	return `${prefix.slice(0, -1)};`;
}

/** Fail a seed write when CouchDB rejected any document that the caller did not permit. */
export function assertBulkWriteResults(
	db: string,
	results: BulkWriteResult[],
	options: { allowConflicts?: boolean } = { allowConflicts: true }
): void {
	const errors = results.filter(
		(result) => result.error && (!options.allowConflicts || result.error !== 'conflict')
	);
	if (errors.length) {
		throw new Error(
			`_bulk_docs to "${db}" returned document errors: ${JSON.stringify(errors.slice(0, 5))}`
		);
	}
}

/** Verify an exact expected date window while allowing explicitly reported historical extras. */
export function inspectDateWindow(
	actualDates: Iterable<string>,
	expectedDates: readonly string[]
): { missingDates: string[]; extraDates: string[] } {
	const actual = new Set(actualDates);
	return {
		missingDates: expectedDates.filter((date) => !actual.has(date)),
		extraDates: [...actual].filter((date) => !expectedDates.includes(date)).sort()
	};
}
