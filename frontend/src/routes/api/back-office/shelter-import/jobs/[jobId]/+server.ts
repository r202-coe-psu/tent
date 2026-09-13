import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, serviceError } from '$lib/server/couch-admin';
import { getImportJob, recomputeImportJob } from '$lib/features/shelter-import/server/job-store';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const summary = await getImportJob(params.jobId);
		if (!summary)
			return json(
				{ error: { code: 'NOT_FOUND', message: 'Import job not found' } },
				{ status: 404 }
			);
		const job = await recomputeImportJob(params.jobId);
		const current = await getImportJob(params.jobId);
		return json(
			{ job, items: current?.items ?? summary.items },
			{ headers: { 'cache-control': 'no-store, max-age=0' } }
		);
	} catch (e) {
		return serviceError(e);
	}
};
