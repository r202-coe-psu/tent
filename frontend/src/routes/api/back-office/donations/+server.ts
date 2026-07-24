import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	authorizeWarehouse,
	listShelterCodes,
	routeErrorResponse,
	shelterDb
} from '$lib/server/donation-intake';
import { fetchDocs } from '$lib/server/donation-docs';
import type { PublicDonationDoc } from '$lib/features/donations';

/**
 * Pending intake queue — the pre-declared donations a shelter is still waiting on
 * (T-16-1.1). Shelter-scoped: staff see only their own shelter, SA sees every shelter.
 *
 * Rows are redacted the same way the scan station's `ScanDonationView` is: no
 * `tracking_token_hash`, no `phone_hash`, no `_rev`. Donor `phone` is included —
 * warehouse staff need it to chase a late delivery.
 */
export interface PendingDonationRow {
	booking_ref?: string;
	shelter_code: string;
	status: string;
	donor_name: string;
	donor_phone: string | null;
	item_count: number;
	declared_at?: string;
	eta?: string;
	slot?: { date: string; from: string; to: string };
	delivery_method?: string;
}

function toPendingRow(d: PublicDonationDoc): PendingDonationRow {
	return {
		booking_ref: d.booking_ref,
		shelter_code: d.shelter_code,
		status: d.status,
		donor_name: d.donor?.name ?? '',
		donor_phone: d.donor?.phone ?? null,
		item_count: (d.items ?? []).length,
		declared_at: d.declared_at,
		eta: d.logistics?.eta,
		slot: d.logistics?.slot,
		delivery_method: d.logistics?.delivery_method
	};
}

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const status = url.searchParams.get('status') ?? 'declared';

		// Scope first, then read: a non-SA caller never reaches another shelter's db.
		const codes = caller.isSA
			? await listShelterCodes()
			: caller.shelterCode
				? [caller.shelterCode]
				: [];

		const rows: PendingDonationRow[] = [];
		for (const code of codes) {
			const donations = await fetchDocs<PublicDonationDoc>(shelterDb(code), 'donation:');
			for (const d of donations) {
				if (d?.type === 'donation' && d.status === status) rows.push(toPendingRow(d));
			}
		}

		// Soonest expected arrival first; undated bookings sink to the bottom.
		rows.sort((a, b) =>
			(a.eta ?? a.declared_at ?? '￿').localeCompare(b.eta ?? b.declared_at ?? '￿')
		);

		return json({ success: true, donations: rows });
	} catch (e) {
		const { message, status: code } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status: code });
	}
};
