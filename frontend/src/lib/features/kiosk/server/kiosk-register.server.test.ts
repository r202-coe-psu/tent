import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '$lib/server/couch-admin';
import { smartCardDataSchema } from '$lib/features/kiosk-devices/domain/scanner.schema';
import {
	decodeKioskPhoto,
	KioskPhoneDuplicateError,
	KioskPhotoValidationError,
	KioskRegistrationBlockedError,
	kioskCardSnapshotFromThaid,
	registerKioskThaidWalkIn,
	registerKioskWalkIn
} from './kiosk-register.server';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';

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
	beforeEach(() => vi.resetAllMocks());

	it('stores a new kiosk_registered record with full snapshot and consent time', async () => {
		const db = fakeShelterDb();

		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			photo,
			consentedAt
		);
		const findSelectors = mockAdminFetch.mock.calls
			.filter(([path]) => String(path) === '/shelter_sh001/_find')
			.map(([, init]) => JSON.parse(String(init?.body)).selector);
		const [image] = db.ofType<{
			_id: string;
			_attachments: Record<string, unknown>;
			created_by: string;
			caption: string;
		}>('image');
		const [saved] = db.ofType<{
			_id: string;
			photo: unknown;
			card_snapshot: Record<string, unknown>;
		}>('evacuee');

		expect(findSelectors).toContainEqual({
			type: 'evacuee',
			'person_id.number': citizenId,
			shelter_code: 'SH001'
		});
		expect(image?._attachments.full).toEqual({
			content_type: 'image/webp',
			data: photo.full_base64
		});
		expect(image?._attachments.thumb).toEqual({
			content_type: 'image/webp',
			data: photo.thumb_base64
		});
		expect(image?.created_by).toBe('scanner:KIOSK-01');
		expect(image?.caption).toBe('ภาพจากบัตรประชาชน');
		expect(saved?._id).toBe(result._id);
		expect(result.current_stay.status).toBe('kiosk_registered');
		expect(result.schema_v).toBe(11);
		expect(result.registered_via).toBe('kiosk');
		expect(result.household_id).toBe(db.ofType('household')[0]?._id);
		expect(result.phone).toBeNull();
		expect(result.photo).toBe(image?._id);
		expect(saved?.card_snapshot.consented_at).toBe(consentedAt);
		expect(saved?.card_snapshot.scanned_at).not.toBe(consentedAt);
		expect(saved?.card_snapshot).not.toHaveProperty('photo_base64');
		expect(saved?.photo).toBe(result.photo);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
	});

	it('does not create an image document when the card has no photo', async () => {
		const db = fakeShelterDb();
		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			consentedAt
		);
		expect(db.ofType('image')).toHaveLength(0);
		expect(result.photo).toBeNull();
		expect(db.ofType('evacuee')[0]?.photo).toBeNull();
		expect(db.ofType('evacuee')[0]?.card_snapshot).not.toHaveProperty('photo_base64');
	});

	it('leaves no image or household behind if creating the evacuee fails', async () => {
		const db = fakeShelterDb([], { failPutOfType: 'evacuee' });
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, consentedAt)
		).rejects.toThrow('evacuee write failed');
		expect(db.ofType('image')).toHaveLength(0);
		expect(db.ofType('household')).toHaveLength(0);
		expect(db.ofType('evacuee')).toHaveLength(0);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
	});

	it('leaves no image behind and writes no evacuee if creating the household fails', async () => {
		const db = fakeShelterDb([], { failPutOfType: 'household' });
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, consentedAt)
		).rejects.toThrow('household write failed');
		expect(db.ofType('image')).toHaveLength(0);
		expect(db.ofType('evacuee')).toHaveLength(0);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
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
				const doc = JSON.parse(String(init.body));
				if (doc.type === 'evacuee') evacuees.push(doc);
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

