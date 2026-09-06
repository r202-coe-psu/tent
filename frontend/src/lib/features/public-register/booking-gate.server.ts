/**
 * Couch-backed helpers for the public booking Forecast gate + duplicate holds.
 */
import { adminRaw } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { sumOccupancyFromStatusRows } from '$lib/features/public-portal/server';
import {
	ACTIVE_HOLD_STATUSES,
	findDuplicateHold,
	type BookingHoldIdentity,
	type ExistingHoldCandidate
} from './domain/booking-gate';

/** Read Forecast Occupancy for a shelter from the dashboard occupancy view. */
export async function readForecastOccupancy(shelterCode: string): Promise<number | null> {
	const db = shelterDbName(shelterCode);
	try {
		const res = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');
		if (res.status >= 400) return null;
		const rows = (res.data as { rows?: unknown } | null)?.rows;
		return sumOccupancyFromStatusRows(rows);
	} catch {
		return null;
	}
}

type FindDoc = ExistingHoldCandidate & { type?: string; _id?: string };

/**
 * Look for an existing non-cancelled hold matching phone and/or card number.
 * Uses Mango `_find`; on failure returns null (caller fails open for lookup errors
 * only after attempting — POST treats a found duplicate as 409).
 */
export async function findConflictingHold(
	shelterCode: string,
	identity: BookingHoldIdentity
): Promise<ExistingHoldCandidate | null> {
	const phone = (identity.phone ?? '').replace(/\D/g, '');
	const card = (identity.cardNumber ?? '').trim();
	if (!phone && !card) return null;

	const orClause: Record<string, unknown>[] = [];
	if (phone) orClause.push({ phone });
	if (card) orClause.push({ 'person_id.number': card });

	const db = shelterDbName(shelterCode);
	const res = await adminRaw(`/${db}/_find`, 'POST', {
		selector: {
			type: 'evacuee',
			'current_stay.status': { $in: [...ACTIVE_HOLD_STATUSES] },
			$or: orClause
		},
		limit: 25,
		fields: ['_id', 'type', 'phone', 'person_id', 'current_stay']
	});

	if (res.status >= 400) {
		// Index missing or query failed — do not invent a duplicate.
		return null;
	}

	const docs = ((res.data as { docs?: FindDoc[] } | null)?.docs ?? []) as FindDoc[];
	return findDuplicateHold(docs, identity) ?? null;
}
