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
 * CouchDB's remote client normalizes an HTTP 409 into this project's typed
 * ConflictError. CAS must fail closed for every other error shape.
 */
export function isCouchConflictError(error: unknown): error is ConflictError {
	return error instanceof ConflictError;
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
