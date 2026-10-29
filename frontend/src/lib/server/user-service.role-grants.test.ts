import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as couchAdmin from './couch-admin';
import {
	deleteUser,
	grantCoordinatorRole,
	readVolunteerGrants,
	revokeCoordinatorGrant,
	updateUser,
	type CouchUserDoc
} from './user-service';
import type { RoleGrant } from '$lib/auth/role-grants';

type FakeUserDoc = CouchUserDoc & { password?: string; derived_key?: string };

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
	/** Docs written outside `_users`: the shelter audits, as `[database, doc]`. */
	let written: [string, Record<string, unknown>][];

	const audits = () =>
		written.map(([database, doc]) => ({
			db: database,
			reason: doc.reason,
			target: doc.target_id,
			context: doc.context
		}));

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
		written = [];
		vi.spyOn(couchAdmin, 'bootstrapAdminName').mockReturnValue('admin');
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
			const clean = path.split('?')[0];
			if (!clean.startsWith('/_users/')) {
				written.push([clean.split('/')[1], body as Record<string, unknown>]);
				return { status: 201, data: { ok: true } };
			}
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
		expect(audits()).toEqual([
			{
				db: 'shelter_sh001',
				reason: 'role_grant.issued',
				target: `org.couchdb.user:${EMAIL}`,
				context: { role: 'kitchen_staff', expires_at: grant().expires_at, actor: 'staff03' }
			}
		]);
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
		expect(audits()).toMatchObject([
			{
				reason: 'role_grant.renewed',
				context: { expires_at: renewed.expires_at, previous_expires_at: grant().expires_at }
			}
		]);
	});

	describe('another coordinator and a grant that is not theirs', () => {
		const mine = (over: Partial<RoleGrant> = {}) => grant('kitchen_staff', over);

		it('renews it but keeps the issuer, and audits the caller as the renewer', async () => {
			const theirs = mine({ granted_by: 'other-coord', granted_at: '2026-10-27T02:00:00.000Z' });
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [theirs] });
			const renewed = mine({ expires_at: '2026-11-03T16:59:59.999Z' });
			await grantCoordinatorRole(input(renewed));
			expect(db[key(EMAIL)].role_grants).toEqual([
				{ ...renewed, granted_by: 'other-coord', granted_at: theirs.granted_at }
			]);
			expect(audits()[0]).toMatchObject({
				reason: 'role_grant.renewed',
				context: { actor: 'staff03' }
			});
		});

		it('still refuses the renewer a revoke of the grant they renewed', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [mine({ granted_by: 'other-coord' })]
			});
			await grantCoordinatorRole(input(mine({ expires_at: '2026-11-03T16:59:59.999Z' })));
			await expect(
				revokeCoordinatorGrant({
					name: EMAIL,
					volunteer_id: 'volunteer:V1',
					shelter_code: 'SH001',
					role: 'kitchen_staff',
					actor: 'staff03'
				})
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(db[key(EMAIL)].roles).toContain('SH001:kitchen_staff');
		});

		it('refuses to shorten it (403, no write)', async () => {
			const theirs = mine({ granted_by: 'other-coord', expires_at: '2026-11-03T16:59:59.999Z' });
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [theirs] });
			await expect(
				grantCoordinatorRole(input(mine({ expires_at: '2026-10-30T16:59:59.999Z' })))
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(db[key(EMAIL)].role_grants).toEqual([theirs]);
			expect(written).toEqual([]);
		});

		it('lets the issuer shorten their own grant, with a shortened audit', async () => {
			const own = mine({ expires_at: '2026-11-03T16:59:59.999Z' });
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [own] });
			const shorter = mine({ expires_at: '2026-10-30T16:59:59.999Z' });
			await grantCoordinatorRole(input(shorter));
			expect(db[key(EMAIL)].role_grants).toEqual([shorter]);
			expect(audits()).toMatchObject([
				{
					reason: 'role_grant.shortened',
					context: { expires_at: shorter.expires_at, previous_expires_at: own.expires_at }
				}
			]);
		});
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
		expect(written).toEqual([]);
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

	// FR-7: an existing account must pass every rule, else 403 and no write of any kind.
	it.each([
		['a staff account', { personnel_type: 'staff' as const }],
		['another volunteer profile', { volunteer_id: 'volunteer:OTHER' }],
		['a deactivated account', { active: false }],
		['a system admin', { roles: ['system_admin'] }],
		['a shelter manager here', { roles: ['shelter:SH001', 'SH001:shelter_manager'] }],
		['a shelter manager elsewhere', { roles: ['shelter:SH002', 'SH002:shelter_manager'] }],
		['a legacy flat shelter manager', { roles: ['shelter:SH002', 'shelter_manager'] }],
		['a coordinator here', { roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] }],
		['a coordinator elsewhere', { roles: ['shelter:SH002', 'SH002:volunteer_coordinator'] }],
		['the caller itself', { name: 'staff03' }]
	])('refuses to extend %s (403, no write)', async (_label, over) => {
		const name = (over as { name?: string }).name ?? EMAIL;
		seed(name, over);
		const before = JSON.stringify(db);
		await expect(grantCoordinatorRole(input(grant(), { name }))).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
		expect(JSON.stringify(db)).toBe(before);
		expect(written).toEqual([]);
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
			expect(written).toEqual([]);
		});

		it('drops the grant of a role the manager removes', async () => {
			await updateUser(EMAIL, { roles: ['shelter:SH001', 'SH001:facility_staff'] }, sm);
			expect(db[key(EMAIL)].role_grants).toEqual([grant('facility_staff')]);
			expect(audits()).toMatchObject([
				{ reason: 'role_grant.revoked', context: { role: 'kitchen_staff', actor: 'sm01' } }
			]);
		});

		it('leaves no grant behind when the manager removes the user from the shelter', async () => {
			const other = grant('kitchen_staff', { shelter_code: 'SH002' });
			seed(EMAIL, {
				roles: [...granted, 'shelter:SH002', 'SH002:kitchen_staff'],
				role_grants: [grant(), grant('facility_staff'), other]
			});
			await deleteUser(EMAIL, sm);
			expect(db[key(EMAIL)].roles).toEqual(['shelter:SH002', 'SH002:kitchen_staff']);
			expect(db[key(EMAIL)].role_grants).toEqual([other]);
			expect(audits()).toMatchObject([
				{ reason: 'role_grant.revoked', context: { role: 'kitchen_staff' } },
				{ reason: 'role_grant.revoked', context: { role: 'facility_staff' } }
			]);
		});

		it('gives a role for good when a manager re-adds one whose grant was left stale', async () => {
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:facility_staff'], role_grants: [grant()] });
			await updateUser(EMAIL, { roles: granted }, sm);
			expect(db[key(EMAIL)].roles).toEqual(granted);
			expect(db[key(EMAIL)].role_grants).toEqual([]);
		});

		it('makes a role permanent: grant removed, role kept, audited', async () => {
			await updateUser(EMAIL, { roles: granted, permanent_roles: ['SH001:kitchen_staff'] }, sm);
			expect(db[key(EMAIL)].roles).toEqual(granted);
			expect(db[key(EMAIL)].role_grants).toEqual([grant('facility_staff')]);
			expect(audits()).toEqual([
				{
					db: 'shelter_sh001',
					reason: 'role_grant.made_permanent',
					target: `org.couchdb.user:${EMAIL}`,
					context: { role: 'kitchen_staff', expires_at: grant().expires_at, actor: 'sm01' }
				}
			]);
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

	describe('a coordinator revoking a grant (FR-8)', () => {
		const revoke = (over: Record<string, unknown> = {}) =>
			revokeCoordinatorGrant({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03',
				...over
			});

		it('takes the role, its grant and the empty shelter scope; keeps the account', async () => {
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [grant()] });
			await revoke();
			const doc = db[key(EMAIL)];
			expect(doc.roles).toEqual([]);
			expect(doc.role_grants).toEqual([]);
			expect(doc.shelter_id).toBeNull();
			expect(doc.derived_key).toBe('keep-me');
			expect(audits()).toMatchObject([
				{ reason: 'role_grant.revoked', context: { role: 'kitchen_staff', actor: 'staff03' } }
			]);
		});

		it('keeps the manager-given role and the other shelters', async () => {
			const other = grant('kitchen_staff', { shelter_code: 'SH002' });
			seed(EMAIL, {
				roles: [
					'shelter:SH001',
					'SH001:kitchen_staff',
					'SH001:facility_staff',
					'shelter:SH002',
					'SH002:kitchen_staff'
				],
				role_grants: [grant(), other]
			});
			await revoke();
			expect(db[key(EMAIL)].roles).toEqual([
				'shelter:SH001',
				'SH001:facility_staff',
				'shelter:SH002',
				'SH002:kitchen_staff'
			]);
			expect(db[key(EMAIL)].role_grants).toEqual([other]);
		});

		it.each([
			['another coordinator grant', { role_grants: [grant('kitchen_staff', { granted_by: 'x' })] }],
			['a role a manager gave (no grant)', { role_grants: [] }],
			['a grant for another role', { role_grants: [grant('facility_staff')] }],
			['another volunteer profile', { volunteer_id: 'volunteer:OTHER' }]
		])('refuses %s with 403 and no write', async (_label, over) => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'],
				role_grants: [grant()],
				...over
			});
			const before = JSON.stringify(db);
			await expect(revoke()).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(JSON.stringify(db)).toBe(before);
			expect(written).toEqual([]);
		});

		it('refuses a role outside the coordinator list', async () => {
			await expect(revoke({ role: 'medical_staff' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});
	});
	describe('reading a volunteer account grants for the dialog (FR-8)', () => {
		const read = (over: Record<string, unknown> = {}) =>
			readVolunteerGrants({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				...over
			});

		it("returns only this shelter's grants", async () => {
			const other = grant('kitchen_staff', { shelter_code: 'SH002' });
			seed(EMAIL, { role_grants: [grant(), other] });
			expect(await read()).toEqual([grant()]);
		});

		it('has none for a missing account or one linked to another volunteer', async () => {
			expect(await read()).toEqual([]);
			seed(EMAIL, { role_grants: [grant()], volunteer_id: 'volunteer:V2' });
			expect(await read()).toEqual([]);
		});
	});
});
