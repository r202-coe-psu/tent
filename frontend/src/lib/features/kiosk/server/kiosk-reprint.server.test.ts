import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '$lib/server/couch-admin';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { KioskInputError, KioskLookupUnavailableError } from './kiosk-check-in.server';
import {
	KioskReprintNotFoundError,
	KioskReprintStaffPinBusyError,
	KioskReprintStaffPinInvalidError,
	KioskReprintStaffPinNotSetError,
	KioskReprintUnverifiableError,
	KioskReprintVerifyFailedError,
	kioskReprintInputSchema,
	reprintKioskLabels
} from './kiosk-reprint.server';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

const mockAdminFetch = vi.mocked(adminFetch);
const mockFindMasterByCode = vi.mocked(findMasterByCode);
const shelterCode = 'SH001';
const phone = '0812345678';
const ids = [
	'01ARZ3NDEKTSV4RRFFQ69G5FAV',
	'01ARZ3NDEKTSV4RRFFQ69G5FAW',
	'01ARZ3NDEKTSV4RRFFQ69G5FAX',
	'01ARZ3NDEKTSV4RRFFQ69G5FAY',
	'01ARZ3NDEKTSV4RRFFQ69G5FAZ',
	'01ARZ3NDEKTSV4RRFFQ69G5FB0',
	'01ARZ3NDEKTSV4RRFFQ69G5FB1'
].map((ulid) => `evacuee:${ulid}`);

interface Fixture {
	_id: string;
	type: 'evacuee';
	shelter_code: string;
	registered_via: string;
	first_name: string;
	last_name: string;
	phone: string | null;
	person_id?: { number?: string };
	household_id: string | null;
	current_stay: { status: string; zone?: string | null };
	privacy?: { search_excluded?: boolean };
}

let docs: Fixture[] = [];
let screenings: { evacuee_id: string }[] = [];

function evacuee(index: number, overrides: Partial<Fixture> = {}): Fixture {
	return {
		_id: ids[index],
		type: 'evacuee',
		shelter_code: shelterCode,
		registered_via: 'kiosk',
		first_name: `สมชาย${index}`,
		last_name: 'ใจดี',
		phone: index === 0 ? phone : null,
		person_id: { number: '1234567890123' },
		household_id: 'household:A',
		current_stay: { status: 'arriving' },
		...overrides
	};
}

function input(overrides: Partial<Parameters<typeof reprintKioskLabels>[1]> = {}) {
	return {
		phone,
		primary_evacuee_id: ids[0],
		id_last4: '0123',
		evacuee_ids: [ids[0]],
		...overrides
	};
}

function pinInput(overrides: Partial<Parameters<typeof reprintKioskLabels>[1]> = {}) {
	return {
		phone,
		primary_evacuee_id: ids[0],
		staff_pin: '123456',
		evacuee_ids: [ids[0]],
		...overrides
	};
}

function writes(): unknown[] {
	return mockAdminFetch.mock.calls.filter(
		([path, init]) => init?.method && init.method !== 'GET' && !path.endsWith('/_find')
	);
}

function screeningLookups(): unknown[] {
	return mockAdminFetch.mock.calls.filter(([path]) => path.endsWith('/_find'));
}

