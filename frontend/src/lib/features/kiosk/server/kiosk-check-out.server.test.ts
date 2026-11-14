import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '$lib/server/couch-admin';
import {
	checkOutSelectedMembers,
	KioskCheckOutIdentityMismatchError,
	kioskCheckOutInputSchema
} from './kiosk-check-out.server';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/evacuee-qr-service', () => ({
	issueEvacueeQr: vi.fn(),
	getEvacueeQrPrints: vi.fn()
}));
vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi.test',
	fastapiServiceHeaders: (extra: Record<string, string> = {}) => ({ ...extra })
}));

const mockAdminFetch = vi.mocked(adminFetch);

const shelterCode = 'SH001';
const CITIZEN = '1234567890123';
const DEVICE = 'kiosk-3';
const ULIDS = [
	'01ARZ3NDEKTSV4RRFFQ69G5FAV',
	'01ARZ3NDEKTSV4RRFFQ69G5FAW',
	'01ARZ3NDEKTSV4RRFFQ69G5FAX',
	'01ARZ3NDEKTSV4RRFFQ69G5FAY'
];
const id = (index: number) => `evacuee:${ULIDS[index]}`;
const HOUSEHOLD = 'household:01ARZ3NDEKTSV4RRFFQ69G5HHH';

type Doc = Record<string, unknown> & { _id: string; _rev: string };

function member(index: number, overrides: Record<string, unknown> = {}): Doc {
	return {
		_id: id(index),
		_rev: '1-a',
		type: 'evacuee',
		schema_v: 1,
		shelter_code: shelterCode,
		registered_via: 'web',
		first_name: `สมชาย${index}`,
		last_name: 'ใจดี',
		phone: null,
		person_id: { number: index === 0 ? CITIZEN : `99999999999${index}` },
		household_id: HOUSEHOLD,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'staff',
		current_stay: { status: 'active', zone: 'Z1', since: '2026-10-02T00:00:00.000Z' },
		...overrides
	};
}

const stay = (status: string) => ({ status, zone: 'Z1', since: '2026-10-02T00:00:00.000Z' });

let store: Map<string, Doc>;
let movements: Array<Record<string, unknown>>;
/** Every PUT that reached Couch (evacuee, movement or household), in order. */
let puts: Array<{ id: string; body: Record<string, unknown> }>;
const faults = {
	failMovementPut: false,
	failHouseholdPut: false,
	/** Someone else touches this evacuee just before our first write of it: it 409s once. */
	racedBy: new Map<string, 'checked_out' | 'edited'>()
};

function httpError(status: number): Error {
	return Object.assign(new Error(`couch ${status}`), { status });
}

function nextRev(rev: string): string {
	return `${Number.parseInt(rev, 10) + 1}-x`;
}

function seed(docs: Doc[]): void {
	for (const doc of docs) store.set(doc._id, doc);
}

beforeEach(() => {
	store = new Map();
	movements = [];
	puts = [];
	faults.failMovementPut = false;
	faults.failHouseholdPut = false;
	faults.racedBy = new Map();
	mockAdminFetch.mockReset();
	mockAdminFetch.mockImplementation(async (path, init = {}) => {
		if (path.endsWith('/_find')) {
			const { selector } = JSON.parse(String(init.body ?? '{}')) as {
				selector: { household_id?: string; shelter_code?: string };
			};
			const docs = [...store.values()].filter(
				(doc) =>
					doc.type === 'evacuee' &&
					doc.household_id === selector.household_id &&
					doc.shelter_code === selector.shelter_code
			);
			return { docs } as never;
		}
		const docId = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
		if ((init.method ?? 'GET') === 'GET') {
			const doc = store.get(docId);
			if (!doc) throw httpError(404);
			return structuredClone(doc) as never;
		}
		const body = JSON.parse(String(init.body ?? '{}')) as Doc;
		puts.push({ id: docId, body });
		if (docId.startsWith('movement:')) {
			if (faults.failMovementPut) throw httpError(500);
			movements.push(body);
			return { ok: true, id: docId, rev: '1-m' } as never;
		}
		if (docId.startsWith('household:') && faults.failHouseholdPut) throw httpError(500);
		const stored = store.get(docId);
		if (!stored) throw httpError(404);
		const race = faults.racedBy.get(docId);
		if (race) {
			faults.racedBy.delete(docId);
			store.set(docId, {
				...stored,
				_rev: nextRev(stored._rev),
				...(race === 'checked_out' ? { current_stay: stay('checked_out') } : {})
			});
			throw httpError(409);
		}
		if (body._rev !== stored._rev) throw httpError(409);
		const rev = nextRev(stored._rev);
		store.set(docId, { ...body, _rev: rev });
		return { ok: true, id: docId, rev } as never;
	});
});

