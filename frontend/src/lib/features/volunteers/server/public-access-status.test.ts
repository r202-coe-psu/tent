import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	find: vi.fn(),
	admin: vi.fn(),
	users: new Map<string, Record<string, unknown>>(),
	/** shelter db → volunteer profile docs the public writer can read */
	profiles: new Map<string, Record<string, unknown>[]>(),
	/** shelter db → grant-ending audit docs */
	audits: new Map<string, Record<string, unknown>[]>()
}));

vi.mock('$lib/db/hash', () => ({
	sha256Hex: vi.fn(async (value: string) => `${value}-hash`)
}));
vi.mock('$lib/server/couch-public-writer', () => ({
	findAsPublicWriter: state.find,
	getAsPublicWriter: vi.fn(),
	putAsPublicWriter: vi.fn()
}));
vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: state.admin
}));

import { accountStanding, readPublicAccessStatus } from './public-access-status';
import { PublicScheduleError } from './public-schedule-action';

/** The moment the tests run at; grants are expired or live relative to it. */
const NOW = Date.parse('2026-11-03T05:00:00.000Z');

const EMAIL_A = 'somchai.secret@example.org';
const EMAIL_B = 'somying.secret@example.org';
const ISSUER = 'coordinator.issuer@example.org';

function profile(id: string, userName: string | null, extra: Record<string, unknown> = {}) {
	return {
		_id: id,
		type: 'volunteer',
		phone_hash: '0812345678-hash',
		user_name: userName,
		...extra
	};
}

function account(
	name: string,
	volunteerId: string,
	over: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		_id: `org.couchdb.user:${name}`,
		name,
		type: 'user',
		personnel_type: 'volunteer',
		volunteer_id: volunteerId,
		active: true,
		roles: [],
		role_grants: [],
		// What a real `_users` doc carries: the public path must never read these.
		password_scheme: 'pbkdf2',
		derived_key: 'DERIVED-KEY-SECRET',
		salt: 'SALT-SECRET',
		...over
	};
}

const grant = (shelter: string, role: string, expires_at: string) => ({
	shelter_code: shelter,
	role,
	expires_at,
	granted_by: ISSUER,
	granted_at: '2026-10-30T00:00:00.000Z'
});

let auditFails = false;
const auditReads = () =>
	state.admin.mock.calls.filter(
		([path]) => String(path).startsWith('/shelter_') && String(path).endsWith('/_find')
	).length;

beforeEach(() => {
	auditFails = false;
	state.find.mockReset();
	state.admin.mockReset();
	state.users.clear();
	state.profiles.clear();
	state.audits.clear();
	state.profiles.set('shelter_sh001', [profile('volunteer:A1', null)]);

	state.admin.mockImplementation(async (path: string, _method: string, body?: unknown) => {
		if (path.startsWith('/registry/_all_docs')) {
			return {
				status: 200,
				data: {
					rows: [
						{ doc: { type: 'shelter', code: 'SH001', name: 'ศูนย์หลัก' } },
						{ doc: { type: 'shelter', code: 'SH002', name: 'ศูนย์สอง' } }
					]
				}
			};
		}
		if (path === '/_users/_find') {
			const { selector, fields } = body as {
				selector: { _id: { $in: string[] } };
				fields: string[];
			};
			// Mirror `fields`: a field that is not asked for never comes back.
			const docs = selector._id.$in.flatMap((id) => {
				const doc = state.users.get(id);
				return doc
					? [Object.fromEntries(fields.filter((f) => f in doc).map((f) => [f, doc[f]]))]
					: [];
			});
			return { status: 200, data: { docs } };
		}
		if (path.endsWith('/_find')) {
			if (auditFails) return { status: 500, data: { error: 'boom' } };
			const db = path.split('/')[1];
			const { $in: targets } = (body as { selector: { target_id: { $in: string[] } } }).selector
				.target_id;
			return {
				status: 200,
				data: {
					docs: (state.audits.get(db) ?? []).filter((a) => targets.includes(a.target_id as string))
				}
			};
		}
		throw new Error(`unexpected admin call ${path}`);
	});
	state.find.mockImplementation(async (db: string, selector: Record<string, unknown>) => {
		if (selector.type === 'volunteer' && '_id' in selector) {
			const ids = (selector._id as { $in: string[] }).$in;
			const docs = (state.profiles.get(db) ?? []).filter((doc) => ids.includes(doc._id as string));
			// Mirror `fields: ['_id', 'user_name']`: nothing else is read.
			return {
				status: 200,
				data: { docs: docs.map((doc) => ({ _id: doc._id, user_name: doc.user_name })) }
			};
		}
		if (selector.type === 'volunteer') {
			return { status: 200, data: { docs: state.profiles.get(db) ?? [] } };
		}
		return { status: 200, data: { docs: [] } };
	});
});