describe('kiosk walk-in phone and ThaiD', () => {
	beforeEach(() => vi.resetAllMocks());

	const device = { shelterCode: 'SH001', deviceId: 'KIOSK-01', stationName: 'โต๊ะ 1' };
	const profile: ThaiDAutofillProfile = {
		id: 'thaid-9999999999999',
		roleLabel: 'ผู้ลงทะเบียนผ่าน ThaiD',
		person_id: '9999999999999',
		first_name: 'วิภา',
		last_name: 'ใจดี',
		nickname: '',
		gender: 'female',
		birth_year: 2530,
		age: 39,
		phone: null,
		vulnerable_groups: [],
		special_needs: [],
		medical_conditions: [],
		address: {
			address_no: '99/1',
			village_no: '2',
			subdistrict: 'สุเทพ',
			district: 'เมืองเชียงใหม่',
			province: 'เชียงใหม่',
			postal_code: '50200'
		}
	};

	it('stores the phone given at the kiosk on a card walk-in', async () => {
		fakeShelterDb();
		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			consentedAt,
			'0812345678'
		);
		expect(result.phone).toBe('0812345678');
	});

	it('registers a ThaiD walk-in from the session pid and profile, with no photo', async () => {
		const db = fakeShelterDb();
		const result = await registerKioskThaidWalkIn(
			device,
			{ pid: citizenId, profile },
			consentedAt,
			'0812345678'
		);
		const [saved] = db.ofType('evacuee');

		expect(db.ofType('image')).toHaveLength(0);
		expect(result.person_id?.number).toBe(citizenId);
		expect(result.first_name).toBe('วิภา');
		expect(result.last_name).toBe('ใจดี');
		expect(result.gender).toBe('female');
		expect(result.birth_year).toBe(2530);
		expect(result.phone).toBe('0812345678');
		expect(result.photo).toBeNull();
		expect(result.current_stay.status).toBe('kiosk_registered');
		expect(saved?.card_snapshot).toMatchObject({
			citizen_id: citizenId,
			province: 'เชียงใหม่',
			postal_code: '50200',
			consented_at: consentedAt,
			device_id: 'KIOSK-01',
			station_name: 'โต๊ะ 1'
		});
	});

	it('leaves out an unknown ThaiD birth year and copes with no profile at all', () => {
		const unknownYear = kioskCardSnapshotFromThaid(
			citizenId,
			{ ...profile, birth_year: 0, age: 0 },
			consentedAt,
			device
		);
		expect(unknownYear.birth_year_ce).toBeUndefined();
		expect(unknownYear.age).toBeUndefined();
		expect(unknownYear.first_name_th).toBe('วิภา');

		const bare = kioskCardSnapshotFromThaid(citizenId, undefined, consentedAt, device);
		expect(bare.citizen_id).toBe(citizenId);
		expect(bare.first_name_th).toBeUndefined();
	});

	it('blocks a ThaiD walk-in for a citizen who already has a record', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never)
			.mockResolvedValueOnce({
				docs: [{ type: 'evacuee', shelter_code: 'SH001', person_id: { number: citizenId } }]
			} as never)
			.mockResolvedValueOnce({ ok: true } as never);
		await expect(
			registerKioskThaidWalkIn(device, { pid: citizenId, profile }, consentedAt, null)
		).rejects.toBeInstanceOf(KioskRegistrationBlockedError);
	});
});

/** A shelter DB that answers `_find` from its docs, so tests do not depend on call order. */
function fakeShelterDb(
	seed: Record<string, unknown>[] = [],
	options: { failPutOfType?: string } = {}
) {
	const docs = new Map<string, Record<string, unknown>>();
	seed.forEach((doc, index) => docs.set(String(doc._id ?? `seed:${index}`), doc));
	const fieldValue = (doc: Record<string, unknown>, path: string): unknown =>
		path
			.split('.')
			.reduce<unknown>(
				(value, key) =>
					typeof value === 'object' && value !== null
						? (value as Record<string, unknown>)[key]
						: undefined,
				doc
			);
	mockAdminFetch.mockImplementation(async (url, init) => {
		const [path, query] = String(url).split('?');
		const id = decodeURIComponent(path!.split('/').pop()!);
		if (path!.endsWith('/_find')) {
			const { selector } = JSON.parse(String(init?.body)) as {
				selector: Record<string, unknown>;
			};
			const matches = [...docs.values()].filter((doc) =>
				Object.entries(selector).every(([key, value]) => fieldValue(doc, key) === value)
			);
			return { docs: matches } as never;
		}
		if (init?.method === 'PUT') {
			const doc = JSON.parse(String(init.body)) as { type?: unknown };
			if (doc.type === options.failPutOfType) throw new Error(`${doc.type} write failed`);
			docs.set(id, { ...JSON.parse(String(init.body)), _id: id, _rev: '1-x' });
			return { ok: true, rev: '1-x' } as never;
		}
		if (init?.method === 'DELETE') {
			if (!query?.startsWith('rev=')) throw new Error('DELETE without rev');
			docs.delete(id);
			return { ok: true } as never;
		}
		return docs.get(id) as never;
	});
	return {
		ofType: <T = Record<string, unknown>>(type: string) =>
			[...docs.values()].filter((doc) => doc.type === type) as T[]
	};
}