function household(overrides: Record<string, unknown> = {}): Doc {
	return {
		_id: HOUSEHOLD,
		_rev: '1-h',
		type: 'household',
		status: 'checked_in',
		checkout_destination: null,
		head_evacuee_id: id(0),
		...overrides
	};
}

function run(
	evacueeIds: string[],
	options: Partial<Parameters<typeof checkOutSelectedMembers>[3]> = {}
) {
	return checkOutSelectedMembers(shelterCode, id(0), evacueeIds, {
		requiredPrimaryCitizenId: CITIZEN,
		deviceId: DEVICE,
		deviceLabel: 'Kiosk Lobby',
		destinationType: 'returned_home',
		...options
	});
}

describe('checkOutSelectedMembers', () => {
	it('checks the card holder out: evacuee becomes checked_out and a check_out movement is written', async () => {
		seed([member(0), household()]);

		const results = await run([id(0)]);

		expect(results).toEqual([
			{ evacuee_id: id(0), status: 'checked_out', stay_status: 'checked_out' }
		]);
		expect(store.get(id(0))?.current_stay).toMatchObject({ status: 'checked_out' });
		expect(movements).toHaveLength(1);
		expect(movements[0]).toMatchObject({
			type: 'movement',
			evacuee_id: id(0),
			action: 'check_out',
			zone: null,
			reason: 'เช็คเอาต์ด้วยตนเองที่ตู้ kiosk (Kiosk Lobby)',
			destination: { kind: 'home' },
			created_by: `scanner:${DEVICE}`,
			shelter_code: shelterCode
		});
	});

	it('refuses everything when the citizen id does not belong to the primary', async () => {
		seed([member(0), household()]);

		await expect(
			run([id(0)], { requiredPrimaryCitizenId: '9999999999999' })
		).rejects.toBeInstanceOf(KioskCheckOutIdentityMismatchError);
		expect(puts).toEqual([]);
	});

	it('answers not_found for everyone when the primary is in another shelter', async () => {
		seed([member(0, { shelter_code: 'SH999' }), household()]);

		const results = await run([id(0)]);

		expect(results).toEqual([{ evacuee_id: id(0), status: 'not_found' }]);
		expect(puts).toEqual([]);
	});

	it('checks out a family member alongside the holder', async () => {
		seed([member(0), member(1), household()]);

		const results = await run([id(0), id(1)]);

		expect(results.map((r) => r.status)).toEqual(['checked_out', 'checked_out']);
		expect(movements.map((m) => m.evacuee_id)).toEqual([id(0), id(1)]);
	});

	it('skips a member of another household or shelter while the rest still check out', async () => {
		seed([
			member(0),
			member(1, { household_id: 'household:01ARZ3NDEKTSV4RRFFQ69G5OTH' }),
			member(2, { shelter_code: 'SH999' }),
			household()
		]);

		const results = await run([id(0), id(1), id(2)]);

		expect(results).toEqual([
			{ evacuee_id: id(0), status: 'checked_out', stay_status: 'checked_out' },
			{ evacuee_id: id(1), status: 'not_eligible' },
			{ evacuee_id: id(2), status: 'not_found' }
		]);
		expect(store.get(id(1))?.current_stay).toMatchObject({ status: 'active' });
	});

	it.each(['arriving', 'temporary_leave'])('does not check out a %s member', async (status) => {
		seed([member(0), member(1, { current_stay: stay(status) }), household()]);

		const results = await run([id(0), id(1)]);

		expect(results[1]).toEqual({ evacuee_id: id(1), status: 'not_eligible', stay_status: status });
		expect(movements.map((m) => m.evacuee_id)).toEqual([id(0)]);
	});

	it('does not check out someone staff already checked out meanwhile (409, re-read)', async () => {
		seed([member(0), household()]);
		faults.racedBy.set(id(0), 'checked_out');

		const results = await run([id(0)]);

		expect(results).toEqual([
			{ evacuee_id: id(0), status: 'not_eligible', stay_status: 'checked_out' }
		]);
		expect(movements).toEqual([]);
	});

	it('retries once when the document changed but the member can still check out', async () => {
		seed([member(0), household()]);
		faults.racedBy.set(id(0), 'edited');

		const results = await run([id(0)]);

		expect(results[0]).toMatchObject({ evacuee_id: id(0), status: 'checked_out' });
		expect(movements).toHaveLength(1);
	});

	it('puts the stay back and reports failed when the movement cannot be written', async () => {
		seed([member(0), household()]);
		faults.failMovementPut = true;

		const results = await run([id(0)]);

		expect(results).toEqual([{ evacuee_id: id(0), status: 'failed' }]);
		expect(store.get(id(0))?.current_stay).toMatchObject({ status: 'active', zone: 'Z1' });
		expect(movements).toEqual([]);
	});

	it('writes a member once when the same id is sent twice (any letter case)', async () => {
		seed([member(0), household()]);

		const results = await run([id(0), id(0).toLowerCase().replace('evacuee:', 'evacuee:')]);

		expect(results).toHaveLength(1);
		expect(movements).toHaveLength(1);
	});

	it('marks the household checked_out with a returned_home destination when everyone leaves', async () => {
		seed([member(0), member(1), household()]);

		await run([id(0), id(1)], { destinationType: 'returned_home' });

		expect(store.get(HOUSEHOLD)).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'returned_home' }
		});
	});

	it('gives an other destination the notes R-29-8 requires', async () => {
		seed([member(0), household()]);

		await run([id(0)], { destinationType: 'other' });

		expect(store.get(HOUSEHOLD)).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'other', notes: 'เช็คเอาต์ที่ตู้ kiosk' }
		});
		expect(movements[0]).toMatchObject({ destination: { kind: 'other' } });
	});

	it('leaves the household open, with no destination, when only some members leave', async () => {
		seed([member(0), member(1), household()]);

		await run([id(0)]);

		const hh = store.get(HOUSEHOLD);
		expect(hh?.status).not.toBe('checked_out');
		expect(hh?.checkout_destination).toBeNull();
	});

	it('keeps an existing household destination', async () => {
		seed([
			member(0),
			household({ checkout_destination: { type: 'transferred_shelter', destination_name: 'SH2' } })
		]);

		await run([id(0)], { destinationType: 'other' });

		expect(store.get(HOUSEHOLD)?.checkout_destination).toEqual({
			type: 'transferred_shelter',
			destination_name: 'SH2'
		});
	});

	it('still reports the member checked_out when the household cannot be updated', async () => {
		seed([member(0), household()]);
		faults.failHouseholdPut = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const results = await run([id(0)]);

		expect(results[0]).toMatchObject({ evacuee_id: id(0), status: 'checked_out' });
		warn.mockRestore();
	});

	it('writes no station_log and no QR', async () => {
		seed([member(0), household()]);

		await run([id(0)]);

		expect(puts.map((p) => p.id.split(':')[0]).sort()).toEqual([
			'evacuee',
			'household',
			'movement'
		]);
	});
});

