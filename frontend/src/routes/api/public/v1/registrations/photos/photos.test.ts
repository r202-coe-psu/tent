import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { registerIpLimiter } from '$lib/server/security/rate-limiter';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { savePublicBookingImage } from '$lib/features/public-register/save-public-booking-image.server';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/security/rate-limiter', () => ({
	registerIpLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn()
}));

vi.mock('$lib/features/shelters/server', () => ({
	isShelterBookable: vi.fn((doc: unknown) => Boolean(doc))
}));

vi.mock('$lib/features/public-register/save-public-booking-image.server', () => ({
	savePublicBookingImage: vi.fn(),
	PublicBookingImageWriteError: class PublicBookingImageWriteError extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'PublicBookingImageWriteError';
		}
	}
}));

function event(form: FormData, ip = '203.0.113.5'): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/registrations/photos', {
			method: 'POST',
			body: form
		}),
		getClientAddress: () => ip
	} as unknown as PostEvent;
}

function photoForm(over: Record<string, string> = {}): FormData {
	const form = new FormData();
	form.append('shelter_code', over.shelter_code ?? 'SH001');
	form.append('full', new File([new Uint8Array([1, 2, 3])], 'face.webp', { type: 'image/webp' }));
	form.append('thumb', new File([new Uint8Array([4])], 'thumb.webp', { type: 'image/webp' }));
	form.append('filename', 'face.webp');
	form.append('content_type', 'image/webp');
	form.append('width', '800');
	form.append('height', '600');
	form.append('original_size', '12000');
	form.append('compressed_size', '4000');
	form.append('thumbnail_size', '800');
	for (const [k, v] of Object.entries(over)) {
		form.set(k, v);
	}
	return form;
}

describe('POST /api/public/v1/registrations/photos', () => {
	beforeEach(() => {
		vi.mocked(registerIpLimiter.check).mockReset();
		vi.mocked(registerIpLimiter.check).mockReturnValue(true);
		vi.mocked(findMasterByCode).mockReset();
		vi.mocked(findMasterByCode).mockResolvedValue({ code: 'SH001', status: 'open' } as never);
		vi.mocked(savePublicBookingImage).mockReset();
		vi.mocked(savePublicBookingImage).mockResolvedValue({
			photo_id: 'image:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			content_type: 'image/webp',
			filename: 'face.webp',
			width: 800,
			height: 600,
			original_size: 12000,
			compressed_size: 4000,
			thumbnail_size: 800
		});
	});

	it('returns 201 with Couch image:{ulid} photo_id', async () => {
		const res = await POST(event(photoForm()));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.photo_id).toBe('image:01ARZ3NDEKTSV4RRFFQ69G5FAV');
		expect(savePublicBookingImage).toHaveBeenCalledWith(
			expect.objectContaining({
				shelterCode: 'SH001',
				filename: 'face.webp',
				contentType: 'image/webp',
				width: 800,
				height: 600
			})
		);
	});

	it('422 when shelter_code is missing', async () => {
		const form = photoForm();
		form.delete('shelter_code');
		const res = await POST(event(form));
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ error: 'SHELTER_REQUIRED' });
		expect(savePublicBookingImage).not.toHaveBeenCalled();
	});

	it('422 when shelter is not bookable', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(null);
		const res = await POST(event(photoForm()));
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ error: 'SHELTER_CLOSED' });
	});

	it('429 when rate limited', async () => {
		vi.mocked(registerIpLimiter.check).mockReturnValue(false);
		const res = await POST(event(photoForm()));
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ error: 'RATE_LIMITED' });
	});
});
