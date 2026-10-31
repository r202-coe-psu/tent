import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse as toRouteError,
	staleDecisionResponse
} from '$lib/server/donation-intake';
import { hasKeyedDonationStock } from '$lib/server/donation-docs';
import {
	donorRejectMessage,
	hasLineReview,
	rejectDonationInputSchema,
	rejectRemainingLines,
	type PublicDonationDoc
} from '$lib/features/donations/server';
import { canTransitionDonation } from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

/**
 * R-16.3 — reject a donation still under review: `pending_review`, or `verifying`
 * once the goods are open on the counter. A reason is mandatory: a preset code plus an
 * optional detail (required for `other`). The text composed from both is written to the
 * doc — the donor reads it on the tracking page (CR-172 FR-1, FR-8) — and to the audit
 * entry, which stays the record of who rejected and when.
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
		const parsed = rejectDonationInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{
					success: false,
					error_code: 'REASON_REQUIRED',
					error: parsed.error.issues[0]?.message ?? 'Rejection reason is required',
					details: parsed.error.flatten()
				},
				{ status: 422 }
			);
		}
		const reasonCode = parsed.data.reason_code;
		const reason = donorRejectMessage(reasonCode, parsed.data.note);

		const { donation, dbName } = found;
		const stale = staleDecisionResponse(body, donation);
		if (stale) return stale;
		if (!canTransitionDonation(donation.status, 'rejected')) {
			return json(
				{
					success: false,
					error_code: 'INVALID_TRANSITION',
					error: `Cannot reject a donation with status "${donation.status}" (only a donation still under review can be rejected)`
				},
				{ status: 422 }
			);
		}
		// A `verifying` booking whose receipt keyed rows but never closed: rejecting it would
		// hand the quota back and tell the donor "not accepted" with the goods on the shelf.
		// The same rule the donor's cancel follows (owner decision 2026-10-22).
		if (await hasKeyedDonationStock(dbName, donation)) {
			return json(
				{
					success: false,
					error_code: 'GOODS_IN_STOCK',
					error:
						'ใบนี้มีของบันทึกเข้าคลังแล้ว — ปฏิเสธไม่ได้ ให้รับของต่อจากหน้าตรวจรับ หรือติดต่อผู้ดูแลเพื่อตรวจยอด'
				},
				{ status: 409 }
			);
		}

		const ctx = { shelterCode: donation.shelter_code, createdBy: caller.name };
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason,
				context: {
					booking_ref: donation.booking_ref ?? null,
					rejected_by: caller.name,
					reject_reason_code: reasonCode
				}
			},
			ctx
		);

		const appendRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: [audit] });
		if (appendRes.status >= 400) {
			throw new Error(`Failed to write audit trail: ${JSON.stringify(appendRes.data)}`);
		}

		const nowStr = new Date().toISOString();
		const updated: PublicDonationDoc = {
			...donation,
			// CR-174 FR-12 — the lines go with the booking, approved ones included.
			...(hasLineReview(donation.items)
				? { items: rejectRemainingLines(donation.items ?? []) }
				: {}),
			status: 'rejected',
			reject_reason: reason,
			reject_reason_code: reasonCode,
			updated_at: nowStr
		};

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status === 409) {
			return json(
				{
					success: false,
					error_code: 'DONATION_CONFLICT',
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
