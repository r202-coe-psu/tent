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

function conflictError(): Error & { status: number } {
	const err = new Error('Conflict') as Error & { status: number };
	err.status = 409;
	return err;
}

describe('registerKioskWalkIn', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stores a new kiosk_registered record with full snapshot and consent time', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never) // acquire lock
			.mockResolvedValueOnce({ docs: [] } as never) // _find
			.mockResolvedValueOnce({ rev: '1-image' } as never) // image put
			.mockResolvedValueOnce({ ok: true } as never) // evacuee put
			.mockResolvedValueOnce({ ok: true } as never); // release lock

		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			photo,
			consentedAt
		);
		const [findPath, findInit] = mockAdminFetch.mock.calls[1]!;
		const findBody = JSON.parse(String(findInit?.body)) as { selector: Record<string, unknown> };
		const [imagePath, imageInit] = mockAdminFetch.mock.calls[2]!;
		const image = JSON.parse(String(imageInit?.body));
		const [putPath, putInit] = mockAdminFetch.mock.calls[3]!;
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
		expect(saved.card_snapshot.scanned_at).not.toBe(consentedAt);
		expect(saved.card_snapshot).not.toHaveProperty('photo_base64');
		expect(saved.photo).toBe(result.photo);
		expect(mockAdminFetch.mock.calls[0]?.[1]?.method).toBe('PUT');
		expect(String(mockAdminFetch.mock.calls[0]?.[0])).toContain('/shelter_sh001/kiosk_reg_lock%3A');
		expect(mockAdminFetch.mock.calls[4]?.[1]?.method).toBe('DELETE');
	});

	it('does not create an image document when the card has no photo', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never) // acquire lock
			.mockResolvedValueOnce({ docs: [] } as never) // _find
			.mockResolvedValueOnce({ ok: true } as never) // evacuee put
			.mockResolvedValueOnce({ ok: true } as never); // release lock
		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			consentedAt
		);
		const saved = JSON.parse(String(mockAdminFetch.mock.calls[2]?.[1]?.body));
		expect(mockAdminFetch).toHaveBeenCalledTimes(4);
		expect(result.photo).toBeNull();
		expect(saved.photo).toBeNull();
		expect(saved.card_snapshot).not.toHaveProperty('photo_base64');
	});

	it('removes the image if creating the evacuee fails', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never) // acquire lock
			.mockResolvedValueOnce({ docs: [] } as never) // _find
			.mockResolvedValueOnce({ rev: '1-image' } as never) // image put
			.mockRejectedValueOnce(new Error('evacuee write failed')) // evacuee put
			.mockResolvedValueOnce({ ok: true } as never) // image delete (cleanup)
			.mockResolvedValueOnce({ ok: true } as never); // release lock
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, consentedAt)
		).rejects.toThrow('evacuee write failed');
		expect(mockAdminFetch.mock.calls[4]?.[0]).toContain('/image%3A');
		expect(mockAdminFetch.mock.calls[4]?.[1]?.method).toBe('DELETE');
		expect(mockAdminFetch.mock.calls[5]?.[1]?.method).toBe('DELETE');
		expect(mockAdminFetch).toHaveBeenCalledTimes(6);
	});

	it('blocks every existing record instead of reactivating it', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never) // acquire lock
			.mockResolvedValueOnce({
				docs: [
					{
						type: 'evacuee',
						shelter_code: 'SH001',
						person_id: { number: citizenId },
						current_stay: { status: 'cancelled' }
					}
				]
			} as never) // _find
			.mockResolvedValueOnce({ ok: true } as never); // release lock

		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, consentedAt)
		).rejects.toBeInstanceOf(KioskRegistrationBlockedError);
		expect(mockAdminFetch).toHaveBeenCalledTimes(3);
	});

	it('fails closed when the record lookup is unavailable', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never) // acquire lock
			.mockRejectedValueOnce(new Error('couch unavailable')) // _find
			.mockResolvedValueOnce({ ok: true } as never); // release lock
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, consentedAt)
		).rejects.toThrow('couch unavailable');
		expect(mockAdminFetch).toHaveBeenCalledTimes(3);
	});

	it('rejects a concurrent registration with a CouchDB 409, not a per-process lock', async () => {
		// Regression test for the cross-worker bug: the old lock was an in-memory
		// `Map`, which only serializes requests inside a single `node:cluster`
		// worker. This simulates two requests racing against a shared CouchDB
		// (via a fake doc store), the same as two different worker processes would.
		const lockDocs = new Map<string, { rev: string; created_at: string }>();
		const evacuees: unknown[] = [];
		mockAdminFetch.mockImplementation(async (url, init) => {
			if (url.endsWith('/_find')) return { docs: [] } as never;
			if (url.includes('/kiosk_reg_lock%3A')) {
				const id = url.split('/').pop()!.split('?')[0]!;
				if (init?.method === 'PUT') {
					if (lockDocs.has(id)) throw conflictError();
					lockDocs.set(id, { rev: '1-lock', created_at: new Date().toISOString() });
					return { rev: '1-lock' } as never;
				}
				if (init?.method === 'DELETE') {
					lockDocs.delete(id);
					return { ok: true } as never;
				}
			}
			if (init?.method === 'PUT') {
				evacuees.push(JSON.parse(String(init.body)));
				return { ok: true } as never;
			}
			return { ok: true } as never;
		});

		const outcomes = await Promise.allSettled([
			registerKioskWalkIn('SH001', 'KIOSK-A', 'โต๊ะ 1', card, null, consentedAt),
			registerKioskWalkIn('SH001', 'KIOSK-B', 'โต๊ะ 2', card, null, consentedAt)
		]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		const rejected = outcomes.find(
			(outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
		);
		expect(rejected?.reason).toBeInstanceOf(KioskRegistrationBlockedError);
		expect(evacuees).toHaveLength(1);
		expect(lockDocs.size).toBe(0);
	});

	it('reclaims a lock abandoned by a crashed request instead of blocking forever', async () => {
		const staleCreatedAt = new Date(Date.now() - 31_000).toISOString();
		let lockPutAttempts = 0;
		mockAdminFetch.mockImplementation(async (url, init) => {
			if (url.endsWith('/_find')) return { docs: [] } as never;
			if (url.includes('/kiosk_reg_lock%3A')) {
				if (init?.method === 'PUT') {
					lockPutAttempts += 1;
					if (lockPutAttempts === 1) throw conflictError();
					return { rev: '2-lock' } as never;
				}
				if (init?.method === 'DELETE') return { ok: true } as never;
				// GET while reclaiming the stale lock doc
				return { _rev: '1-lock', created_at: staleCreatedAt } as never;
			}
			return { ok: true } as never;
		});

		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			consentedAt
		);
		expect(result.current_stay.status).toBe('kiosk_registered');
		expect(lockPutAttempts).toBe(2);
	});

	it('rejects an image whose magic bytes do not match the declared MIME type', () => {
		expect(() => decodeKioskPhoto({ ...photo, content_type: 'image/jpeg' })).toThrow(
			KioskPhotoValidationError
		);
	});
});
