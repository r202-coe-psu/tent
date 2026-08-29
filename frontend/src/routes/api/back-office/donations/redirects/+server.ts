import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	authorizeWarehouse,
	listShelterCodes,
	routeErrorResponse,
	shelterDb
} from '$lib/server/donation-intake';
import { fetchDocs } from '$lib/server/donation-docs';
import { isDonationRedirect, type DonationRedirect } from '$lib/features/donations';

/**
 * Incoming redirect tickets — requests other shelters handed to this one
 * (R-16.4 · CR-087 · schema.md §2.14).
 *
 * Read from the CALLER's own shelter db: a `donation_redirect` lives in the
 * destination's database, which is the whole reason the ticket exists (a field on
 * the origin's donation would be invisible across the scope boundary).
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));

		const codes = caller.isSA
			? await listShelterCodes()
			: caller.shelterCode
				? [caller.shelterCode]
				: [];

		const rows: DonationRedirect[] = [];
		for (const code of codes) {
			const docs = await fetchDocs<unknown>(shelterDb(code), 'donation_redirect:');
			for (const d of docs) {
				if (isDonationRedirect(d)) rows.push(d);
			}
		}

		// Newest first — an incoming request is acted on, not archived.
		rows.sort((a, b) => b.created_at.localeCompare(a.created_at));

		return json({ success: true, redirects: rows });
	} catch (e) {
		const { message, status } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status });
	}
};
