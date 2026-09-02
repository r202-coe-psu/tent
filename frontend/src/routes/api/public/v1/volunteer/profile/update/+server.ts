import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	portalCredentialSchema,
	volunteerProfileUpdateSchema
} from '$lib/features/volunteer-portal/server';
import { volunteerProfileUpdateLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

/**
 * Change the parts of the profile the volunteer owns.
 *
 * A write, so it gets its own budget rather than the shared read one — and a tighter
 * one, because the credential that reaches it (a phone number, or a `VIEW-` token handed
 * out by a phone lookup) is guessable. What it can express is the whole defence beyond
 * that: only `skills` crosses to FastAPI, so nothing here can touch `identity_verified`,
 * `status`, `volunteer_code` or `personnel_type`, which are staff decisions.
 */
export const POST: RequestHandler = async ({ request, fetch, getClientAddress }) => {
	if (!volunteerProfileUpdateLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const payload = await request.json();
		const credential = portalCredentialSchema.safeParse(payload);
		const update = volunteerProfileUpdateSchema.safeParse(payload);
		if (!credential.success || !update.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/profile/update`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ ...credential.data, skills: update.data.skills })
		});
		const body = (await res.json().catch(() => ({}))) as { errors?: Array<{ error?: string }> };
		if (!res.ok) {
			const code = body.errors?.[0]?.error;
			return json(
				{ success: false, error: code ?? 'PROFILE_UPDATE_FAILED' },
				{ status: res.status >= 400 ? res.status : 502 }
			);
		}
		return json(body, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'PROFILE_UPDATE_FAILED' }, { status: 503 });
	}
};
