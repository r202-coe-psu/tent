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
	applyLineReview,
	hasLineReview,
	reviewDonationInputSchema,
	type LineReviewResult,
	type PublicDonationDoc
} from '$lib/features/donations/server';
import { canTransitionDonation, DONATION_SCHEMA_V } from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

/**
 * R-16.2 — review a `pending_review` donation. Moves it off the "รอการประเมิน" tab;
 * counting/lot receipt still happens in the `[query]` POST route (R-16.5).
 *
 * CR-174: a schema_v 7 booking is reviewed line by line — `lines` decides every line
 * still `pending` (campaign lines were approved at booking time and cannot be decided
 * here), and the booking's status follows from its lines (FR-10): `verifying`, or
 * `rejected` with the lines' reasons when every one was refused. Without `lines` the
 * whole booking is approved, which is also how a doc from before schema_v 7 is
 * reviewed (AC-8).
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
		const body = await request.json().catch(() => ({}));
		// Decisions are by line position (CR-174): they must be about the booking on file.
		// Checked before the status, so a booking the donor edited out of review reads as
		// "changed, reload" rather than as a refused transition.
		const stale = staleDecisionResponse(body, donation);
		if (stale) return stale;
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

		const parsed = reviewDonationInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{
					success: false,
					error_code: 'INVALID_REVIEW',
					error: parsed.error.issues[0]?.message ?? 'Invalid review',
					details: parsed.error.flatten()
				},
				{ status: 422 }
			);
		}
		const { memo, lines } = parsed.data;
		const items = donation.items ?? [];
		const lineReview = hasLineReview(items);
		if (lines && !lineReview) {
			return json(
				{
					success: false,
					error_code: 'INVALID_REVIEW',
					error: 'This booking is reviewed as a whole (no per-line review)'
				},
				{ status: 422 }
			);
		}

		let outcome: LineReviewResult<(typeof items)[number]>;
		try {
			outcome = lineReview
				? applyLineReview(
						items,
						// No `lines`: approve everything still waiting — the one-button approve.
						lines ??
							items.flatMap((item, index) =>
								item.review_status === 'pending' ? [{ index, decision: 'approved' as const }] : []
							)
					)
				: { items, status: 'verifying' };
		} catch (e) {
			return json(
				{
					success: false,
					error_code: 'INVALID_REVIEW',
					error: e instanceof Error ? e.message : 'Invalid review'
				},
				{ status: 422 }
			);
		}
		// Refusing every line rejects the booking — the same guard as the reject route: a
		// `pending_review` receipt can key rows and fail to close, and rejecting it then
		// hands the quota back with the goods on the shelf.
		if (outcome.status === 'rejected' && (await hasKeyedDonationStock(dbName, donation))) {
			return json(
				{
					success: false,
					error_code: 'GOODS_IN_STOCK',
					error:
						'ใบนี้มีของบันทึกเข้าคลังแล้ว — ปฏิเสธทุกรายการไม่ได้ ให้รับของต่อจากหน้าตรวจรับ หรือติดต่อผู้ดูแลเพื่อตรวจยอด'
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
				reason:
					outcome.status === 'rejected'
						? `ปฏิเสธทุกรายการที่รอประเมิน (${donation.booking_ref ?? donation._id})`
						: `อนุมัติคำขอบริจาคเข้าสู่การตรวจรับ (${donation.booking_ref ?? donation._id})`,
				context: {
					booking_ref: donation.booking_ref ?? null,
					approved_by: caller.name,
					memo: memo ?? null,
					...(lineReview
						? {
								lines: (lines ?? []).map(({ index, decision, reason_code }) => ({
									index,
									decision,
									reason_code: reason_code ?? null
								}))
							}
						: {})
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
			items: outcome.items,
			status: outcome.status,
			...(outcome.reject_reason !== undefined
				? { reject_reason: outcome.reject_reason, reject_reason_code: outcome.reject_reason_code }
				: {}),
			...(lineReview ? { schema_v: Math.max(donation.schema_v ?? 0, DONATION_SCHEMA_V) } : {}),
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
