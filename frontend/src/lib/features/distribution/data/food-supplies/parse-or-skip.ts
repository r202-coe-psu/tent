/** A document a list read left out because it failed schema validation. */
export interface SkippedDoc {
	_id: string;
	type: string;
	reason: string;
}

type SafeParser = {
	safeParse(
		input: unknown
	):
		| { success: true; data: unknown }
		| { success: false; error: { issues: ReadonlyArray<{ message: string }> } };
};

/**
 * Parses each doc with `schema`. Docs that fail are left out and reported in `skipped` instead of
 * failing the whole batch: one malformed doc must not break a shelter-wide read.
 */
export function parseDocsOrSkip<T>(
	docs: readonly unknown[],
	schema: SafeParser
): { items: T[]; skipped: SkippedDoc[] } {
	const items: T[] = [];
	const skipped: SkippedDoc[] = [];
	for (const doc of docs) {
		const result = schema.safeParse(doc);
		if (result.success) {
			items.push(result.data as T);
			continue;
		}
		const raw = (doc ?? {}) as { _id?: unknown; type?: unknown };
		skipped.push({
			_id: typeof raw._id === 'string' ? raw._id : '',
			type: typeof raw.type === 'string' ? raw.type : '',
			reason: result.error.issues[0]?.message ?? 'invalid document'
		});
	}
	return { items, skipped };
}