describe('reprintKioskLabels', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		docs = [];
		screenings = [];
		mockAdminFetch.mockImplementation(async (path, init) => {
			if (path.endsWith('/_find')) {
				const { selector } = JSON.parse(String(init?.body)) as {
					selector: { evacuee_id: { $in: string[] } };
				};
				return {
					docs: screenings.filter((doc) => selector.evacuee_id.$in.includes(doc.evacuee_id))
				} as never;
			}
			const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
			const doc = docs.find((candidate) => candidate._id === id);
			if (!doc) throw Object.assign(new Error('not found'), { status: 404 });
			return doc as never;
		});
	});

	it('returns the labels after the last four digits of the phone owner id match', async () => {
		docs = [evacuee(0), evacuee(1, { current_stay: { status: 'active' } })];

		const members = await reprintKioskLabels(shelterCode, input({ evacuee_ids: [ids[0], ids[1]] }));

		expect(members).toEqual([
			{
				evacuee_id: ids[0],
				qr_payload: ids[0],
				label: { name: 'สมชาย0 ใจดี', phone, zone: null, stations_passed: 1 }
			},
			{
				evacuee_id: ids[1],
				qr_payload: ids[1],
				label: { name: 'สมชาย1 ใจดี', phone: null, zone: null, stations_passed: 1 }
			}
		]);
		expect(writes()).toEqual([]);
		// Nobody has a zone yet: the shelter's zone names are not needed.
		expect(mockFindMasterByCode).not.toHaveBeenCalled();
	});

	it('returns the labels when a staff PIN is accepted, even if the primary has no citizen id', async () => {
		docs = [evacuee(0, { person_id: {} }), evacuee(1, { current_stay: { status: 'active' } })];
		const verifyStaffPin = vi.fn().mockResolvedValue({ kind: 'ok' });

		const members = await reprintKioskLabels(
			shelterCode,
			{
				phone,
				primary_evacuee_id: ids[0],
				staff_pin: '123456',
				evacuee_ids: [ids[0], ids[1]]
			},
			{ verifyStaffPin }
		);

		expect(verifyStaffPin).toHaveBeenCalledWith('123456');
		expect(members.map((member) => member.evacuee_id)).toEqual([ids[0], ids[1]]);
	});

	it('refuses the reprint with a wrong staff PIN, without labels or a screening lookup', async () => {
		docs = [evacuee(0)];
		const verifyStaffPin = vi.fn().mockResolvedValue({ kind: 'wrong' });

		await expect(
			reprintKioskLabels(shelterCode, pinInput({ staff_pin: '000000' }), { verifyStaffPin })
		).rejects.toBeInstanceOf(KioskReprintStaffPinInvalidError);
		expect(verifyStaffPin).toHaveBeenCalledWith('000000');
		expect(screeningLookups()).toEqual([]);
	});

	it('refuses the reprint when the kiosk has no staff PIN set', async () => {
		docs = [evacuee(0)];
		const verifyStaffPin = vi.fn().mockResolvedValue({ kind: 'not_set' });

		await expect(
			reprintKioskLabels(shelterCode, pinInput(), { verifyStaffPin })
		).rejects.toBeInstanceOf(KioskReprintStaffPinNotSetError);
		expect(screeningLookups()).toEqual([]);
	});

	it('refuses the reprint when the device PIN queue is full', async () => {
		docs = [evacuee(0)];
		const verifyStaffPin = vi.fn().mockResolvedValue({ kind: 'busy' });

		await expect(
			reprintKioskLabels(shelterCode, pinInput(), { verifyStaffPin })
		).rejects.toBeInstanceOf(KioskReprintStaffPinBusyError);
		expect(screeningLookups()).toEqual([]);
	});

	it('fails closed when no staff PIN verifier is available', async () => {
		docs = [evacuee(0)];

		await expect(reprintKioskLabels(shelterCode, pinInput())).rejects.toBeInstanceOf(
			KioskReprintStaffPinInvalidError
		);
		expect(screeningLookups()).toEqual([]);
	});

	it('is not found for an unknown primary before the staff PIN is checked', async () => {
		const verifyStaffPin = vi.fn().mockResolvedValue({ kind: 'ok' });

		await expect(
			reprintKioskLabels(shelterCode, pinInput(), { verifyStaffPin })
		).rejects.toBeInstanceOf(KioskReprintNotFoundError);
		expect(verifyStaffPin).not.toHaveBeenCalled();
	});

	it('prints the current zone name of members already given a zone', async () => {
		docs = [
			evacuee(0, { current_stay: { status: 'room_confirmed', zone: 'z3' } }),
			evacuee(1, { current_stay: { status: 'active', zone: 'z9' } })
		];
		mockFindMasterByCode.mockResolvedValue({
			zones: [{ code: 'Z3', name: 'A3' }]
		} as never);

		const members = await reprintKioskLabels(shelterCode, input({ evacuee_ids: [ids[0], ids[1]] }));

		expect(members.map((member) => member.label.zone)).toEqual(['A3', 'z9']);
		expect(mockFindMasterByCode).toHaveBeenCalledTimes(1);
		expect(mockFindMasterByCode).toHaveBeenCalledWith(shelterCode);
	});

	it('ticks one box per intake station passed', async () => {
		docs = [
			evacuee(0),
			evacuee(1),
			evacuee(2, { current_stay: { status: 'active', zone: 'z3' } }),
			evacuee(3, { current_stay: { status: 'room_confirmed', zone: 'z3' } })
		];
		screenings = [{ evacuee_id: ids[1] }, { evacuee_id: ids[2] }];
		mockFindMasterByCode.mockResolvedValue({ zones: [] } as never);

		const members = await reprintKioskLabels(
			shelterCode,
			input({ evacuee_ids: [ids[0], ids[1], ids[2], ids[3]] })
		);

		expect(members.map((member) => member.label.stations_passed)).toEqual([1, 2, 3, 3]);
		// Only the members not yet given a zone need their screening looked up.
		expect(screeningLookups()).toHaveLength(1);
		const [[, init]] = screeningLookups() as [[string, RequestInit]];
		expect(JSON.parse(String(init.body)).selector).toEqual({
			type: 'screening',
			evacuee_id: { $in: [ids[0], ids[1]] }
		});
	});

	it('skips the screening lookup when everyone already has a zone', async () => {
		docs = [evacuee(0, { current_stay: { status: 'room_confirmed', zone: 'z3' } })];
		mockFindMasterByCode.mockResolvedValue({ zones: [] } as never);

		const [member] = await reprintKioskLabels(shelterCode, input());

		expect(member?.label.stations_passed).toBe(3);
		expect(screeningLookups()).toEqual([]);
	});

	it('still prints, ticking check-in only, when the screening lookup fails', async () => {
		docs = [evacuee(0)];
		const lookup = mockAdminFetch.getMockImplementation()!;
		mockAdminFetch.mockImplementation(async (path, init) => {
			if (path.endsWith('/_find')) throw new Error('down');
			return lookup(path, init);
		});

		const [member] = await reprintKioskLabels(shelterCode, input());

		expect(member?.label.stations_passed).toBe(1);
	});

	it('prints the zone short name when the shelter gives it one', async () => {
		docs = [evacuee(0, { current_stay: { status: 'room_confirmed', zone: 'z3' } })];
		mockFindMasterByCode.mockResolvedValue({
			zones: [{ code: 'z3', name: 'โซนผู้สูงอายุ อาคารเรียนรวม 2', short_name: 'A3' }]
		} as never);

		const [member] = await reprintKioskLabels(shelterCode, input());

		expect(member?.label.zone).toBe('A3');
	});

	it('falls back to the zone code when the shelter zones cannot be read', async () => {
		docs = [evacuee(0, { current_stay: { status: 'room_confirmed', zone: 'z3' } })];
		mockFindMasterByCode.mockRejectedValue(new Error('registry down'));

		const [member] = await reprintKioskLabels(shelterCode, input());

		expect(member?.label.zone).toBe('z3');
	});

	it('accepts a legacy +66 stored phone for the same number', async () => {
		docs = [evacuee(0, { phone: '+66812345678' })];
		expect(await reprintKioskLabels(shelterCode, input())).toHaveLength(1);
	});

	it('rejects a phone that is not a Thai number before touching CouchDB', async () => {
		await expect(reprintKioskLabels(shelterCode, input({ phone: '12345' }))).rejects.toBeInstanceOf(
			KioskInputError
		);
		expect(mockAdminFetch).not.toHaveBeenCalled();
	});

	it('rejects a wrong last four', async () => {
		docs = [evacuee(0)];
		await expect(
			reprintKioskLabels(shelterCode, input({ id_last4: '9999' }))
		).rejects.toBeInstanceOf(KioskReprintVerifyFailedError);
	});

	it.each([['1-2345-67890-12-3'], ['1 2345 67890 12 3']])(
		'verifies a primary whose id is stored with separators (%j)',
		async (number) => {
			docs = [evacuee(0, { person_id: { number } })];
			expect(await reprintKioskLabels(shelterCode, input())).toHaveLength(1);
		}
	);

	it.each([[undefined], ['123'], ['12345678901AB']])(
		'cannot verify a primary whose id is %j',
		async (number) => {
			docs = [evacuee(0, { person_id: number === undefined ? {} : { number } })];
			await expect(reprintKioskLabels(shelterCode, input())).rejects.toBeInstanceOf(
				KioskReprintUnverifiableError
			);
		}
	);

	it.each([
		['phone mismatch', { phone: '0899999999' }],
		['another shelter', { shelter_code: 'SH002' }]
	])('is not found for %s', async (_label, override) => {
		docs = [evacuee(0, override)];
		await expect(reprintKioskLabels(shelterCode, input())).rejects.toBeInstanceOf(
			KioskReprintNotFoundError
		);
	});

	it('reprints a staff-registered household like any other channel', async () => {
		docs = [
			evacuee(0, { registered_via: 'station_1' }),
			evacuee(1, { registered_via: 'station_1' })
		];
		const members = await reprintKioskLabels(shelterCode, input({ evacuee_ids: [ids[0], ids[1]] }));
		expect(members.map((member) => member.evacuee_id)).toEqual([ids[0], ids[1]]);
	});

	it('is not found for an unknown primary', async () => {
		await expect(reprintKioskLabels(shelterCode, input())).rejects.toBeInstanceOf(
			KioskReprintNotFoundError
		);
	});

	it('skips members outside the household, not yet checked in, gone, or not found', async () => {
		docs = [
			evacuee(0),
			evacuee(1, { household_id: 'household:B' }),
			evacuee(2, { current_stay: { status: 'pre_registered' } }),
			evacuee(3, { current_stay: { status: 'checked_out' } }),
			evacuee(4, { current_stay: { status: 'temporary_leave' } })
		];

		const members = await reprintKioskLabels(
			shelterCode,
			input({ evacuee_ids: [ids[0], ids[1], ids[2], ids[3], ids[4], ids[5]] })
		);

		expect(members.map((member) => member.evacuee_id)).toEqual([ids[0]]);
		expect(writes()).toEqual([]);
	});

	it('is not found when none of the selected members can be reprinted', async () => {
		docs = [evacuee(0), evacuee(1, { current_stay: { status: 'checked_out' } })];
		await expect(
			reprintKioskLabels(shelterCode, input({ evacuee_ids: [ids[1]] }))
		).rejects.toBeInstanceOf(KioskReprintNotFoundError);
		expect(writes()).toEqual([]);
	});

	it('only lists the primary when it has no household', async () => {
		docs = [evacuee(0, { household_id: null }), evacuee(1, { household_id: null })];
		const members = await reprintKioskLabels(shelterCode, input({ evacuee_ids: [ids[0], ids[1]] }));
		expect(members.map((member) => member.evacuee_id)).toEqual([ids[0]]);
	});

	it('turns a CouchDB failure into the lookup-unavailable error', async () => {
		mockAdminFetch.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
		await expect(reprintKioskLabels(shelterCode, input())).rejects.toBeInstanceOf(
			KioskLookupUnavailableError
		);
	});
});

describe('kioskReprintInputSchema', () => {
	const valid = input();

	it('accepts a well-formed input', () => {
		expect(kioskReprintInputSchema.safeParse(valid).success).toBe(true);
	});

	it.each([
		['an empty phone', { phone: '' }],
		['an overlong phone', { phone: '0'.repeat(21) }],
		['a bad last4', { id_last4: '12a4' }],
		['five digits', { id_last4: '12345' }],
		['a bad primary id', { primary_evacuee_id: 'evacuee:nope' }],
		['no members', { evacuee_ids: [] }],
		['too many members', { evacuee_ids: Array.from({ length: 21 }, () => ids[0]) }]
	])('rejects %s', (_label, override) => {
		expect(kioskReprintInputSchema.safeParse({ ...valid, ...override }).success).toBe(false);
	});
});
