import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse
} from '$lib/server/donation-intake';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

export const prerender = false;

/** The `audit.reason` of a donor-contact view (schema.md §2.12). */
const DONOR_CONTACT_VIEW_REASON = 'donor_contact_view';

/** The contact is personal data: never cached, by the browser or anything between. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Full donor contact of ONE donation (#821 FR-10a). The "รับแล้ว" list and its search only
 * carry masked values; this is the one door to the real ones, and it is a `POST` because every
 * call writes an `audit` row (who looked at which donation, when) — the same shape as the
 * kiosk device "reveal PIN" button. A `GET` is a 405: nothing here may be cached, prefetched or
 * replayed from a history entry.
 *
 * Fails closed: if the audit row cannot be written the contact is NOT returned (503). The audit
 * never holds the contact itself. A donation whose contact was removed by retention answers 200
 * with `null` in every field, and is audited all the same (FR-10c).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json(
				{ success: false, error: 'Query parameter is required' },
				{ status: 400, headers: NO_STORE }
			);
		}

		// A non-SA caller is looked up in their own shelter only: no read of other shelters'
		// donations. Not found there is a 403 (AC-5), the same answer whether the ref exists in
		// another shelter or nowhere — so the answer does not tell which.
		if (!caller.isSA && !caller.shelterCode) {
			return json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
		}
		const found = await findDonationByQuery(
			query,
			caller.isSA ? undefined : [caller.shelterCode as string]
		);
		if (!found) {
			return caller.isSA
				? json({ success: false, error: 'Donation not found' }, { status: 404, headers: NO_STORE })
				: json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
		}
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403, headers: NO_STORE });
		}

		const { donation, dbName } = found;
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'other',
				target_type: 'donation',
				target_id: donation._id,
				reason: DONOR_CONTACT_VIEW_REASON
			},
			{ shelterCode: donation.shelter_code, createdBy: caller.name }
		);

		const unavailable = () =>
			json(
				{ success: false, error_code: 'AUDIT_UNAVAILABLE', error: 'Could not record the access' },
				{ status: 503, headers: NO_STORE }
			);
		let written: { status: number; data: unknown };
		try {
			written = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: [audit] });
		} catch {
			return unavailable();
		}
		const outcome = Array.isArray(written.data)
			? (written.data as Array<{ ok?: boolean; error?: string }>)
			: [];
		if (written.status >= 400 || outcome.length !== 1 || !outcome[0]?.ok) return unavailable();

		const donor = donation.donor;
		return json(
			{
				success: true,
				contact: {
					name: donor?.name?.trim() || null,
					phone: donor?.phone?.trim() || null,
					email: donor?.email?.trim() || null
				}
			},
			{ headers: NO_STORE }
		);
	} catch (e) {
		const { message, status } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status, headers: NO_STORE });
	}
};
