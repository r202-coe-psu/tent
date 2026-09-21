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
export const GET: RequestHandler = async ({ request }) => {
	await requireSystemAdmin(request.headers.get('cookie'));
	try {
		const logs = await listImportLogs();
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
			{ headers: { 'cache-control': 'no-store, max-age=0' } }
		);
	} catch (e) {
		return serviceError(e);
	}
};
