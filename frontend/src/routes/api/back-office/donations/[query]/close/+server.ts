import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse as toRouteError
} from '$lib/server/donation-intake';
import { toScanView } from '$lib/server/donation-scan-view';
import {
	closeDonationByPoints,
	hasPointReceipts,
	recordedLineNos,
	type PublicDonationDoc
} from '$lib/features/donations/server';
import { canTransitionDonation, deriveDonationCloseAuditId } from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

/** Body of `POST /api/back-office/donations/[query]/close` — the `_rev` the screen holds. */
const closeDonationInputSchema = z.object({ expected_rev: z.string().min(1) });

/** Statuses a booking no longer leaves — nothing left to close. */
const TERMINAL_STATUSES = new Set(['received', 'rejected', 'redirected', 'expired', 'cancelled']);

type BulkDocsOutcome = { id?: string; ok?: boolean; error?: string };

/**
 * CR-206 FR-MP-26 – FR-MP-28 — staff press "ปิดใบ" on a booking some drop-off points
 * received but not every one: the goods that never came are a shortfall, and the booking
 * stops holding their quota (the worker settles it once the booking is `received`).
 *
 * Who may close is who may receive (D-8): `authorizeWarehouse` plus the shelter scope. The
 * audit entry goes in first under a fixed id — one per booking — so a retried close neither
 * logs twice nor closes without a record.
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
		// Shelter-scope isolation: non-SA callers may only close donations of their own shelter.
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const parsed = closeDonationInputSchema.safeParse(await request.json().catch(() => ({})));
		if (!parsed.success) {
			return json(
				{ success: false, error: 'Invalid input', details: parsed.error.flatten() },
				{ status: 422 }
			);
		}

		const { donation, dbName } = found;

		// FR-MP-27 — staff decided on the booking as the screen showed it. A point that
		// recorded since then may have been the last one, or changed what is missing.
		if (parsed.data.expected_rev !== donation._rev) {
			return json(
				{
					success: false,
					error_code: 'DONATION_CHANGED',
					error: 'ใบบริจาคถูกแก้ไขหลังจากเปิดหน้าไว้ — ค้นหาใบใหม่แล้วตรวจอีกครั้ง'
				},
				{ status: 409 }
			);
		}
		if (TERMINAL_STATUSES.has(donation.status)) {
			return json(
				{
					success: false,
					error_code: 'DONATION_CLOSED',
					error: `ใบนี้ปิดไปแล้ว (สถานะ ${donation.status}) — ไม่ต้องปิดซ้ำ`
				},
				{ status: 422 }
			);
		}
		// FR-MP-28 — with no receipt nothing was taken in: the booking is rejected or left to
		// expire, not closed as received.
		if (!hasPointReceipts(donation)) {
			return json(
				{
					success: false,
					error_code: 'NO_POINT_RECEIPTS',
					error: 'ใบนี้ยังไม่มีจุดไหนรับของ — ปิดใบไม่ได้ ใช้ปฏิเสธใบ หรือรอให้หมดอายุ'
				},
				{ status: 422 }
			);
		}

		const nowStr = new Date().toISOString();
		const closed = closeDonationByPoints(donation, {
			closedBy: caller.name,
			closedReason: 'staff_close',
			now: nowStr
		});
		// FR-MP-27b — every recorded line was turned away and the rest never came: the booking
		// is refused, which only some statuses allow.
		if (closed.status === 'rejected' && !canTransitionDonation(donation.status, 'rejected')) {
			return json(
				{
					success: false,
					error_code: 'INVALID_TRANSITION',
					error: `Cannot reject a donation with status "${donation.status}"`
				},
				{ status: 422 }
			);
		}

		const recorded = recordedLineNos(donation);
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason: `ปิดใบบริจาคที่รับไม่ครบทุกจุด (${donation.booking_ref ?? donation._id})`,
				// No donor PII: the booking ref is the donor-facing handle.
				context: {
					booking_ref: donation.booking_ref ?? null,
					closed_by: caller.name,
					closed_reason: 'staff_close',
					status: closed.status,
					point_receipts: (donation.point_receipts ?? []).map((receipt) => ({
						point_id: receipt.point_id,
						line_nos: receipt.line_nos,
						audit_id: receipt.audit_id
					})),
					unrecorded_lines: (donation.items ?? []).flatMap((_, lineNo) =>
						recorded.has(lineNo) ? [] : [lineNo]
					),
					shortfalls: closed.received_summary.shortfalls
				}
			},
			{ shelterCode: donation.shelter_code, createdBy: caller.name },
			await deriveDonationCloseAuditId(donation._id)
		);
		const updated: PublicDonationDoc = {
			...donation,
			...closed,
			updated_at: nowStr
		};
		const saveRes = await adminRaw(
			`/${dbName}/${encodeURIComponent(donation._id)}`,
			'PUT',
			updated
		);
		if (saveRes.status === 409) {
			return json(
				{
					success: false,
					error_code: 'DONATION_CONFLICT',
					error: 'ใบบริจาคถูกแก้ไขระหว่างปิดใบ — ค้นหาใบใหม่แล้วตรวจอีกครั้ง'
				},
				{ status: 409 }
			);
		}
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		// After the PUT: no audit of a close another write beat. The booking is closed by now
		// (`closed_by` on the doc), so a lost audit is logged, not answered as a failure.
		try {
			const auditRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', { docs: [audit] });
			const outcomes = Array.isArray(auditRes.data) ? (auditRes.data as BulkDocsOutcome[]) : [];
			if (auditRes.status >= 400 || outcomes.some((o) => o.error))
				console.error('donation close audit failed', auditRes.data);
		} catch (e) {
			console.error('donation close audit failed', e);
		}

		const rev = (saveRes.data as { rev?: string } | null)?.rev;
		return json({ success: true, donation: toScanView(rev ? { ...updated, _rev: rev } : updated) });
	} catch (e) {
		return routeErrorResponse(e);
	}
};
