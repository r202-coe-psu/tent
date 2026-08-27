import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse as toRouteError
} from '$lib/server/donation-intake';
import type { PublicDonationDoc } from '$lib/features/donations';
import { canTransitionDonation } from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

/**
 * R-16.3 — reject a `pending_review` donation. A reason is mandatory (kept on
 * the audit trail, not on the donation doc — schema.md §2.3 has no rejection
 * reason field, and the audit entry is already the record of who/why).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const body = await request.json().catch(() => ({}));
		const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
		if (!reason) {
			return json(
				{ success: false, error_code: 'REASON_REQUIRED', error: 'Rejection reason is required' },
				{ status: 422 }
			);
		}
		if (reason.length > 500) {
			return json(
				{
					success: false,
					error_code: 'REASON_TOO_LONG',
					error: 'Reason exceeds maximum length of 500 characters'
				},
				{ status: 422 }
			);
		}

		const { donation, dbName } = found;
		if (!canTransitionDonation(donation.status, 'rejected')) {
			return json(
				{
					success: false,
					error_code: 'INVALID_TRANSITION',
					error: `Cannot reject a donation with status "${donation.status}" (only pending_review can be rejected)`
				},
				{ status: 422 }
			);
		}

		const ctx = { shelterCode: donation.shelter_code, createdBy: caller.name };
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason,
				context: { booking_ref: donation.booking_ref ?? null, rejected_by: caller.name }
			},
			ctx
		);

		const appendRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: [audit] });
		if (appendRes.status >= 400) {
			throw new Error(`Failed to write audit trail: ${JSON.stringify(appendRes.data)}`);
		}

		const nowStr = new Date().toISOString();
		const updated: PublicDonationDoc = { ...donation, status: 'rejected', updated_at: nowStr };

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status === 409) {
			return json(
				{
					success: false,
					error: 'Donation was updated by another process. Please search again and retry.'
				},
				{ status: 409 }
			);
		}
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		return json({
			success: true,
			donation: { booking_ref: updated.booking_ref, status: updated.status }
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
