import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import { volunteerTicketFindLimiter } from '$lib/server/security/rate-limiter';
import {
	applyPublicScheduleAction,
	PublicScheduleError
} from '$lib/features/volunteers/server/public-schedule-action';

export const prerender = false;

const actionBodySchema = z.union([
	portalCredentialSchema.options[0].extend({
		assignment_id: z.string().trim().min(1).max(120),
		action: z.enum(['check_in', 'check_out', 'withdraw'])
	}),
	portalCredentialSchema.options[1].extend({
		assignment_id: z.string().trim().min(1).max(120),
		action: z.enum(['check_in', 'check_out', 'withdraw'])
	})
]);

/** Volunteer-owned check-in, check-out and withdrawal action. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!volunteerTicketFindLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = actionBodySchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const { assignment_id, action, ...credential } = parsed.data;
		return json(await applyPublicScheduleAction(credential, assignment_id, action), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof PublicScheduleError) {
			return json({ success: false, error: error.code }, { status: error.httpStatus });
		}
		return json({ success: false, error: 'ACTION_FAILED' }, { status: 503 });
	}
};
