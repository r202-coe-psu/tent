import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '$lib/server/couch-admin';
import { smartCardDataSchema } from '$lib/features/scanners/domain/scanner.schema';
import {
	decodeKioskPhoto,
	KioskPhotoValidationError,
	KioskRegistrationBlockedError,
	registerKioskWalkIn
} from './kiosk-register.server';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));

const mockAdminFetch = vi.mocked(adminFetch);
const citizenId = '1234567890123';
const consentedAt = new Date().toISOString();
const card = smartCardDataSchema.parse({
	citizen_id: citizenId,
	first_name_th: 'สมชาย',
	last_name_th: 'ใจดี',
	gender: 'male',
	age: 30,
	address_no: '99/1',
	subdistrict: 'บางนา',
	district: 'บางนา',
	province: 'กรุงเทพมหานคร',
	postal_code: '10260'
});
const photo = {
	content_type: 'image/webp' as const,
	full_base64: Buffer.from([
		0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
	]).toString('base64'),
	thumb_base64: Buffer.from([
		0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
	]).toString('base64'),
	width: 1,
	height: 1,
	original_size: 12,
	compressed_size: 12,
	thumbnail_size: 12
};

describe('registerKioskWalkIn', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stores a new kiosk_registered record with full snapshot and consent time', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ docs: [] } as never)
			.mockResolvedValueOnce({ rev: '1-image' } as never)
			.mockResolvedValueOnce({ ok: true } as never);

		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			photo,
			consentedAt
		);
		const [findPath, findInit] = mockAdminFetch.mock.calls[0]!;
		const findBody = JSON.parse(String(findInit?.body)) as { selector: Record<string, unknown> };
		const [imagePath, imageInit] = mockAdminFetch.mock.calls[1]!;
		const image = JSON.parse(String(imageInit?.body));
		const [putPath, putInit] = mockAdminFetch.mock.calls[2]!;
		const saved = JSON.parse(String(putInit?.body));

		expect(findPath).toBe('/shelter_sh001/_find');
		expect(findBody.selector).toEqual({
			type: 'evacuee',
			'person_id.number': citizenId,
			shelter_code: 'SH001'
		});
		expect(imagePath).toContain('/shelter_sh001/image%3A');
		expect(image._attachments.full).toEqual({
			content_type: 'image/webp',
			data: photo.full_base64
		});
		expect(image._attachments.thumb).toEqual({
			content_type: 'image/webp',
			data: photo.thumb_base64
		});
		expect(image.created_by).toBe('scanner:KIOSK-01');
		expect(image.caption).toBe('ภาพจากบัตรประชาชน');
		expect(putPath).toContain('/shelter_sh001/evacuee%3A');
		expect(result.current_stay.status).toBe('kiosk_registered');
		expect(result.schema_v).toBe(11);
		expect(result.registered_via).toBe('kiosk');
		expect(result.household_id).toBeNull();
		expect(result.phone).toBeNull();
		expect(result.photo).toMatch(/^image:/);
		expect(saved.card_snapshot.consented_at).toBe(consentedAt);
		expect(saved.card_snapshot).not.toHaveProperty('photo_base64');
		expect(saved.photo).toBe(result.photo);
	});

	it('does not create an image document when the card has no photo', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ docs: [] } as never)
			.mockResolvedValueOnce({ ok: true } as never);
		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			consentedAt
		);
		const saved = JSON.parse(String(mockAdminFetch.mock.calls[1]?.[1]?.body));
		expect(mockAdminFetch).toHaveBeenCalledTimes(2);
		expect(result.photo).toBeNull();
		expect(saved.photo).toBeNull();
		expect(saved.card_snapshot).not.toHaveProperty('photo_base64');
	});

	it('removes the image if creating the evacuee fails', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ docs: [] } as never)
			.mockResolvedValueOnce({ rev: '1-image' } as never)
			.mockRejectedValueOnce(new Error('evacuee write failed'))
			.mockResolvedValueOnce({ ok: true } as never);
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, consentedAt)
		).rejects.toThrow('evacuee write failed');
		expect(mockAdminFetch.mock.calls[3]?.[0]).toContain('/image%3A');
		expect(mockAdminFetch.mock.calls[3]?.[1]?.method).toBe('DELETE');
	});

	it('blocks every existing record instead of reactivating it', async () => {
		mockAdminFetch.mockResolvedValueOnce({
			docs: [
				{
					type: 'evacuee',
					shelter_code: 'SH001',
					person_id: { number: citizenId },
					current_stay: { status: 'cancelled' }
				}
			]
		} as never);

		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, consentedAt)
		).rejects.toBeInstanceOf(KioskRegistrationBlockedError);
		expect(mockAdminFetch).toHaveBeenCalledTimes(1);
	});

	it('fails closed when the record lookup is unavailable', async () => {
		mockAdminFetch.mockRejectedValueOnce(new Error('couch unavailable'));
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, consentedAt)
		).rejects.toThrow('couch unavailable');
		expect(mockAdminFetch).toHaveBeenCalledTimes(1);
	});

	it('serializes concurrent requests for the same citizen and creates only one document', async () => {
		const docs: unknown[] = [];
		mockAdminFetch.mockImplementation(async (url, init) => {
			if (url.endsWith('/_find')) return { docs: [...docs] } as never;
			if (init?.method === 'PUT') {
				docs.push(JSON.parse(String(init.body)));
				return { ok: true } as never;
			}
			return { ok: true } as never;
		});

		const outcomes = await Promise.allSettled([
			registerKioskWalkIn('SH001', 'KIOSK-A', 'โต๊ะ 1', card, null, consentedAt),
			registerKioskWalkIn('SH001', 'KIOSK-B', 'โต๊ะ 2', card, null, consentedAt)
		]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
		expect(docs).toHaveLength(1);
		expect(mockAdminFetch).toHaveBeenCalledTimes(3);
	});

	it('rejects an image whose magic bytes do not match the declared MIME type', () => {
		expect(() => decodeKioskPhoto({ ...photo, content_type: 'image/jpeg' })).toThrow(
			KioskPhotoValidationError
		);
	});
});
