import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/db/couch';
import { ServiceError, serviceError } from '$lib/server/couch-admin';
import { recordUserConsent } from '$lib/server/user-service';

export const prerender = false;

export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const session = await getSession(fetch);
		if (!session?.name) {
			throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
		}

		const body = (await request.json().catch(() => null)) as { agreed?: boolean } | null;
		if (!body || body.agreed !== true) {
			throw new ServiceError('VALIDATION', 'Consent agreement is required');
		}

		const result = await recordUserConsent(session.name);
		return json(result);
	} catch (err) {
		return serviceError(err);
	}
};
