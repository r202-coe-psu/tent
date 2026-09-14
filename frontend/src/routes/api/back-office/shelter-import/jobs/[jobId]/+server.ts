import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, serviceError } from '$lib/server/couch-admin';
import { getImportJob } from '$lib/features/shelter-import/server/job-store';

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
		const etag = summary.job._rev ? `"${summary.job._rev}"` : undefined;
		const headers = {
			'cache-control': 'no-store, max-age=0',
			...(etag ? { etag } : {})
		};
		const ifNoneMatch = request.headers.get('if-none-match');
		if (etag && ifNoneMatch?.split(',').some((value) => value.trim() === etag)) {
			return new Response(null, { status: 304, headers });
		}
		return json({ job: summary.job, items: summary.items }, { headers });
	} catch (e) {
		return serviceError(e);
	}
};
