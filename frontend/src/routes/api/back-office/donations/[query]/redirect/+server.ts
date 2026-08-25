import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	listShelterCodes,
	shelterDb,
	routeErrorResponse as toRouteError
} from '$lib/server/donation-intake';
import {
	createDonationRedirect,
	donationRedirectInputSchema,
	type DonationRedirect,
	type PublicDonationDoc
} from '$lib/features/donations';
import { canTransitionDonation } from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

/**
 * R-16.4 (CR-087) — hand a `pending_review` donation to another shelter.
 *
 * Three writes, in this order:
 *   1. `audit` in the ORIGIN db — who redirected what, and why
 *   2. `donation_redirect` in the DESTINATION db — the only thing that shelter's
 *      staff can actually see (scope isolation), so it must exist before the
 *      origin doc stops showing the request in its own queue
 *   3. `PUT` the origin donation to `redirected` + `redirect_to_shelter_code`
 *
 * **No `stock_ledger`, no lot** — the goods never entered this shelter's stock,
 * so redirecting must not move a balance anywhere (R-16.4 acceptance).
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
		if (!canTransitionDonation(donation.status, 'redirected')) {
			return json(
				{
					success: false,
					error_code: 'INVALID_TRANSITION',
					error: `Cannot redirect a donation with status "${donation.status}" (only pending_review can be redirected)`
				},
				{ status: 422 }
			);
		}

		const body = await request.json().catch(() => ({}));
		const parsed = donationRedirectInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{
					success: false,
					error_code: 'TARGET_SHELTER_REQUIRED',
					error: 'A destination shelter code is required'
				},
				{ status: 422 }
			);
		}
		const target = parsed.data.target_shelter_code;

		if (target === donation.shelter_code) {
			return json(
				{
					success: false,
					error_code: 'SAME_SHELTER',
					error: 'Cannot redirect a donation to the shelter that already holds it'
				},
				{ status: 422 }
			);
		}

		// The destination must be a real shelter — otherwise the ticket would be
		// written into a database nobody reads (or created by accident).
		const shelterCodes = await listShelterCodes();
		if (!shelterCodes.includes(target)) {
			return json(
				{ success: false, error_code: 'UNKNOWN_SHELTER', error: `Unknown shelter: ${target}` },
				{ status: 422 }
			);
		}

		const nowStr = new Date().toISOString();

		// 1) Audit at the origin. Who/when/why lives here, not on the donation doc
		//    (same split as approve/reject — no duplicated fields).
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason: `ส่งต่อคำขอบริจาคไปยังศูนย์ ${target} (${donation.booking_ref ?? donation._id})`,
				context: {
					booking_ref: donation.booking_ref ?? null,
					redirected_by: caller.name,
					target_shelter_code: target,
					note: parsed.data.note ?? null
				}
			},
			{ shelterCode: donation.shelter_code, createdBy: caller.name }
		);

		const auditRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: [audit] });
		if (auditRes.status >= 400) {
			throw new Error(`Failed to write audit trail: ${JSON.stringify(auditRes.data)}`);
		}

		// 2) Ticket at the destination. Envelope `shelter_code` is the DESTINATION —
		//    the doc belongs to that shelter's DB; the origin is kept in its own field.
		const ticket: DonationRedirect = createDonationRedirect(
			{
				origin_shelter_code: donation.shelter_code,
				origin_donation_id: donation._id,
				booking_ref: donation.booking_ref ?? null,
				donor: { name: donation.donor?.name ?? '', phone: donation.donor?.phone ?? null },
				items: (donation.items ?? []).map((it) => ({
					...(it.item_id ? { item_id: it.item_id } : {}),
					...(it.free_text ? { free_text: it.free_text } : {}),
					qty: it.qty,
					unit: it.unit,
					...(it.category ? { category: it.category } : {}),
					...(it.condition ? { condition: it.condition } : {}),
					...(it.note ? { note: it.note } : {})
				})),
				note: parsed.data.note ?? null
			},
			{ shelterCode: target, createdBy: caller.name }
		);

		const ticketRes = await adminRaw(`/${shelterDb(target)}/_bulk_docs`, 'POST', {
			docs: [ticket]
		});
		if (ticketRes.status >= 400) {
			throw new Error(
				`Failed to write the redirect ticket to ${target}: ${JSON.stringify(ticketRes.data)}`
			);
		}

		// 3) Only now does the request leave this shelter's queue. Failing here
		//    leaves a visible ticket at the destination and the request still in
		//    `pending_review` here — recoverable by retrying, unlike the reverse.
		const updated: PublicDonationDoc = {
			...donation,
			status: 'redirected',
			redirect_to_shelter_code: target,
			updated_at: nowStr
		};

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
			donation: {
				booking_ref: updated.booking_ref,
				status: updated.status,
				redirect_to_shelter_code: target
			},
			redirect_id: ticket._id
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
