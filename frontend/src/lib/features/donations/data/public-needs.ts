/**
 * What a shelter is still asking for, as the donor-facing board sees it.
 *
 * Read through the SvelteKit BFF (`/api/public/v1/needs`, Bearer-signed on the server
 * — CR-063), the same source the donate wizard's step 1 uses. The rows carry the
 * catalog `item_id` and its `base_unit`, which is exactly what a donor edit needs: a
 * line typed by hand has no `item_id`, so it holds no quota and cannot be received
 * into stock (`toCountedItems` drops free-text lines at intake).
 */

import { addQty } from '$lib/utils/qty';

export type PublicShelterNeed = {
	item_id: string;
	name: string;
	unit: string;
	qty_needed: string;
	category?: string;
};

type RawNeed = {
	item_id?: unknown;
	name?: unknown;
	unit?: unknown;
	qty_needed?: unknown;
	category?: unknown;
	status?: unknown;
};

type RawShelter = { code?: unknown; needs?: unknown };

/** Open needs of one shelter. Returns `[]` when the board has nothing for it. */
export async function fetchShelterNeeds(shelterCode: string): Promise<PublicShelterNeed[]> {
	const code = shelterCode.trim().toUpperCase();
	if (!code) return [];

	const res = await fetch('/api/public/v1/needs');
	if (!res.ok) throw new Error('ไม่สามารถโหลดรายการที่ศูนย์ต้องการได้');

	const body = await res.json().catch(() => null);
	if (!Array.isArray(body)) return [];

	const shelter = (body as RawShelter[]).find(
		(entry) => String(entry?.code ?? '').toUpperCase() === code
	);
	const needs = Array.isArray(shelter?.needs) ? (shelter.needs as RawNeed[]) : [];

	// The board has one row per item + drop-off point (CR-206 A2), so an item can repeat.
	// A donor edit picks an item, not a card: rows of one `item_id` fold into one, summed.
	const byItem = new Map<string, PublicShelterNeed>();
	for (const need of needs) {
		// A closed need takes no more (T-22), so it must not be offerable in an edit.
		if (need?.status === 'closed' || typeof need?.item_id !== 'string') continue;
		const qty = String(need.qty_needed ?? '0');
		const seen = byItem.get(need.item_id);
		if (seen) {
			seen.qty_needed = addQty(seen.qty_needed, qty);
			continue;
		}
		byItem.set(need.item_id, {
			item_id: need.item_id,
			name: String(need.name ?? need.item_id),
			unit: String(need.unit ?? ''),
			qty_needed: qty,
			...(typeof need.category === 'string' ? { category: need.category } : {})
		});
	}
	return [...byItem.values()];
}
