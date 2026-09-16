import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError } from '$lib/server/couch-admin';
import {
	buildOverviewSites,
	noStore,
	parseOverviewFilters,
	requireOverviewSA
} from '$lib/server/system-overview';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		await requireOverviewSA(request.headers.get('cookie'));
		const filters = parseOverviewFilters(url.searchParams);
		const payload = await buildOverviewSites(filters);
		return json(payload, { headers: noStore });
	} catch (e) {
		return serviceError(e);
	}
};
