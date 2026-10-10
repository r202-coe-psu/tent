import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '$lib/server/couch-admin';
import {
	checkInSelectedMembers,
	KioskInputError,
	KioskThaidIdentityMismatchError,
	kioskCheckInInputSchema,
	kioskGateInputSchema,
	lookupPreRegisteredEvacuee,
	saveKioskCheckInCardPhoto
} from './kiosk-check-in.server';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));

const mockAdminFetch = vi.mocked(adminFetch);
const shelterCode = 'SH001';
const phone = '0812345678';
const ids = [
	'01ARZ3NDEKTSV4RRFFQ69G5FAV',
	'01ARZ3NDEKTSV4RRFFQ69G5FAW',
	'01ARZ3NDEKTSV4RRFFQ69G5FAX',
	'01ARZ3NDEKTSV4RRFFQ69G5FAY',
	'01ARZ3NDEKTSV4RRFFQ69G5FAZ',
	'01ARZ3NDEKTSV4RRFFQ69G5FB0',
	'01ARZ3NDEKTSV4RRFFQ69G5FB1',
	'01ARZ3NDEKTSV4RRFFQ69G5FB2',
	'01ARZ3NDEKTSV4RRFFQ69G5FB3',
	'01ARZ3NDEKTSV4RRFFQ69G5FB4',
	'01ARZ3NDEKTSV4RRFFQ69G5FB5',
	'01ARZ3NDEKTSV4RRFFQ69G5FB6'
];

interface FixtureEvacuee {
	_id: string;
	_rev?: string;
	type: 'evacuee';
	shelter_code: string;
	registered_via: string;
	first_name: string;
	last_name: string;
	phone: string | null;
	person_id?: { number: string };
	household_id: string | null;
	created_at: string;
	updated_at?: string;
	current_stay: { status: string; zone?: string | null; since?: string };
	privacy?: { search_excluded?: boolean };
}

interface FixtureHousehold {
	_id: string;
	_rev?: string;
	type: 'household';
	head_evacuee_id: string;
	status?: string;
	updated_at?: string;
}

let evacuees: FixtureEvacuee[] = [];
let households: FixtureHousehold[] = [];

function evacuee(index: number, overrides: Partial<FixtureEvacuee> = {}): FixtureEvacuee {
	return {
		_id: `evacuee:${ids[index]}`,
		_rev: '1-evacuee',
		type: 'evacuee',
		shelter_code: shelterCode,
		registered_via: 'web',
		first_name: `สมชาย${index}`,
		last_name: 'ใจดี',
		phone,
		person_id: { number: '1234567890123' },
		household_id: `household:${index}`,
		created_at: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
		current_stay: { status: 'pre_registered' },
		...overrides
	};
}

function setHousehold(members: FixtureEvacuee[], head = members[0]): void {
	const householdId = head.household_id;
	if (householdId) {
		for (const member of members) member.household_id = householdId;
		households.push({
			_id: householdId,
			_rev: '1-household',
			type: 'household',
			head_evacuee_id: head._id,
			status: 'pre_registered'
		});
	}
	evacuees.push(...members);
}

function configureCheckInCouchMocks(options: { conflictOnId?: string } = {}): void {
	mockAdminFetch.mockImplementation(async (path, init = {}) => {
		if (path.endsWith('/_find')) {
			const body = JSON.parse(String(init.body ?? '{}')) as {
				selector?: Record<string, unknown>;
			};
			const selector = body.selector ?? {};
			let docs = evacuees.filter((doc) => doc.type === selector.type);
			if (typeof selector.shelter_code === 'string') {
				docs = docs.filter((doc) => doc.shelter_code === selector.shelter_code);
			}
			const personNumber = (selector['person_id.number'] as string | undefined) ?? undefined;
			if (personNumber) docs = docs.filter((doc) => doc.person_id?.number === personNumber);
			if (typeof selector.household_id === 'string') {
				docs = docs.filter((doc) => doc.household_id === selector.household_id);
			}
			return { docs } as never;
		}

		const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
		const method = init.method ?? 'GET';
		const evacueeIndex = evacuees.findIndex((doc) => doc._id === id);
		const householdIndex = households.findIndex((doc) => doc._id === id);
		if (method === 'PUT') {
			const updated = JSON.parse(String(init.body ?? '{}')) as FixtureEvacuee | FixtureHousehold;
			if (evacueeIndex >= 0) {
				Object.assign(evacuees[evacueeIndex], updated, { _rev: '2-evacuee' });
				if (id === options.conflictOnId) {
					throw Object.assign(new Error('conflict'), { status: 409 });
				}
			} else if (householdIndex >= 0) {
				Object.assign(households[householdIndex], updated, { _rev: '2-household' });
			} else {
				throw Object.assign(new Error('not found'), { status: 404 });
			}
			return { ok: true } as never;
		}

		if (evacueeIndex >= 0) return evacuees[evacueeIndex] as never;
		if (householdIndex >= 0) return households[householdIndex] as never;
		throw Object.assign(new Error('not found'), { status: 404 });
	});
}

