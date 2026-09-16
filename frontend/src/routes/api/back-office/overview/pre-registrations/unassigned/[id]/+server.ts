import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError } from '$lib/server/couch-admin';
import { buildUnassignedProfile, noStore, requireOverviewSA } from '$lib/server/system-overview';

export const prerender = false;

export const GET: RequestHandler = async ({ params, request, fetch }) => {
	try {
		const cookie = request.headers.get('cookie');
		await requireOverviewSA(cookie);
		const payload = await buildUnassignedProfile(params.id, fetch, cookie);
		return json(payload, { headers: noStore });
	} catch (e) {
		return serviceError(e);
	}
};
