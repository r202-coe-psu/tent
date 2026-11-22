/**
 * GET /api/back-office/shelter/[code]/close/jobs/[id] — CR-243 FR-8: status / progress /
 * failures of a close job. Same permission as the close route. A job that belongs to another
 * shelter answers `404` (not `403`, so it does not reveal that the job exists). `no-store`.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterManagerOrSA, serviceOrHttpError } from '$lib/server/couch-admin';
import { toShelterCloseJobView } from '$lib/server/shelter-close-job';
import { getShelterCloseStore } from '$lib/server/shelter-close-job-runtime';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	const { code, id } = params;
	if (!code || !id) return error(400, { message: 'Missing code or job id' });
	try {
		await requireShelterManagerOrSA(request.headers.get('cookie'), code);
		const store = getShelterCloseStore();
		await store.ensureDesign();
		const job = await store.getJob(id);
		if (!job || job.shelter_code.toUpperCase() !== code.toUpperCase()) {
			return error(404, { message: 'Close job not found' });
		}
		return json(toShelterCloseJobView(job), { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		return serviceOrHttpError(e);
	}
};
