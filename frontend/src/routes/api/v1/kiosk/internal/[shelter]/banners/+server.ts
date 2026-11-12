import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findGroupByTvCode } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { listActiveForShelter } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { signBannerImageUrl } from '$lib/server/kiosk-banners/signed-image-url';
import { DEPENDENCY_UNAVAILABLE } from '$lib/server/scanners/device-credentials';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

const TV_CODE_NOT_FOUND = 'TV_CODE_NOT_FOUND';

function tvCodeNotFound() {
	return json(
		{ error: { code: TV_CODE_NOT_FOUND, message: 'ไม่พบรหัส TV นี้' } },
		{ status: 404, headers: noStoreHeaders }
	);
}

/**
 * TV banner feed for a paired TV (issue #1299 §C). Anonymous: the TV code in `?c=` is the only
 * credential, so every refusal looks the same and nothing about the group or shelter is returned.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const now = new Date();
		const group = await findGroupByTvCode(url.searchParams.get('c') ?? '');
		if (!group || group.shelter_code !== params.shelter) return tvCodeNotFound();
		const banners = await listActiveForShelter(params.shelter, now, {
			groupId: group._id,
			screenType: 'tv'
		});
		return json(
			{
				banners: banners.map((banner) => ({
					id: banner._id,
					title: banner.title,
					caption: banner.caption ?? null,
					duration_sec: banner.duration_sec,
					image_url: signBannerImageUrl(banner._id, now.getTime())
				})),
				fetched_at: now.toISOString()
			},
			{ status: 200, headers: noStoreHeaders }
		);
	} catch {
		return json(
			{
				error: {
					code: DEPENDENCY_UNAVAILABLE,
					message: 'บริการแบนเนอร์ kiosk ไม่พร้อมใช้งาน'
				}
			},
			{ status: 503, headers: noStoreHeaders }
		);
	}
};
