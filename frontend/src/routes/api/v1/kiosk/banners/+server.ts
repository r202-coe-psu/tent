import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import { listActiveForShelter } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { signBannerImageUrl } from '$lib/server/kiosk-banners/signed-image-url';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** Active banner feed for the authenticated kiosk's shelter (FR-KBN-30..32, FR-KBR-30). */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const now = new Date();
		// A kiosk with no banner group gets an empty feed, no listing.
		if (principal.banner_group_id === null) {
			return json(
				{ banners: [], fetched_at: now.toISOString() },
				{ status: 200, headers: noStoreHeaders }
			);
		}
		const banners = await listActiveForShelter(principal.shelter_code, now, {
			groupId: principal.banner_group_id,
			screenType: principal.screen_type
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
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
				{ status: 401, headers: noStoreHeaders }
			);
		}
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
