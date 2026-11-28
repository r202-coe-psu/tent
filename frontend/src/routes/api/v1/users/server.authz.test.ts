import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route-level authz for /api/v1/users with the REAL authorizeUserWrite + user-service (#477,
// PR #1523 review W2). Only the Couch transport is faked: `/_session` via `fetch`, `_users` via
// `adminRaw`. Audit and the volunteer verification are out of scope here.
vi.mock('$lib/server/audit-log', () => ({ recordAuditedWrites: vi.fn(async () => undefined) }));
vi.mock('$lib/features/volunteers/server/volunteer-access-grant', () => ({
	assertVolunteerVerifiedForAccess: vi.fn(async () => undefined)
}));

import * as couchAdmin from '$lib/server/couch-admin';
import type { CouchUserDoc } from '$lib/server/user-service';
import { GET, PUT } from './+server';

type FakeUserDoc = CouchUserDoc & { password?: string };

const idOf = (name: string) => `org.couchdb.user:${name}`;
let users: Record<string, FakeUserDoc>;

function userDoc(name: string, roles: string[], extra: Partial<FakeUserDoc> = {}): FakeUserDoc {
	return {
		_id: idOf(name),
		_rev: '1-a',
		name,
		type: 'user',
		roles,
		display_name: name,
		personnel_type: 'staff',
		active: true,
		...extra
	} as FakeUserDoc;
}

function signedInAs(roles: string[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ userCtx: { name: 'caller', roles } }))
	);
}

function put(shelter: string | null, body: Record<string, unknown>) {
	const qs = shelter ? `?shelter_code=${shelter}` : '';
	const request = new Request(`http://localhost/api/v1/users${qs}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify(body)
	});
	return PUT({ request } as Parameters<typeof PUT>[0]);
}

function get(shelter: string | null) {
	const qs = shelter ? `?shelter_code=${shelter}` : '';
	const request = new Request(`http://localhost/api/v1/users${qs}`, {
		headers: { cookie: 'AuthSession=x' }
	});
	return GET({ request } as Parameters<typeof GET>[0]);
}

const SM_SH002 = ['shelter:SH002', 'SH002:shelter_manager'];
const SM_BOTH = [
	'shelter:SH001',
	'SH001:shelter_manager',
	'shelter:SH002',
	'SH002:shelter_manager'
];

beforeEach(() => {
	users = {};
	vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
		const clean = path.split('?')[0];
		if (clean === '/_users/_all_docs') {
			const rows = Object.values(users).map((doc) => ({ id: doc._id, key: doc._id, doc }));
			return { status: 200, data: { rows } };
		}
		const id = clean.slice('/_users/'.length);
		if (method === 'GET') {
			return users[id]
				? { status: 200, data: { ...users[id] } }
				: { status: 404, data: { error: 'not_found' } };
		}
		if (method === 'PUT') {
			users[id] = { ...(body as FakeUserDoc), _id: id, _rev: '2-b' };
			return { status: 201, data: { ok: true, id, rev: '2-b' } };
		}
		return { status: 200, data: { ok: true } };
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('/api/v1/users authz across shelters (#477)', () => {
	it('403s a manager naming a shelter they do not manage, and writes nothing', async () => {
		users[idOf('u1')] = userDoc('u1', ['shelter:SH001', 'SH001:registration_staff']);
		signedInAs(['shelter:SH001', 'SH001:registration_staff', ...SM_SH002]);

		const res = await put('SH001', { name: 'u1', display_name: 'hijacked' });

		expect(res.status).toBe(403);
		expect(users[idOf('u1')].display_name).toBe('u1');
	});

	it('403s a single-shelter manager changing the password of another shelter’s manager (B1)', async () => {
		users[idOf('mgr1')] = userDoc(
			'mgr1',
			['shelter:SH001', 'SH001:shelter_manager', 'shelter:SH002', 'SH002:registration_staff'],
			{ password: 'old' }
		);
		signedInAs(SM_SH002);

		const res = await put('SH002', { name: 'mgr1', password: 'Taken-Over-123!' });

		expect(res.status).toBe(403);
		expect(users[idOf('mgr1')].password).toBe('old');
	});

	it('409s relinking an account to a volunteer profile another account holds (W1)', async () => {
		users[idOf('vol-a')] = userDoc('vol-a', ['shelter:SH001', 'SH001:registration_staff'], {
			personnel_type: 'volunteer',
			volunteer_id: 'volunteer:01VOL'
		});
		users[idOf('u2')] = userDoc('u2', ['shelter:SH002', 'SH002:registration_staff']);
		signedInAs(SM_SH002);

		const res = await put('SH002', { name: 'u2', volunteer_id: 'volunteer:01VOL' });

		expect(res.status).toBe(409);
		expect(users[idOf('u2')].volunteer_id).toBeUndefined();
	});

	it('422s a manager of several shelters who names none', async () => {
		signedInAs(SM_BOTH);
		expect((await get(null)).status).toBe(422);
	});

	it('lists the named managed shelter only', async () => {
		users[idOf('a')] = userDoc('a', ['shelter:SH001', 'SH001:registration_staff']);
		users[idOf('b')] = userDoc('b', ['shelter:SH002', 'SH002:registration_staff']);
		signedInAs(SM_BOTH);

		const res = await get('SH002');

		expect(res.status).toBe(200);
		const names = ((await res.json()) as { name: string }[]).map((u) => u.name);
		expect(names).toContain('b');
		expect(names).not.toContain('a');
	});
});
