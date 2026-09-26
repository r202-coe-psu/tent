import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError } from '$lib/server/couch-admin';
import { noStore, searchHouseholds } from '$lib/server/system-overview';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url, fetch }) => {
	try {
		const cookie = request.headers.get('cookie');
		await requireShelterScopeOrSA(cookie);

		const scopeRaw = url.searchParams.get('scope');
		const scope = scopeRaw === 'shelter' ? 'shelter' : 'universal';
		const shelterCode = url.searchParams.get('shelter_code');
		const q = url.searchParams.get('q');
		const limitRaw = url.searchParams.get('limit');
		const limit = limitRaw ? Math.min(Math.max(1, parseInt(limitRaw, 10)), 100) : 20;

		const items = await searchHouseholds(
			{
				scope,
				shelterCode,
				q,
				limit
			},
			fetch,
			cookie
		);

		return json({ items }, { headers: noStore });
	} catch (e) {
		return serviceError(e);
	}
};