function link(shelterDb: string, volunteerId: string, email: string, over = {}) {
	const profiles = state.profiles.get(shelterDb) ?? [];
	state.profiles.set(
		shelterDb,
		profiles.map((p) => (p._id === volunteerId ? { ...p, user_name: email } : p))
	);
	state.users.set(`org.couchdb.user:${email}`, account(email, volunteerId, over));
}

const phone = { phone: '0812345678' };

describe('readPublicAccessStatus — status per shelter', () => {
	it('is none when the profile has no linked account', async () => {
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access).toEqual([
			{
				shelter_code: 'SH001',
				shelter_name: 'ศูนย์หลัก',
				status: 'none',
				role_label: null,
				expires_at: null
			}
		]);
	});

	it('is none when user_name names no account', async () => {
		state.profiles.set('shelter_sh001', [profile('volunteer:A1', EMAIL_A)]);
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0].status).toBe('none');
	});

	it('is active with the role label and end date for a grant', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('SH001', 'kitchen_staff', '2026-11-05T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0]).toMatchObject({
			status: 'active',
			role_label: 'เจ้าหน้าที่ครัว',
			expires_at: '2026-11-05T16:59:59.999Z'
		});
	});

	it('is active with no date for a permanent role', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0]).toMatchObject({ status: 'active', expires_at: null });
		expect(access[0].role_label).toBeTruthy();
	});

	it('is lapsed, not active, when every grant has passed its expiry but the worker has not swept it', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('SH001', 'kitchen_staff', '2026-11-02T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		// Dated by the grant that ended; no audit read was needed.
		expect(access[0]).toMatchObject({
			status: 'lapsed',
			role_label: null,
			expires_at: '2026-11-02T16:59:59.999Z'
		});
		expect(auditReads()).toBe(0);
	});

	it('is lapsed when the account holds nothing in this shelter', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			// A role in another shelter does not count here.
			roles: ['shelter:SH002', 'SH002:kitchen_staff'],
			role_grants: [grant('SH002', 'kitchen_staff', '2026-11-05T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0]).toMatchObject({ status: 'lapsed', role_label: null, expires_at: null });
	});

	it('words the lapsed date for every reason a grant can end (expired, revoked, verification lapsed)', async () => {
		for (const reason of [
			'role_grant.expired',
			'role_grant.revoked',
			'role_grant.verification_revoked'
		]) {
			state.audits.clear();
			link('shelter_sh001', 'volunteer:A1', EMAIL_A);
			state.audits.set('shelter_sh001', [
				{
					type: 'audit',
					target_id: `org.couchdb.user:${EMAIL_A}`,
					reason,
					created_at: '2026-11-01T17:00:00.000Z',
					context: { role: 'kitchen_staff', actor: 'coord' }
				}
			]);
			const { access } = await readPublicAccessStatus(phone, NOW);
			expect(access[0]).toMatchObject({ status: 'lapsed', expires_at: '2026-11-01T17:00:00.000Z' });
		}
	});

	it('keeps the card when the audit read fails: lapsed with no date', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A);
		auditFails = true;
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0]).toMatchObject({ status: 'lapsed', role_label: null, expires_at: null });
	});

	it('says since when a lapsed account has had no access, still without the account name', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A);
		state.audits.set('shelter_sh001', [
			{
				type: 'audit',
				target_id: `org.couchdb.user:${EMAIL_A}`,
				reason: 'role_grant.expired',
				created_at: '2026-11-01T17:00:00.000Z',
				context: { role: 'kitchen_staff', actor: 'worker' }
			}
		]);
		const result = await readPublicAccessStatus(phone, NOW);
		expect(result.access[0]).toEqual({
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์หลัก',
			status: 'lapsed',
			role_label: null,
			expires_at: '2026-11-01T17:00:00.000Z'
		});
		expect(JSON.stringify(result)).not.toContain(EMAIL_A);
		expect(JSON.stringify(result)).not.toContain('worker');
	});

	it('answers a suspended account exactly like no account: none, no role, no date', async () => {
		const none = (await readPublicAccessStatus(phone, NOW)).access[0];

		// Suspended while it still holds a live grant, a permanent role and an audit trail.
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			active: false,
			roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:warehouse_staff'],
			role_grants: [grant('SH001', 'warehouse_staff', '2026-11-05T16:59:59.999Z')]
		});
		state.audits.set('shelter_sh001', [
			{
				type: 'audit',
				target_id: `org.couchdb.user:${EMAIL_A}`,
				reason: 'role_grant.expired',
				created_at: '2026-11-01T17:00:00.000Z'
			}
		]);
		const suspended = (await readPublicAccessStatus(phone, NOW)).access[0];

		expect(suspended).toEqual(none);
		expect(suspended).toEqual({
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์หลัก',
			status: 'none',
			role_label: null,
			expires_at: null
		});
		expect(JSON.stringify(suspended)).not.toContain('disabled');
	});

	it('does not let a suspended account hide the live access of another profile in the shelter', async () => {
		state.profiles.set('shelter_sh001', [
			profile('volunteer:A1', EMAIL_A),
			profile('volunteer:A2', EMAIL_B)
		]);
		state.users.set(
			`org.couchdb.user:${EMAIL_A}`,
			account(EMAIL_A, 'volunteer:A1', {
				active: false,
				roles: ['shelter:SH001', 'SH001:kitchen_staff']
			})
		);
		state.users.set(
			`org.couchdb.user:${EMAIL_B}`,
			account(EMAIL_B, 'volunteer:A2', { roles: ['shelter:SH001', 'SH001:warehouse_staff'] })
		);
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0]).toMatchObject({ status: 'active', role_label: 'เจ้าหน้าที่คลัง' });
	});

	it('answers one row per shelter with a profile, sorted by code', async () => {
		state.profiles.set('shelter_sh002', [profile('volunteer:B1', null)]);
		link('shelter_sh002', 'volunteer:B1', EMAIL_B, {
			roles: ['shelter:SH002', 'SH002:warehouse_staff'],
			role_grants: [grant('SH002', 'warehouse_staff', '2026-11-04T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access.map((row) => [row.shelter_code, row.status])).toEqual([
			['SH001', 'none'],
			['SH002', 'active']
		]);
	});

	it('answers an empty list when the credential opens no profile', async () => {
		state.profiles.clear();
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access).toEqual([]);
	});
});

