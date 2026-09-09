import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import { volunteerTicketFindLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

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
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	if (!volunteerTicketFindLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const parsed = actionBodySchema.safeParse(await request.json());
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/schedule/action`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(parsed.data)
		});
		const body = await res.json().catch(() => ({ success: false, error: 'ACTION_FAILED' }));
		if (!res.ok) {
			const detail = body as { detail?: { error?: string }; error?: string };
			return json(
				{ success: false, error: detail.detail?.error ?? detail.error ?? 'ACTION_FAILED' },
				{ status: res.status }
			);
		}
		return json(body, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'ACTION_FAILED' }, { status: 503 });
	}
};
