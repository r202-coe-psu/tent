import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	adminRaw: vi.fn(),
	readEffectiveMasterDoc: vi.fn()
}));

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: mocks.adminRaw
}));
vi.mock('$lib/server/master-data-server', () => ({
	readEffectiveMasterDoc: mocks.readEffectiveMasterDoc
}));

import { findCrossShelterVerifications } from './cross-shelter-verification';

type Doc = Record<string, unknown>;

const SM02 = { name: 'sm02', roles: ['shelter:SH002', 'SH002:shelter_manager'] };
const MEDICAL = '01MASTERMEDICAL';
const FIRST_AID = '01MASTERFIRSTAID';
const DRIVING = '01MASTERDRIVING';
const HASHES = { phone_hash: 'ph-1', national_id_hash: 'nid-1' };
const VERIFIED_AT = '2026-10-30T02:00:00.000Z';

/** `shelter_shXXX` → docs; `registry` → shelter docs. A DB absent from the map answers 404. */
let dbs: Record<string, Doc[]>;
let failing: Set<string>;
let registryStatus: number;
let audits: Doc[];

const own = (over: Doc = {}): Doc => ({
	_id: 'volunteer:own',
	type: 'volunteer',
	shelter_code: 'SH002',
	status: 'active',
	skills: [MEDICAL, FIRST_AID, DRIVING],
	identity_verified: false,
	identity_verification: { status: 'pending' },
	skill_verifications: {},
	...HASHES,
	...over
});

const source = (over: Doc = {}): Doc => ({
	_id: 'volunteer:src',
	type: 'volunteer',
	status: 'active',
	first_name: 'สมชาย',
	phone: '0812345678',
	national_id: '1234567890123',
	identity_verified: true,
	identity_verification: {
		status: 'verified',
		reviewed_at: VERIFIED_AT,
		reviewed_by: 'sm01',
		notes: 'ตรวจบัตร',
		credential_reference: 'x'
	},
	skill_verifications: {
		[MEDICAL]: {
			status: 'verified',
			reviewed_at: VERIFIED_AT,
			reviewed_by: 'sm01',
			credential_reference: 'ว.123'
		}
	},
	...HASHES,
	...over
});

const shelter = (code: string, over: Doc = {}): Doc => ({
	_id: `shelter:${code}`,
	type: 'shelter',
	code,
	name: `ศูนย์ ${code}`,
	...over
});

function matchesSelector(doc: Doc, selector: Doc): boolean {
	return Object.entries(selector).every(([key, value]) => doc[key] === value);
}

beforeEach(() => {
	vi.clearAllMocks();
	failing = new Set();
	registryStatus = 200;
	audits = [];
	dbs = {
		registry: [shelter('SH001'), shelter('SH002'), shelter('SH003')],
		shelter_sh001: [source()],
		shelter_sh002: [own()],
		shelter_sh003: []
	};
	mocks.readEffectiveMasterDoc.mockResolvedValue({
		items: [
			{ code: MEDICAL, label_th: 'การแพทย์', label_en: 'Medical', category: 'controlled' },
			{ code: FIRST_AID, label_th: 'ปฐมพยาบาล', label_en: 'First aid', category: 'controlled' },
			{ code: DRIVING, label_th: 'ขับรถ', label_en: 'Driving', category: 'general' }
		]
	});
	mocks.adminRaw.mockImplementation(async (path: string, method = 'GET', body?: Doc) => {
		const [, db, rest] = path.split('?')[0].split('/');
		if (db === 'registry') {
			return registryStatus === 200
				? { status: 200, data: { rows: dbs.registry.map((doc) => ({ doc })) } }
				: { status: registryStatus, data: { error: 'boom' } };
		}
		if (failing.has(db)) return { status: 500, data: { error: 'boom' } };
		if (!(db in dbs))
			return { status: 404, data: { error: 'not_found', reason: 'Database does not exist.' } };
		if (method === 'PUT') {
			audits.push(body as Doc);
			return { status: 201, data: { ok: true } };
		}
		if (method === 'POST' && rest === '_find') {
			const { selector, fields } = body as { selector: Doc; fields: string[] };
			const docs = dbs[db]
				.filter((doc) => matchesSelector(doc, selector))
				.map((doc) => Object.fromEntries(fields.filter((f) => f in doc).map((f) => [f, doc[f]])));
			return { status: 200, data: { docs } };
		}
		const doc = dbs[db].find((d) => d._id === decodeURIComponent(rest));
		return doc ? { status: 200, data: doc } : { status: 404, data: { error: 'not_found' } };
	});
});

const find = (
	caller = SM02,
	input: { shelter_code?: unknown; volunteer_id?: unknown } = {
		shelter_code: 'SH002',
		volunteer_id: 'volunteer:own'
	}
) =>
	findCrossShelterVerifications(caller, input as { shelter_code: unknown; volunteer_id: unknown });

