import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { printErrorResponse } from '../../_print-http';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { getPrintJobStatus } from '$lib/server/printers/print-jobs.server';
import { printJobStore } from '$lib/server/printers/printer-server';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const GET: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireShelterScopeOrSA(request.headers.get('cookie'));
		const status = await getPrintJobStatus(printJobStore, caller, params.id);
		return json(status, { headers: noStoreHeaders });
	} catch (e) {
		return printErrorResponse(e);
	}
};
