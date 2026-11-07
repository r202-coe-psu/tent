import { allDocsByType } from '$lib/db/couch-db';
import { resolveShelterDbName } from './shared';

/** One non-voided `distribution_log` of an item: who got it and how many units. */
export type ItemDistribution = {
	item_id: string;
	/** `evacuee`, `volunteer`, `staff` or `outside`. */
	recipient_type: string;
	/** Null for an `outside` recipient. */
	recipient_id: string | null;
	/** Units handed out (qty_str). */
	qty: string;
	/** Units that came back (qty_str), `'0'` when none. */
	qty_returned: string;
};

type DistributionLogRow = {
	item_id?: unknown;
	recipient_type?: unknown;
	recipient_id?: unknown;
	status?: unknown;
	qty?: unknown;
	qty_returned?: unknown;
};

const isDistributionLogRow = (d: unknown): d is DistributionLogRow =>
	typeof d === 'object' && d !== null && (d as { type?: unknown }).type === 'distribution_log';

const qtyStr = (value: unknown) =>
	typeof value === 'string' || typeof value === 'number' ? String(value) : '0';

/**
 * The shelter's non-voided `distribution_log` docs for the given items, one row per log. A log that
 * was later returned, lost or waived is still listed: the unit left the warehouse and the person
 * received it. The caller decides what counts (people, units).
 */
export async function listItemDistributions(
	shelterCode: string,
	itemIds: readonly string[]
): Promise<ItemDistribution[]> {
	if (itemIds.length === 0) return [];
	const wanted = new Set(itemIds);
	const docs = await allDocsByType<DistributionLogRow>(
		resolveShelterDbName(shelterCode),
		'distribution_log',
		isDistributionLogRow
	);
	const out: ItemDistribution[] = [];
	for (const log of docs) {
		const { item_id, recipient_type, recipient_id, status } = log;
		if (typeof item_id !== 'string' || !wanted.has(item_id) || status === 'voided') continue;
		out.push({
			item_id,
			recipient_type: typeof recipient_type === 'string' ? recipient_type : '',
			recipient_id: typeof recipient_id === 'string' && recipient_id ? recipient_id : null,
			qty: qtyStr(log.qty),
			qty_returned: qtyStr(log.qty_returned)
		});
	}
	return out;
}
