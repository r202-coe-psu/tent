import { getShelterDb } from '$lib/db/shelter';
import { ConflictError, NotFoundError } from '$lib/utils/errors';

export { ConflictError, NotFoundError };

export const MAX_CAS_RETRIES = 5;

/** Resolves the CouchDB database name for a shelter code under Remote-First architecture. */
export function resolveShelterDbName(shelterCode: string): string {
	if (!shelterCode) {
		throw new Error('shelter_code is required for shelter database resolution');
	}
	return getShelterDb(shelterCode);
}

/**
 * Checks whether an error indicates a CouchDB HTTP 409 Conflict.
 * Bounded CAS retry loops retry only on actual document conflicts.
 */
export function isCouchConflictError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	if (error instanceof ConflictError) return true;
	const candidate = error as {
		status?: number;
		statusCode?: number;
		name?: string;
		message?: string;
	};
	return (
		candidate.status === 409 ||
		candidate.statusCode === 409 ||
		candidate.name === 'ConflictError' ||
		(typeof candidate.message === 'string' && candidate.message.includes('409'))
	);
}

/**
 * Executes an operation with bounded CAS retry on CouchDB 409 conflict only.
 * Reload and recompute must happen inside `operation`. Non-conflict errors fail immediately.
 */
export async function retryCas<T>(
	operation: (attempt: number) => Promise<T>,
	maxRetries: number = MAX_CAS_RETRIES
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation(attempt);
		} catch (error) {
			lastError = error;
			if (!isCouchConflictError(error) || attempt === maxRetries) {
				throw error;
			}
		}
	}
	throw lastError;
}
