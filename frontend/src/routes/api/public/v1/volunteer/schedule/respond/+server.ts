import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	dispatchRespondSchema,
	portalCredentialSchema
} from '$lib/features/volunteer-portal/server';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/**
 * Accept or decline an offered shift (CR-092 FR-VOL-06).
 *
 * Two factors, both checked upstream against the same assignment: whichever credential
 * the portal signed in with (phone or ticket token), and the short code a manager read
 * out over the phone. A six-character code is only safe alongside that credential — it is
 * the one volunteer surface where guessing gets you a write, and a declined shift cannot be
 * un-declined by the volunteer.
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const payload = await request.json();
		const parsed = dispatchRespondSchema.safeParse(payload);
		const credential = portalCredentialSchema.safeParse(payload);
		if (!parsed.success || !credential.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}

		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/schedule/respond`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ ...parsed.data, ...credential.data })
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
