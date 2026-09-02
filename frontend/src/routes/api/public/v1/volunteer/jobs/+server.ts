import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { volunteerTicketLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

/**
 * กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1) — the read half of the public board.
 *
 * Anonymous, and the one volunteer surface with nothing personal on it — so it shares
 * the loose ticket-read budget rather than the phone lookup's tight one, which exists
 * to stop enumeration of who is registered. Upstream already refuses to project
 * anything but the public statuses, so there is no per-status filtering to redo here.
 *
 * Never cached: quota moves with every application, and a cached board sends people
 * to a job that filled minutes ago.
 */
export const GET: RequestHandler = async ({ url, fetch, getClientAddress }) => {
	if (!volunteerTicketLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}
	const query = new URLSearchParams();
	const shelterCode = url.searchParams.get('shelter_code');
	const skill = url.searchParams.get('skill');
	if (shelterCode) query.set('shelter_code', shelterCode);
	if (skill) query.set('skill', skill);
	const suffix = query.size > 0 ? `?${query}` : '';

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/jobs${suffix}`, {
			headers: fastapiServiceHeaders()
		});
		if (!res.ok) {
			return json({ success: false, error: 'JOBS_UNAVAILABLE' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'JOBS_UNAVAILABLE' }, { status: 503 });
	}
};
