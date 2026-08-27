/** A line as the edit form sends it: `item_id` is whatever the client was handed. */
export type BareItem = {
	item_id?: string | null;
	free_text?: string | null;
	item_name?: string | null;
	qty: string | number;
	unit?: string | null;
};

/**
 * Re-attach the `item_id` this booking already holds for a line that came back bare.
 *
 * The edit form returns the whole basket, so it can only send an `item_id` it was handed.
 * Anything upstream that loses one — a tracking stub written before the field existed, a
 * stale cache, an older client — makes the line look untracked. FastAPI already repairs
 * this (`_carry_item_ids`) before it moves the counter, but the BFF's headroom pre-check
 * runs *earlier*, on the raw payload. A bare line therefore matched no need, counted as
 * "not quota-tracked", passed the check untouched, and was then reserved by FastAPI
 * against the identity it had just restored — which is how a booking was raised past its
 * target with the pre-check live and working.
 *
 * So both halves resolve identity the same way, from this booking's own record rather
 * than from the request. This is not the free-text heuristic the public side rejected:
 * nothing is inferred from arbitrary words, the name is only matched against the handful
 * of lines this donation already has, and an unmatched line stays untracked as before.
 */
export function carryItemIds<T extends BareItem>(items: T[], held: BareItem[]): T[] {
	const byName = new Map<string, string>();
	for (const line of held) {
		const name = String(line.free_text ?? line.item_name ?? '').trim();
		if (name && line.item_id && !byName.has(name)) byName.set(name, line.item_id);
	}
	if (byName.size === 0) return items;

	return items.map((item) => {
		if (item.item_id) return item;
		const carried = byName.get(String(item.free_text ?? item.item_name ?? '').trim());
		return carried ? { ...item, item_id: carried } : item;
	});
}