describe('kioskCheckOutInputSchema', () => {
	const base = {
		primary_evacuee_id: id(0),
		evacuee_ids: [id(0)],
		destination_type: 'returned_home'
	};

	it('accepts a smart-card check-out with the citizen id', () => {
		expect(
			kioskCheckOutInputSchema.safeParse({ ...base, source: 'smart-card', citizen_id: CITIZEN })
				.success
		).toBe(true);
	});

	it('accepts a thaid check-out with its session id', () => {
		expect(
			kioskCheckOutInputSchema.safeParse({
				...base,
				source: 'thaid',
				thaid_session_id: 'a'.repeat(32)
			}).success
		).toBe(true);
	});

	it.each([
		['a smart-card without citizen_id', { source: 'smart-card' }],
		[
			'a smart-card carrying a thaid session',
			{
				source: 'smart-card',
				citizen_id: CITIZEN,
				thaid_session_id: 'a'.repeat(32)
			}
		],
		['a thaid without a session', { source: 'thaid' }],
		[
			'a thaid carrying a citizen id',
			{
				source: 'thaid',
				thaid_session_id: 'a'.repeat(32),
				citizen_id: CITIZEN
			}
		],
		['a QR source', { source: 'qr', citizen_id: CITIZEN }],
		['a phone source', { source: 'phone', citizen_id: CITIZEN }],
		[
			'an unsupported destination',
			{
				source: 'smart-card',
				citizen_id: CITIZEN,
				destination_type: 'transferred_shelter'
			}
		],
		['no members', { source: 'smart-card', citizen_id: CITIZEN, evacuee_ids: [] }]
	])('rejects %s', (_label, extra) => {
		expect(kioskCheckOutInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
	});
});
