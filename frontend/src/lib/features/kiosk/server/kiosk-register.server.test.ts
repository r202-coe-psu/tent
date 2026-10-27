import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
	evacueeConsentSchema,
	EVACUEE_SCHEMA_V,
	mintConsentStamp,
	type ConsentDecision
} from '$lib/features/consent/server';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));

const mockAdminFetch = vi.mocked(adminFetch);
const citizenId = '1234567890123';
const decision: ConsentDecision = {
	mode: 'full',
	health: false,
	search_visible: true,
	guardian_for: [],
	verbal: false,
	...mintConsentStamp()
};
const consentedAt = decision.given_at;
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

	it('stores a new arriving record with full snapshot and consent time', async () => {
		const db = fakeShelterDb();

		const result = await registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, decision);
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
		expect(result.current_stay.status).toBe('arriving');
		expect(result.schema_v).toBe(EVACUEE_SCHEMA_V);
		expect(result.consent.ref).toBe(decision.ref);
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

	it('records the decision as a valid kiosk consent on the saved evacuee', async () => {
		const db = fakeShelterDb();
		await registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision);
		const [saved] = db.ofType<{
			schema_v: number;
			consent: unknown;
			privacy: { search_excluded: boolean };
		}>('evacuee');

		expect(saved.schema_v).toBe(15);
		expect(evacueeConsentSchema.parse(saved.consent)).toMatchObject({
			ref: decision.ref,
			given_at: decision.given_at,
			notice_version: decision.notice_version,
			mode: 'full',
			health: false,
			given_by: 'self',
			giver_evacuee_id: null,
			recorded_verbally_by: null,
			channel: 'kiosk'
		});
		expect(saved.privacy.search_excluded).toBe(false);
	});

	it('excludes the evacuee from search when search visibility is declined', async () => {
		const db = fakeShelterDb();
		const hidden: ConsentDecision = { ...decision, search_visible: false };
		await registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, hidden);
		const [saved] = db.ofType<{
			consent: { mode: string; health: boolean };
			privacy: { search_excluded: boolean };
		}>('evacuee');

		expect(saved.consent).toMatchObject({ mode: 'full', health: false });
		expect(saved.privacy.search_excluded).toBe(true);
	});

	it('does not create an image document when the card has no photo', async () => {
		const db = fakeShelterDb();
		const result = await registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision);
		expect(db.ofType('image')).toHaveLength(0);
		expect(result.photo).toBeNull();
		expect(db.ofType('evacuee')[0]?.photo).toBeNull();
		expect(db.ofType('evacuee')[0]?.card_snapshot).not.toHaveProperty('photo_base64');
	});

	it('leaves no image or household behind if creating the evacuee fails', async () => {
		const db = fakeShelterDb([], { failPutOfType: 'evacuee' });
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, decision)
		).rejects.toThrow('evacuee write failed');
		expect(db.ofType('image')).toHaveLength(0);
		expect(db.ofType('household')).toHaveLength(0);
		expect(db.ofType('evacuee')).toHaveLength(0);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
	});

	it('leaves no image behind and writes no evacuee if creating the household fails', async () => {
		const db = fakeShelterDb([], { failPutOfType: 'household' });
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, decision)
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
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision)
		).rejects.toBeInstanceOf(KioskRegistrationBlockedError);
		expect(mockAdminFetch).toHaveBeenCalledTimes(3);
	});

	it('fails closed when the record lookup is unavailable', async () => {
		mockAdminFetch
			.mockResolvedValueOnce({ rev: '1-lock' } as never) // acquire lock
			.mockRejectedValueOnce(new Error('couch unavailable')) // _find
			.mockResolvedValueOnce({ ok: true } as never); // release lock
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision)
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
			if (url.includes('/kiosk_addr_lock%3A')) return { rev: '1-addr', ok: true } as never;
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
			registerKioskWalkIn('SH001', 'KIOSK-A', 'โต๊ะ 1', card, null, decision),
			registerKioskWalkIn('SH001', 'KIOSK-B', 'โต๊ะ 2', card, null, decision)
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
			if (url.includes('/kiosk_addr_lock%3A')) return { rev: '1-addr', ok: true } as never;
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

		const result = await registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision);
		expect(result.current_stay.status).toBe('arriving');
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
			decision,
			'0812345678'
		);
		expect(result.phone).toBe('0812345678');
	});

	it('registers a ThaiD walk-in from the session pid and profile, with no photo', async () => {
		const db = fakeShelterDb();
		const result = await registerKioskThaidWalkIn(
			device,
			{ pid: citizenId, profile },
			decision,
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
		expect(result.current_stay.status).toBe('arriving');
		expect(saved?.card_snapshot).toMatchObject({
			citizen_id: citizenId,
			province: 'เชียงใหม่',
			postal_code: '50200',
			consented_at: consentedAt,
			device_id: 'KIOSK-01',
			station_name: 'โต๊ะ 1'
		});
	});

	it('keeps a ThaiD walk-in out of search when the person unticks C3', async () => {
		const db = fakeShelterDb();
		const hidden: ConsentDecision = {
			...decision,
			health: true,
			search_visible: false,
			...mintConsentStamp()
		};
		await registerKioskThaidWalkIn(device, { pid: citizenId, profile }, hidden, null);
		const [saved] = db.ofType<{
			consent: { mode: string; health: boolean };
			privacy: { search_excluded: boolean };
		}>('evacuee');

		expect(saved.consent).toMatchObject({ mode: 'full', health: true, channel: 'kiosk' });
		expect(saved.privacy.search_excluded).toBe(true);
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
			registerKioskThaidWalkIn(device, { pid: citizenId, profile }, decision, null)
		).rejects.toBeInstanceOf(KioskRegistrationBlockedError);
	});
});

