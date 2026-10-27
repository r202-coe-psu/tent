import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '$lib/server/couch-admin';
import {
	checkInSelectedMembers,
	KioskInputError,
	KioskLookupUnavailableError,
	KioskThaidIdentityMismatchError,
	kioskCheckInInputSchema,
	kioskGateInputSchema,
	lookupPreRegisteredEvacuee,
	saveKioskCheckInCardPhoto
} from './kiosk-check-in.server';
import {
	KioskUnassignedClaimConflictError,
	KioskUnassignedClaimFailedError,
	KioskUnassignedUnavailableError
} from './kiosk-unassigned.server';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));
vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi.test',
	fastapiServiceHeaders: (extra: Record<string, string> = {}) => ({
		Authorization: 'Bearer secret',
		...extra
	})
}));

const mockAdminFetch = vi.mocked(adminFetch);
const fetchMock = vi.fn();

// FastAPI (the central queue) defaults to "nobody registered"; tests override per case.
beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => queueResponse(404, notFoundBody));
	vi.stubGlobal('fetch', fetchMock);
});
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
	booking_ref?: string;
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

const notFoundBody = { errors: [{ error: { code: 'NOT_FOUND' } }] };

function queueResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

interface QueueMember {
	reserved_evacuee_id: string;
	first_name: string;
	last_name: string;
	gender: string;
	age: number;
	status: 'open' | 'claimed' | 'cancelled';
	claimed_shelter_code: string | null;
	matched: boolean;
}

function queueMember(index: number, overrides: Partial<QueueMember> = {}): QueueMember {
	return {
		reserved_evacuee_id: `evacuee:${ids[index]}`,
		first_name: `สมหญิง${index}`,
		last_name: 'ใจดี',
		gender: 'female',
		age: 30 + index,
		status: 'open',
		claimed_shelter_code: null,
		matched: false,
		...overrides
	};
}

function respondWithRegistration(members: QueueMember[]): void {
	fetchMock.mockImplementation(async () =>
		queueResponse(200, {
			registration_id: '01ARZ3NDEKTSV4RRFFQ69G5REG',
			reserved_household_id: 'household:01ARZ3NDEKTSV4RRFFQ69G5HHH',
			members
		})
	);
}

/** How the in-memory Couch answers a `_bulk_docs` write (kiosk claim birth). */
type BulkDocsMode = 'ok' | 'throw' | 'row-error' | 'conflict';
let images: Array<Record<string, unknown>> = [];

interface BulkDoc {
	_id: string;
	type: string;
	[key: string]: unknown;
}
/** CR-192 `station_log` docs the check-in appended (kept apart from claim births). */
let bulkWrites: BulkDoc[] = [];
let failBulk = false;

