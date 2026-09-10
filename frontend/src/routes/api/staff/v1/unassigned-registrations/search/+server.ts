import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, unwrapFastapiError } from '$lib/server/fastapi';
import { requireUnassignedRegistrationSearchAccess } from '../_auth';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

/**
 * GET /api/staff/v1/unassigned-registrations/search?q=
 * Forwards the caller's AuthSession cookie to FastAPI staff search (CR-113 / #245).
 * Browser never talks to FastAPI directly.
 * Auth: any shelter-scoped staff (or SA) — claim stays registration-desk gated (#251).
 */
export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const cookie = request.headers.get('cookie');
	const auth = await requireUnassignedRegistrationSearchAccess(cookie);
	if (!auth.ok) return auth.response;

	const q = url.searchParams.get('q') ?? '';
	const upstream = new URL(`${fastapiBaseUrl()}/staff/v1/unassigned-registrations/search`);
	upstream.searchParams.set('q', q);

	let apiRes: Response;
	try {
		apiRes = await fetch(upstream.toString(), {
			headers: {
				Accept: 'application/json',
				...(cookie ? { Cookie: cookie } : {})
			}
		});
	} catch {
		return json(
			{
				error: {
					code: 'ONLINE_REQUIRED',
					message: 'Unassigned Registration search requires central connectivity'
				}
			},
			{ status: 503, headers: noStore }
		);
	}

	const body = await apiRes.json().catch(() => ({}));
	if (!apiRes.ok) {
		const unwrapped = unwrapFastapiError(body, 'ONLINE_REQUIRED');
		return json(
			typeof unwrapped.error === 'object' && unwrapped.error !== null
				? unwrapped
				: { error: unwrapped },
			{ status: apiRes.status, headers: noStore }
		);
	}

	return json(body, { status: 200, headers: noStore });
};
