import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import {
	readOrMintRoleCardToken,
	PublicScheduleError
} from '$lib/features/volunteers/server/public-schedule-action';
import { volunteerTicketFindLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

/**
 * Return the volunteer's role-card payload from the `volunteer` document.
 * This is intentionally independent of jobs, applications, and assignments.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!volunteerTicketFindLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = portalCredentialSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const credential = parsed.data;
		if (!('phone' in credential) || !credential.phone || !credential.portal_id) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}

		const result = await readOrMintRoleCardToken(credential);
		return json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof PublicScheduleError) {
			return json({ success: false, error: error.code }, { status: error.httpStatus });
		}
		return json({ success: false, error: 'ROLE_CARD_WRITE_FAILED' }, { status: 503 });
	}
};