function configureCouchMocks(): void {
	mockAdminFetch.mockImplementation(async (path, init = {}) => {
		if (path.includes('/_all_docs?include_docs=true')) {
			const body = JSON.parse(String(init.body ?? '{}')) as { keys?: string[] };
			return {
				rows: (body.keys ?? []).map((id) => ({ doc: households.find((doc) => doc._id === id) }))
			} as never;
		}
		if (path.endsWith('/_find')) {
			const body = JSON.parse(String(init.body ?? '{}')) as {
				selector?: Record<string, unknown>;
				fields?: string[];
			};
			const selector = body.selector ?? {};
			let docs = evacuees.filter((doc) => doc.type === selector.type);
			if (typeof selector.shelter_code === 'string') {
				docs = docs.filter((doc) => doc.shelter_code === selector.shelter_code);
			}
			if (typeof selector.registered_via === 'string') {
				docs = docs.filter((doc) => doc.registered_via === selector.registered_via);
			}
			if (typeof selector.household_id === 'string') {
				docs = docs.filter((doc) => doc.household_id === selector.household_id);
			}
			if (typeof selector.household_id === 'object' && selector.household_id !== null) {
				const ids = (selector.household_id as { $in?: string[] }).$in ?? [];
				docs = docs.filter((doc) => doc.household_id !== null && ids.includes(doc.household_id));
			}
			if (typeof selector.phone === 'object' && selector.phone !== null) {
				const variants = (selector.phone as { $in?: string[] }).$in ?? [];
				docs = docs.filter((doc) => doc.phone !== null && variants.includes(doc.phone));
			}
			if (typeof selector.phone === 'string') {
				docs = docs.filter((doc) => doc.phone === selector.phone);
			}
			if (typeof selector['person_id.number'] === 'string') {
				docs = docs.filter((doc) => doc.person_id?.number === selector['person_id.number']);
			}
			const requestedFields = body.fields;
			const projectedDocs = requestedFields
				? docs.map((doc) =>
						Object.fromEntries(
							requestedFields
								.filter((field) => field in doc)
								.map((field) => [field, doc[field as keyof FixtureEvacuee]])
						)
					)
				: docs;
			return { docs: projectedDocs } as never;
		}
		const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
		const doc = evacuees.find((candidate) => candidate._id === id);
		if (!doc) throw Object.assign(new Error('not found'), { status: 404 });
		return doc as never;
	});
}