function configureCheckInCouchMocks(
	options: { conflictOnId?: string; bulkDocs?: BulkDocsMode; bulkRowErrorIds?: string[] } = {}
): void {
	bulkWrites = [];
	failBulk = false;
	mockAdminFetch.mockImplementation(async (path, init = {}) => {
		if (path.endsWith('/_all_docs')) {
			const { keys } = JSON.parse(String(init.body ?? '{}')) as { keys: string[] };
			const known = new Set([...evacuees, ...households].map((doc) => doc._id));
			return {
				rows: keys.map((key) =>
					known.has(key) ? { id: key, key, value: { rev: '1-x' } } : { key, error: 'not_found' }
				)
			} as never;
		}
		if (path.endsWith('/_bulk_docs')) {
			const { docs: written } = JSON.parse(String(init.body ?? '{}')) as { docs: BulkDoc[] };
			if (written.every((doc) => doc.type === 'station_log')) {
				if (failBulk) throw Object.assign(new Error('couch down'), { status: 503 });
				bulkWrites.push(...written);
				return written.map((doc) => ({ ok: true, id: doc._id, rev: '1-log' })) as never;
			}
			const mode = options.bulkDocs ?? 'ok';
			if (mode === 'throw') throw Object.assign(new Error('couch down'), { status: 503 });
			const { docs } = JSON.parse(String(init.body ?? '{}')) as {
				docs: Array<Record<string, unknown> & { _id: string }>;
			};
			const failed = (doc: { _id: string }) =>
				mode === 'row-error' || (options.bulkRowErrorIds ?? []).includes(doc._id);
			for (const doc of docs.filter((doc) => !failed(doc))) {
				if (doc.type === 'evacuee') evacuees.push({ ...doc, _rev: '1-bulk' } as never);
				else if (doc.type === 'household') households.push({ ...doc, _rev: '1-bulk' } as never);
				else images.push(doc);
			}
			return docs.map((doc) =>
				failed(doc)
					? { id: doc._id, error: 'forbidden', reason: 'validation failed' }
					: mode === 'conflict'
						? { id: doc._id, error: 'conflict', reason: 'Document update conflict.' }
						: { ok: true, id: doc._id, rev: '1-bulk' }
			) as never;
		}
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
					pending_count: 0
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

	it('counts only reprintable (already checked-in) members as pending_count', async () => {
		const head = evacuee(0, { current_stay: { status: 'active' } });
		const waiting = evacuee(1, { phone: null });
		const left = evacuee(2, { phone: null, current_stay: { status: 'checked_out' } });
		const away = evacuee(4, { phone: null, current_stay: { status: 'temporary_leave' } });
		setHousehold([head, waiting, left, away], head);
		setHousehold([evacuee(3, { current_stay: { status: 'pre_registered' } })]);

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		if (result.kind !== 'candidates') throw new Error('expected candidates');
		expect(
			result.candidates.map(({ member_count, pending_count }) => [member_count, pending_count])
		).toEqual([
			[3, 1],
			[1, 0]
		]);
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
		expect(queryBodies).toHaveLength(5); // 2 phone variants plus three household groups
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

	it('finds a kiosk walk-in by phone and lets only checked-in members be reprinted', async () => {
		const walkIn = evacuee(0, { registered_via: 'kiosk', current_stay: { status: 'arriving' } });
		const active = evacuee(1, {
			phone: null,
			registered_via: 'kiosk',
			current_stay: { status: 'active' }
		});
		const waiting = evacuee(2, { phone: null, current_stay: { status: 'pre_registered' } });
		const gone = evacuee(3, { phone: null, current_stay: { status: 'checked_out' } });
		const away = evacuee(4, { phone: null, current_stay: { status: 'temporary_leave' } });
		setHousehold([walkIn, active, waiting, gone, away], walkIn);

		const result = await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		if (result.kind !== 'household') throw new Error('expected household');
		expect(result.primary_evacuee_id).toBe(walkIn._id);
		expect(result.members.map(({ evacuee_id, selectable }) => [evacuee_id, selectable])).toEqual([
			[walkIn._id, true],
			[active._id, true],
			[waiting._id, false],
			[away._id, false]
		]);
	});

	it('keeps pre_registered-only selectable semantics for card lookups', async () => {
		const walkIn = evacuee(0, { registered_via: 'kiosk', current_stay: { status: 'arriving' } });
		const waiting = evacuee(1, {
			phone: null,
			person_id: { number: '1111111111111' },
			current_stay: { status: 'pre_registered' }
		});
		setHousehold([walkIn, waiting], walkIn);

		const result = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'smart-card',
			citizen_id: '1234567890123'
		});
		if (result.kind !== 'household') throw new Error('expected household');
		expect(result.members.map(({ selectable }) => selectable)).toEqual([false, true]);
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
		expect(phoneQueryCount).toBe(2); // both pages of the canonical number
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

	it('queries the whole authenticated shelter, any channel, with exact canonical and legacy values', async () => {
		await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone });
		const queryCalls = mockAdminFetch.mock.calls.filter(([path]) => path.endsWith('/_find'));
		const bodies = queryCalls.map(
			([, init]) =>
				JSON.parse(String(init?.body)) as { selector: Record<string, unknown>; fields: string[] }
		);

		expect(bodies.map(({ selector }) => selector.phone)).toEqual([phone, '+66812345678']);
		for (const { selector, fields } of bodies) {
			expect(selector).not.toHaveProperty('registered_via');
			expect(selector).toMatchObject({
				type: 'evacuee',
				shelter_code: shelterCode
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

	it('never sends an unmasked last name or a phone in a lookup, even for printable members', async () => {
		const person = evacuee(0, { last_name: 'ใจดี' });
		const arriving = evacuee(1, {
			phone: null,
			person_id: { number: '1111111111111' },
			current_stay: { status: 'arriving' }
		});
		const active = evacuee(2, {
			person_id: { number: '2222222222222' },
			current_stay: { status: 'active' }
		});
		setHousehold([person, arriving, active]);

		const result = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'smart-card',
			citizen_id: '1234567890123'
		});

		expect(result.kind).toBe('household');
		if (result.kind !== 'household') return;
		const byId = new Map(result.members.map((member) => [member.evacuee_id, member]));
		expect(byId.get(person._id)).toMatchObject({ last_name: 'ใ****' });
		for (const member of result.members) expect(member).not.toHaveProperty('label');
		const body = JSON.stringify(result);
		expect(body).not.toContain('ใจดี');
		expect(body).not.toContain(phone);
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

	it('makes staff-created household members selectable like any pre-registration', async () => {
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
		expect(result.members[1]).toMatchObject({ selectable: true, status: 'pre_registered' });
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

	it('finds a kiosk walk-in that is already arriving, listed but not selectable', async () => {
		const walkIn = evacuee(0, { registered_via: 'kiosk', current_stay: { status: 'arriving' } });
		setHousehold([walkIn]);
		configureCheckInCouchMocks();
		const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'smart-card',
			citizen_id: '1234567890123'
		});
		expect(outcome).toMatchObject({
			kind: 'household',
			primary_evacuee_id: walkIn._id,
			members: [{ evacuee_id: walkIn._id, status: 'arriving', selectable: false }]
		});
	});

	it('finds a registration from any channel in the shelter', async () => {
		const staffMade = evacuee(0, { registered_via: 'api', current_stay: { status: 'arriving' } });
		evacuees = [staffMade];
		configureCheckInCouchMocks();
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'smart-card',
				citizen_id: '1234567890123'
			})
		).toMatchObject({
			kind: 'household',
			primary_evacuee_id: staffMade._id,
			members: [{ evacuee_id: staffMade._id, status: 'arriving', selectable: false }]
		});
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

describe('lookupPreRegisteredEvacuee CouchDB failures', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAdminFetch.mockRejectedValue(Object.assign(new Error('couch down'), { status: 503 }));
	});

	it.each([
		['qr', { source: 'qr' as const, token: `evacuee:${ids[0]}` }],
		['smart-card', { source: 'smart-card' as const, citizen_id: '1234567890123' }],
		['phone', { source: 'phone' as const, phone }]
	])('maps a %s lookup failure to KioskLookupUnavailableError', async (_label, input) => {
		await expect(lookupPreRegisteredEvacuee(shelterCode, input)).rejects.toBeInstanceOf(
			KioskLookupUnavailableError
		);
	});

	it('maps a household expansion failure to KioskLookupUnavailableError', async () => {
		mockAdminFetch.mockReset();
		mockAdminFetch.mockImplementation(async (path) => {
			if (path.endsWith('/_find')) throw new Error('couch down');
			return {
				_id: `evacuee:${ids[0]}`,
				type: 'evacuee',
				shelter_code: shelterCode,
				registered_via: 'web',
				household_id: `household:${ids[1]}`,
				current_stay: { status: 'pre_registered' }
			} as never;
		});
		await expect(
			lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: `evacuee:${ids[0]}` })
		).rejects.toBeInstanceOf(KioskLookupUnavailableError);
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

	it('offers walk-in registration when the citizen is unknown', async () => {
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, {
				source: 'thaid',
				citizen_id: '1234567890123'
			})
		).toEqual({ kind: 'not_found', can_register: true });
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

describe('lookupPreRegisteredEvacuee unassigned registration queue', () => {
	const registrationUlid = '01ARZ3NDEKTSV4RRFFQ69G5REG';

	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCouchMocks();
	});

	it('shows the whole family of a scanned unassigned ticket with masked last names', async () => {
		respondWithRegistration([queueMember(0), queueMember(1)]);

		const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'qr',
			token: registrationUlid
		});

		expect(outcome).toEqual({
			kind: 'household',
			name_masked: true,
			shelter_code: shelterCode,
			primary_evacuee_id: `evacuee:${ids[0]}`,
			members: [
				{
					evacuee_id: `evacuee:${ids[0]}`,
					first_name: 'สมหญิง0',
					last_name: 'ใ****',
					gender: 'female',
					age: 30,
					status: 'pre_registered',
					is_primary: true,
					selectable: true
				},
				{
					evacuee_id: `evacuee:${ids[1]}`,
					first_name: 'สมหญิง1',
					last_name: 'ใ****',
					gender: 'female',
					age: 31,
					status: 'pre_registered',
					is_primary: false,
					selectable: true
				}
			]
		});
	});

	it.each(['smart-card', 'thaid'] as const)(
		'finds a %s citizen who is only in the queue and makes the matched member primary',
		async (source) => {
			respondWithRegistration([queueMember(0), queueMember(1, { matched: true })]);

			const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
				source,
				citizen_id: '1234567890123'
			});

			expect(outcome).toMatchObject({
				kind: 'household',
				name_masked: true,
				shelter_code: shelterCode,
				primary_evacuee_id: `evacuee:${ids[1]}`
			});
			expect(
				outcome.kind === 'household' && outcome.members.map((m) => [m.evacuee_id, m.is_primary])
			).toEqual([
				[`evacuee:${ids[0]}`, false],
				[`evacuee:${ids[1]}`, true]
			]);
		}
	);

	it('reads a member already claimed into this shelter from CouchDB and keeps only pre_registered selectable', async () => {
		evacuees = [evacuee(1, { current_stay: { status: 'arriving' } })];
		respondWithRegistration([
			queueMember(0),
			queueMember(1, { status: 'claimed', claimed_shelter_code: shelterCode })
		]);

		const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'qr',
			token: registrationUlid
		});

		expect(outcome.kind === 'household' && outcome.members).toMatchObject([
			{ evacuee_id: `evacuee:${ids[0]}`, status: 'pre_registered', selectable: true },
			{
				evacuee_id: `evacuee:${ids[1]}`,
				first_name: 'สมชาย1',
				status: 'arriving',
				selectable: false
			}
		]);
	});

	it('offers a member claimed into this shelter but missing in CouchDB so check-in can repair it', async () => {
		respondWithRegistration([
			queueMember(0, { status: 'claimed', claimed_shelter_code: shelterCode })
		]);

		const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'qr',
			token: registrationUlid
		});

		expect(outcome.kind === 'household' && outcome.members).toMatchObject([
			{ evacuee_id: `evacuee:${ids[0]}`, status: 'pre_registered', selectable: true }
		]);
	});

	it('omits members claimed into another shelter or cancelled', async () => {
		respondWithRegistration([
			queueMember(0, { status: 'claimed', claimed_shelter_code: 'SH999' }),
			queueMember(1, { status: 'cancelled' }),
			queueMember(2)
		]);

		const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
			source: 'qr',
			token: registrationUlid
		});

		expect(outcome).toMatchObject({ kind: 'household', primary_evacuee_id: `evacuee:${ids[2]}` });
		expect(outcome.kind === 'household' && outcome.members.map((m) => m.evacuee_id)).toEqual([
			`evacuee:${ids[2]}`
		]);
	});

	it('is not_found when no member can come into this shelter', async () => {
		respondWithRegistration([queueMember(0, { status: 'cancelled' })]);

		expect(
			await lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: registrationUlid })
		).toEqual({ kind: 'not_found', can_register: false });
	});

	describe('when the central queue is unavailable', () => {
		const failures: Array<[string, () => void]> = [
			['a network error', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
			[
				'a timeout',
				() => fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
			],
			['a 5xx', () => fetchMock.mockResolvedValue(queueResponse(503, { errors: [] }))],
			['an unparseable body', () => fetchMock.mockResolvedValue(queueResponse(200, { nope: 1 }))]
		];

		it.each(failures)('fails open for a smart-card lookup on %s', async (_label, fail) => {
			fail();
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

			expect(
				await lookupPreRegisteredEvacuee(shelterCode, {
					source: 'smart-card',
					citizen_id: '1234567890123'
				})
			).toEqual({ kind: 'not_found', can_register: true });
			expect(JSON.stringify(warn.mock.calls)).not.toContain('1234567890123');
			warn.mockRestore();
		});

		it.each(failures)('fails open for a thaid lookup on %s', async (_label, fail) => {
			fail();
			vi.spyOn(console, 'warn').mockImplementation(() => {});

			expect(
				await lookupPreRegisteredEvacuee(shelterCode, {
					source: 'thaid',
					citizen_id: '1234567890123'
				})
			).toEqual({ kind: 'not_found', can_register: true });
		});

		it.each(failures)('rejects a scanned unassigned ticket on %s', async (_label, fail) => {
			fail();

			await expect(
				lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: registrationUlid })
			).rejects.toBeInstanceOf(KioskLookupUnavailableError);
		});
	});

	it.each(['smart-card', 'thaid'] as const)(
		'never calls the queue when a %s citizen is already in the shelter',
		async (source) => {
			setHousehold([evacuee(0)]);
			respondWithRegistration([queueMember(5)]);

			const outcome = await lookupPreRegisteredEvacuee(shelterCode, {
				source,
				citizen_id: '1234567890123'
			});

			expect(outcome).toMatchObject({ kind: 'household', primary_evacuee_id: `evacuee:${ids[0]}` });
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('never calls the queue for an evacuee qr or the phone gate', async () => {
		setHousehold([evacuee(0)]);
		await lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: `evacuee:${ids[0]}` });
		await lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: `evacuee:${ids[7]}` });
		await lookupPreRegisteredEvacuee(shelterCode, { source: 'phone', phone: '0899999999' });

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('is not_found without a walk-in offer for an unknown unassigned ticket', async () => {
		expect(
			await lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: registrationUlid })
		).toEqual({ kind: 'not_found', can_register: false });
	});

	it('looks the ticket up by registration id with the service secret', async () => {
		respondWithRegistration([queueMember(0)]);
		await lookupPreRegisteredEvacuee(shelterCode, { source: 'qr', token: registrationUlid });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://fastapi.test/public/v1/unassigned-registrations/kiosk-lookup');
		expect(JSON.parse(String(init.body))).toEqual({ registration_id: registrationUlid });
		expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' });
	});
});

