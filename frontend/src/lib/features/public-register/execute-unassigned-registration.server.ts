/**
 * Dedicated Public Mongo Executor (#255 / CR-113).
 *
 * Persists a public Unassigned Registration (no shelter selected) to Mongo via
 * FastAPI. Mirrors `executePublicFamilyRegistration` (#254) but writes the
 * central queue — never Couch SoR — through Bearer `EXTERNAL_API_SECRET`.
 *
 * Input is shared `UnifiedRegistrationInput` (not a Couch FamilyRegistrationPlan).
 */
import type { UnifiedRegistrationInput } from '$lib/features/people/server';
import { fastapiBaseUrl, fastapiServiceHeaders, unwrapFastapiError } from '$lib/server/fastapi';
import {
	toUnassignedRegistrationPayload,
	type UnassignedRegistrationPayload
} from './domain/unassigned-registration';

export interface ExecuteUnassignedRegistrationOptions {
	/** SvelteKit `fetch` (or test double) used for the upstream FastAPI call. */
	fetch: typeof globalThis.fetch;
}

export interface UnassignedRegistrationResult {
	success: true;
	id: string;
	schema_v: number;
	reserved_household_id: string;
	members: Array<{
		reserved_evacuee_id: string;
		status: string;
		first_name: string;
		last_name: string;
		gender?: string;
		phone?: string | null;
		[key: string]: unknown;
	}>;
	registered_via: string;
	status: string;
	created_at: string;
}

export class UnassignedRegistrationWriteError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly upstream?: Record<string, unknown>
	) {
		super(message);
		this.name = 'UnassignedRegistrationWriteError';
	}
}

/**
 * Map UnifiedRegistrationInput → FastAPI body and POST to Mongo queue.
 */
export async function executeUnassignedRegistration(
	input: UnifiedRegistrationInput,
	options: ExecuteUnassignedRegistrationOptions
): Promise<UnassignedRegistrationResult> {
	const upstreamBody: UnassignedRegistrationPayload = toUnassignedRegistrationPayload(input);

	let apiRes: Response;
	try {
		apiRes = await options.fetch(`${fastapiBaseUrl()}/public/v1/unassigned-registrations`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(upstreamBody)
		});
	} catch {
		throw new UnassignedRegistrationWriteError('WRITE_FAILED', 502);
	}

	if (!apiRes.ok) {
		const errBody = (await apiRes.json().catch(() => ({}))) as Record<string, unknown>;
		const unwrapped = unwrapFastapiError(errBody);
		const code =
			typeof unwrapped.error === 'string'
				? unwrapped.error
				: ((unwrapped as { error?: { code?: string } }).error?.code ?? 'WRITE_FAILED');
		throw new UnassignedRegistrationWriteError(String(code), apiRes.status, errBody);
	}

	const created = (await apiRes.json()) as UnassignedRegistrationResult;
	return { ...created, success: true };
}
