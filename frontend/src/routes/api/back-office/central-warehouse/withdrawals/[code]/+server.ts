import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { integrationRequest } from '$lib/server/integrations';
import { authorizeCentralWarehouse, resolveShelterCode } from '../../_auth';
import { CODE_PATTERN, NO_STORE, m6ErrorResponse } from '../../_m6';

export const prerender = false;

/**
 * GET /api/back-office/central-warehouse/withdrawals/[code] — one request, refreshed from M6
 * (RES-006); `live: false` when M6 is unreachable and the stored snapshot is returned.
 * 404 when the request is not this shelter's.
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		if (!CODE_PATTERN.test(params.code)) {
			return json({ error: 'รหัสใบเบิกไม่ถูกต้อง', code: 'VALIDATION' }, { status: 422 });
		}
		const qs = new URLSearchParams({ shelter_code: shelterCode });
		const path = `/v1/integrations/m6/withdrawals/${encodeURIComponent(params.code)}?${qs}`;
		return json(await integrationRequest('GET', path), { headers: NO_STORE });
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse withdrawal GET');
	}
};