describe('lookupPreRegisteredEvacuee phone gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCouchMocks();
	});

	it('rejects an invalid phone before calling CouchDB', async () => {
		await expect(
			lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone: '12345' })
		).rejects.toBeInstanceOf(KioskInputError);
		expect(mockAdminFetch).not.toHaveBeenCalled();
	});

	it('returns not_found when no eligible record matches', async () => {
		expect(await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone })).toEqual({
			kind: 'not_found'
		});
	});

	it('returns one household with every last name masked and no phone field', async () => {
		const head = evacuee(0);
		const member = evacuee(1, { phone: null });
		setHousehold([head, member], head);

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		expect(result).toMatchObject({
			kind: 'household',
			name_masked: true,
			primary_evacuee_id: head._id,
			members: [
				{ last_name: 'ใ****', is_primary: true, phone_matched: true },
				{ last_name: 'ใ****', is_primary: false, phone_matched: false }
			]
		});
		if (result.kind !== 'household') throw new Error('expected household');
		for (const summary of result.members) expect(summary).not.toHaveProperty('phone');
	});

	it('returns multiple households ordered by primary creation date with masked contact names and counts', async () => {
		const later = evacuee(3, { first_name: 'ปลาย', last_name: 'นามสกุลยาว' });
		const laterMember = evacuee(4, { phone: null, current_stay: { status: 'arriving' } });
		setHousehold([later, laterMember], later);
		const earlier = evacuee(0, { first_name: 'ต้น', last_name: 'นามสกุลยาว' });
		const earlierMember = evacuee(1, { phone: null });
		const earlierStaffMember = evacuee(5, {
			phone: null,
			registered_via: 'station_1'
		});
		setHousehold([earlier, earlierMember, earlierStaffMember], earlier);

		expect(await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone })).toEqual({
			kind: 'candidates',
			shelter_code: shelterCode,
			candidates: [
				{
					primary_evacuee_id: earlier._id,
					contact_display: 'ต้น นา****ว',
					member_count: 3,
					pending_count: 2
				},
				{
					primary_evacuee_id: later._id,
					contact_display: 'ปลาย นา****ว',
					member_count: 2,
					pending_count: 1
				}
			]
		});
	});

	it('counts candidates with one exact household query per group and never uses $in', async () => {
		for (let index = 0; index < 3; index += 1) setHousehold([evacuee(index)]);

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		expect(result).toMatchObject({ kind: 'candidates' });

		const queryBodies = mockAdminFetch.mock.calls
			.filter(([path]) => path.endsWith('/_find'))
			.map(([, init]) => JSON.parse(String(init?.body)) as { selector: Record<string, unknown> });
		const candidateQueries = queryBodies.filter(
			({ selector }) => typeof selector.household_id === 'string'
		);
		expect(queryBodies).toHaveLength(5); // two phone variants plus three household groups
		expect(candidateQueries).toHaveLength(3);
		expect(candidateQueries.map(({ selector }) => selector.household_id).sort()).toEqual([
			'household:0',
			'household:1',
			'household:2'
		]);
		for (const { selector } of queryBodies) {
			expect(JSON.stringify(selector)).not.toContain('$in');
		}
	});

	it('returns too_many after the sixth eligible household', async () => {
		for (let index = 0; index < 6; index += 1) setHousehold([evacuee(index)]);

		expect(await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone })).toEqual({
			kind: 'too_many'
		});
	});

	it('keeps the five-household cap when a candidate id is supplied', async () => {
		let firstId = '';
		for (let index = 0; index < 6; index += 1) {
			const member = evacuee(index);
			if (index === 0) firstId = member._id;
			setHousehold([member]);
		}

		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'phone',
				phone,
				primary_evacuee_id: firstId
			})
		).toEqual({ kind: 'too_many' });
	});

	it('follows Mango bookmarks so a full first page from one large household is not mistaken for many matches', async () => {
		const head = evacuee(0);
		setHousehold([head]);
		let phoneQueryCount = 0;
		mockAdminFetch.mockImplementation(async (path, init = {}) => {
			if (path.includes('/_all_docs?include_docs=true')) {
				return { rows: [{ doc: households[0] }] } as never;
			}
			if (path.endsWith('/_find')) {
				const body = JSON.parse(String(init.body ?? '{}')) as {
					selector?: Record<string, unknown>;
				};
				if (body.selector?.phone === phone) {
					phoneQueryCount += 1;
					return phoneQueryCount === 1
						? { docs: Array.from({ length: 50 }, () => head), bookmark: 'page-2' }
						: { docs: [head] };
				}
				if (body.selector?.phone) return { docs: [] } as never;
				return { docs: [head] } as never;
			}
			return head as never;
		});

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		expect(result).toMatchObject({ kind: 'household', primary_evacuee_id: head._id });
		expect(phoneQueryCount).toBe(2);
	});

	it('fails closed when a full Mango page has no continuation bookmark', async () => {
		const hit = evacuee(0);
		mockAdminFetch.mockImplementation(async (path, init = {}) => {
			if (path.endsWith('/_find')) {
				const body = JSON.parse(String(init.body ?? '{}')) as {
					selector?: Record<string, unknown>;
				};
				if (body.selector?.phone) return { docs: Array.from({ length: 50 }, () => hit) } as never;
			}
			return { docs: [] } as never;
		});

		expect(await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone })).toEqual({
			kind: 'too_many'
		});
	});

	it('resolves a selected matched member to its household and rejects an unrelated candidate id', async () => {
		const head = evacuee(0, { phone: null });
		const matched = evacuee(1);
		setHousehold([head, matched], head);

		const selected = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'phone',
			phone,
			primary_evacuee_id: matched._id
		});
		expect(selected).toMatchObject({ kind: 'household', primary_evacuee_id: matched._id });
		if (selected.kind === 'household') expect(selected.members).toHaveLength(2);

		const invalidSelection = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'phone',
			phone,
			primary_evacuee_id: `evacuee:${ids[5]}`
		});
		expect(invalidSelection).toEqual({ kind: 'not_found' });
	});

	it('filters cancelled and privacy-excluded matching records', async () => {
		evacuees = [
			evacuee(0, { current_stay: { status: 'cancelled' } }),
			evacuee(1, { privacy: { search_excluded: true } })
		];
		expect(await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone })).toEqual({
			kind: 'not_found'
		});
	});

	it('queries only the authenticated shelter and web records with exact canonical and legacy values', async () => {
		await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		const queryCalls = mockAdminFetch.mock.calls.filter(([path]) => path.endsWith('/_find'));
		const bodies = queryCalls.map(
			([, init]) =>
				JSON.parse(String(init?.body)) as { selector: Record<string, unknown>; fields: string[] }
		);

		expect(bodies.map(({ selector }) => selector.phone)).toEqual([phone, '+66812345678']);
		for (const { selector, fields } of bodies) {
			expect(selector).toMatchObject({
				type: 'evacuee',
				shelter_code: shelterCode,
				registered_via: 'web'
			});
			expect(fields).toContain('type');
			expect(fields).toContain('privacy');
			expect(fields).not.toContain('phone');
		}
	});

	it('merges matching phone variants without duplicating an evacuee', async () => {
		const matchingMember = evacuee(0, { household_id: null });
		const queriedPhones: string[] = [];
		mockAdminFetch.mockImplementation(async (path, init = {}) => {
			if (path.endsWith('/_find')) {
				const body = JSON.parse(String(init.body ?? '{}')) as {
					selector?: { phone?: string };
				};
				if (body.selector?.phone) queriedPhones.push(body.selector.phone);
				return { docs: [matchingMember] } as never;
			}
			return matchingMember as never;
		});

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });

		expect(queriedPhones).toEqual([phone, '+66812345678']);
		expect(result).toMatchObject({ kind: 'household', primary_evacuee_id: matchingMember._id });
		if (result.kind === 'household') {
			expect(result.members.map((member) => member.evacuee_id)).toEqual([matchingMember._id]);
		}
	});

	it('finds a legacy +66 phone using its exact-value follow-up query', async () => {
		const legacy = evacuee(0, { phone: '+66812345678' });
		setHousehold([legacy]);

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });

		expect(result).toMatchObject({ kind: 'household', primary_evacuee_id: legacy._id });
	});

	it('masks card and QR household names', async () => {
		const person = evacuee(0, { last_name: 'ใจดี' });
		evacuees = [person];

		const card = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'smart-card',
			citizen_id: '1234567890123'
		});
		const qr = await lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: person._id });
		expect(card).toMatchObject({ kind: 'household', name_masked: true });
		expect(qr).toMatchObject({ kind: 'household', name_masked: true });
		if (card.kind === 'household') expect(card.members[0].last_name).toBe('ใ****');
		if (qr.kind === 'household') expect(qr.members[0].last_name).toBe('ใ****');
	});

	it('lists eligible staff-created household members without making them selectable', async () => {
		const primary = evacuee(0);
		const staffMember = evacuee(1, {
			registered_via: 'station_1',
			person_id: { number: '9876543210987' }
		});
		const cancelled = evacuee(2, {
			current_stay: { status: 'cancelled' },
			person_id: { number: '9876543210988' }
		});
		const optedOut = evacuee(3, {
			privacy: { search_excluded: true },
			person_id: { number: '9876543210989' }
		});
		setHousehold([primary, staffMember, cancelled, optedOut]);

		const result = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'qr',
			token: primary._id
		});

		expect(result).toMatchObject({ kind: 'household', name_masked: true });
		if (result.kind !== 'household') throw new Error('Expected a household lookup result');
		expect(result.members.map((member) => member.evacuee_id)).toEqual([
			primary._id,
			staffMember._id
		]);
		expect(result.members[1]).toMatchObject({ selectable: false, status: 'pre_registered' });
		const householdQuery = mockAdminFetch.mock.calls
			.filter(([path]) => path.endsWith('/_find'))
			.map(([, init]) => JSON.parse(String(init?.body)) as { selector: Record<string, unknown> })
			.find(({ selector }) => selector.household_id === primary.household_id);
		expect(householdQuery?.selector).not.toHaveProperty('registered_via');
	});

	it('returns not_found when the scanned primary opted out of search', async () => {
		const person = evacuee(0, { privacy: { search_excluded: true } });
		evacuees = [person];

		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'qr',
				token: person._id
			})
		).toEqual({ kind: 'not_found', can_register: false });
	});

	it('marks a new smart-card lookup as eligible for registration', async () => {
		configureCheckInCouchMocks();
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'smart-card',
				citizen_id: '1234567890123'
			})
		).toEqual({ kind: 'not_found', can_register: true });
		const query = mockAdminFetch.mock.calls.map(
			([, init]) => JSON.parse(String(init?.body)) as { selector: Record<string, unknown> }
		)[0];
		expect(query?.selector).toMatchObject({
			shelter_code: shelterCode,
			'person_id.number': '1234567890123'
		});
	});

	it('returns a repeat-registration outcome for kiosk_registered records', async () => {
		evacuees = [
			evacuee(0, { registered_via: 'kiosk', current_stay: { status: 'kiosk_registered' } })
		];
		configureCheckInCouchMocks();
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'smart-card',
				citizen_id: '1234567890123'
			})
		).toEqual({ kind: 'kiosk_registered' });
	});

	it('keeps ambiguous card lookup as not_found', async () => {
		evacuees = [evacuee(0), evacuee(1)];
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'smart-card',
				citizen_id: '1234567890123'
			})
		).toEqual({ kind: 'not_found', can_register: false });
	});
});

