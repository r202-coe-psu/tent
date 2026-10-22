/** Error envelope + domain-error mapping shared by the staff print routes (plan §4.2). */
import { isHttpError, json } from '@sveltejs/kit';
import {
	DEPENDENCY_UNAVAILABLE,
	PrintDependencyError
} from '$lib/server/printers/device-credentials';
import {
	PrintJobForbiddenError,
	PrintJobNotFoundError,
	PrinterNotFoundError,
	PrinterOfflineError
} from '$lib/server/printers/print-jobs.server';

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export function envelope(status: number, code: string, message: string): Response {
	return json({ error: { code, message } }, { status, headers: noStoreHeaders });
}

export function printErrorResponse(e: unknown): Response {
	if (e instanceof PrinterOfflineError) return envelope(409, 'PRINTER_OFFLINE', e.message);
	if (e instanceof PrinterNotFoundError) return envelope(404, 'PRINTER_NOT_FOUND', e.message);
	if (e instanceof PrintJobNotFoundError) return envelope(404, 'JOB_NOT_FOUND', e.message);
	if (e instanceof PrintJobForbiddenError) return envelope(403, 'FORBIDDEN', e.message);
	if (e instanceof PrintDependencyError) {
		return envelope(503, DEPENDENCY_UNAVAILABLE, e.message);
	}
	if (isHttpError(e) && e.status === 401) return envelope(401, 'UNAUTHENTICATED', e.body.message);
	if (isHttpError(e) && e.status === 403) return envelope(403, 'FORBIDDEN', e.body.message);
	throw e;
}
