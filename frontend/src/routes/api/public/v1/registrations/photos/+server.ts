import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import {
	PublicBookingImageWriteError,
	savePublicBookingImage
} from '$lib/features/public-register/save-public-booking-image.server';
import { isShelterBookable } from '$lib/features/shelters/server';
import { registerIpLimiter } from '$lib/server/security/rate-limiter';
import { findMasterByCode } from '$lib/server/shelters.admin';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };
const MAX_BYTES = 5 * 1024 * 1024;

function formNumber(form: FormData, key: string): number {
	const raw = form.get(key);
	if (typeof raw !== 'string' || !raw.trim()) return 0;
	const n = Number.parseInt(raw.trim(), 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * POST /api/public/v1/registrations/photos
 *
 * Anonymous public shelter-booking photo upload. Browser → BFF → Couch
 * `image:{ulid}` in the target shelter DB via the roleless public writer
 * (same SoR path as onsite / CR-054 — not GridFS).
 *
 * Multipart fields mirror unassigned GridFS upload so the unified form can
 * reuse the compressed full/thumb payload; `shelter_code` selects the DB.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	if (!registerIpLimiter.check(ip)) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	const form = await request.formData().catch(() => null);
	if (!form) {
		return json({ success: false, error: 'INVALID_INPUT' }, { status: 422, headers: noStore });
	}

	const shelterCode =
		typeof form.get('shelter_code') === 'string' ? String(form.get('shelter_code')).trim() : '';
	if (!shelterCode) {
		return json({ success: false, error: 'SHELTER_REQUIRED' }, { status: 422, headers: noStore });
	}

	const master = await findMasterByCode(shelterCode).catch(() => null);
	if (!master || !isShelterBookable(master)) {
		return json({ success: false, error: 'SHELTER_CLOSED' }, { status: 422, headers: noStore });
	}

	const full = form.get('full');
	if (!(full instanceof File) || full.size === 0) {
		return json({ success: false, error: 'EMPTY_PHOTO' }, { status: 422, headers: noStore });
	}
	if (full.size > MAX_BYTES) {
		return json({ success: false, error: 'PHOTO_TOO_LARGE' }, { status: 413, headers: noStore });
	}

	const thumb = form.get('thumb');
	const filename =
		(typeof form.get('filename') === 'string' && String(form.get('filename')).trim()) ||
		full.name ||
		'photo.webp';
	const contentType =
		(typeof form.get('content_type') === 'string' && String(form.get('content_type')).trim()) ||
		full.type ||
		'image/webp';

	try {
		const created = await savePublicBookingImage({
			shelterCode,
			full,
			thumb: thumb instanceof File && thumb.size > 0 ? thumb : null,
			filename,
			contentType,
			width: formNumber(form, 'width'),
			height: formNumber(form, 'height'),
			originalSize: formNumber(form, 'original_size'),
			compressedSize: formNumber(form, 'compressed_size') || full.size,
			thumbnailSize:
				formNumber(form, 'thumbnail_size') ||
				(thumb instanceof File && thumb.size > 0 ? thumb.size : 0)
		});
		return json({ success: true, ...created }, { status: 201, headers: noStore });
	} catch (err) {
		if (err instanceof PublicBookingImageWriteError) {
			return json({ success: false, error: err.message }, { status: 502, headers: noStore });
		}
		return json({ success: false, error: 'WRITE_FAILED' }, { status: 502, headers: noStore });
	}
};