describe('lookupPreRegisteredEvacuee thaid', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCouchMocks();
	});

	it('finds the household by person_id.number with masked names like a smart-card lookup', async () => {
		const primary = evacuee(0);
		const member = evacuee(1, { person_id: { number: '9999999999999' } });
		setHousehold([primary, member], primary);

		const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'thaid',
			citizen_id: '1234567890123'
		});

		expect(outcome).toMatchObject({
			kind: 'household',
			name_masked: true,
			shelter_code: shelterCode,
			primary_evacuee_id: primary._id
		});
		expect(outcome.kind === 'household' && outcome.members.map((m) => m.evacuee_id)).toEqual([
			primary._id,
			member._id
		]);
		const query = mockAdminFetch.mock.calls.map(
			([, init]) => JSON.parse(String(init?.body)) as { selector: Record<string, unknown> }
		)[0];
		expect(query?.selector).toMatchObject({
			shelter_code: shelterCode,
			'person_id.number': '1234567890123'
		});
	});

	it('does not offer walk-in registration when the citizen is unknown', async () => {
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'thaid',
				citizen_id: '1234567890123'
			})
		).toEqual({ kind: 'not_found', can_register: false });
	});

	it('returns the repeat-registration outcome for kiosk_registered records', async () => {
		evacuees = [
			evacuee(0, { registered_via: 'kiosk', current_stay: { status: 'kiosk_registered' } })
		];
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'thaid',
				citizen_id: '1234567890123'
			})
		).toEqual({ kind: 'kiosk_registered' });
	});
});

