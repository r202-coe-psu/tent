import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { envelope, printErrorResponse } from '../_print-http';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { listShelterPrinters } from '$lib/server/printers/print-jobs.server';
import { printDeviceRepository } from '$lib/server/printers/printer-server';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const shelterCode = url.searchParams.get('shelter_code');
		if (!shelterCode) return envelope(422, 'VALIDATION', 'shelter_code is required');
		await requireShelterScopeOrSA(request.headers.get('cookie'), shelterCode);

		const now = new Date();
		const printers = await listShelterPrinters(printDeviceRepository, shelterCode, now);
		return json({ printers, server_time: now.toISOString() }, { headers: noStoreHeaders });
	} catch (e) {
		return printErrorResponse(e);
	}
};