describe('checkInSelectedMembers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCheckInCouchMocks();
	});

	it('checks in pre-registered members of any channel in the primary household and refreshes household status', async () => {
		const primary = evacuee(0);
		const member = evacuee(1);
		const apiMember = evacuee(2, { registered_via: 'api' });
		setHousehold([primary, member, apiMember], primary);
		const unrelated = evacuee(3);
		setHousehold([unrelated]);
		const otherShelter = evacuee(4, { shelter_code: 'SH002' });
		setHousehold([otherShelter]);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [
			primary._id,
			member._id,
			apiMember._id,
			unrelated._id,
			otherShelter._id
		]);

		expect(results).toMatchObject([
			{
				evacuee_id: primary._id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: primary._id,
				label: { name: 'สมชาย0 ใจดี', phone }
			},
			{
				evacuee_id: member._id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: member._id,
				label: { name: 'สมชาย1 ใจดี', phone }
			},
			{
				evacuee_id: apiMember._id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: apiMember._id
			},
			{ evacuee_id: unrelated._id, status: 'not_eligible' },
			{ evacuee_id: otherShelter._id, status: 'not_found' }
		]);
		for (const result of results.slice(3)) expect(result).not.toHaveProperty('label');
		expect(primary.current_stay).toMatchObject({ status: 'arriving', zone: null });
		expect(member.current_stay).toMatchObject({ status: 'arriving', zone: null });
		expect(typeof primary.current_stay.since).toBe('string');
		expect(typeof primary.updated_at).toBe('string');

		const evacueeWrites = mockAdminFetch.mock.calls.filter(
			([path, init]) =>
				init?.method === 'PUT' &&
				[primary._id, member._id, apiMember._id].some((id) => path.endsWith(encodeURIComponent(id)))
		);
		expect(evacueeWrites).toHaveLength(3);
		for (const [, init] of evacueeWrites) {
			const body = JSON.parse(String(init?.body)) as FixtureEvacuee;
			expect(body._rev).toBe('1-evacuee');
		}

		const householdWrite = mockAdminFetch.mock.calls.find(
			([path, init]) =>
				path.endsWith(encodeURIComponent(primary.household_id ?? '')) && init?.method === 'PUT'
		);
		expect(householdWrite).toBeDefined();
		const householdBody = JSON.parse(String(householdWrite?.[1]?.body)) as FixtureHousehold;
		expect(householdBody).toMatchObject({ _rev: '1-household', status: 'arriving' });
	});

	it('keeps booking_ref when checking in an api-registered pre_registered member (CR-169 FR-62)', async () => {
		const primary = evacuee(0, { registered_via: 'api', booking_ref: 'BK-01TEST' });
		setHousehold([primary], primary);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [primary._id]);

		expect(results[0]).toMatchObject({ evacuee_id: primary._id, status: 'checked_in' });
		const write = mockAdminFetch.mock.calls.find(
			([path, init]) => init?.method === 'PUT' && path.endsWith(encodeURIComponent(primary._id))
		);
		expect(write).toBeDefined();
		const body = JSON.parse(String(write?.[1]?.body)) as FixtureEvacuee;
		expect(body.booking_ref).toBe('BK-01TEST');
		expect(body.registered_via).toBe('api');
		expect(body.current_stay).toMatchObject({ status: 'arriving' });
	});

	it('returns the label for a reprint of arriving members and none for members past arrival', async () => {
		const primary = evacuee(0, { current_stay: { status: 'arriving' } });
		const active = evacuee(1, { current_stay: { status: 'active' } });
		setHousehold([primary, active], primary);

		const results = await checkInSelectedMembers(shelterCode, primary._id, [
			primary._id,
			active._id
		]);

		expect(results).toEqual([
			{
				evacuee_id: primary._id,
				status: 'already_checked_in',
				stay_status: 'arriving',
				qr_payload: primary._id,
				label: { name: 'สมชาย0 ใจดี', phone }
			},
			{ evacuee_id: active._id, status: 'already_checked_in', stay_status: 'active' }
		]);
		expect(mockAdminFetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
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
				qr_payload: primary._id,
				label: { name: 'สมชาย0 ใจดี', phone }
			}
		]);
		expect(
			mockAdminFetch.mock.calls.filter(([path]) => path.endsWith(encodeURIComponent(primary._id)))
		).toHaveLength(4);
	});
});