/** A shelter DB that answers `_find` from its docs, so tests do not depend on call order. */
function fakeShelterDb(
	seed: Record<string, unknown>[] = [],
	options: { failPutOfType?: string; failBulkDocs?: boolean } = {}
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
		if (path!.endsWith('/_bulk_docs')) {
			if (options.failBulkDocs) throw new Error('bulk write failed');
			const { docs: written } = JSON.parse(String(init?.body)) as {
				docs: { _id: string }[];
			};
			for (const doc of written) docs.set(doc._id, { ...doc, _rev: '1-x' });
			return written.map((doc) => ({ ok: true, id: doc._id, rev: '1-x' })) as never;
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

describe('kiosk walk-in station_log (CR-192)', () => {
	beforeEach(() => vi.resetAllMocks());

	type Log = {
		_id: string;
		evacuee_id: string;
		station: number;
		action: string;
		channel: string;
		device_id: string;
		created_by: string;
		occurred_at: string;
	};

	it('writes one kiosk start + complete for the created member, start = card-read time', async () => {
		const db = fakeShelterDb();
		const startedAt = new Date(Date.now() - 2 * 60_000).toISOString();

		const result = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			decision,
			null,
			startedAt
		);

		const logs = db.ofType<Log>('station_log');
		expect(logs).toHaveLength(2);
		const start = logs.find((l) => l.action === 'start');
		const complete = logs.find((l) => l.action === 'complete');
		for (const log of logs) {
			expect(log).toMatchObject({
				evacuee_id: result._id,
				station: 1,
				channel: 'kiosk',
				device_id: 'KIOSK-01',
				created_by: 'kiosk:KIOSK-01'
			});
		}
		expect(start?.occurred_at).toBe(startedAt);
		expect(Date.parse(complete!.occurred_at)).toBeGreaterThanOrEqual(Date.parse(startedAt));
	});

	it('writes the ThaiD walk-in pair under the same kiosk identity', async () => {
		const db = fakeShelterDb();
		const result = await registerKioskThaidWalkIn(
			{ shelterCode: 'SH001', deviceId: 'KIOSK-02', stationName: 'โต๊ะ 2' },
			{ pid: citizenId },
			decision,
			null
		);
		const logs = db.ofType<Log>('station_log');
		expect(logs.map((l) => l.action).sort()).toEqual(['complete', 'start']);
		expect(logs.every((l) => l.evacuee_id === result._id && l.device_id === 'KIOSK-02')).toBe(true);
	});

	it('falls back to server time for a card-read time older than 2 hours', async () => {
		const db = fakeShelterDb();
		const before = Date.now();
		await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			card,
			null,
			decision,
			null,
			new Date(Date.now() - 3 * 3_600_000).toISOString()
		);
		const start = db.ofType<Log>('station_log').find((l) => l.action === 'start');
		expect(Date.parse(start!.occurred_at)).toBeGreaterThanOrEqual(before);
	});

	it('still returns the registered record when the log write fails', async () => {
		const db = fakeShelterDb([], { failBulkDocs: true });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision);

		expect(result.current_stay.status).toBe('arriving');
		expect(db.ofType('evacuee')).toHaveLength(1);
		expect(db.ofType('station_log')).toHaveLength(0);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('writes no log when the registration itself fails', async () => {
		const db = fakeShelterDb([], { failPutOfType: 'evacuee' });
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision)
		).rejects.toThrow();
		expect(db.ofType('station_log')).toHaveLength(0);
	});
});

