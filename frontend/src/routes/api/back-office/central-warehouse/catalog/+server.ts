import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { integrationRequest } from '$lib/server/integrations';
import { authorizeCentralWarehouse } from '../_auth';
import { NO_STORE, m6ErrorResponse } from '../_m6';

export const prerender = false;

const MAX_QUERY = 100;
const MAX_CURSOR = 500;

const PASS_THROUGH: readonly [name: string, max: number][] = [
	['q', MAX_QUERY],
	['type_code', MAX_QUERY],
	['warehouse_code', MAX_QUERY],
	['cursor', MAX_CURSOR]
];

/**
 * GET /api/back-office/central-warehouse/catalog?q=&type_code=&warehouse_code=&cursor= — central
 * catalog search with `warehouses_count` (M6 RES-003).
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		await authorizeCentralWarehouse(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const qs = new URLSearchParams();
		for (const [name, max] of PASS_THROUGH) {
			const value = (url.searchParams.get(name) ?? '').trim().slice(0, max);
			if (value) qs.set(name, value);
		}
		const suffix = qs.size ? `?${qs}` : '';
		return json(await integrationRequest('GET', `/v1/integrations/m6/catalog/search${suffix}`), {
			headers: NO_STORE
		});
	} catch (e: unknown) {
		return m6ErrorResponse(e, 'Central warehouse catalog GET');
	}
};
