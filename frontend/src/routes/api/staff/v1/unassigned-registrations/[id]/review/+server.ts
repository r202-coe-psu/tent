import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, unwrapFastapiError } from '$lib/server/fastapi';
import { requireUnassignedRegistrationQueueAccess } from '../../_auth';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

/**
 * GET /api/staff/v1/unassigned-registrations/[id]/review
 * Read-only pre-claim review (CR-140 addendum) — same auth gate as claim, since this
 * is the step staff take right before it; writes nothing on either side.
 */
export const GET: RequestHandler = async ({ params, request, fetch }) => {
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

	const upstream = `${fastapiBaseUrl()}/staff/v1/unassigned-registrations/${encodeURIComponent(registrationId)}/review`;

	let apiRes: Response;
	try {
		apiRes = await fetch(upstream, {
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
					message: 'Unassigned Registration review requires central connectivity'
				}
			},
			{ status: 503, headers: noStore }
		);
	}

	const body = await apiRes.json().catch(() => ({}));
	if (!apiRes.ok) {
		const unwrapped = unwrapFastapiError(body, 'REVIEW_FAILED');
		return json(
			typeof unwrapped.error === 'object' && unwrapped.error !== null
				? unwrapped
				: { error: unwrapped },
			{ status: apiRes.status, headers: noStore }
		);
	}

	return json(body, { status: 200, headers: noStore });
};
