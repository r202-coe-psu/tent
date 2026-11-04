import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	assertCanManageShelter,
	assertNoShelterCode,
	bannerErrorResponse,
	parseBody,
	readJsonObject,
	requireBannerManager,
	requireShelterCode
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { createGroup, listGroups } from '$lib/server/kiosk-banners/kiosk-banner-group.server';

import { kioskBannerGroupInputSchema } from '$lib/features/kiosk-banners';

export const prerender = false;

const createBodySchema = z.strictObject({
	...kioskBannerGroupInputSchema.shape,
	device_ids: z.array(z.string().min(1)).default([])
});

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const shelterCode = requireShelterCode(url);
		assertCanManageShelter(caller, shelterCode);
		const groups = await listGroups(shelterCode);
		return json([...groups].sort((a, b) => a.name.localeCompare(b.name, 'th')));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const shelterCode = requireShelterCode(url);
		assertCanManageShelter(caller, shelterCode);

		const body = await readJsonObject(request);
		assertNoShelterCode(body);
		const { device_ids, ...input } = parseBody(createBodySchema, body);
		const created = await createGroup(input, device_ids, { shelterCode, createdBy: caller.name });
		return json(created, { status: 201 });
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
