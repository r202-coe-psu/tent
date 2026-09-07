import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessUnassignedRegistrationQueue } from '$lib/auth/roles';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { fastapiBaseUrl, unwrapFastapiError } from '$lib/server/fastapi';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

/**
 * GET /api/staff/v1/unassigned-registrations/search?q=
 * Forwards the caller's AuthSession cookie to FastAPI staff search (CR-113 / #245).
 * Browser never talks to FastAPI directly.
 */
export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const cookie = request.headers.get('cookie');
	try {
		const caller = await requireShelterScopeOrSA(cookie);
		if (!canAccessUnassignedRegistrationQueue(caller.roles, caller.shelterCode)) {
			return json(
				{ error: { code: 'FORBIDDEN', message: 'Requires registration_staff or above' } },
				{ status: 403, headers: noStore }
			);
		}
	} catch (e) {
		const status =
			typeof e === 'object' && e !== null && 'status' in e && typeof e.status === 'number'
				? e.status
				: 401;
		return json(
			{
				error: {
					code: status === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED',
					message: e instanceof Error ? e.message : 'Authentication required'
				}
			},
			{ status, headers: noStore }
		);
	}

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
