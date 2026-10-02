import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireSystemAdmin, serviceError } from '$lib/server/couch-admin';
import { listImportLogs } from '$lib/features/shelter-import/server/job-store';

export const prerender = false;

/**
 * Audit history BFF. Import logs contain cross-shelter filenames, actors and
 * row-level errors, so the browser must never query their CouchDB database
 * directly, even though the response is safe for an authenticated SA.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	await requireSystemAdmin(request.headers.get('cookie'));
	try {
		const limitParam = url.searchParams.get('limit');
		const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;
		const cursor = url.searchParams.get('cursor') || undefined;
		const logs = await listImportLogs({ limit, cursor });
		const nextCursor = logs.length === limit ? logs[logs.length - 1]?._id : undefined;
		const headers: Record<string, string> = {
			'cache-control': 'no-store, max-age=0'
		};
		if (nextCursor) {
			headers['x-next-cursor'] = nextCursor;
		}
		return json(
			logs.map((log) => ({
				_id: log._id,
				type: log.type,
				schema_v: log.schema_v,
				created_at: log.created_at,
				updated_at: log.updated_at,
				created_by: log.created_by,
				job_id: log.job_id,
				attempt: log.attempt,
				source: log.source,
				filename: log.filename,
				imported_by: log.imported_by,
				total_rows: log.total_rows,
				success_count: log.success_count,
				updated_count: log.updated_count,
				skipped_count: log.skipped_count,
				error_count: log.error_count,
				results: log.results,
				started_at: log.started_at,
				finished_at: log.finished_at
			})),
			{ headers }
		);
	} catch (e) {
		return serviceError(e);
	}
};
