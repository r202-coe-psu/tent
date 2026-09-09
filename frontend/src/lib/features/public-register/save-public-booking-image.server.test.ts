import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	savePublicBookingImage,
	PublicBookingImageWriteError
} from './save-public-booking-image.server';
import {
	deleteAsPublicWriter,
	putAsPublicWriter,
	putAttachmentAsPublicWriter
} from '$lib/server/couch-public-writer';

vi.mock('$lib/server/couch-public-writer', () => ({
	putAsPublicWriter: vi.fn(),
	putAttachmentAsPublicWriter: vi.fn(),
	deleteAsPublicWriter: vi.fn()
}));

describe('savePublicBookingImage', () => {
	beforeEach(() => {
		vi.mocked(putAsPublicWriter).mockReset();
		vi.mocked(putAttachmentAsPublicWriter).mockReset();
		vi.mocked(deleteAsPublicWriter).mockReset();
	});

	it('writes image doc + full/thumb attachments and returns image:{ulid}', async () => {
		vi.mocked(putAsPublicWriter).mockResolvedValue({
			status: 201,
			data: { ok: true, rev: '1-a' }
		});
		vi.mocked(putAttachmentAsPublicWriter)
			.mockResolvedValueOnce({ status: 201, id: 'image:X', rev: '2-b' })
			.mockResolvedValueOnce({ status: 201, id: 'image:X', rev: '3-c' });

		const full = new Blob(['full'], { type: 'image/webp' });
		const thumb = new Blob(['thumb'], { type: 'image/webp' });
		const result = await savePublicBookingImage({
			shelterCode: 'SH001',
			full,
			thumb,
			filename: 'face.webp',
			contentType: 'image/webp',
			width: 800,
			height: 600,
			originalSize: 12000,
			compressedSize: 4000,
			thumbnailSize: 800
		});

		expect(result.photo_id).toMatch(/^image:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(result.content_type).toBe('image/webp');
		expect(putAsPublicWriter).toHaveBeenCalledTimes(1);
		const [dbName, docId, doc] = vi.mocked(putAsPublicWriter).mock.calls[0];
		expect(dbName).toBe('shelter_sh001');
		expect(docId).toBe(result.photo_id);
		expect(doc).toMatchObject({
			type: 'image',
			schema_v: 1,
			shelter_code: 'SH001',
			created_by: 'public',
			filename: 'face.webp'
		});
		expect(putAttachmentAsPublicWriter).toHaveBeenCalledTimes(2);
		expect(deleteAsPublicWriter).not.toHaveBeenCalled();
	});

	it('rolls back the image doc when an attachment PUT fails', async () => {
		vi.mocked(putAsPublicWriter).mockResolvedValue({
			status: 201,
			data: { ok: true, rev: '1-a' }
		});
		vi.mocked(putAttachmentAsPublicWriter).mockRejectedValueOnce(new Error('boom'));
		vi.mocked(deleteAsPublicWriter).mockResolvedValue();

		await expect(
			savePublicBookingImage({
				shelterCode: 'SH001',
				full: new Blob(['full'], { type: 'image/webp' }),
				filename: 'face.webp',
				contentType: 'image/webp',
				width: 1,
				height: 1,
				originalSize: 1,
				compressedSize: 1,
				thumbnailSize: 0
			})
		).rejects.toBeInstanceOf(PublicBookingImageWriteError);

		expect(deleteAsPublicWriter).toHaveBeenCalledWith(
			'shelter_sh001',
			expect.stringMatching(/^image:/),
			'1-a'
		);
	});
});