describe('checkInSelectedMembers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCheckInCouchMocks();
	});

	it('checks in only eligible web members in the primary household and refreshes household status', async () => {
		const primary = evacuee(0);
		const member = evacuee(1);
		const legacyKioskMember = evacuee(2, { registered_via: 'kiosk' });
		setHousehold([primary, member, legacyKioskMember], primary);
		const unrelated = evacuee(3);
		setHousehold([unrelated]);
		const otherShelter = evacuee(4, { shelter_code: 'SH002' });
		setHousehold([otherShelter]);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [
			primary._id,
			member._id,
			legacyKioskMember._id,
			unrelated._id,
			otherShelter._id
		]);

		expect(results).toMatchObject([
			{
				evacuee_id: primary._id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: primary._id
			},
			{
				evacuee_id: member._id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: member._id
			},
			{ evacuee_id: legacyKioskMember._id, status: 'not_eligible' },
			{ evacuee_id: unrelated._id, status: 'not_eligible' },
			{ evacuee_id: otherShelter._id, status: 'not_found' }
		]);
		expect(primary.current_stay).toMatchObject({ status: 'arriving', zone: null });
		expect(member.current_stay).toMatchObject({ status: 'arriving', zone: null });
		expect(typeof primary.current_stay.since).toBe('string');
		expect(typeof primary.updated_at).toBe('string');

		const evacueeWrites = mockAdminFetch.mock.calls.filter(
			([path, init]) =>
				init?.method === 'PUT' &&
				[primary._id, member._id].some((id) => path.endsWith(encodeURIComponent(id)))
		);
		expect(evacueeWrites).toHaveLength(2);
		for (const [, init] of evacueeWrites) {
			const body = JSON.parse(String(init?.body)) as FixtureEvacuee;
			expect(body._rev).toBe('1-evacuee');
			expect(body.registered_via).toBe('web');
		}

		const householdWrite = mockAdminFetch.mock.calls.find(
			([path, init]) =>
				path.endsWith(encodeURIComponent(primary.household_id ?? '')) && init?.method === 'PUT'
		);
		expect(householdWrite).toBeDefined();
		const householdBody = JSON.parse(String(householdWrite?.[1]?.body)) as FixtureHousehold;
		expect(householdBody).toMatchObject({ _rev: '1-household', status: 'arriving' });
	});

	it('rejects opted-out members even when their IDs are submitted directly', async () => {
		const primary = evacuee(0);
		const hidden = evacuee(1, { privacy: { search_excluded: true } });
		setHousehold([primary, hidden], primary);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [hidden._id]);

		expect(results).toEqual([{ evacuee_id: hidden._id, status: 'not_eligible' }]);
		expect(mockAdminFetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
	});

	it('rejects an opted-out primary before processing selected members', async () => {
		const primary = evacuee(0, { privacy: { search_excluded: true } });
		setHousehold([primary]);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [primary._id]);

		expect(results).toEqual([{ evacuee_id: primary._id, status: 'not_eligible' }]);
		expect(mockAdminFetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
	});

	it('re-reads after a CouchDB conflict and returns the already committed QR result', async () => {
		const primary = evacuee(0);
		setHousehold([primary]);
		configureCheckInCouchMocks({ conflictOnId: primary._id });

		const results = await checkInSelectedMembers(shelterCode, primary._id, [primary._id]);

		expect(results).toEqual([
			{
				evacuee_id: primary._id,
				status: 'already_checked_in',
				stay_status: 'arriving',
				qr_payload: primary._id
			}
		]);
		expect(
			mockAdminFetch.mock.calls.filter(([path]) => path.endsWith(encodeURIComponent(primary._id)))
		).toHaveLength(4);
	});
});