describe('readPublicAccessStatus — one role shown among several', () => {
	it('shows the grant that ends last', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:warehouse_staff'],
			role_grants: [
				grant('SH001', 'kitchen_staff', '2026-11-03T16:59:59.999Z'),
				grant('SH001', 'warehouse_staff', '2026-11-06T16:59:59.999Z')
			]
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0].expires_at).toBe('2026-11-06T16:59:59.999Z');
		expect(access[0].role_label).toBe('เจ้าหน้าที่คลัง');
	});

	it('lets a permanent role take precedence over a grant', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:warehouse_staff'],
			// kitchen_staff has no grant: a manager gave it.
			role_grants: [grant('SH001', 'warehouse_staff', '2026-11-06T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0]).toMatchObject({ status: 'active', expires_at: null });
		expect(access[0].role_label).toBe('เจ้าหน้าที่ครัว');
	});
});

describe('accountStanding — only grants still in force count', () => {
	const base = {
		volunteer_id: 'volunteer:A1',
		name: EMAIL_A,
		active: true,
		permanent_roles: [] as string[]
	};
	const g = (role: string, expires_at: string) => ({ role, expires_at, granted_by: ISSUER });

	it('is lapsed, dated by the newest one, when every grant has expired', () => {
		expect(
			accountStanding(
				{
					...base,
					grants: [
						g('kitchen_staff', '2026-11-01T16:59:59.999Z'),
						g('warehouse_staff', '2026-11-02T16:59:59.999Z')
					]
				},
				NOW
			)
		).toEqual({ status: 'lapsed', role_label: null, expires_at: '2026-11-02T16:59:59.999Z' });
	});

	it('is active with the live grant when an expired one sits beside it', () => {
		expect(
			accountStanding(
				{
					...base,
					grants: [
						g('kitchen_staff', '2026-11-01T16:59:59.999Z'),
						g('warehouse_staff', '2026-11-05T16:59:59.999Z')
					]
				},
				NOW
			)
		).toEqual({
			status: 'active',
			role_label: 'เจ้าหน้าที่คลัง',
			expires_at: '2026-11-05T16:59:59.999Z'
		});
	});

	it('is active and permanent when an expired grant sits beside a permanent role', () => {
		expect(
			accountStanding(
				{
					...base,
					permanent_roles: ['kitchen_staff'],
					grants: [g('warehouse_staff', '2026-11-01T16:59:59.999Z')]
				},
				NOW
			)
		).toEqual({ status: 'active', role_label: 'เจ้าหน้าที่ครัว', expires_at: null });
	});

	it('counts a grant ending exactly now as ended', () => {
		expect(
			accountStanding({ ...base, grants: [g('kitchen_staff', new Date(NOW).toISOString())] }, NOW)
				.status
		).toBe('lapsed');
	});

	it('shows the same permanent role whatever order they are listed in', () => {
		const roles = ['warehouse_staff', 'kitchen_staff'];
		const forward = accountStanding({ ...base, permanent_roles: roles, grants: [] }, NOW);
		const backward = accountStanding(
			{ ...base, permanent_roles: [...roles].reverse(), grants: [] },
			NOW
		);
		expect(forward).toEqual(backward);
		expect(forward.role_label).toBe('เจ้าหน้าที่ครัว');
	});
});

