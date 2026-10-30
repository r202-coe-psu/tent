import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { savePublicBookingImage } from '$lib/features/public-register/save-public-booking-image.server';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

vi.mock('$lib/features/public-register/save-public-booking-image.server', () => ({
	savePublicBookingImage: vi.fn(),
	PublicBookingImageWriteError: class PublicBookingImageWriteError extends Error {}
}));

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function event(form: FormData): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/donations/photos', {
			method: 'POST',
			body: form
		}),
		getClientAddress: () => '203.0.113.5'
	} as unknown as PostEvent;
}

function photoForm(
	over: { full?: File | null; thumb?: File | null; shelter_code?: string } = {}
): FormData {
	const form = new FormData();
	form.append('shelter_code', over.shelter_code ?? 'SH001');
	const full = over.full === undefined ? new File([WEBP], 'box.webp') : over.full;
	const thumb = over.thumb === undefined ? new File([WEBP], 'thumb.webp') : over.thumb;
	if (full) form.append('full', full);
	if (thumb) form.append('thumb', thumb);
	form.append('width', '1600');
	form.append('height', '1200');
	form.append('original_size', '4000000');
	form.append('compressed_size', '999999999');
	return form;
}

describe('POST /api/public/v1/donations/photos', () => {
	beforeEach(() => {
		vi.mocked(findMasterByCode).mockReset();
		vi.mocked(findMasterByCode).mockResolvedValue({ code: 'SH001', status: 'active' } as never);
		vi.mocked(savePublicBookingImage).mockReset();
		vi.mocked(savePublicBookingImage).mockResolvedValue({
			photo_id: 'image:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			content_type: 'image/webp',
			filename: 'box.webp',
			width: 1600,
			height: 1200,
			original_size: 4000000,
			compressed_size: WEBP.length,
			thumbnail_size: WEBP.length
		});
	});

	it('stores a donation photo and answers photo_id', async () => {
		const res = await POST(event(photoForm()));

		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({
			success: true,
			photo_id: 'image:01ARZ3NDEKTSV4RRFFQ69G5FAV'
		});
		const input = vi.mocked(savePublicBookingImage).mock.calls[0][0];
		expect(input).toMatchObject({
			shelterCode: 'SH001',
			purpose: 'donation',
			contentType: 'image/webp',
			// Measured from the upload, not the form's claim.
			compressedSize: WEBP.length,
			thumbnailSize: WEBP.length
		});
	});

	it('records the type the bytes are, not the one the browser sent', async () => {
		const full = new File([JPEG], 'box.webp', { type: 'image/webp' });
		const res = await POST(event(photoForm({ full })));

		expect(res.status).toBe(201);
		expect(vi.mocked(savePublicBookingImage).mock.calls[0][0].contentType).toBe('image/jpeg');
	});

	it('cuts a long file name to 200 characters', async () => {
		const form = photoForm();
		form.append('filename', `${'ก'.repeat(500)}.webp`);
		const res = await POST(event(form));

		expect(res.status).toBe(201);
		expect(vi.mocked(savePublicBookingImage).mock.calls[0][0].filename).toBe('ก'.repeat(200));
	});

	it('refuses a renamed non-image file without writing anything (AC-5)', async () => {
		const full = new File(['%PDF-1.7 not a photo'], 'box.jpg', { type: 'image/jpeg' });
		const res = await POST(event(photoForm({ full })));

		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ success: false, error: 'PHOTO_NOT_IMAGE' });
		expect(savePublicBookingImage).not.toHaveBeenCalled();
	});

	it('refuses a non-image thumbnail too', async () => {
		const thumb = new File(['GIF89a'], 'thumb.webp', { type: 'image/webp' });
		const res = await POST(event(photoForm({ thumb })));

		expect(res.status).toBe(422);
		expect(savePublicBookingImage).not.toHaveBeenCalled();
	});

	it('refuses a full image over 1.5 MB (FR-6)', async () => {
		const big = new Uint8Array(1.5 * 1024 * 1024 + 1);
		big.set(WEBP);
		const res = await POST(event(photoForm({ full: new File([big], 'big.webp') })));

		expect(res.status).toBe(413);
		expect(await res.json()).toMatchObject({ error: 'PHOTO_TOO_LARGE' });
		expect(savePublicBookingImage).not.toHaveBeenCalled();
	});

	it('takes a full image of exactly 1.5 MB', async () => {
		const edge = new Uint8Array(1.5 * 1024 * 1024);
		edge.set(WEBP);
		const res = await POST(event(photoForm({ full: new File([edge], 'edge.webp') })));

		expect(res.status).toBe(201);
	});

	it('refuses a missing photo', async () => {
		const res = await POST(event(photoForm({ full: null })));
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ error: 'EMPTY_PHOTO' });
	});

	it.each(['closed', 'standby', 'cancelled'])('refuses a %s shelter', async (status) => {
		vi.mocked(findMasterByCode).mockResolvedValue({ code: 'SH001', status } as never);
		const res = await POST(event(photoForm()));

		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ error: 'SHELTER_CLOSED' });
		expect(savePublicBookingImage).not.toHaveBeenCalled();
	});

	it('refuses an unknown shelter', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(null);
		const res = await POST(event(photoForm({ shelter_code: 'NOPE' })));

		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ error: 'SHELTER_CLOSED' });
	});
});
