import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

import { fastapiBaseUrl, fastapiServiceHeaders, unwrapFastapiError } from '$lib/server/fastapi';
import { registerIpLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/public/v1/unassigned-registrations/photos
 *
 * Browser → BFF → FastAPI GridFS. Returns `{ photo_id: "gfs:…" }` for member.photo (#255).
 */
export const POST: RequestHandler = async ({ request, getClientAddress, fetch }) => {
	const ip = getClientAddress();
	if (!registerIpLimiter.check(ip)) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	if (!env.EXTERNAL_API_SECRET) {
		return json(
			{ success: false, error: 'SERVER_MISCONFIGURED' },
			{ status: 500, headers: noStore }
		);
	}

	const form = await request.formData().catch(() => null);
	if (!form) {
		return json({ success: false, error: 'INVALID_INPUT' }, { status: 422, headers: noStore });
	}

	const full = form.get('full');
	if (!(full instanceof File) || full.size === 0) {
		return json({ success: false, error: 'EMPTY_PHOTO' }, { status: 422, headers: noStore });
	}
	if (full.size > MAX_BYTES) {
		return json({ success: false, error: 'PHOTO_TOO_LARGE' }, { status: 413, headers: noStore });
	}

	const upstream = new FormData();
	upstream.append('full', full, full.name || 'face.webp');
	const thumb = form.get('thumb');
	if (thumb instanceof File && thumb.size > 0) {
		upstream.append('thumb', thumb, thumb.name || 'thumb.webp');
	}
	for (const key of [
		'filename',
		'content_type',
		'width',
		'height',
		'original_size',
		'compressed_size',
		'thumbnail_size'
	] as const) {
		const value = form.get(key);
		if (typeof value === 'string' && value.trim()) {
			upstream.append(key, value.trim());
		}
	}

	let apiRes: Response;
	try {
		apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/unassigned-registrations/photos`, {
			method: 'POST',
			headers: fastapiServiceHeaders(),
			body: upstream
		});
	} catch {
		return json({ success: false, error: 'WRITE_FAILED' }, { status: 502, headers: noStore });
	}

	if (!apiRes.ok) {
		const errBody = await apiRes.json().catch(() => ({}));
		return json(
			{ success: false, ...unwrapFastapiError(errBody) },
			{ status: apiRes.status, headers: noStore }
		);
	}

	const created = (await apiRes.json()) as Record<string, unknown>;
	return json({ success: true, ...created }, { status: 201, headers: noStore });
};
