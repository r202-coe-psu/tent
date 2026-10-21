import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import {
	assertGroupInShelter,
	assertNoShelterCode,
	bannerErrorResponse,
	decodeImageField,
	loadBannerInScope,
	parseBannerInput,
	readJsonObject,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import {
	deleteBanner,
	setBannerStatus,
	updateBanner
} from '$lib/server/kiosk-banners/kiosk-banner.server';
import { kioskBannerStatusSchema } from '$lib/features/kiosk-banners';

export const prerender = false;

const statusPatchSchema = z.strictObject({
	_rev: z.string().min(1),
	status: kioskBannerStatusSchema
});

function requireRev(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ServiceError('VALIDATION', '_rev is required');
	}
	return value;
}

export const GET: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);
		return json(await loadBannerInScope(caller, params.id));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const PUT: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);

		const { _rev, image, ...fields } = await readJsonObject(request);
		assertNoShelterCode(fields);
		const rev = requireRev(_rev);
		const input = parseBannerInput(fields);
		const decoded = image === undefined ? null : decodeImageField(image);

		const banner = await loadBannerInScope(caller, params.id);
		await assertGroupInShelter(input.group_id, banner.shelter_code);
		return json(await updateBanner(banner._id, rev, input, decoded));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);

		const parsed = statusPatchSchema.safeParse(await readJsonObject(request));
		if (!parsed.success) {
			throw new ServiceError(
				'VALIDATION',
				parsed.error.issues[0]?.message ?? 'Invalid status update'
			);
		}

		const banner = await loadBannerInScope(caller, params.id);
		return json(await setBannerStatus(banner._id, parsed.data._rev, parsed.data.status));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};

export const DELETE: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await requireBannerManager(request);
		const rev = url.searchParams.get('rev');
		if (!rev) throw new ServiceError('VALIDATION', 'rev is required');

		const banner = await loadBannerInScope(caller, params.id);
		await deleteBanner(banner._id, rev);
		return new Response(null, { status: 204 });
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
