import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { computeSlotAvailability } from '$lib/features/donations';
import type { DonationSlotMode } from '$lib/features/operations';
import type { PublicDonationDoc } from '$lib/features/donations';
import type { DonationSlot } from '$lib/features/operations';
import { fetchDocs } from '$lib/server/donation-docs';

const SHELTER_CODE = /^[A-Z0-9_-]{2,32}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DN-5 — queue windows + remaining capacity for one shelter, date and queue.
 *
 * `mode=dropoff` (default) is the donor driving up; `mode=pickup` is the shelter's
 * vehicle going out, which is the one with a real ceiling.
 *
 * `donation_slot` (schema.md §2.13) is staff-configured and stays in the shelter's
 * CouchDB — the sync worker does not project it to Mongo — so this reads CouchDB
 * server-side with admin credentials, exactly like the SLOT_FULL re-check in
 * `POST /api/public/v1/donations`. The browser never sees those credentials, and the
 * response carries no donor data: only window, capacity and how many are booked.
 */
export const GET: RequestHandler = async ({ url }) => {
	const shelterCode = (url.searchParams.get('shelter_code') ?? '').trim().toUpperCase();
	const date = (url.searchParams.get('date') ?? '').trim();
	const modeParam = (url.searchParams.get('mode') ?? 'dropoff').trim();

	// Validated before it reaches the db name — `shelter_${code}` is a URL path segment.
	if (
		!SHELTER_CODE.test(shelterCode) ||
		!DATE.test(date) ||
		(modeParam !== 'dropoff' && modeParam !== 'pickup')
	) {
		return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
	}
	const mode = modeParam as DonationSlotMode;

	const dbName = `shelter_${shelterCode.toLowerCase()}`;

	try {
		const [slots, donations] = await Promise.all([
			fetchDocs<DonationSlot>(dbName, 'donation_slot:'),
			fetchDocs<PublicDonationDoc>(dbName, 'donation:').then((docs) =>
				docs.filter((d) => d && d.type === 'donation')
			)
		]);

		return json({ date, mode, slots: computeSlotAvailability(date, mode, slots, donations) });
	} catch {
		return json({ success: false, error: 'SLOTS_UNAVAILABLE' }, { status: 503 });
	}
};