describe('checkInSelectedMembers requiredPrimaryCitizenId', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCheckInCouchMocks();
	});

	it('writes nothing and signals a mismatch when the primary is another citizen', async () => {
		const primary = evacuee(0, { person_id: { number: '1111111111111' } });
		setHousehold([primary]);

		await expect(
			checkInSelectedMembers(shelterCode, primary._id, [primary._id], {
				requiredPrimaryCitizenId: '1234567890123'
			})
		).rejects.toBeInstanceOf(KioskThaidIdentityMismatchError);
		expect(mockAdminFetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
	});

	it('signals a mismatch when the primary has no citizen id', async () => {
		const primary = evacuee(0, { person_id: undefined });
		setHousehold([primary]);

		await expect(
			checkInSelectedMembers(shelterCode, primary._id, [primary._id], {
				requiredPrimaryCitizenId: '1234567890123'
			})
		).rejects.toBeInstanceOf(KioskThaidIdentityMismatchError);
	});

	it('checks in as usual when the primary citizen id matches', async () => {
		const primary = evacuee(0);
		setHousehold([primary]);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [primary._id], {
			requiredPrimaryCitizenId: '1234567890123'
		});

		expect(results).toEqual([
			{
				evacuee_id: primary._id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: primary._id
			}
		]);
	});
});

describe('kioskCheckInInputSchema photo', () => {
	const primaryId = `evacuee:${ids[0]}`;
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
	const photo = {
		content_type: 'image/jpeg' as const,
		full_base64: jpeg.toString('base64'),
		width: 1,
		height: 1,
		original_size: 4,
		compressed_size: 4,
		thumbnail_size: 0
	};

	it('defaults photo to null and keeps the legacy body valid', () => {
		const parsed = kioskCheckInInputSchema.parse({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId]
		});
		expect(parsed.photo).toBeNull();
	});

	it('accepts a photo only with a smart-card source and citizen id', () => {
		const base = { primary_evacuee_id: primaryId, evacuee_ids: [primaryId], photo };
		expect(
			kioskCheckInInputSchema.safeParse({
				...base,
				source: 'smart-card',
				citizen_id: '1234567890123'
			}).success
		).toBe(true);
		expect(kioskCheckInInputSchema.safeParse({ ...base, source: 'qr' }).success).toBe(false);
		expect(kioskCheckInInputSchema.safeParse({ ...base, source: 'phone' }).success).toBe(false);
		expect(kioskCheckInInputSchema.safeParse({ ...base, source: 'smart-card' }).success).toBe(
			false
		);
		expect(kioskCheckInInputSchema.safeParse(base).success).toBe(false);
	});
});

