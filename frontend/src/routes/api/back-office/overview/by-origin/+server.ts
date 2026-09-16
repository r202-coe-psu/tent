import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError } from '$lib/server/couch-admin';
import {
	buildOverviewOrigin,
	noStore,
	parseOverviewFilters,
	requireOverviewSA
} from '$lib/server/system-overview';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url, fetch }) => {
	try {
		const cookie = request.headers.get('cookie');
		await requireOverviewSA(cookie);
		const filters = parseOverviewFilters(url.searchParams);
		const payload = await buildOverviewOrigin(filters, fetch, cookie);
		return json(payload, { headers: noStore });
	} catch (e) {
		return serviceError(e);
	}
};
