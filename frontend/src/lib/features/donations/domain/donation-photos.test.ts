import { describe, expect, it } from 'vitest';
import {
	DONATION_PHOTO_RULES,
	donationPhotoIdsSchema,
	rejectDonationPhotoDocs,
	rejectDonationPhotoIds,
	shelterAcceptsDonations,
	type StoredDonationPhoto
} from './donation-photos';

const MB = 1024 * 1024;
const id = (n: number) => `image:01K8PHXTX${String(n).padStart(17, '0')}`;
const photo = (over: Partial<StoredDonationPhoto> = {}): StoredDonationPhoto => ({
	purpose: 'donation',
	bytes: 200_000,
	...over
});

describe('donation photo rules (CR-175 FR-10)', () => {
	it('checks in the order the CR lists, the id count before any read', () => {
		expect(DONATION_PHOTO_RULES.map((r) => r.code)).toEqual([
			'PHOTO_LIMIT_EXCEEDED',
			'PHOTO_NOT_FOUND',
			'PHOTO_INVALID',
			'PHOTO_ALREADY_USED',
			'PHOTOS_TOO_LARGE'
		]);
		expect(DONATION_PHOTO_RULES[0].stage).toBe('ids');
	});

	it('takes 30 ids and refuses 31 (AC-8)', () => {
		expect(rejectDonationPhotoIds(Array.from({ length: 30 }, (_, i) => id(i)))).toBeNull();
		expect(rejectDonationPhotoIds(Array.from({ length: 31 }, (_, i) => id(i)))).toBe(
			'PHOTO_LIMIT_EXCEEDED'
		);
	});

	it('passes a set of unbound donation photos under 10 MB', () => {
		expect(rejectDonationPhotoDocs([photo(), photo()])).toBeNull();
		expect(rejectDonationPhotoDocs([])).toBeNull();
	});

	it('names a photo missing from the shelter DB before anything else (AC-4)', () => {
		expect(
			rejectDonationPhotoDocs([
				null,
				photo({ purpose: undefined }),
				photo({ donation_id: 'donation:X' })
			])
		).toBe('PHOTO_NOT_FOUND');
	});

	it('refuses a photo that is not a donation photo (AC-4)', () => {
		expect(rejectDonationPhotoDocs([photo(), photo({ purpose: undefined })])).toBe('PHOTO_INVALID');
	});

	it('refuses a photo another booking already holds (AC-9)', () => {
		expect(rejectDonationPhotoDocs([photo({ donation_id: 'donation:OTHER' })])).toBe(
			'PHOTO_ALREADY_USED'
		);
	});

	it('refuses a set over 10 MB of full + thumb, and takes exactly 10 MB (FR-7)', () => {
		expect(
			rejectDonationPhotoDocs([photo({ bytes: 6 * MB }), photo({ bytes: 4 * MB })])
		).toBeNull();
		expect(rejectDonationPhotoDocs([photo({ bytes: 6 * MB }), photo({ bytes: 4 * MB + 1 })])).toBe(
			'PHOTOS_TOO_LARGE'
		);
	});
});

describe('donationPhotoIdsSchema', () => {
	it('keeps image ids, drops repeats, and refuses anything else', () => {
		expect(donationPhotoIdsSchema.parse([id(1), id(2), id(1)])).toEqual([id(1), id(2)]);
		expect(donationPhotoIdsSchema.safeParse(['image:../_all_docs']).success).toBe(false);
		expect(donationPhotoIdsSchema.safeParse(['donation:01K8PHXTX00000000000000001']).success).toBe(
			false
		);
	});
});

describe('shelterAcceptsDonations', () => {
	it('mirrors what FastAPI create accepts', () => {
		for (const status of ['open', 'active', 'full_capacity']) {
			expect(shelterAcceptsDonations(status), status).toBe(true);
		}
		for (const status of ['closed', 'standby', 'cancelled', null]) {
			expect(shelterAcceptsDonations(status), String(status)).toBe(false);
		}
	});
});