describe('kiosk walk-in phone already in use', () => {
	beforeEach(() => vi.resetAllMocks());

	const otherEvacuee = (phone: string, status: string) => ({
		_id: 'evacuee:01OTHER',
		type: 'evacuee',
		shelter_code: 'SH001',
		person_id: { cardType: 'national_id', number: '9999999999999' },
		phone,
		current_stay: { status, zone: null, since: decision }
	});

	it('refuses a phone another evacuee in the shelter already has, and writes nothing', async () => {
		const db = fakeShelterDb([otherEvacuee('0812345678', 'active')]);
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, photo, decision, '0812345678')
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
				decision,
				'0812345678'
			);
			expect(result.phone).toBe('0812345678');
			expect(db.ofType('evacuee')).toHaveLength(2);
		}
	);

	it('treats a phone stored the legacy +66 way as the same phone', async () => {
		fakeShelterDb([otherEvacuee('+66812345678', 'kiosk_registered')]);
		await expect(
			registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card, null, decision, '0812345678')
		).rejects.toBeInstanceOf(KioskPhoneDuplicateError);
	});
});

describe('kiosk walk-in household from the address read', () => {
	beforeEach(() => vi.resetAllMocks());

	it('gives a card walk-in their own arriving household at the card address', async () => {
		const db = fakeShelterDb();
		const evacuee = await registerKioskWalkIn(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			{ ...card, village_no: '4', lane: 'ซอย 5', road: 'สุขุมวิท' },
			null,
			decision
		);
		const [household] = db.ofType('household');

		expect(db.ofType('household')).toHaveLength(1);
		expect(evacuee.household_id).toBe(household?._id);
		expect(db.ofType('evacuee')[0]?.household_id).toBe(household?._id);
		expect(household).toMatchObject({
			label: 'ครอบครัวสมชาย ใจดี',
			head_evacuee_id: evacuee._id,
			status: 'arriving',
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
			decision,
			null
		);
		const [household] = db.ofType('household');
		expect(evacuee.household_id).toBe(household?._id);
		expect(household).toMatchObject({
			label: 'ครอบครัวไม่ระบุชื่อ',
			head_evacuee_id: evacuee._id,
			status: 'arriving',
			address_no: null,
			subdistrict: null,
			district: null,
			province: null,
			postal_code: null
		});
	});
});

describe('kiosk walk-in joining the household at the same card address', () => {
	beforeEach(() => vi.resetAllMocks());

	const address = { village_no: '4', lane: 'ซอย 5', road: 'สุขุมวิท' };
	const second = { ...card, citizen_id: '2234567890123', first_name_th: 'สมหญิง' };
	const register = (card_: typeof card, photo_: typeof photo | null = null) =>
		registerKioskWalkIn('SH001', 'KIOSK-01', 'โต๊ะ 1', card_, photo_, decision);

	it('puts a second walk-in at the same address (spaced differently) in the first one household', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address });
		const joined = await register({
			...second,
			...address,
			lane: ' ซอย  5',
			road: 'สุขุมวิท '
		});

		const [household] = db.ofType<{ _id: string; head_evacuee_id: string; status: string }>(
			'household'
		);
		expect(db.ofType('household')).toHaveLength(1);
		expect(joined.household_id).toBe(first.household_id);
		expect(joined._id).not.toBe(first._id);
		expect(household).toMatchObject({
			_id: first.household_id,
			head_evacuee_id: first._id,
			status: 'arriving'
		});
		expect(db.ofType('evacuee')).toHaveLength(2);
	});

	it('keeps the third and fourth walk-in at the address in the first household', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address });
		await register({ ...second, ...address });
		const third = await register({
			...card,
			...address,
			citizen_id: '3234567890123',
			first_name_th: 'สมศรี'
		});
		const fourth = await register({
			...card,
			...address,
			citizen_id: '4234567890123',
			first_name_th: 'สมปอง'
		});

		expect(db.ofType('household')).toHaveLength(1);
		expect(third.household_id).toBe(first.household_id);
		expect(fourth.household_id).toBe(first.household_id);
		expect(db.ofType('evacuee')).toHaveLength(4);
	});

	it('gives a different road (both from the card) its own household', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address });
		const other = await register({ ...second, ...address, road: 'เพชรเกษม' });
		expect(db.ofType('household')).toHaveLength(2);
		expect(other.household_id).not.toBe(first.household_id);
	});

	it('joins when the road is the same, even written with the ถนน prefix', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address });
		const joined = await register({ ...second, ...address, road: 'ถนนสุขุมวิท' });
		expect(db.ofType('household')).toHaveLength(1);
		expect(joined.household_id).toBe(first.household_id);
	});

	it('joins a head without a road (ThaiD-style) when the newcomer has one', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address, road: null });
		const joined = await register({ ...second, ...address });
		expect(db.ofType('household')).toHaveLength(1);
		expect(joined.household_id).toBe(first.household_id);
	});

	it('joins a head with a road when the newcomer has none (ThaiD-style)', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address });
		const joined = await register({ ...second, ...address, road: null });
		expect(db.ofType('household')).toHaveLength(1);
		expect(joined.household_id).toBe(first.household_id);
	});

	it('never compares the lane when grouping', async () => {
		const db = fakeShelterDb();
		const first = await register({ ...card, ...address });
		const joined = await register({ ...second, ...address, lane: 'ซอย 9' });
		expect(db.ofType('household')).toHaveLength(1);
		expect(joined.household_id).toBe(first.household_id);
	});

	it('does not group walk-ins whose card has no house number', async () => {
		const db = fakeShelterDb();
		const noHouse = { ...card, address_no: null };
		const first = await register(noHouse);
		const other = await register({ ...second, address_no: null });
		expect(db.ofType('household')).toHaveLength(2);
		expect(other.household_id).not.toBe(first.household_id);
	});

	const seededHousehold = (overrides: Record<string, unknown> = {}) => [
		{
			_id: 'household:01EARLIER',
			type: 'household',
			shelter_code: 'SH001',
			head_evacuee_id: 'evacuee:01EARLIER',
			status: 'arriving',
			created_by: 'scanner:KIOSK-02',
			created_at: '2026-10-01T00:00:00.000Z',
			...overrides
		},
		{
			_id: 'evacuee:01EARLIER',
			type: 'evacuee',
			shelter_code: 'SH001',
			registered_via: 'kiosk',
			household_id: 'household:01EARLIER',
			card_snapshot: { ...card, ...address, citizen_id: '3234567890123' }
		}
	];

	it('joins an earlier household made by another kiosk, keeping its head', async () => {
		const db = fakeShelterDb(seededHousehold());
		const joined = await register({ ...card, ...address });
		expect(joined.household_id).toBe('household:01EARLIER');
		expect(db.ofType('household')).toHaveLength(1);
		expect(db.ofType('household')[0]).toMatchObject({ head_evacuee_id: 'evacuee:01EARLIER' });
	});

	it('joins a kiosk-made household whose head is registered through another channel', async () => {
		const [household, head] = seededHousehold();
		fakeShelterDb([household, { ...head, registered_via: 'station_1' }]);
		const joined = await register({ ...card, ...address });
		expect(joined.household_id).toBe('household:01EARLIER');
	});

	it.each([
		['cancelled', { status: 'cancelled' }],
		['checked out', { status: 'checked_out' }],
		['merged', { status: 'merged' }],
		['made by staff', { created_by: 'user:somchai' }],
		['headed by someone else', { head_evacuee_id: 'evacuee:01OTHER' }],
		['in another shelter', { shelter_code: 'SH002' }]
	])('does not join a household that is %s', async (_name, overrides) => {
		const db = fakeShelterDb(seededHousehold(overrides));
		const evacuee = await register({ ...card, ...address });
		expect(evacuee.household_id).not.toBe('household:01EARLIER');
		expect(db.ofType('household')).toHaveLength(2);
	});

	it('joins the oldest of several open households at the address', async () => {
		const older = seededHousehold({ created_at: '2026-09-01T00:00:00.000Z' }).map((doc) => ({
			...doc,
			_id: String(doc._id).replace('01EARLIER', '00OLDEST'),
			...(doc.type === 'household' ? { head_evacuee_id: 'evacuee:00OLDEST' } : {}),
			...(doc.type === 'evacuee' ? { household_id: 'household:00OLDEST' } : {})
		}));
		fakeShelterDb([...seededHousehold(), ...older]);
		const evacuee = await register({ ...card, ...address });
		expect(evacuee.household_id).toBe('household:00OLDEST');
	});

	it('leaves the existing household untouched and no image behind when the join write fails', async () => {
		const seed = seededHousehold();
		const db = fakeShelterDb(seed, { failPutOfType: 'evacuee' });
		await expect(register({ ...card, ...address }, photo)).rejects.toThrow('evacuee write failed');
		expect(db.ofType('household')).toEqual(seed.filter((doc) => doc.type === 'household'));
		expect(db.ofType('image')).toHaveLength(0);
		expect(db.ofType('kiosk_addr_lock')).toHaveLength(0);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
	});

	describe('while another walk-in holds the address lock', () => {
		afterEach(() => vi.useRealTimers());

		/** The fake DB, with the address lock PUT answering 409 for the first `heldFor` tries. */
		function dbWithAddressLockHeld(heldFor: number) {
			const db = fakeShelterDb();
			const delegate = mockAdminFetch.getMockImplementation()!;
			let tries = 0;
			mockAdminFetch.mockImplementation(async (url, init) => {
				if (String(url).includes('/kiosk_addr_lock%3A') && init?.method === 'PUT') {
					tries += 1;
					if (tries <= heldFor) throw conflictError();
				}
				return delegate(url, init);
			});
			return { db, tries: () => tries };
		}

		it('waits for it and then registers', async () => {
			vi.useFakeTimers();
			const { db, tries } = dbWithAddressLockHeld(2);
			const registering = register({ ...card, ...address });
			await vi.advanceTimersByTimeAsync(1000);
			const evacuee = await registering;
			expect(tries()).toBe(3);
			expect(evacuee.household_id).toBe(db.ofType<{ _id: string }>('household')[0]?._id);
			expect(db.ofType('kiosk_addr_lock')).toHaveLength(0);
			expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
		});

		it('fails with a retryable error, not "already registered", if it never frees up', async () => {
			vi.useFakeTimers();
			const { db } = dbWithAddressLockHeld(Infinity);
			const registering = register({ ...card, ...address });
			const outcome = registering.then(
				() => null,
				(error: unknown) => error
			);
			await vi.advanceTimersByTimeAsync(5000);
			const error = await outcome;
			expect(error).toBeInstanceOf(Error);
			expect(error).not.toBeInstanceOf(KioskRegistrationBlockedError);
			expect(db.ofType('evacuee')).toHaveLength(0);
			expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
		});
	});

	it('releases the address lock after a successful registration', async () => {
		const db = fakeShelterDb();
		await register({ ...card, ...address });
		expect(db.ofType('kiosk_addr_lock')).toHaveLength(0);
		expect(db.ofType('kiosk_reg_lock')).toHaveLength(0);
	});

	it('releases the address lock when the registration fails', async () => {
		const db = fakeShelterDb([], { failPutOfType: 'household' });
		await expect(register({ ...card, ...address })).rejects.toThrow('household write failed');
		expect(db.ofType('kiosk_addr_lock')).toHaveLength(0);
	});
});
