import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError } from '$lib/server/couch-admin';
import { buildBoundEvacueeProfile, noStore, requireOverviewSA } from '$lib/server/system-overview';

export const prerender = false;

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		await requireOverviewSA(request.headers.get('cookie'));
		const payload = await buildBoundEvacueeProfile(params.shelter, params.evacueeId);
		return json(payload, { headers: noStore });
	} catch (e) {
		return serviceError(e);
	}
};
