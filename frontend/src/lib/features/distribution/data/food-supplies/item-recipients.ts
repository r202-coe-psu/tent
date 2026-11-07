import { allDocsByType } from '$lib/db/couch-db';
import { resolveShelterDbName } from './shared';

/** One person (evacuee, volunteer or staff) who has received one item (a non-voided `distribution_log`). */
export type ItemRecipient = { item_id: string; recipient_id: string };

type RecipientLogRow = {
	item_id?: unknown;
	recipient_type?: unknown;
	recipient_id?: unknown;
	status?: unknown;
};

const COUNTED_RECIPIENT_TYPES: ReadonlySet<string> = new Set(['evacuee', 'volunteer', 'staff']);

const isRecipientLogRow = (d: unknown): d is RecipientLogRow =>
	typeof d === 'object' && d !== null && (d as { type?: unknown }).type === 'distribution_log';

/**
 * Distinct (item, recipient) pairs from the shelter's `distribution_log` docs, for the given items.
 * A log that was later returned, lost or waived still counts: the person received the item.
 * Voided logs and recipients from outside the shelter (`outside`) do not.
 */
export async function listRecipientsByItems(
	shelterCode: string,
	itemIds: readonly string[]
): Promise<ItemRecipient[]> {
	if (itemIds.length === 0) return [];
	const wanted = new Set(itemIds);
	const docs = await allDocsByType<RecipientLogRow>(
		resolveShelterDbName(shelterCode),
		'distribution_log',
		isRecipientLogRow
	);
	const seen = new Set<string>();
	const out: ItemRecipient[] = [];
	for (const log of docs) {
		const { item_id, recipient_type, recipient_id, status } = log;
		if (typeof item_id !== 'string' || !wanted.has(item_id)) continue;
		if (status === 'voided' || !COUNTED_RECIPIENT_TYPES.has(recipient_type as string)) continue;
		if (typeof recipient_id !== 'string' || !recipient_id) continue;
		const key = `${item_id}\n${recipient_id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ item_id, recipient_id });
	}
	return out;
}
