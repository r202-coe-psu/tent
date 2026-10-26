import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import {
	DONATION_PHOTO_MAX_UPLOAD_BYTES,
	shelterAcceptsDonations
} from '$lib/features/donations/server';
import { detectImageMime, type ImageMime } from '$lib/features/images/server';
import {
	PublicBookingImageWriteError,
	savePublicBookingImage
} from '$lib/features/public-register/save-public-booking-image.server';
import { resolveOperationStatus } from '$lib/features/shelters/server';
import { findMasterByCode } from '$lib/server/shelters.admin';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

function formNumber(form: FormData, key: string): number {
	const raw = form.get(key);
	if (typeof raw !== 'string' || !raw.trim()) return 0;
	const n = Number.parseInt(raw.trim(), 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

function refuse(error: string, status = 422) {
	return json({ success: false, error }, { status, headers: noStore });
}

type CheckedFile = { ok: true; mime: ImageMime } | { ok: false; error: string; status: number };

/** FR-6: real image bytes (magic number, not `content-type`), no bigger than 1.5 MB. */
async function checkImageFile(value: FormDataEntryValue | null): Promise<CheckedFile> {
	if (!(value instanceof File) || value.size === 0) {
		return { ok: false, error: 'EMPTY_PHOTO', status: 422 };
	}
	if (value.size > DONATION_PHOTO_MAX_UPLOAD_BYTES) {
		return { ok: false, error: 'PHOTO_TOO_LARGE', status: 413 };
	}
	const mime = detectImageMime(new Uint8Array(await value.slice(0, 12).arrayBuffer()));
	return mime ? { ok: true, mime } : { ok: false, error: 'PHOTO_NOT_IMAGE', status: 422 };
}

/**
 * POST /api/public/v1/donations/photos (CR-175 donor photos FR-8)
 *
 * One compressed donor photo → Couch `image:{ulid}` with `purpose: 'donation'` in the
 * booking's shelter DB through the roleless public writer, the same path as
 * `registrations/photos`. Returns `photo_id`; the booking POST binds it (FR-10) and the
 * worker writes `donation_id` onto it (FR-11a). An upload that never gets booked is
 * swept after 24 h (FR-16). Rate limit is nginx `public_write` (CR-188), not here.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	if (!form) return refuse('INVALID_INPUT');

	const full = form.get('full');
	const thumb = form.get('thumb');
	const fullCheck = await checkImageFile(full);
	if (!fullCheck.ok) return refuse(fullCheck.error, fullCheck.status);
	const thumbCheck = await checkImageFile(thumb);
	if (!thumbCheck.ok) return refuse(thumbCheck.error, thumbCheck.status);

	const shelterCode =
		typeof form.get('shelter_code') === 'string' ? String(form.get('shelter_code')).trim() : '';
	if (!shelterCode) return refuse('SHELTER_REQUIRED');

	const master = await findMasterByCode(shelterCode).catch(() => null);
	if (!master || !shelterAcceptsDonations(resolveOperationStatus(master))) {
		return refuse('SHELTER_CLOSED');
	}

	const fullFile = full as File;
	const thumbFile = thumb as File;
	try {
		const created = await savePublicBookingImage({
			shelterCode,
			full: fullFile,
			// Stored under the type its bytes are, whatever the browser labelled it.
			thumb: new Blob([thumbFile], { type: thumbCheck.mime }),
			filename:
				(typeof form.get('filename') === 'string' && String(form.get('filename')).trim()) ||
				fullFile.name ||
				'photo.webp',
			contentType: fullCheck.mime,
			width: formNumber(form, 'width'),
			height: formNumber(form, 'height'),
			originalSize: formNumber(form, 'original_size'),
			// Measured here, not taken from the form: the booking's 10 MB check reads the
			// stored attachments, and these fields should say the same.
			compressedSize: fullFile.size,
			thumbnailSize: thumbFile.size,
			purpose: 'donation'
		});
		return json({ success: true, ...created }, { status: 201, headers: noStore });
	} catch (err) {
		const error = err instanceof PublicBookingImageWriteError ? err.message : 'WRITE_FAILED';
		return refuse(error, 502);
	}
};
