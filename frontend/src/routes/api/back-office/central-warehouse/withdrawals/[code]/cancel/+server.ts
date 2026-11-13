import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelWithdrawal } from '$lib/features/central-warehouse/server/withdrawal.server';
import { authorizeCentralWarehouse, resolveShelterCode } from '../../../_auth';
import { CODE_PATTERN, NO_STORE, m6ErrorResponse } from '../../../_m6';

export const prerender = false;

/**
 * POST /api/back-office/central-warehouse/withdrawals/[code]/cancel — cancel a `pending` request
 * (RES-008). Body `{ reason }`. A request M6 already moved on answers `409 M6_NOT_CANCELLABLE`.
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		if (!CODE_PATTERN.test(params.code)) {
			return json({ error: 'รหัสใบเบิกไม่ถูกต้อง', code: 'VALIDATION' }, { status: 422 });
		}
		const body = await request.json().catch(() => null);
		const cancelled = await cancelWithdrawal({ caller, shelterCode }, params.code, body);
		return json(cancelled, { headers: NO_STORE });
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse withdrawal cancel POST');
	}
};
