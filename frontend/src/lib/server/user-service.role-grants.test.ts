import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as couchAdmin from './couch-admin';
import { grantCoordinatorRole, updateUser, type CouchUserDoc } from './user-service';
import type { RoleGrant } from '$lib/auth/role-grants';

type FakeUserDoc = CouchUserDoc & { password?: string };

const key = (name: string) => `org.couchdb.user:${encodeURIComponent(name)}`;
const EMAIL = 'vol@example.com';
const PASSWORD = 'Temp-Pass-123!';

const grant = (role = 'kitchen_staff', over: Partial<RoleGrant> = {}): RoleGrant => ({
	shelter_code: 'SH001',
	role,
	expires_at: '2026-10-31T16:59:59.999Z',
	granted_by: 'staff03',
	granted_at: '2026-10-28T01:30:00.000Z',
	...over
});

const input = (g: RoleGrant = grant(), over: Record<string, unknown> = {}) => ({
	name: EMAIL,
	password: PASSWORD,
	display_name: 'สมชาย ใจดี',
	organization: null,
	phone: null,
	volunteer_id: 'volunteer:V1',
	linked_user_name: null,
	grant: g,
	...over
});

describe('coordinator role grants on _users (#955)', () => {
	let db: Record<string, FakeUserDoc>;

	function seed(name: string, doc: Partial<FakeUserDoc>) {
		db[key(name)] = {
			_id: key(name),
			_rev: '1-a',
			name,
			type: 'user',
			roles: [],
			personnel_type: 'volunteer',
			volunteer_id: 'volunteer:V1',
			active: true,
			password_scheme: 'pbkdf2',
			derived_key: 'keep-me',
			salt: 'keep-salt',
			...doc
		} as FakeUserDoc;
	}

	beforeEach(() => {
		db = {};
		vi.spyOn(couchAdmin, 'bootstrapAdminName').mockReturnValue('admin');
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
			const clean = path.split('?')[0];
			if (method === 'GET' && clean === '/_users/_all_docs') {
				return {
					status: 200,
					data: { rows: Object.values(db).map((doc) => ({ id: doc._id, doc })) }
				};
			}
			const id = clean.slice('/_users/'.length);
			if (method === 'GET') {
				return db[id]
					? { status: 200, data: { ...db[id] } }
					: { status: 404, data: { error: 'not_found', reason: 'missing' } };
			}
			if (method === 'PUT') {
				const doc = (body ?? {}) as FakeUserDoc;
				if (db[id] && !doc._rev) return { status: 409, data: { error: 'conflict' } };
				db[id] = { ...doc, _id: id, _rev: '2-b' };
				return { status: 201, data: { ok: true } };
			}
			return { status: 200, data: { ok: true } };
		});
	});

	it('creates the account with compound roles, the grant and a forced password change', async () => {
		await expect(grantCoordinatorRole(input())).resolves.toEqual({
			created: true,
			unchanged: false
		});
		const doc = db[key(EMAIL)];
		expect(doc.roles).toEqual(['shelter:SH001', 'SH001:kitchen_staff']);
		expect(doc.role_grants).toEqual([grant()]);
		expect(doc.personnel_type).toBe('volunteer');
		expect(doc.volunteer_id).toBe('volunteer:V1');
		expect(doc.must_change_password).toBe(true);
	});

	it('adds a second role to an existing account without touching the password', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [grant()] });
		const next = grant('facility_staff');
		await expect(
			grantCoordinatorRole(input(next, { password: 'Other-Pass-999!' }))
		).resolves.toEqual({
			created: false,
			unchanged: false
		});
		const doc = db[key(EMAIL)];
		expect(doc.roles).toEqual(['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff']);
		expect(doc.role_grants).toEqual([grant(), next]);
		expect(doc.derived_key).toBe('keep-me');
		expect(doc.password).toBeUndefined();
	});

	it('renews an existing grant instead of duplicating it', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [grant()] });
		const renewed = grant('kitchen_staff', { expires_at: '2026-11-03T16:59:59.999Z' });
		await grantCoordinatorRole(input(renewed));
		expect(db[key(EMAIL)].role_grants).toEqual([renewed]);
		expect(db[key(EMAIL)].roles).toEqual(['shelter:SH001', 'SH001:kitchen_staff']);
	});

	it('re-grants an account whose roles were revoked by the worker', async () => {
		seed(EMAIL, { roles: [], role_grants: [] });
		await grantCoordinatorRole(input());
		expect(db[key(EMAIL)].roles).toEqual(['shelter:SH001', 'SH001:kitchen_staff']);
		expect(db[key(EMAIL)].shelter_id).toBe('SH001');
	});

	it('does nothing when a manager already gave the role (no grant)', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'] });
		await expect(grantCoordinatorRole(input())).resolves.toEqual({
			created: false,
			unchanged: true
		});
		expect(db[key(EMAIL)].role_grants).toBeUndefined();
	});

	it('does nothing for an account that is already the shelter manager', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:shelter_manager'] });
		await expect(grantCoordinatorRole(input())).resolves.toMatchObject({ unchanged: true });
	});

	it('keeps other shelters roles and grants', async () => {
		const other = grant('kitchen_staff', { shelter_code: 'SH002' });
		seed(EMAIL, { roles: ['shelter:SH002', 'SH002:kitchen_staff'], role_grants: [other] });
		await grantCoordinatorRole(input());
		const doc = db[key(EMAIL)];
		expect(doc.roles).toEqual([
			'shelter:SH002',
			'SH002:kitchen_staff',
			'shelter:SH001',
			'SH001:kitchen_staff'
		]);
		expect(doc.role_grants).toEqual([other, grant()]);
	});

	it.each([
		['a staff account', { personnel_type: 'staff' as const }],
		['another volunteer profile', { volunteer_id: 'volunteer:OTHER' }],
		['a deactivated account', { active: false }],
		['a system admin', { roles: ['system_admin'] }]
	])('refuses to extend %s', async (_label, over) => {
		seed(EMAIL, over);
		await expect(grantCoordinatorRole(input())).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('refuses a volunteer who already has a different account', async () => {
		seed('first@example.com', { roles: ['shelter:SH001', 'SH001:kitchen_staff'] });
		await expect(grantCoordinatorRole(input())).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(db[key(EMAIL)]).toBeUndefined();
	});

	it('refuses when the profile is linked to another existing account', async () => {
		seed('linked@example.com', { volunteer_id: 'volunteer:V1', roles: [] });
		await expect(
			grantCoordinatorRole(input(grant(), { linked_user_name: 'linked@example.com' }))
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('never grants a role outside the coordinator list', async () => {
		await expect(grantCoordinatorRole(input(grant('medical_staff')))).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
		expect(db[key(EMAIL)]).toBeUndefined();
	});

	describe('a manager saving the user', () => {
		const sm = {
			name: 'sm01',
			roles: ['shelter:SH001', 'SH001:shelter_manager'],
			isSA: false,
			shelterCode: 'SH001'
		};
		const sa = { name: 'sa01', roles: ['system_admin'], isSA: true, shelterCode: null };
		const granted = ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'];

		beforeEach(() =>
			seed(EMAIL, { roles: granted, role_grants: [grant(), grant('facility_staff')] })
		);

		it('keeps the expiry when the role stays', async () => {
			await updateUser(EMAIL, { roles: granted, display_name: 'ใหม่' }, sm);
			expect(db[key(EMAIL)].role_grants).toEqual([grant(), grant('facility_staff')]);
		});

		it('drops the grant of a role the manager removes', async () => {
			await updateUser(EMAIL, { roles: ['shelter:SH001', 'SH001:facility_staff'] }, sm);
			expect(db[key(EMAIL)].role_grants).toEqual([grant('facility_staff')]);
		});

		it('makes a role permanent: grant removed, role kept', async () => {
			await updateUser(EMAIL, { roles: granted, permanent_roles: ['SH001:kitchen_staff'] }, sm);
			expect(db[key(EMAIL)].roles).toEqual(granted);
			expect(db[key(EMAIL)].role_grants).toEqual([grant('facility_staff')]);
		});

		it('a system admin may make a role permanent too', async () => {
			await updateUser(EMAIL, { permanent_roles: ['SH001:facility_staff'] }, sa);
			expect(db[key(EMAIL)].role_grants).toEqual([grant()]);
		});

		it('a manager cannot touch another shelter grants', async () => {
			await expect(
				updateUser(EMAIL, { roles: granted, permanent_roles: ['SH002:kitchen_staff'] }, sm)
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});
	});
});
