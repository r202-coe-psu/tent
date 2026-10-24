import { z } from 'zod';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

const LOOKUP_TIMEOUT_MS = 3_000;

const unassignedMemberSchema = z.object({
	reserved_evacuee_id: z.string(),
	first_name: z.string(),
	last_name: z.string(),
	gender: z.string().nullable(),
	age: z.number().nullable(),
	status: z.enum(['open', 'claimed', 'cancelled']),
	claimed_shelter_code: z.string().nullable(),
	matched: z.boolean()
});

const unassignedRegistrationSchema = z.object({
	registration_id: z.string(),
	reserved_household_id: z.string(),
	members: z.array(unassignedMemberSchema)
});

export type UnassignedRegistrationMember = z.infer<typeof unassignedMemberSchema>;
export type UnassignedRegistration = z.infer<typeof unassignedRegistrationSchema>;

/** Exactly one key, mirroring the FastAPI `kiosk-lookup` body. */
export type UnassignedRegistrationQuery =
	{ registration_id: string } | { citizen_id: string } | { evacuee_id: string };

/** The central queue (FastAPI / Mongo) could not answer: network, timeout, 5xx or a bad body. */
export class KioskUnassignedUnavailableError extends Error {
	constructor() {
		super('Unassigned registration queue unavailable');
		this.name = 'KioskUnassignedUnavailableError';
	}
}

/** The registration (any status) the query points at, or `null` when the queue has none. */
export async function findUnassignedRegistration(
	query: UnassignedRegistrationQuery
): Promise<UnassignedRegistration | null> {
	let response: Response;
	try {
		response = await fetch(`${fastapiBaseUrl()}/public/v1/unassigned-registrations/kiosk-lookup`, {
			method: 'POST',
			headers: fastapiServiceHeaders({
				'content-type': 'application/json',
				accept: 'application/json'
			}),
			body: JSON.stringify(query),
			signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
		});
	} catch {
		throw new KioskUnassignedUnavailableError();
	}
	if (response.status === 404) return null;
	if (!response.ok) throw new KioskUnassignedUnavailableError();

	const parsed = unassignedRegistrationSchema.safeParse(await response.json().catch(() => null));
	if (!parsed.success) throw new KioskUnassignedUnavailableError();
	return parsed.data;
}