describe('kiosk walk-in phone already in use', () => {
	beforeEach(() => vi.resetAllMocks());

	const otherEvacuee = (phone: string, status: string) => ({
		_id: 'evacuee:01OTHER',
		type: 'evacuee',
		shelter_code: 'SH001',
		person_id: { cardType: 'national_id', number: '9999999999999' },
		phone,
		current_stay: { status, zone: null, since: consentedAt }
	});

	it('refuses a phone another evacuee in the shelter already has, and writes nothing', async () => {
		const db = fakeShelterDb([otherEvacuee('0812345678', 'active')]);
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, consentedAt, '0812345678')
		).rejects.toBeInstanceOf(KioskPhoneDuplicateError);
		expect(db.ofType('evacuee')).toHaveLength(1);
		expect(db.ofType('image')).toHaveLength(0);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
	});

	it.each(['checked_out', 'cancelled', 'transferred', 'deceased'])(
		'lets the phone of someone %s be used again',
		async (status) => {
			const db = fakeShelterDb([otherEvacuee('0812345678', status)]);
			const result = await registerKioskWalkIn(
				'SH001',
				'KIOSK-01',
				'โต๊ะ 1',
				card,
				null,
				consentedAt,
				'0812345678'
			);
			expect(result.phone).toBe('0812345678');
			expect(db.ofType('evacuee')).toHaveLength(2);
		}
	);

	it('treats a phone stored the legacy +66 way as the same phone', async () => {
		fakeShelterDb([otherEvacuee('+66812345678', 'kiosk_registered')]);
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, consentedAt, '0812345678')
		).rejects.toBeInstanceOf(KioskPhoneDuplicateError);
	});
});

describe('kiosk walk-in household from the address read', () => {
	beforeEach(() => vi.resetAllMocks());

	it('gives a card walk-in their own pre-registered household at the card address', async () => {
		const db = fakeShelterDb();
		const evacuee = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			{ ...card, village_no: '4', lane: 'ซอย 5', road: 'สุขุมวิท' },
			null,
			consentedAt
		);
		const [household] = db.ofType('household');

		expect(db.ofType('household')).toHaveLength(1);
		expect(evacuee.household_id).toBe(household?._id);
		expect(db.ofType('evacuee')[0]?.household_id).toBe(household?._id);
		expect(household).toMatchObject({
			label: 'ครอบครัวสมชาย ใจดี',
			head_evacuee_id: evacuee._id,
			status: 'pre_registered',
			shelter_code: 'SH001',
			created_by: 'scanner:KIOSK-01',
			address_no: '99/1',
			village_no: '4',
			subdistrict: 'บางนา',
			district: 'บางนา',
			province: 'กรุงเทพมหานคร',
			postal_code: '10260',
			housing_type: null,
			pets: [],
			vehicles: []
		});
	});

	it('still gives a ThaiD walk-in with no address a household, with the Residence left empty', async () => {
		const db = fakeShelterDb();
		const evacuee = await registerKioskThaidWalkIn(
			{ shelterCode: 'SH001', deviceId: 'KIOSK-01', stationName: 'โต๊ะ 1' },
			{ pid: citizenId },
			consentedAt,
			null
		);
		const [household] = db.ofType('household');
		expect(evacuee.household_id).toBe(household?._id);
		expect(household).toMatchObject({
			label: 'ครอบครัวไม่ระบุชื่อ',
			head_evacuee_id: evacuee._id,
			status: 'pre_registered',
			address_no: null,
			subdistrict: null,
			district: null,
			province: null,
			postal_code: null
		});
	});
});
