import { adminRaw } from '$lib/server/couch-admin';
import { lotDateStamp, nextLotNos } from '$lib/features/operations/server';

/**
 * Mint `count` lot numbers for a shelter DB, continuing after the highest
 * `L-YYMMDD-XXX` already on that day's ledger rows (CR-088 · schema.md §2.1).
 *
 * **Server-only** (admin credentials). The sequence is scoped per shelter DB and
 * per day, which is exactly how staff read the label off a box.
 *
 * Deliberately NOT atomic: the lot number is a human-readable label, so two
 * concurrent receives colliding on one sequence produces a duplicate label and
 * nothing more — balances come from `qty`, never from this string. CR-088
 * accepts that risk instead of introducing a counter doc.
 */
export async function allocateLotNos(
	dbName: string,
	count: number,
	when: Date = new Date()
): Promise<string[]> {
	if (count <= 0) return [];

	// Scoped to THIS day's prefix on purpose. A blanket "lot_no exists" selector
	// with a row cap could return 10k old labels and none of today's, which would
	// silently restart the sequence at 001 and duplicate every label of the day.
	const prefix = `L-${lotDateStamp(when)}-`;
	const res = await adminRaw(`/${dbName}/_find`, 'POST', {
		selector: {
			type: 'stock_ledger',
			'lot.lot_no': { $gte: prefix, $lt: `${prefix}\ufff0` }
		},
		fields: ['lot.lot_no'],
		limit: 10_000
	});

	// A failed lookup must not block goods from being received — restart the
	// day's sequence rather than throwing. A duplicate label is recoverable;
	// a blocked intake at the gate is not.
	const docs =
		res.status >= 400 ? [] : ((res.data as { docs?: { lot?: { lot_no?: string } }[] })?.docs ?? []);
	const existing = docs.map((d) => d.lot?.lot_no).filter((v): v is string => typeof v === 'string');

	return nextLotNos(existing, when, count);
}
