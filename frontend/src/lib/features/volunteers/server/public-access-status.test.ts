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

import { readPublicAccessStatus } from './public-access-status';

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

beforeEach(() => {
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
		if (path === '/_users/_all_docs?include_docs=true') {
			const keys = (body as { keys: string[] }).keys;
			return {
				status: 200,
				data: { rows: keys.map((key) => ({ key, doc: state.users.get(key) ?? null })) }
			};
		}
		if (path.endsWith('/_find')) {
			const db = path.split('/')[1];
			const target = (body as { selector: { target_id: string } }).selector.target_id;
			return {
				status: 200,
				data: { docs: (state.audits.get(db) ?? []).filter((a) => a.target_id === target) }
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
		const { access } = await readPublicAccessStatus(phone);
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
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0].status).toBe('none');
	});

	it('is active with the role label and end date for a grant', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('SH001', 'kitchen_staff', '2026-11-05T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone);
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
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0]).toMatchObject({ status: 'active', expires_at: null });
		expect(access[0].role_label).toBeTruthy();
	});

	it('is lapsed when the account holds nothing in this shelter', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			// A role in another shelter does not count here.
			roles: ['shelter:SH002', 'SH002:kitchen_staff'],
			role_grants: [grant('SH002', 'kitchen_staff', '2026-11-05T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone);
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
		const result = await readPublicAccessStatus(phone);
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

	it('is account_disabled for a suspended account even when it still holds a role', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			active: false,
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('SH001', 'kitchen_staff', '2026-11-05T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0]).toMatchObject({
			status: 'account_disabled',
			role_label: null,
			expires_at: null
		});
	});

	it('answers one row per shelter with a profile, sorted by code', async () => {
		state.profiles.set('shelter_sh002', [profile('volunteer:B1', null)]);
		link('shelter_sh002', 'volunteer:B1', EMAIL_B, {
			roles: ['shelter:SH002', 'SH002:warehouse_staff'],
			role_grants: [grant('SH002', 'warehouse_staff', '2026-11-04T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone);
		expect(access.map((row) => [row.shelter_code, row.status])).toEqual([
			['SH001', 'none'],
			['SH002', 'active']
		]);
	});

	it('answers an empty list when the credential opens no profile', async () => {
		state.profiles.clear();
		const { access } = await readPublicAccessStatus(phone);
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
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0].expires_at).toBe('2026-11-06T16:59:59.999Z');
		expect(access[0].role_label).toBe('เจ้าหน้าที่คลัง');
	});

	it('lets a permanent role take precedence over a grant', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:warehouse_staff'],
			// kitchen_staff has no grant: a manager gave it.
			role_grants: [grant('SH001', 'warehouse_staff', '2026-11-06T16:59:59.999Z')]
		});
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0]).toMatchObject({ status: 'active', expires_at: null });
		expect(access[0].role_label).toBe('เจ้าหน้าที่ครัว');
	});
});

describe('readPublicAccessStatus — two-way link (CR-221 FR-7)', () => {
	it('ignores an account whose volunteer_id is another profile', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			volunteer_id: 'volunteer:OTHER',
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0].status).toBe('none');
	});

	it('ignores a staff account that a profile user_name happens to name', async () => {
		link('shelter_sh001', 'volunteer:A1', EMAIL_A, {
			personnel_type: 'staff',
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});
		const { access } = await readPublicAccessStatus(phone);
		expect(access[0].status).toBe('none');
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

		const result = await readPublicAccessStatus(phone);
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
