/** Error envelope + domain-error mapping shared by the staff print routes (plan §4.2). */
import { isHttpError, json } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/session-auth';
import {
	DEPENDENCY_UNAVAILABLE,
	PrintDependencyError
} from '$lib/server/printers/device-credentials';
import { isDependencyUnreachable } from '$lib/server/printers/dependency-unreachable';
import {
	PrintJobForbiddenError,
	PrintJobIdConflictError,
	PrintJobNotFoundError,
	PrinterNotFoundError,
	PrinterOfflineError
} from '$lib/server/printers/print-jobs.server';

/** Never echoes a dependency's own message: it can name env vars or hosts. */
const DEPENDENCY_MESSAGE = 'Print service unavailable';

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export function envelope(status: number, code: string, message: string): Response {
	return json({ error: { code, message } }, { status, headers: noStoreHeaders });
}

export function printErrorResponse(e: unknown): Response {
	if (e instanceof PrinterOfflineError) return envelope(409, 'PRINTER_OFFLINE', e.message);
	if (e instanceof PrintJobIdConflictError) return envelope(409, 'JOB_ID_CONFLICT', e.message);
	if (e instanceof PrinterNotFoundError) return envelope(404, 'PRINTER_NOT_FOUND', e.message);
	if (e instanceof PrintJobNotFoundError) return envelope(404, 'JOB_NOT_FOUND', e.message);
	if (e instanceof PrintJobForbiddenError) return envelope(403, 'FORBIDDEN', e.message);
	if (e instanceof PrintDependencyError || isDependencyUnreachable(e)) {
		// Details (env var names, hosts) stay in the server log, never in the staff-visible message.
		console.error('[printing] dependency unavailable:', e instanceof Error ? e.message : e);
		return envelope(503, DEPENDENCY_UNAVAILABLE, DEPENDENCY_MESSAGE);
	}
	// Covers CouchUserError (the caller's own CouchDB session) and the FORBIDDEN from createPrintJob.
	// Only `message` is rendered: `couchReason` / `description` stay in server logs.
	if (e instanceof ServiceError && e.code === 'UNAUTHENTICATED') {
		return envelope(401, 'UNAUTHENTICATED', e.message);
	}
	if (e instanceof ServiceError && e.code === 'FORBIDDEN') {
		return envelope(403, 'FORBIDDEN', e.message);
	}
	if (isHttpError(e) && e.status === 401) return envelope(401, 'UNAUTHENTICATED', e.body.message);
	if (isHttpError(e) && e.status === 403) return envelope(403, 'FORBIDDEN', e.body.message);
	throw e;
}