describe('saveKioskCheckInCardPhoto', () => {
	const citizenId = '1234567890123';
	const ownerId = `evacuee:${ids[0]}`;
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
	const photo = {
		content_type: 'image/jpeg' as const,
		full_base64: jpeg.toString('base64'),
		width: 1,
		height: 1,
		original_size: jpeg.length,
		compressed_size: jpeg.length,
		thumbnail_size: 0
	};
	const checkedIn = [{ evacuee_id: ownerId, status: 'checked_in' as const }];

	type Owner = ReturnType<typeof evacuee> & { photo?: string | null };
	let owner: Owner;
	let evacueePutError: Error | null;
	let imagePuts: Array<{ path: string; body: Record<string, unknown> }>;
	let evacueePuts: Array<Record<string, unknown>>;
	let deletes: string[];
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		owner = evacuee(0, { current_stay: { status: 'arriving' }, _rev: '2-evacuee' });
		evacueePutError = null;
		imagePuts = [];
		evacueePuts = [];
		deletes = [];
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockAdminFetch.mockImplementation(async (path, init = {}) => {
			const method = init.method ?? 'GET';
			if (method === 'DELETE') {
				deletes.push(path);
				return { ok: true } as never;
			}
			if (path.includes('image%3A')) {
				imagePuts.push({ path, body: JSON.parse(String(init.body)) });
				return { ok: true, rev: '1-image' } as never;
			}
			if (path.endsWith(encodeURIComponent(ownerId))) {
				if (method === 'PUT') {
					if (evacueePutError) throw evacueePutError;
					evacueePuts.push(JSON.parse(String(init.body)));
					return { ok: true, rev: '3-evacuee' } as never;
				}
				return owner as never;
			}
			throw Object.assign(new Error('not found'), { status: 404 });
		});
	});

	function save(overrides: Partial<Parameters<typeof saveKioskCheckInCardPhoto>[2]> = {}) {
		return saveKioskCheckInCardPhoto(shelterCode, 'KIOSK-01', {
			primaryEvacueeId: ownerId,
			citizenId,
			photo,
			results: checkedIn,
			...overrides
		});
	}

	it('stores image:{ulid} and links it to the card owner who has no photo yet', async () => {
		await expect(save()).resolves.toBe('saved');

		expect(imagePuts).toHaveLength(1);
		expect(imagePuts[0].path).toMatch(/^\/shelter_sh001\/image%3A[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(imagePuts[0].body).toMatchObject({
			type: 'image',
			shelter_code: shelterCode,
			created_by: 'scanner:KIOSK-01',
			content_type: 'image/jpeg',
			_attachments: { full: { content_type: 'image/jpeg', data: photo.full_base64 } }
		});
		expect(evacueePuts).toHaveLength(1);
		expect(evacueePuts[0]).toMatchObject({
			_id: ownerId,
			_rev: '2-evacuee',
			photo: decodeURIComponent(imagePuts[0].path.split('/').pop()!)
		});
		expect(deletes).toEqual([]);
	});

	it('never replaces an existing photo', async () => {
		owner.photo = 'image:01ARZ3NDEKTSV4RRFFQ69G5FAA';
		await expect(save()).resolves.toBe('has_photo');
		expect(imagePuts).toEqual([]);
		expect(evacueePuts).toEqual([]);
	});

	it('only writes to the evacuee whose person_id matches the card', async () => {
		await expect(save({ citizenId: '9999999999999' })).resolves.toBe('not_owner');
		expect(imagePuts).toEqual([]);
		expect(evacueePuts).toEqual([]);
	});

	it('skips when the card owner was not checked in by this request', async () => {
		await expect(
			save({ results: [{ evacuee_id: ownerId, status: 'not_eligible' }] })
		).resolves.toBe('not_checked_in');
		await expect(
			save({ results: [{ evacuee_id: ownerId, status: 'already_checked_in' }] })
		).resolves.toBe('not_checked_in');
		await expect(save({ results: [] })).resolves.toBe('not_checked_in');
		expect(mockAdminFetch).not.toHaveBeenCalled();
	});

	it('rejects a corrupt photo without writing anything or throwing', async () => {
		const notJpeg = Buffer.from([0x00, 0x01, 0x02, 0x03]);
		await expect(
			save({
				photo: {
					...photo,
					full_base64: notJpeg.toString('base64'),
					compressed_size: notJpeg.length
				}
			})
		).resolves.toBe('invalid_photo');
		await expect(save({ photo: { ...photo, compressed_size: 999 } })).resolves.toBe(
			'invalid_photo'
		);
		expect(imagePuts).toEqual([]);
		expect(evacueePuts).toEqual([]);
	});

	it('deletes the just-created image when the evacuee update conflicts', async () => {
		evacueePutError = Object.assign(new Error('conflict'), { status: 409 });
		await expect(save()).resolves.toBe('failed');
		expect(imagePuts).toHaveLength(1);
		expect(deletes).toHaveLength(1);
		expect(deletes[0]).toBe(`${imagePuts[0].path}?rev=1-image`);
	});

	it('never logs image data on failure', async () => {
		evacueePutError = Object.assign(new Error('conflict'), { status: 409 });
		await save();
		const logged = JSON.stringify(warn.mock.calls);
		expect(logged).not.toContain(photo.full_base64);
		expect(warn).toHaveBeenCalled();
	});
});

