import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { volunteerTicketLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/** "ขอยกเลิกการสมัครล่วงหน้า" on the pass (CR-092 FR-VOL-03.3). */
export const POST: RequestHandler = async ({ params, fetch, getClientAddress }) => {
	if (!volunteerTicketLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	try {
		const res = await fetch(
			`${fastapiBaseUrl()}/public/v1/volunteer/ticket/${encodeURIComponent(params.token)}/cancel`,
			{ method: 'POST', headers: fastapiServiceHeaders() }
		);
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { errors?: Array<{ error?: string }> };
			const code = body.errors?.[0]?.error;
			return json(
				{ success: false, error: code ?? 'CANCEL_FAILED' },
				{ status: res.status >= 400 ? res.status : 502 }
			);
		}
		return json(await res.json());
	} catch {
		return json({ success: false, error: 'CANCEL_FAILED' }, { status: 503 });
	}
};
