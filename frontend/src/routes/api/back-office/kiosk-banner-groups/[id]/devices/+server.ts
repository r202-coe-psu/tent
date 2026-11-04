import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	bannerErrorResponse,
	loadGroupInScope,
	parseBody,
	readJsonObject,
	requireBannerManager
} from '$lib/server/kiosk-banners/kiosk-banner-access';
import { setGroupDevices } from '$lib/server/kiosk-banners/kiosk-banner-group.server';

export const prerender = false;

const devicesBodySchema = z.strictObject({ device_ids: z.array(z.string().min(1)) });

export const PUT: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireBannerManager(request);
		const { device_ids } = parseBody(devicesBodySchema, await readJsonObject(request));

		const group = await loadGroupInScope(caller, params.id);
		return json(await setGroupDevices(group, device_ids, caller.name));
	} catch (error) {
		return bannerErrorResponse(error);
	}
};
