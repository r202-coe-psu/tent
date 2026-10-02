import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, unwrapFastapiError } from '$lib/server/fastapi';
import { requireUnassignedRegistrationQueueAccess } from '../../_auth';

export const prerender = false;

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/staff/v1/unassigned-registrations/photos/[photoId]
 * Binary proxy (CR-140 addendum) — same auth gate as review/claim. FastAPI 404s
 * unless `photoId` is still referenced by an open member/pet, so this never leaks
 * a photo once its registration row has moved on.
 */
export const GET: RequestHandler = async ({ params, request, fetch }) => {
	const cookie = request.headers.get('cookie');
	const auth = await requireUnassignedRegistrationQueueAccess(cookie);
	if (!auth.ok) return auth.response;

	const photoId = params.photoId?.trim();
	if (!photoId) {
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'photo id required' } },
			{ status: 422, headers: noStore }
		);
	}

	const upstream = `${fastapiBaseUrl()}/staff/v1/unassigned-registrations/photos/${encodeURIComponent(photoId)}`;

	let apiRes: Response;
	try {
		apiRes = await fetch(upstream, {
			headers: { ...(cookie ? { Cookie: cookie } : {}) }
		});
	} catch {
		return json(
			{
				error: {
					code: 'ONLINE_REQUIRED',
					message: 'Unassigned Registration photo requires central connectivity'
				}
			},
			{ status: 503, headers: noStore }
		);
	}

	if (!apiRes.ok) {
		const body = await apiRes.json().catch(() => ({}));
		const unwrapped = unwrapFastapiError(body, 'NOT_FOUND');
		return json(
			typeof unwrapped.error === 'object' && unwrapped.error !== null
				? unwrapped
				: { error: unwrapped },
			{ status: apiRes.status, headers: noStore }
		);
	}

	return new Response(await apiRes.arrayBuffer(), {
		status: 200,
		headers: {
			'Content-Type': apiRes.headers.get('content-type') ?? 'application/octet-stream',
			...noStore
		}
	});
};
