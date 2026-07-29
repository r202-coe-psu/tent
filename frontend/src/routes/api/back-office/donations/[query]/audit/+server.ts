import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse
} from '$lib/server/donation-intake';
import { fetchDocs } from '$lib/server/donation-docs';
import { isAuditEntry, type AuditEntry } from '$lib/features/shared';

/**
 * Audit trail of one donation — T-16 Deliverable 4 ("Audit trail query"), DoD 5.
 *
 * Read-only, staff-scoped (FR-33 "ดู": SA · shelter_manager scope · warehouse_staff
 * scope). The public transparency report over the same data is T-24 (R3) — audit and
 * stock_ledger are deliberately NOT projected to the public plane
 * (couchdb-mongodb-sync.md §5), so this surface stays behind the staff session.
 */
export const GET: RequestHandler = async ({ params, request }) => {
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

		const entries = (await fetchDocs<AuditEntry>(found.dbName, 'audit:'))
			.filter(isAuditEntry)
			.filter((a) => a.target_type === 'donation' && a.target_id === found.donation._id)
			.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

		return json({
			success: true,
			donation: { booking_ref: found.donation.booking_ref, status: found.donation.status },
			audits: entries.map((a) => ({
				action: a.action,
				reason: a.reason,
				occurred_at: a.occurred_at,
				created_by: a.created_by,
				context: a.context ?? {}
			}))
		});
	} catch (e) {
		const { message, status } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status });
	}
};