describe('checkInSelectedMembers station_log (CR-192)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCheckInCouchMocks();
	});

	it('writes a kiosk Station 1 start + complete per checked-in member', async () => {
		const primary = evacuee(0);
		const member = evacuee(1);
		setHousehold([primary, member], primary);
		const lookupAt = new Date(Date.now() - 90_000).toISOString();

		await checkInSelectedMembers(shelterCode, primary._id, [primary._id, member._id], {
			deviceId: 'kiosk-dev-7',
			lookupAt
		});

		expect(bulkWrites).toHaveLength(4);
		for (const id of [primary._id, member._id]) {
			const mine = bulkWrites.filter((doc) => doc.evacuee_id === id);
			const start = mine.find((doc) => doc.action === 'start');
			const complete = mine.find((doc) => doc.action === 'complete');
			expect(start).toMatchObject({
				type: 'station_log',
				schema_v: 1,
				shelter_code: shelterCode,
				station: 1,
				channel: 'kiosk',
				device_id: 'kiosk-dev-7',
				created_by: 'kiosk:kiosk-dev-7',
				occurred_at: lookupAt
			});
			expect(complete).toMatchObject({
				station: 1,
				channel: 'kiosk',
				device_id: 'kiosk-dev-7',
				created_by: 'kiosk:kiosk-dev-7'
			});
			expect(Date.parse(String(complete?.occurred_at))).toBeGreaterThanOrEqual(
				Date.parse(String(start?.occurred_at))
			);
		}
		expect(bulkWrites.every((doc) => String(doc._id).startsWith('station_log:'))).toBe(true);
	});

	it('uses server time when the lookup time is in the future or older than 2 hours', async () => {
		for (const lookupAt of [
			new Date(Date.now() + 10 * 60_000).toISOString(),
			new Date(Date.now() - 3 * 3_600_000).toISOString(),
			'garbage'
		]) {
			evacuees = [];
			households = [];
			configureCheckInCouchMocks();
			const primary = evacuee(0);
			setHousehold([primary], primary);

			const before = Date.now();
			await checkInSelectedMembers(shelterCode, primary._id, [primary._id], {
				deviceId: 'kiosk-dev-7',
				lookupAt
			});

			const start = bulkWrites.find((doc) => doc.action === 'start');
			expect(Date.parse(String(start?.occurred_at))).toBeGreaterThanOrEqual(before);
			expect(Date.parse(String(start?.occurred_at))).toBeLessThanOrEqual(Date.now());
		}
	});

	it('writes no log without an authenticated device', async () => {
		const primary = evacuee(0);
		setHousehold([primary], primary);
		await checkInSelectedMembers(shelterCode, primary._id, [primary._id]);
		expect(bulkWrites).toHaveLength(0);
	});

	it('only logs members this request reported in, not already-arriving ones', async () => {
		const primary = evacuee(0);
		const arriving = evacuee(1, { current_stay: { status: 'arriving' } });
		setHousehold([primary, arriving], primary);

		await checkInSelectedMembers(shelterCode, primary._id, [primary._id, arriving._id], {
			deviceId: 'kiosk-dev-7'
		});

		expect([...new Set(bulkWrites.map((doc) => doc.evacuee_id))]).toEqual([primary._id]);
	});

	it('keeps the check-in result when the log write fails', async () => {
		const primary = evacuee(0);
		setHousehold([primary], primary);
		failBulk = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const results = await checkInSelectedMembers(shelterCode, primary._id, [primary._id], {
			deviceId: 'kiosk-dev-7'
		});

		expect(results).toMatchObject([{ evacuee_id: primary._id, status: 'checked_in' }]);
		expect(primary.current_stay.status).toBe('arriving');
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('kioskCheckInInputSchema lookup_at', () => {
	const base = {
		primary_evacuee_id: `evacuee:${ids[0]}`,
		evacuee_ids: [`evacuee:${ids[0]}`]
	};

	it('accepts an optional lookup_at and drops a malformed one', () => {
		const at = new Date().toISOString();
		expect(kioskCheckInInputSchema.parse({ ...base, lookup_at: at }).lookup_at).toBe(at);
		expect(kioskCheckInInputSchema.parse(base).lookup_at).toBeUndefined();
		expect(kioskCheckInInputSchema.parse({ ...base, lookup_at: 42 }).lookup_at).toBeUndefined();
	});
});

describe('checkInSelectedMembers kiosk walk-in reprint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		configureCheckInCouchMocks();
	});

	it('returns the QR and label of an arriving kiosk walk-in without writing', async () => {
		const walkIn = evacuee(0, { registered_via: 'kiosk', current_stay: { status: 'arriving' } });
		setHousehold([walkIn]);

		const results = await checkInSelectedMembers(shelterCode, walkIn._id, [walkIn._id]);

		expect(results).toEqual([
			{
				evacuee_id: walkIn._id,
				status: 'already_checked_in',
				stay_status: 'arriving',
				qr_payload: walkIn._id,
				label: { name: 'สมชาย0 ใจดี', phone }
			}
		]);
		expect(mockAdminFetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
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

	it('signals a mismatch when the primary doc does not exist', async () => {
		await expect(
			checkInSelectedMembers(shelterCode, `evacuee:${ids[0]}`, [`evacuee:${ids[0]}`], {
				requiredPrimaryCitizenId: '1234567890123'
			})
		).rejects.toBeInstanceOf(KioskThaidIdentityMismatchError);
		expect(mockAdminFetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
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
				qr_payload: primary._id,
				label: { name: 'สมชาย0 ใจดี', phone }
			}
		]);
	});
});