describe('findCrossShelterVerifications (CR-228)', () => {
	it('answers only the fields of FR-4 for a shelter where both hashes match', async () => {
		await expect(find()).resolves.toEqual({
			matches: [
				{
					shelter_code: 'SH001',
					shelter_name: 'ศูนย์ SH001',
					identity: { reviewed_at: VERIFIED_AT },
					skills: [{ code: MEDICAL, reviewed_at: VERIFIED_AT }]
				}
			]
		});
	});

	it('does not match on the phone alone, nor when this profile lacks a hash (FR-3)', async () => {
		dbs.shelter_sh001 = [source({ national_id_hash: 'nid-other' })];
		expect((await find()).matches).toEqual([]);

		dbs.shelter_sh001 = [source()];
		dbs.shelter_sh002 = [own({ national_id_hash: null })];
		expect((await find()).matches).toEqual([]);
		dbs.shelter_sh002 = [own({ phone_hash: null })];
		expect((await find()).matches).toEqual([]);
	});

	it('skips an inactive source profile, and answers nothing for an inactive profile here (FR-3)', async () => {
		dbs.shelter_sh001 = [source({ status: 'inactive' })];
		expect((await find()).matches).toEqual([]);

		dbs.shelter_sh001 = [source()];
		dbs.shelter_sh002 = [own({ status: 'inactive' })];
		expect((await find()).matches).toEqual([]);
	});

	it('never passes on a result another shelter itself accepted (FR-15, AC-12)', async () => {
		const accepted = { shelter_code: 'SH001', verified_at: VERIFIED_AT };
		dbs.shelter_sh001 = [];
		dbs.shelter_sh003 = [
			source({
				identity_verification: {
					status: 'verified',
					reviewed_at: VERIFIED_AT,
					accepted_from: accepted
				},
				skill_verifications: {
					[MEDICAL]: { status: 'verified', reviewed_at: VERIFIED_AT, accepted_from: accepted }
				}
			})
		];
		expect((await find()).matches).toEqual([]);
	});

	it('keeps only controlled skills this profile asks for and has not decided (FR-5, AC-7)', async () => {
		dbs.shelter_sh001 = [
			source({
				skill_verifications: {
					[MEDICAL]: { status: 'verified', reviewed_at: VERIFIED_AT },
					[FIRST_AID]: { status: 'verified', reviewed_at: VERIFIED_AT },
					[DRIVING]: { status: 'verified', reviewed_at: VERIFIED_AT },
					'01MASTERNOTASKED': { status: 'verified', reviewed_at: VERIFIED_AT }
				}
			})
		];
		dbs.shelter_sh002 = [own({ skill_verifications: { [FIRST_AID]: { status: 'rejected' } } })];
		expect((await find()).matches[0].skills).toEqual([{ code: MEDICAL, reviewed_at: VERIFIED_AT }]);

		dbs.shelter_sh002 = [own({ skill_verifications: { [MEDICAL]: { status: 'verified' } } })];
		expect((await find()).matches[0].skills.map((s) => s.code)).toEqual([FIRST_AID]);
	});

	it('leaves identity out once this shelter verified or rejected it (FR-4, Q2)', async () => {
		for (const status of ['verified', 'rejected']) {
			dbs.shelter_sh002 = [own({ identity_verification: { status } })];
			const [match] = (await find()).matches;
			expect(match.identity).toBeNull();
			expect(match.skills).toHaveLength(1);
		}
	});

	it('answers a null date when the source kept none, and counts a legacy flag-only check', async () => {
		dbs.shelter_sh001 = [
			source({ identity_verification: { status: 'verified' }, skill_verifications: {} })
		];
		expect((await find()).matches[0].identity).toEqual({ reviewed_at: null });

		dbs.shelter_sh001 = [
			source({ identity_verified: true, identity_verification: null, skill_verifications: {} })
		];
		expect((await find()).matches[0].identity).toEqual({ reviewed_at: null });
	});

	it('searches closed shelters too, one line per shelter (FR-2, FR-13, AC-13)', async () => {
		dbs.registry = [
			shelter('SH001', { operation_status: 'closed' }),
			shelter('SH002'),
			shelter('SH003')
		];
		dbs.shelter_sh003 = [source({ skill_verifications: {} })];
		expect((await find()).matches.map((m) => m.shelter_code)).toEqual(['SH001', 'SH003']);
	});

	it('skips a shelter whose database is gone (AC-10)', async () => {
		delete dbs.shelter_sh003;
		expect((await find()).matches.map((m) => m.shelter_code)).toEqual(['SH001']);
		expect(audits[0].context).toMatchObject({ shelters_searched: 1 });
	});

	it('answers 503 instead of a partial result when the registry or a shelter fails (FR-12)', async () => {
		registryStatus = 500;
		await expect(find()).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });

		registryStatus = 200;
		failing.add('shelter_sh003');
		await expect(find()).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
		expect(audits).toEqual([]);
	});

	it('refuses other roles (403) and missing input (422) before reading anything (FR-1)', async () => {
		await expect(
			find({ name: 'reg', roles: ['shelter:SH002', 'SH002:registration_staff'] })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(
			find({ name: 'vc1', roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(find(SM02, { shelter_code: 'SH002' })).rejects.toMatchObject({
			code: 'VALIDATION'
		});
		await expect(find(SM02, { volunteer_id: 'volunteer:own' })).rejects.toMatchObject({
			code: 'VALIDATION'
		});
		expect(mocks.adminRaw).not.toHaveBeenCalled();
		expect(audits).toEqual([]);
	});

	it('answers 404 for a profile that is not in the shelter', async () => {
		await expect(
			find(SM02, { shelter_code: 'SH002', volunteer_id: 'volunteer:missing' })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('audits every completed search in the asking shelter, without the other side (FR-16)', async () => {
		await find();
		dbs.shelter_sh001 = [];
		await find();
		expect(audits).toHaveLength(2);
		expect(audits[0]).toMatchObject({
			type: 'audit',
			shelter_code: 'SH002',
			action: 'other',
			reason: 'cross_shelter_verification.search',
			target_type: 'volunteer',
			target_id: 'volunteer:own',
			context: { actor: 'sm02', shelter_code: 'SH002', match_count: 1, shelters_searched: 2 }
		});
		expect(audits[1].context).toMatchObject({ match_count: 0 });
		const written = JSON.stringify(audits);
		for (const secret of ['volunteer:src', 'ph-1', 'nid-1', 'สมชาย', 'sm01']) {
			expect(written).not.toContain(secret);
		}
	});
});
