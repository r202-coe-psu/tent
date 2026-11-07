import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { envelope, printErrorResponse } from '../_print-http';
import { shelterCodeSchema } from '$lib/db/model';
import { requireShelterScopeOrSA } from '$lib/server/session-auth';
import { listShelterPrinters } from '$lib/server/printers/print-jobs.server';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const shelter = shelterCodeSchema.safeParse(url.searchParams.get('shelter_code'));
		if (!shelter.success) return envelope(422, 'VALIDATION', 'shelter_code is required');
		await requireShelterScopeOrSA(request.headers.get('cookie'), shelter.data);

		const now = new Date();
		const printers = await listShelterPrinters(printDeviceRepository, shelter.data, now);
		return json({ printers, server_time: now.toISOString() }, { headers: noStoreHeaders });
	} catch (e) {
		return printErrorResponse(e);
	}
};
