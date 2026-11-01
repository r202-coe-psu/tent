/** Ledger `ref_id` → label; `null` = read already, nothing better than `shortLedgerRef` (#811). */
export type LedgerRefLabels = ReadonlyMap<string, string | null>;

/**
 * A short, stable stand-in for a ledger's `ref_id` list in a query key (count + 32-bit FNV-1a),
 * so the key does not grow with the ledger's thousands of rows.
 */
export function digestRefIds(ids: readonly string[]): string {
	let hash = 0x811c9dc5;
	for (const id of ids) {
		// `\n` between ids keeps ['ab', 'c'] apart from ['a', 'bc'].
		for (const char of `${id}\n`) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 0x01000193);
		}
	}
	return `${ids.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Labels for `ids`, taking each one an earlier result already labelled from `cached` and reading
 * only the rest — so a new ledger row reads its own doc, not the whole ledger's again. An id that
 * had no label is read again: its doc may have arrived or gained the field since.
 */
export async function resolveLedgerRefLabels(
	ids: readonly string[],
	cached: Iterable<LedgerRefLabels | undefined>,
	read: (missing: string[]) => Promise<ReadonlyMap<string, string>>
): Promise<LedgerRefLabels> {
	const known = new Map<string, string>();
	for (const labels of cached) {
		for (const [id, label] of labels ?? []) if (label !== null) known.set(id, label);
	}

	const missing = ids.filter((id) => !known.has(id));
	const fetched = missing.length > 0 ? await read(missing) : new Map<string, string>();
	return new Map(ids.map((id) => [id, known.get(id) ?? fetched.get(id) ?? null]));
}