describe('kioskGateInputSchema thaid', () => {
	const sessionId = '0123456789abcdef0123456789abcdef';

	it('accepts a thaid gate that carries only a session id', () => {
		expect(kioskGateInputSchema.safeParse({ source: 'thaid', session_id: sessionId })).toEqual({
			success: true,
			data: { source: 'thaid', session_id: sessionId }
		});
	});

	it('never accepts the 13-digit citizen id from the browser for thaid', () => {
		expect(
			kioskGateInputSchema.safeParse({
				source: 'thaid',
				session_id: sessionId,
				citizen_id: '1234567890123'
			}).success
		).toBe(false);
	});

	it('rejects a malformed or missing thaid session id', () => {
		expect(kioskGateInputSchema.safeParse({ source: 'thaid', session_id: 'abc' }).success).toBe(
			false
		);
		expect(
			kioskGateInputSchema.safeParse({ source: 'thaid', session_id: sessionId.toUpperCase() })
				.success
		).toBe(false);
		expect(kioskGateInputSchema.safeParse({ source: 'thaid' }).success).toBe(false);
	});
});

describe('kioskCheckInInputSchema thaid', () => {
	const primaryId = `evacuee:${ids[0]}`;
	const sessionId = '0123456789abcdef0123456789abcdef';
	const base = { primary_evacuee_id: primaryId, evacuee_ids: [primaryId], source: 'thaid' };
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
	const photo = {
		content_type: 'image/jpeg' as const,
		full_base64: jpeg.toString('base64'),
		width: 1,
		height: 1,
		original_size: 4,
		compressed_size: 4,
		thumbnail_size: 0
	};

	it('accepts source thaid with a session id and no photo', () => {
		const parsed = kioskCheckInInputSchema.safeParse({ ...base, thaid_session_id: sessionId });
		expect(parsed.success).toBe(true);
		expect(parsed.data?.photo).toBeNull();
	});

	it('requires the session id and a well-formed one', () => {
		expect(kioskCheckInInputSchema.safeParse(base).success).toBe(false);
		expect(kioskCheckInInputSchema.safeParse({ ...base, thaid_session_id: 'abc' }).success).toBe(
			false
		);
	});

	it('forbids a browser-supplied citizen id', () => {
		expect(
			kioskCheckInInputSchema.safeParse({
				...base,
				thaid_session_id: sessionId,
				citizen_id: '1234567890123'
			}).success
		).toBe(false);
	});

	it('rejects a photo', () => {
		expect(
			kioskCheckInInputSchema.safeParse({ ...base, thaid_session_id: sessionId, photo }).success
		).toBe(false);
	});

	it('rejects a session id on any other source', () => {
		expect(
			kioskCheckInInputSchema.safeParse({
				primary_evacuee_id: primaryId,
				evacuee_ids: [primaryId],
				source: 'qr',
				thaid_session_id: sessionId
			}).success
		).toBe(false);
	});
});
