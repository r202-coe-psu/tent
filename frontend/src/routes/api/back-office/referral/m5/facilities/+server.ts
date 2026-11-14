import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { integrationRequest } from '$lib/server/integrations';
import { authorizeReferral } from '../../_auth';
import { m5ErrorResponse } from '../../_m5';

export const prerender = false;

const MAX_QUERY = 100;

/** GET /api/back-office/referral/m5/facilities?q= — M5 destination hospitals (TRF-001). */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		await authorizeReferral(request.headers.get('cookie'), url.searchParams.get('shelter_code'));
		const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY);
		const path = `/v1/integrations/m5/facilities${q ? `?q=${encodeURIComponent(q)}` : ''}`;
		return json(await integrationRequest('GET', path));
	} catch (e: unknown) {
		return m5ErrorResponse(e, 'M5 facilities GET');
	}
};
