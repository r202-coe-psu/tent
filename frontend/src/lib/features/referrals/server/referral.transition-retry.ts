import type { Referral, ReferralStatus } from '../domain/referral.schema';

/** Max attempts for a single referral transition when CouchDB answers 409 (document conflict). */
export const TRANSITION_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 50;

/** The one repository method the retry loop needs (lets tests and the bulk core inject a fake). */
export interface TransitionRepo {
	transition(
		id: string,
		to: ReferralStatus,
		actor: string,
		reason?: string,
		actorShelter?: string
	): Promise<Referral>;
}

/** Raised when every attempt hit a write conflict. HTTP 409. */
export class ReferralConflictError extends Error {
	readonly status = 409;
	constructor(
		attempts: number,
		public readonly details?: string
	) {
		super(`Conflict: transition failed after ${attempts} attempts`);
		this.name = 'ReferralConflictError';
	}
}

function isConflict(e: unknown): boolean {
	const err = e as { status?: number; message?: string };
	return (
		err.status === 409 ||
		!!err.message?.includes('409') ||
		!!err.message?.includes('conflict') ||
		!!err.message?.includes('Conflict')
	);
}

/**
 * Run `repo.transition` with the conflict retry shared by the per-item BFF endpoint and the bulk
 * core (CR-167 FR-B7): up to 3 attempts, 50ms apart, only on a 409; anything else is rethrown at
 * once. Each attempt re-reads the latest doc inside `transition()`.
 *
 * @throws {ReferralConflictError} when all attempts conflict.
 */
export async function transitionWithRetry(
	repo: TransitionRepo,
	id: string,
	to: ReferralStatus,
	actor: string,
	reason: string | undefined,
	actorShelter: string
): Promise<Referral> {
	let lastError: { message?: string } | null = null;

	for (let attempt = 0; attempt < TRANSITION_MAX_RETRIES; attempt++) {
		try {
			return await repo.transition(id, to, actor, reason, actorShelter);
		} catch (e: unknown) {
			if (!isConflict(e)) throw e;
			lastError = e as { message?: string };
			// Wait before retrying to mitigate write contention
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		}
	}

	throw new ReferralConflictError(TRANSITION_MAX_RETRIES, lastError?.message);
}
