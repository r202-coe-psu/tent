import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import {
	assertCanManageShelter,
	bannerErrorResponse,
	readJsonObject,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { reorderBanners } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { kioskScreenTypeSchema } from '$lib/features/shared';

export const prerender = false;

const reorderBodySchema = z.strictObject({
	group_id: z.string().startsWith('kiosk_banner_group:'),
	screen_type: kioskScreenTypeSchema,
	items: z.array(z.strictObject({ id: z.string().min(1), _rev: z.string().min(1) }))
});

function requireShelterCode(url: URL): string {
	const shelterCode = url.searchParams.get('shelter_code');
	if (!shelterCode) throw new ServiceError('VALIDATION', 'shelter_code is required');
	return shelterCode;
}

export const PUT: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const shelterCode = requireShelterCode(url);
		assertCanManageShelter(caller, shelterCode);

		const parsed = reorderBodySchema.safeParse(await readJsonObject(request));
		if (!parsed.success) {
			throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid reorder');
		}
		const { group_id, screen_type, items } = parsed.data;
		const result = await reorderBanners(
			shelterCode,
			{ groupId: group_id, screenType: screen_type },
			items.map(({ id, _rev }) => ({ id, rev: _rev }))
		);
		return json(result);
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
