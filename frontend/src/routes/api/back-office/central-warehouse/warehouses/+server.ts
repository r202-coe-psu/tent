import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { integrationRequest } from '$lib/server/integrations';
import { authorizeCentralWarehouse } from '../_auth';
import { NO_STORE, m6ErrorResponse } from '../_m6';

export const prerender = false;

/** GET /api/back-office/central-warehouse/warehouses — central warehouses (M6 RES-001). */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		return json(await integrationRequest('GET', '/v1/integrations/m6/warehouses'), {
			headers: NO_STORE
		});
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse warehouses GET');
	}
};
