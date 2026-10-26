import { shouldRetryQuery } from '$lib/auth/session-expiry';
import { TransferForbiddenError } from '../domain/operations';

/**
 * A refused transfer list stays refused: asking again only delays the "no permission" message
 * and repeats the 403 (#571). Everything else retries as the app default does.
 */
export function retryUnlessForbidden(failureCount: number, err: unknown): boolean {
	return !(err instanceof TransferForbiddenError) && shouldRetryQuery(failureCount, err);
}