describe('readPublicAccessStatus — two-way link (CR-221 FR-7)', () => {
	it('ignores an account whose volunteer_id is another profile', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			volunteer_id: 'volunteer:OTHER',
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0].status).toBe('none');
	});

	it('ignores a staff account that a profile user_name happens to name', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			personnel_type: 'staff',
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		const { access } = await readPublicAccessStatus(phone, NOW);
		expect(access[0].status).toBe('none');
	});
});

describe('readPublicAccessStatus — what is read', () => {
	it('reads the grant audits once per shelter for all lapsed accounts', async () => {
		state.profiles.set('shelter_sh001', [
			profile('volunteer:A1', EMAIL_A),
			profile('volunteer:A2', EMAIL_B)
		]);
		for (const [email, id] of [
			[EMAIL_A, 'volunteer:A1'],
			[EMAIL_B, 'volunteer:A2']
		]) {
			state.users.set(`org.couchdb.user:${email}`, account(email, id));
		}
		state.audits.set('shelter_sh001', [
			{
				type: 'audit',
				target_id: `org.couchdb.user:${EMAIL_A}`,
				reason: 'role_grant.revoked',
				created_at: '2026-11-01T17:00:00.000Z'
			},
			{
				type: 'audit',
				target_id: `org.couchdb.user:${EMAIL_B}`,
				reason: 'role_grant.expired',
				created_at: '2026-11-02T17:00:00.000Z'
			}
		]);
		await readPublicAccessStatus(phone, NOW);
		expect(auditReads()).toBe(1);
	});

	it('reads _users with _find and a field list: never a hash, salt or key', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		await readPublicAccessStatus(phone, NOW);

		const userReads = state.admin.mock.calls.filter(([path]) => String(path).startsWith('/_users'));
		expect(userReads.map(([path]) => path)).toEqual(['/_users/_find']);
		const { fields } = userReads[0][2] as { fields: string[] };
		expect(fields).toEqual(
			expect.arrayContaining(['name', 'active', 'roles', 'role_grants', 'volunteer_id'])
		);
		for (const secret of ['derived_key', 'salt', 'password_scheme', 'password', 'iterations']) {
			expect(fields).not.toContain(secret);
		}
	});

	it('answers 503 with no rows when one shelter fails, even if another one read fine', async () => {
		state.profiles.set('shelter_sh002', [profile('volunteer:B1', null)]);
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		link('shelter_sh002', 'volunteer:B1', EMAIL_B, {
			roles: ['shelter:SH002', 'SH002:kitchen_staff']
		});
		const real = state.find.getMockImplementation()!;
		// Fails only the per-shelter link read, not the identity lookup that finds the profiles.
		state.find.mockImplementation(async (db: string, selector: Record<string, unknown>) => {
			if (db === 'shelter_sh002' && '_id' in selector) throw new Error('couch down');
			return real(db, selector);
		});

		const error = await readPublicAccessStatus(phone, NOW).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(PublicScheduleError);
		expect(error).toMatchObject({ code: 'ACCESS_STATUS_UNAVAILABLE', httpStatus: 503 });
	});
});

describe('readPublicAccessStatus — privacy (CR-221 FR-28)', () => {
	it('returns exactly the five keys and nothing that names the account', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			display_name: 'สมชาย ลับ',
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('SH001', 'kitchen_staff', '2026-11-05T16:59:59.999Z')]
		});
		state.profiles.set('shelter_sh002', [profile('volunteer:B1', null)]);
		link('shelter_sh002', 'volunteer:B1', EMAIL_B, { active: false });

		const result = await readPublicAccessStatus(phone, NOW);
		for (const row of result.access) {
			expect(Object.keys(row).sort()).toEqual(
				['expires_at', 'role_label', 'shelter_code', 'shelter_name', 'status'].sort()
			);
		}
		expect(Object.keys(result).sort()).toEqual(['access', 'success']);
		const text = JSON.stringify(result);
		for (const secret of [EMAIL_A, EMAIL_B, ISSUER, 'secret', '@', 'สมชาย ลับ', 'granted_by']) {
			expect(text).not.toContain(secret);
		}
	});
});
