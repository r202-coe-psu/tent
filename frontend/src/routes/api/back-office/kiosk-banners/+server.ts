import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import {
	assertCanManageShelter,
	assertGroupInShelter,
	assertNoShelterCode,
	bannerErrorResponse,
	decodeImageField,
	parseBannerInput,
	readJsonObject,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { createBanner, listBannersForShelter } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { splitByView } from '$lib/features/kiosk-banners';

export const prerender = false;

function requireShelterCode(url: URL): string {
	const shelterCode = url.searchParams.get('shelter_code');
	if (!shelterCode) throw new ServiceError('VALIDATION', 'shelter_code is required');
	return shelterCode;
}

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const shelterCode = requireShelterCode(url);
		const view = url.searchParams.get('view') ?? 'current';
		if (view !== 'current' && view !== 'expired') {
			throw new ServiceError('VALIDATION', 'view must be current or expired');
		}
		assertCanManageShelter(caller, shelterCode);
		const banners = await listBannersForShelter(shelterCode);
		return json(splitByView(banners, new Date())[view]);
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const shelterCode = requireShelterCode(url);
		assertCanManageShelter(caller, shelterCode);

		const { image, ...fields } = await readJsonObject(request);
		assertNoShelterCode(fields);
		const input = parseBannerInput(fields);
		const decoded = decodeImageField(image);
		await assertGroupInShelter(input.group_id, shelterCode);

		const created = await createBanner(input, decoded, { shelterCode, createdBy: caller.name });
		return json(created, { status: 201 });
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
