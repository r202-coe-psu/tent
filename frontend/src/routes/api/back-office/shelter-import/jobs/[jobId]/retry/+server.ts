import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, serviceError } from '$lib/server/couch-admin';
import { retryFailedImportItems } from '$lib/features/shelter-import/server/job-store';

export const prerender = false;

export const POST: RequestHandler = async ({ request, params }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const summary = await retryFailedImportItems(params.jobId);
		return json(summary, { status: 202, headers: { 'cache-control': 'no-store, max-age=0' } });
	} catch (e) {
		return serviceError(e);
	}
};
