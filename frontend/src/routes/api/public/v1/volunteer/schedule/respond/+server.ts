import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dispatchRespondSchema, ticketFindSchema } from '$lib/features/volunteers/server';
import { volunteerDispatchRespondLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/**
 * Accept or decline an offered shift (CR-092 FR-VOL-06).
 *
 * Two factors, both checked upstream against the same assignment: the phone the portal
 * signed in with, and the short code a manager read out over the phone. A six-character
 * code is only safe alongside the phone number and this limiter — it is the one
 * volunteer surface where guessing gets you a write, and a declined shift cannot be
 * un-declined by the volunteer, so it is held far tighter than the read routes.
 */
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	if (!volunteerDispatchRespondLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const payload = await request.json();
		const parsed = dispatchRespondSchema.safeParse(payload);
		const phone = ticketFindSchema.safeParse({ phone: (payload as { phone?: unknown }).phone });
		if (!parsed.success || !phone.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}

		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/schedule/respond`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ ...parsed.data, phone: phone.data.phone })
		});

		const body = (await res.json().catch(() => ({}))) as { errors?: Array<{ error?: string }> };
		if (!res.ok) {
			const code = body.errors?.[0]?.error;
			return json(
				{ success: false, error: code ?? 'RESPOND_FAILED' },
				{ status: res.status >= 400 ? res.status : 502 }
			);
		}
		return json(body, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'RESPOND_FAILED' }, { status: 503 });
	}
};
