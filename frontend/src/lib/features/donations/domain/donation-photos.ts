import { z } from 'zod';

/**
 * Donor photos on an unsolicited booking (CR-175 donor photos). Pure: limits, the
 * booking-time checks of FR-10, and the shapes the BFF and the donor form share.
 */

const MB = 1024 * 1024;

/** FR-3 — photos per booking. */
export const DONATION_PHOTO_MAX_COUNT = 30;
/** FR-4 — an original the donor may pick, checked on their device before compressing. */
export const DONATION_PHOTO_MAX_ORIGINAL_BYTES = 20 * MB;
/** FR-6 — the compressed `full` (and `thumb`) the upload BFF accepts. */
export const DONATION_PHOTO_MAX_UPLOAD_BYTES = 1.5 * MB;
/** FR-7 — `full` + `thumb` of every photo on one booking. */
export const DONATION_PHOTOS_MAX_TOTAL_BYTES = 10 * MB;
/** FR-5 — passed to `compressImage`; its defaults stay as they are for other features. */
export const DONATION_PHOTO_COMPRESS = { maxPx: 1600, quality: 0.8, thumbPx: 200 } as const;

export const donationPhotoIdSchema = z.string().regex(/^image:[0-9A-HJKMNP-TV-Z]{26}$/);

/**
 * `photos` on `POST /api/public/v1/donations`. Not capped here: 31 ids must reach the
 * rules below and come back as `PHOTO_LIMIT_EXCEEDED` (AC-8), not as a schema error.
 * A repeated id is one photo.
 */
export const donationPhotoIdsSchema = z
	.array(donationPhotoIdSchema)
	.transform((ids) => [...new Set(ids)]);

export type DonationPhotoErrorCode =
	| 'PHOTO_LIMIT_EXCEEDED'
	| 'PHOTO_NOT_FOUND'
	| 'PHOTO_INVALID'
	| 'PHOTO_ALREADY_USED'
	| 'PHOTOS_TOO_LARGE';

/** One photo doc as the BFF read it from the booking's shelter DB; `null` = not there. */
export interface StoredDonationPhoto {
	purpose?: string;
	donation_id?: string;
	/** `full` + `thumb` attachment lengths as CouchDB stored them. */
	bytes: number;
}

type DonationPhotoRule =
	| {
			code: DonationPhotoErrorCode;
			stage: 'ids';
			fails: (ids: readonly string[]) => boolean;
	  }
	| {
			code: DonationPhotoErrorCode;
			stage: 'docs';
			fails: (docs: readonly (StoredDonationPhoto | null)[]) => boolean;
	  };

/**
 * FR-10, in order: the first rule that fails is the answer. The `ids` rule runs before
 * any CouchDB read, so a 31-id request costs nothing.
 */
export const DONATION_PHOTO_RULES: readonly DonationPhotoRule[] = [
	{
		code: 'PHOTO_LIMIT_EXCEEDED',
		stage: 'ids',
		fails: (ids) => ids.length > DONATION_PHOTO_MAX_COUNT
	},
	{ code: 'PHOTO_NOT_FOUND', stage: 'docs', fails: (docs) => docs.some((d) => d === null) },
	{
		code: 'PHOTO_INVALID',
		stage: 'docs',
		fails: (docs) => docs.some((d) => d !== null && d.purpose !== 'donation')
	},
	{
		code: 'PHOTO_ALREADY_USED',
		stage: 'docs',
		fails: (docs) => docs.some((d) => d !== null && Boolean(d.donation_id))
	},
	{
		code: 'PHOTOS_TOO_LARGE',
		stage: 'docs',
		fails: (docs) =>
			docs.reduce((sum, d) => sum + (d?.bytes ?? 0), 0) > DONATION_PHOTOS_MAX_TOTAL_BYTES
	}
];

export function rejectDonationPhotoIds(ids: readonly string[]): DonationPhotoErrorCode | null {
	for (const rule of DONATION_PHOTO_RULES) {
		if (rule.stage === 'ids' && rule.fails(ids)) return rule.code;
	}
	return null;
}

export function rejectDonationPhotoDocs(
	docs: readonly (StoredDonationPhoto | null)[]
): DonationPhotoErrorCode | null {
	for (const rule of DONATION_PHOTO_RULES) {
		if (rule.stage === 'docs' && rule.fails(docs)) return rule.code;
	}
	return null;
}

/**
 * Does the shelter take donations right now? The upload BFF reads the registry, so it
 * judges the registry status the way FastAPI's create judges the projected one:
 * `map_public_shelter_status` (worker) turns `closed` → closed and `standby` → standby,
 * and create refuses both; a cancelled shelter is not on the public plane at all.
 */
export function shelterAcceptsDonations(operationStatus: string | null): boolean {
	return operationStatus !== null && !['closed', 'standby', 'cancelled'].includes(operationStatus);
}
