import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { integrationRequest } from '$lib/server/integrations';
import { createWithdrawal } from '$lib/features/central-warehouse/server/withdrawal.server';
import { authorizeCentralWarehouse, resolveShelterCode } from '../_auth';
import { NO_STORE, m6ErrorResponse } from '../_m6';

export const prerender = false;

const MAX_STATUS = 40;

/**
 * GET /api/back-office/central-warehouse/withdrawals?status= — this shelter's withdrawal requests,
 * newest first, from the Mongo snapshot (never calls M6, so it works while M6 is down).
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		const qs = new URLSearchParams({ shelter_code: shelterCode });
		const status = (url.searchParams.get('status') ?? '').trim().slice(0, MAX_STATUS);
		if (status) qs.set('status', status);
		return json(await integrationRequest('GET', `/v1/integrations/m6/withdrawals?${qs}`), {
			headers: NO_STORE
		});
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse withdrawals GET');
	}
};

/**
 * POST /api/back-office/central-warehouse/withdrawals — send one withdrawal request (RES-005).
 *
 * Body: `withdrawalCreateInputSchema` (warehouse, reason, contact, lines). The BFF builds the
 * requester and destination from the shelter master and the session; a shelter without
 * coordinates or address answers `422 SHELTER_LOCATION_MISSING`. → 201 `WithdrawalView`.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		const body = await request.json().catch(() => null);
		const created = await createWithdrawal({ caller, shelterCode }, body);
		return json(created, { status: 201, headers: NO_STORE });
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse withdrawals POST');
	}
};
