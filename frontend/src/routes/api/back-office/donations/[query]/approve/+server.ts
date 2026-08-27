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
 * R-16.2 — approve a `pending_review` donation into `verifying`. Moves the
 * item off the "รอการประเมิน" tab and into the drop-off verification queue;
 * counting/lot receipt still happens in the `[query]` POST route (R-16.5).
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

		const { donation, dbName } = found;
		if (!canTransitionDonation(donation.status, 'verifying')) {
			return json(
				{
					success: false,
					error_code: 'INVALID_TRANSITION',
					error: `Cannot approve a donation with status "${donation.status}" (only pending_review can be approved)`
				},
				{ status: 422 }
			);
		}

		const body = await request.json().catch(() => ({}));
		const memo = typeof body.memo === 'string' ? body.memo.trim().slice(0, 500) : undefined;

		const ctx = { shelterCode: donation.shelter_code, createdBy: caller.name };
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason: `อนุมัติคำขอบริจาคเข้าสู่การตรวจรับ (${donation.booking_ref ?? donation._id})`,
				context: {
					booking_ref: donation.booking_ref ?? null,
					approved_by: caller.name,
					memo: memo ?? null
				}
			},
			ctx
		);

		const appendRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: [audit] });
		if (appendRes.status >= 400) {
			throw new Error(`Failed to write audit trail: ${JSON.stringify(appendRes.data)}`);
		}

		const nowStr = new Date().toISOString();
		const updated: PublicDonationDoc = { ...donation, status: 'verifying', updated_at: nowStr };

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
