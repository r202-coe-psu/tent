import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { integrationRequest } from '$lib/server/integrations';
import { authorizeCentralWarehouse } from '../../../_auth';
import { CODE_PATTERN, NO_STORE, m6ErrorResponse } from '../../../_m6';

export const prerender = false;

const MAX_QUERY = 100;

/**
 * GET /api/back-office/central-warehouse/warehouses/[code]/stock?type_code=&search= — one
 * warehouse's stock (M6 RES-002). Filtering happens in FastAPI.
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		if (!CODE_PATTERN.test(params.code)) {
			return json({ error: 'รหัสคลังไม่ถูกต้อง', code: 'VALIDATION' }, { status: 422 });
		}
		const qs = new URLSearchParams();
		const typeCode = (url.searchParams.get('type_code') ?? '').trim().slice(0, MAX_QUERY);
		const search = (url.searchParams.get('search') ?? '').trim().slice(0, MAX_QUERY);
		if (typeCode) qs.set('type_code', typeCode);
		if (search) qs.set('search', search);
		const suffix = qs.size ? `?${qs}` : '';
		const path = `/v1/integrations/m6/warehouses/${encodeURIComponent(params.code)}/stock${suffix}`;
		return json(await integrationRequest('GET', path), { headers: NO_STORE });
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse stock GET');
	}
};
