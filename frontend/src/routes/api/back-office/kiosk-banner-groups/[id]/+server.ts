import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import {
	assertNoShelterCode,
	bannerErrorResponse,
	loadGroupInScope,
	parseBody,
	readJsonObject,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { deleteGroup, updateGroup } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { kioskBannerGroupInputSchema } from '$lib/features/kiosk-banners';

export const prerender = false;

const updateBodySchema = z.strictObject({
	_rev: z.string().min(1),
	...kioskBannerGroupInputSchema.shape
});

export const GET: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);
		return json(await loadGroupInScope(caller, params.id));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const PUT: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);

		const body = await readJsonObject(request);
		assertNoShelterCode(body);
		const { _rev, ...input } = parseBody(updateBodySchema, body);

		const group = await loadGroupInScope(caller, params.id);
		return json(await updateGroup(group._id, _rev, input));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const DELETE: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const rev = url.searchParams.get('rev');
		if (!rev) throw new ServiceError('VALIDATION', 'rev is required');

		const group = await loadGroupInScope(caller, params.id);
		await deleteGroup(group._id, rev, caller.name);
		return new Response(null, { status: 204 });
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
