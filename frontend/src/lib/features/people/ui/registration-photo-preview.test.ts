import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	forgetPhotoPreview,
	recallPhotoPreview,
	rememberPhotoPreview,
	resolvePhotoPreviewUrl
} from './registration-photo-preview';

vi.mock('$lib/features/images', () => ({
	imageRepository: () => ({
		getThumbnailUrl: vi.fn(async (id: string) => `thumb://${id}`)
	})
}));

describe('registration-photo-preview', () => {
	afterEach(() => {
		forgetPhotoPreview('image:onsite-1');
		forgetPhotoPreview('gfs:public-1');
		forgetPhotoPreview('image:public-1');
	});

	it('remembers and recalls session preview URLs', () => {
		rememberPhotoPreview('image:onsite-1', 'blob:preview-a');
		expect(recallPhotoPreview('image:onsite-1')).toBe('blob:preview-a');
		expect(recallPhotoPreview(null)).toBeNull();
	});

	it('resolves onsite image: from Couch thumbnail when cache misses', async () => {
		const url = await resolvePhotoPreviewUrl('image:onsite-1', 'onsite-couch');
		expect(url).toBe('thumb://image:onsite-1');
	});

	it('returns null for public gfs: without a session cache (no public GET yet)', async () => {
		expect(await resolvePhotoPreviewUrl('gfs:public-1', 'unassigned-gridfs')).toBeNull();
		expect(await resolvePhotoPreviewUrl('image:public-1', 'shelter-couch')).toBeNull();
	});

	it('prefers session cache over Couch for image: ids', async () => {
		rememberPhotoPreview('image:onsite-1', 'blob:cached');
		expect(await resolvePhotoPreviewUrl('image:onsite-1', 'onsite-couch')).toBe('blob:cached');
	});
});
