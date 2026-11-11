import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	bannerErrorResponse,
	loadGroupInScope,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { rotateTvCode } from '$lib/server/kiosk-banners/kiosk-banner-group.server';

export const prerender = false;

export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);
		const group = await loadGroupInScope(caller, params.id);
		return json(await rotateTvCode(group._id));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
