import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, unwrapFastapiError } from '$lib/server/fastapi';
import { requireUnassignedRegistrationQueueAccess } from '../../_auth';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

/**
 * POST /api/staff/v1/unassigned-registrations/[id]/claim
 * Forwards AuthSession cookie to FastAPI claim (CR-113 / #247).
 * Browser never talks to FastAPI directly.
 */
export const POST: RequestHandler = async ({ params, request, fetch }) => {
	const cookie = request.headers.get('cookie');
	const auth = await requireUnassignedRegistrationQueueAccess(cookie);
	if (!auth.ok) return auth.response;

	const registrationId = params.id?.trim();
	if (!registrationId) {
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'registration id required' } },
			{ status: 422, headers: noStore }
		);
	}

	const payload = await request.json().catch(() => null);
	if (!payload || typeof payload !== 'object') {
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'JSON body required' } },
			{ status: 422, headers: noStore }
		);
	}

	const upstream = `${fastapiBaseUrl()}/staff/v1/unassigned-registrations/${encodeURIComponent(registrationId)}/claim`;

	let apiRes: Response;
	try {
		apiRes = await fetch(upstream, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...(cookie ? { Cookie: cookie } : {})
			},
			body: JSON.stringify(payload)
		});
	} catch {
		return json(
			{
				error: {
					code: 'ONLINE_REQUIRED',
					message: 'Unassigned Registration claim requires central connectivity'
				}
			},
			{ status: 503, headers: noStore }
		);
	}

	const body = await apiRes.json().catch(() => ({}));
	if (!apiRes.ok) {
		const unwrapped = unwrapFastapiError(body, 'CLAIM_FAILED');
		return json(
			typeof unwrapped.error === 'object' && unwrapped.error !== null
				? unwrapped
				: { error: unwrapped },
			{ status: apiRes.status, headers: noStore }
		);
	}

	return json(body, { status: 200, headers: noStore });
};