describe('checkInSelectedMembers kiosk claim of unassigned members', () => {
	const registrationId = '01ARZ3NDEKTSV4RRFFQ69G5REG';
	const reservedHouseholdId = 'household:01ARZ3NDEKTSV4RRFFQ69G5HHH';
	const deviceId = 'kiosk-1';
	const citizenId = '1234567890123';
	const prepareUrl = `http://fastapi.test/public/v1/unassigned-registrations/${registrationId}/kiosk-claim/prepare`;
	const revertUrl = `http://fastapi.test/public/v1/unassigned-registrations/${registrationId}/kiosk-claim/revert`;
	const photoId = 'image:01ARZ3NDEKTSV4RRFFQ69G5IMG';
	const strayPhotoId = 'image:01ARZ3NDEKTSV4RRFFQ69G5IMX';

	type PrepareBody = {
		shelter_code: string;
		device_id: string;
		member_ids: string[];
		required_person_id?: string;
	};

	function preparedImage(imageId: string) {
		return {
			doc: { _id: imageId, type: 'image', schema_v: 1, content_type: 'image/jpeg' },
			full_b64: '/9j/4AAQ',
			thumb_b64: 'UklGRgAA',
			content_type: 'image/jpeg'
		};
	}

	/** What FastAPI `prepare` returns for these members: the born-at-pre_registered Couch docs. */
	function preparedClaim(memberIds: string[], withImages: unknown[] = []) {
		return {
			registration_id: registrationId,
			shelter_code: shelterCode,
			household: {
				_id: reservedHouseholdId,
				type: 'household',
				head_evacuee_id: memberIds[0],
				status: 'pre_registered'
			},
			evacuees: memberIds.map((id) => ({
				...evacuee(ids.indexOf(id.slice('evacuee:'.length)), {
					household_id: reservedHouseholdId,
					registered_via: 'kiosk'
				}),
				_id: id,
				_rev: undefined,
				created_by: `kiosk:${deviceId}`,
				...(id === `evacuee:${ids[0]}` && withImages.length > 0 ? { photo: photoId } : {})
			})),
			images: withImages
		};
	}

	/** Stub the central queue: a registration of `members`; `prepare` defaults to a good claim. */
	function stubQueue(
		members: QueueMember[],
		prepare: (body: PrepareBody) => Response | Promise<Response> = (body) =>
			queueResponse(200, preparedClaim(body.member_ids))
	): void {
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (url.endsWith('/kiosk-lookup')) {
				return queueResponse(200, {
					registration_id: registrationId,
					reserved_household_id: reservedHouseholdId,
					members
				});
			}
			if (url === prepareUrl) return prepare(JSON.parse(String(init?.body)) as PrepareBody);
			if (url === revertUrl) return queueResponse(200, { reverted: [] });
			return queueResponse(404, notFoundBody);
		});
	}

	function queueCalls(url: string): Array<Record<string, unknown>> {
		return fetchMock.mock.calls
			.filter(([calledUrl]) => calledUrl === url)
			.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
	}

	/** Claim-birth docs only; the CR-192 station_log append is its own `_bulk_docs` write. */
	function bulkWrittenDocs(): Array<Record<string, unknown> & { _id: string }> {
		return mockAdminFetch.mock.calls
			.filter(([path]) => path.endsWith('/_bulk_docs'))
			.flatMap(
				([, init]) =>
					JSON.parse(String(init?.body)).docs as Array<Record<string, unknown> & { _id: string }>
			)
			.filter((doc) => doc.type !== 'station_log');
	}

	function putCalls() {
		return mockAdminFetch.mock.calls.filter(([, init]) => init?.method === 'PUT');
	}

	const first = `evacuee:${ids[0]}`;
	const second = `evacuee:${ids[1]}`;

	beforeEach(() => {
		vi.clearAllMocks();
		evacuees = [];
		households = [];
		images = [];
		configureCheckInCouchMocks();
	});

	it('claims the selected open queue members into Couch, then checks them in', async () => {
		stubQueue([queueMember(0), queueMember(1), queueMember(2)]);

		const results = await checkInSelectedMembers(shelterCode, first, [first, second], {
			deviceId
		});

		expect(queueCalls(prepareUrl)).toEqual([
			{ shelter_code: shelterCode, device_id: deviceId, member_ids: [first, second] }
		]);
		expect(
			bulkWrittenDocs()
				.map((doc) => doc._id)
				.sort()
		).toEqual([reservedHouseholdId, first, second].sort());
		expect(results).toMatchObject([
			{ evacuee_id: first, status: 'checked_in', stay_status: 'arriving', qr_payload: first },
			{ evacuee_id: second, status: 'checked_in', stay_status: 'arriving', qr_payload: second }
		]);
	});

	it('times Station 1 for queue members claimed and checked in by the kiosk (CR-192)', async () => {
		stubQueue([queueMember(0), queueMember(1)]);
		const lookupAt = new Date(Date.now() - 60_000).toISOString();

		await checkInSelectedMembers(shelterCode, first, [first, second], { deviceId, lookupAt });

		expect(bulkWrites.map((doc) => [doc.evacuee_id, doc.action]).sort()).toEqual(
			[
				[first, 'start'],
				[first, 'complete'],
				[second, 'start'],
				[second, 'complete']
			].sort()
		);
		expect(bulkWrites.find((doc) => doc.action === 'start')?.occurred_at).toBe(lookupAt);
		expect(bulkWrites.every((doc) => doc.channel === 'kiosk')).toBe(true);
	});

	it('does not rewrite a household that already exists in Couch', async () => {
		households.push({
			_id: reservedHouseholdId,
			_rev: '1-household',
			type: 'household',
			head_evacuee_id: first,
			status: 'pre_registered'
		});
		stubQueue([queueMember(0), queueMember(1)]);

		await checkInSelectedMembers(shelterCode, first, [first, second], { deviceId });

		expect(bulkWrittenDocs().map((doc) => doc._id)).toEqual([first, second]);
	});

	it('writes a photo image doc with inline attachments, only for an evacuee being written', async () => {
		stubQueue([queueMember(0), queueMember(1)], (body) =>
			queueResponse(
				200,
				preparedClaim(body.member_ids, [preparedImage(photoId), preparedImage(strayPhotoId)])
			)
		);

		await checkInSelectedMembers(shelterCode, first, [first, second], { deviceId });

		const written = bulkWrittenDocs();
		expect(written.map((doc) => doc._id)).toContain(photoId);
		expect(written.map((doc) => doc._id)).not.toContain(strayPhotoId);
		expect(written.find((doc) => doc._id === photoId)).toMatchObject({
			type: 'image',
			_attachments: {
				full: { content_type: 'image/jpeg', data: '/9j/4AAQ' },
				thumb: { content_type: 'image/jpeg', data: 'UklGRgAA' }
			}
		});
	});

	it('skips an evacuee already born in Couch, and its freshly minted image, on a repair claim', async () => {
		stubQueue([queueMember(0), queueMember(1)], (body) => {
			// Born by an earlier claim whose response was lost: prepare mints a new image id for it.
			evacuees.push({ ...evacuee(0), _id: first, household_id: reservedHouseholdId } as never);
			return queueResponse(200, preparedClaim(body.member_ids, [preparedImage(photoId)]));
		});

		await checkInSelectedMembers(shelterCode, first, [first, second], { deviceId });

		const written = bulkWrittenDocs().map((doc) => doc._id);
		expect(written).toContain(second);
		expect(written).not.toContain(first);
		expect(written).not.toContain(photoId);
	});

	describe.each([
		['the bulk write throws', 'throw'],
		['a bulk row fails for a reason other than conflict', 'row-error']
	] as const)('when %s', (_label, bulkDocs) => {
		it('reverts the claim, fails, and checks nobody in', async () => {
			configureCheckInCouchMocks({ bulkDocs });
			stubQueue([queueMember(0), queueMember(1)]);

			await expect(
				checkInSelectedMembers(shelterCode, first, [first, second], { deviceId })
			).rejects.toBeInstanceOf(KioskUnassignedClaimFailedError);

			expect(queueCalls(revertUrl)).toEqual([
				{ shelter_code: shelterCode, device_id: deviceId, member_ids: [first, second] }
			]);
			expect(putCalls()).toHaveLength(0);
		});
	});

	it('reverts only the members Couch did not take when the bulk write partly fails', async () => {
		configureCheckInCouchMocks({ bulkRowErrorIds: [second] });
		stubQueue([queueMember(0), queueMember(1)]);

		await expect(
			checkInSelectedMembers(shelterCode, first, [first, second], { deviceId })
		).rejects.toBeInstanceOf(KioskUnassignedClaimFailedError);

		expect(queueCalls(revertUrl)).toEqual([
			{ shelter_code: shelterCode, device_id: deviceId, member_ids: [second] }
		]);
		expect(putCalls()).toHaveLength(0);
	});

	it('reverts nobody when every evacuee was born and only an image row failed', async () => {
		configureCheckInCouchMocks({ bulkRowErrorIds: [photoId] });
		stubQueue([queueMember(0), queueMember(1)], (body) =>
			queueResponse(200, preparedClaim(body.member_ids, [preparedImage(photoId)]))
		);

		await expect(
			checkInSelectedMembers(shelterCode, first, [first, second], { deviceId })
		).rejects.toBeInstanceOf(KioskUnassignedClaimFailedError);

		expect(queueCalls(revertUrl)).toEqual([]);
	});

	it('finds the registration from a later missing member when the first is not queued', async () => {
		const lookupUrl = 'http://fastapi.test/public/v1/unassigned-registrations/kiosk-lookup';
		stubQueue([queueMember(0), queueMember(1)]);
		const queued = fetchMock.getMockImplementation()!;
		const stray = `evacuee:${ids[5]}`;
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (url === lookupUrl && JSON.parse(String(init?.body)).evacuee_id === stray) {
				return queueResponse(404, notFoundBody);
			}
			return queued(url, init);
		});

		await checkInSelectedMembers(shelterCode, first, [stray, first], { deviceId });

		expect(queueCalls(prepareUrl)).toMatchObject([{ member_ids: [first] }]);
	});

	describe('when the primary is already in Couch', () => {
		it('claims nobody when that primary cannot check in here', async () => {
			const primary = evacuee(0, { shelter_code: 'SH999' });
			setHousehold([primary], primary);
			stubQueue([queueMember(0), queueMember(1)]);

			const results = await checkInSelectedMembers(shelterCode, primary._id, [second], {
				deviceId
			});

			expect(results).toMatchObject([{ evacuee_id: second, status: 'not_eligible' }]);
			expect(queueCalls(prepareUrl)).toEqual([]);
			expect(bulkWrittenDocs()).toEqual([]);
		});

		it('claims nobody when the thaid citizen is not that primary', async () => {
			const primary = evacuee(0, { person_id: { number: '9999999999999' } });
			setHousehold([primary], primary);
			stubQueue([queueMember(0), queueMember(1)]);

			await expect(
				checkInSelectedMembers(shelterCode, primary._id, [second], {
					deviceId,
					requiredPrimaryCitizenId: citizenId
				})
			).rejects.toBeInstanceOf(KioskThaidIdentityMismatchError);

			expect(queueCalls(prepareUrl)).toEqual([]);
			expect(bulkWrittenDocs()).toEqual([]);
		});
	});

	it('treats a bulk conflict as already born and carries on to check-in', async () => {
		configureCheckInCouchMocks({ bulkDocs: 'conflict' });
		stubQueue([queueMember(0), queueMember(1)]);

		const results = await checkInSelectedMembers(shelterCode, first, [first, second], {
			deviceId
		});

		expect(results.map((result) => result.status)).toEqual(['checked_in', 'checked_in']);
		expect(queueCalls(revertUrl)).toEqual([]);
	});

	it('does not claim when another shelter or device got the member first', async () => {
		stubQueue([queueMember(0), queueMember(1)], () =>
			queueResponse(409, { errors: [{ error: { code: 'ALREADY_CLAIMED' } }] })
		);

		await expect(
			checkInSelectedMembers(shelterCode, first, [first, second], { deviceId })
		).rejects.toBeInstanceOf(KioskUnassignedClaimConflictError);

		expect(bulkWrittenDocs()).toEqual([]);
		expect(putCalls()).toHaveLength(0);
	});

	it('reverts and reports the queue unavailable when prepare fails after the request was sent', async () => {
		stubQueue([queueMember(0), queueMember(1)], () => {
			throw new TypeError('fetch failed');
		});

		await expect(
			checkInSelectedMembers(shelterCode, first, [first, second], { deviceId })
		).rejects.toBeInstanceOf(KioskUnassignedUnavailableError);

		expect(queueCalls(revertUrl)).toEqual([
			{ shelter_code: shelterCode, device_id: deviceId, member_ids: [first, second] }
		]);
		expect(bulkWrittenDocs()).toEqual([]);
		expect(putCalls()).toHaveLength(0);
	});

	it('maps a person mismatch on a thaid check-in to the thaid identity mismatch', async () => {
		stubQueue([queueMember(0)], () =>
			queueResponse(403, { errors: [{ error: { code: 'PERSON_MISMATCH' } }] })
		);

		await expect(
			checkInSelectedMembers(shelterCode, first, [first], {
				deviceId,
				requiredPrimaryCitizenId: citizenId
			})
		).rejects.toBeInstanceOf(KioskThaidIdentityMismatchError);

		expect(queueCalls(prepareUrl)).toMatchObject([{ required_person_id: citizenId }]);
		expect(bulkWrittenDocs()).toEqual([]);
	});

	it('asks the queue to verify the smart-card citizen via claimPersonId', async () => {
		stubQueue([queueMember(0)]);

		await checkInSelectedMembers(shelterCode, first, [first], {
			deviceId,
			claimPersonId: citizenId
		});

		expect(queueCalls(prepareUrl)).toMatchObject([{ required_person_id: citizenId }]);
	});

	describe('when the primary is not selected and not in Couch (FR-KUC-07a)', () => {
		it('leaves the primary open and checks in the selected members under a stand-in', async () => {
			stubQueue([queueMember(0), queueMember(1), queueMember(2)]);

			const results = await checkInSelectedMembers(shelterCode, first, [second], { deviceId });

			expect(queueCalls(prepareUrl)).toMatchObject([{ member_ids: [second] }]);
			expect(results).toMatchObject([{ evacuee_id: second, status: 'checked_in' }]);
		});

		it('verifies the thaid citizen is that primary in the queue', async () => {
			stubQueue([queueMember(0, { matched: true }), queueMember(1)]);

			const results = await checkInSelectedMembers(shelterCode, first, [second], {
				deviceId,
				requiredPrimaryCitizenId: citizenId
			});

			expect(
				queueCalls('http://fastapi.test/public/v1/unassigned-registrations/kiosk-lookup')
			).toContainEqual({
				citizen_id: citizenId
			});
			expect(results).toMatchObject([{ evacuee_id: second, status: 'checked_in' }]);
		});

		it('rejects a thaid citizen who is not that primary', async () => {
			stubQueue([queueMember(0), queueMember(1, { matched: true })]);

			await expect(
				checkInSelectedMembers(shelterCode, first, [second], {
					deviceId,
					requiredPrimaryCitizenId: citizenId
				})
			).rejects.toBeInstanceOf(KioskThaidIdentityMismatchError);

			expect(putCalls()).toHaveLength(0);
		});

		it('checks nobody in when the primary is not on the queue registration', async () => {
			stubQueue([queueMember(1), queueMember(2)]);

			const results = await checkInSelectedMembers(shelterCode, first, [second], { deviceId });

			expect(results).toMatchObject([{ evacuee_id: second, status: 'not_eligible' }]);
			expect(putCalls()).toHaveLength(0);
		});
	});

	it('never calls the queue when every selected member is already in Couch', async () => {
		const primary = evacuee(0);
		const member = evacuee(1);
		setHousehold([primary, member], primary);
		stubQueue([queueMember(0), queueMember(1)]);

		const results = await checkInSelectedMembers(
			shelterCode,
			primary._id,
			[primary._id, member._id],
			{
				deviceId
			}
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(results.map((result) => result.status)).toEqual(['checked_in', 'checked_in']);
	});

	it('never calls the queue without a device id, even when members are missing', async () => {
		stubQueue([queueMember(0), queueMember(1)]);

		const results = await checkInSelectedMembers(shelterCode, first, [first, second]);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(results.map((result) => result.status)).toEqual(['not_eligible', 'not_eligible']);
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

describe('kioskGateInputSchema qr', () => {
	it('accepts an evacuee id or a bare ULID (unassigned ticket), case-insensitively', () => {
		for (const token of [`evacuee:${ids[0]}`, ids[0], ids[0].toLowerCase()]) {
			expect(kioskGateInputSchema.safeParse({ source: 'qr', token })).toEqual({
				success: true,
				data: { source: 'qr', token }
			});
		}
	});

	it('rejects garbage qr tokens', () => {
		for (const token of [
			'',
			'hello',
			ids[0].slice(1),
			`${ids[0]}X`,
			'U1ARZ3NDEKTSV4RRFFQ69G5FAV',
			'81ARZ3NDEKTSV4RRFFQ69G5FAV',
			`household:${ids[0]}`,
			`evacuee:${ids[0]}x`
		]) {
			expect(kioskGateInputSchema.safeParse({ source: 'qr', token }).success).toBe(false);
		}
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
