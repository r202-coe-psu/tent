import type { RequestHandler } from './$types';
import {
	bannerErrorResponse,
	loadBannerInScope,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { BannerNotFoundError, getBannerImage } from '$lib/server/kiosk-banners/kiosk-banner.server';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);
		const banner = await loadBannerInScope(caller, params.id);
		const image = await getBannerImage(banner._id);
		if (!image) throw new BannerNotFoundError(banner._id);
		return new Response(image.bytes, {
			headers: { 'content-type': image.contentType, 'cache-control': 'private, no-store' }
		});
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
