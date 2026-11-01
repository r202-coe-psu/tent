import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { envelope, printErrorResponse } from '../../_print-http';
import { shelterCodeSchema } from '$lib/db/model';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { getPrintJobStatus } from '$lib/server/printers/print-jobs.server';
import { userJobStore } from '$lib/server/printers/print-job.user-store';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** Poll a job's status. The job lives in its shelter's DB, so `?shelter_code=` is required. */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		const shelter = shelterCodeSchema.safeParse(url.searchParams.get('shelter_code'));
		if (!shelter.success) return envelope(422, 'VALIDATION', 'shelter_code is required');

		const cookie = request.headers.get('cookie');
		const caller = await requireShelterScopeOrSA(cookie, shelter.data);
		const status = await getPrintJobStatus(userJobStore(cookie, shelter.data), caller, params.id);
		return json(status, { headers: noStoreHeaders });
	} catch (e) {
		return printErrorResponse(e);
	}
};
