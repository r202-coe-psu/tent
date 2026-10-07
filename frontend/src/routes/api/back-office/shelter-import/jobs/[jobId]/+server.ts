import { json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import type { RequestHandler } from './$types';
import { requireSystemAdmin, serviceError } from '$lib/server/couch-admin';
import {
	getImportJob,
	toShelterImportItemSummary,
	toShelterImportJobSummary
} from '$lib/features/shelter-import/server/job-store';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	await requireSystemAdmin(request.headers.get('cookie'));
	try {
		const summary = await getImportJob(params.jobId);
		if (!summary)
			return json(
				{ error: { code: 'NOT_FOUND', message: 'Import job not found' } },
				{ status: 404 }
			);
		const items = summary.items.map(toShelterImportItemSummary);
		const itemProgressHash = createHash('sha256')
			.update(JSON.stringify(items.map((item) => [item._id, item._rev ?? ''])))
			.digest('hex');
		const etag = `"${summary.job._rev ?? 'no-job-revision'}:${itemProgressHash}"`;
		const headers = {
			'cache-control': 'no-store, max-age=0',
			...(etag ? { etag } : {})
		};
		const ifNoneMatch = request.headers.get('if-none-match');
		if (etag && ifNoneMatch?.split(',').some((value) => value.trim() === etag)) {
			return new Response(null, { status: 304, headers });
		}
		return json({ job: toShelterImportJobSummary(summary.job), items }, { headers });
	} catch (e) {
		return serviceError(e);
	}
};
