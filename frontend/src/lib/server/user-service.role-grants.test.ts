import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as couchAdmin from './couch-admin';
import {
	createOrMergeUser,
	deleteUser,
	grantCoordinatorRole,
	readShelterVolunteerAccounts,
	readVolunteerAccount,
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
			if (method === 'POST' && clean === '/_users/_find') {
				// Mirror `selector._id.$in` and `fields`: only the asked-for fields come back.
				const { selector, fields } = body as {
					selector: { _id: { $in: string[] } };
					fields: string[];
				};
				const stored = (k: string) => db[`org.couchdb.user:${encodeURIComponent(k.slice(17))}`];
				return {
					status: 200,
					data: {
						docs: selector._id.$in.flatMap((k) =>
							stored(k)
								? [
										{
											...Object.fromEntries(
												fields.map((f) => [f, stored(k)[f as keyof FakeUserDoc]])
											),
											// Couch answers the raw id, not the path-encoded key the fake stores.
											_id: k
										}
									]
								: []
						)
					}
				};
			}
			if (method === 'POST' && clean === '/_users/_all_docs') {
				// Keys are raw ids (`org.couchdb.user:a@b`); the fake stores them path-encoded.
				const keys = (body as { keys: string[] }).keys;
				const stored = (k: string) => db[`org.couchdb.user:${encodeURIComponent(k.slice(17))}`];
				return {
					status: 200,
					data: {
						rows: keys.map((k) =>
							stored(k) ? { key: k, doc: stored(k) } : { key: k, error: 'not_found' }
						)
					}
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
			unchanged: false,
			name: EMAIL
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

	it('replaces the coordinator role with the newly picked one, without touching the password (#1044)', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [grant()] });
		const next = grant('warehouse_staff');
		await expect(
			grantCoordinatorRole(input(next, { password: 'Other-Pass-999!' }))
		).resolves.toEqual({
			created: false,
			unchanged: false,
			name: EMAIL
		});
		const doc = db[key(EMAIL)];
		expect(doc.roles).toEqual(['shelter:SH001', 'SH001:warehouse_staff']);
		expect(doc.role_grants).toEqual([next]);
		expect(doc.derived_key).toBe('keep-me');
		expect(doc.password).toBeUndefined();
		expect(audits()).toMatchObject([
			{ reason: 'role_grant.revoked', context: { role: 'kitchen_staff', actor: 'staff03' } },
			{ reason: 'role_grant.issued', context: { role: 'warehouse_staff', actor: 'staff03' } }
		]);
	});

	it('replaces every older coordinator grant of this shelter at once', async () => {
		seed(EMAIL, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'],
			role_grants: [grant(), grant('facility_staff')]
		});
		await grantCoordinatorRole(input(grant('warehouse_staff')));
		expect(db[key(EMAIL)].roles).toEqual(['shelter:SH001', 'SH001:warehouse_staff']);
		expect(db[key(EMAIL)].role_grants).toEqual([grant('warehouse_staff')]);
	});

	it('replaces a grant another coordinator issued (draft CR #1046 FR-17)', async () => {
		seed(EMAIL, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('kitchen_staff', { granted_by: 'coord-other' })]
		});
		await grantCoordinatorRole(input(grant('warehouse_staff')));
		expect(db[key(EMAIL)].roles).toEqual(['shelter:SH001', 'SH001:warehouse_staff']);
	});

	it('replaces the grant beside a role a manager gave, which stays (CR-221 A1-2)', async () => {
		seed(EMAIL, {
			roles: ['shelter:SH001', 'SH001:registration_staff', 'SH001:kitchen_staff'],
			role_grants: [grant()]
		});
		await grantCoordinatorRole(input(grant('warehouse_staff')));
		expect(db[key(EMAIL)].roles).toEqual([
			'shelter:SH001',
			'SH001:registration_staff',
			'SH001:warehouse_staff'
		]);
		expect(db[key(EMAIL)].role_grants).toEqual([grant('warehouse_staff')]);
		expect(audits()).toMatchObject([
			{ reason: 'role_grant.revoked', context: { role: 'kitchen_staff' } },
			{ reason: 'role_grant.issued', context: { role: 'warehouse_staff' } }
		]);
	});

	it('grants beside the permanent roles of an account with no grant here (CR-221 A1-2)', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'] });
		await grantCoordinatorRole(input(grant('warehouse_staff')));
		expect(db[key(EMAIL)].roles).toEqual([
			'shelter:SH001',
			'SH001:kitchen_staff',
			'SH001:warehouse_staff'
		]);
		expect(db[key(EMAIL)].role_grants).toEqual([grant('warehouse_staff')]);
		expect(audits()).toMatchObject([
			{ reason: 'role_grant.issued', context: { role: 'warehouse_staff' } }
		]);
	});

	it('keeps the verification a grant was issued under when an edit carries none (FR-3)', async () => {
		const verified_by = {
			shelter_code: 'SH001',
			volunteer_id: 'volunteer:V1',
			reviewed_by: 'sm01'
		};
		seed(EMAIL, {
			roles: ['shelter:SH001', 'SH001:kitchen_staff'],
			role_grants: [grant('kitchen_staff', { verified_by })]
		});
		await grantCoordinatorRole(
			input(grant('kitchen_staff', { expires_at: '2026-11-03T16:59:59.999Z' }))
		);
		expect(db[key(EMAIL)].role_grants?.[0].verified_by).toEqual(verified_by);
		await grantCoordinatorRole(input(grant('warehouse_staff')));
		expect(db[key(EMAIL)].role_grants?.[0]).toMatchObject({ role: 'warehouse_staff', verified_by });
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
				context: { actor: 'staff03', granted_by: 'other-coord' }
			});
		});

		it('lets the renewer revoke the grant they renewed, auditing the original issuer', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [mine({ granted_by: 'other-coord' })]
			});
			await grantCoordinatorRole(input(mine({ expires_at: '2026-11-03T16:59:59.999Z' })));
			written.length = 0;
			await revokeCoordinatorGrant({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03'
			});
			expect(db[key(EMAIL)].roles).not.toContain('SH001:kitchen_staff');
			expect(audits()).toMatchObject([
				{
					reason: 'role_grant.revoked',
					context: { actor: 'staff03', granted_by: 'other-coord', role: 'kitchen_staff' }
				}
			]);
		});

		it('revokes a grant another coordinator issued (FR-17)', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [mine({ granted_by: 'other-coord' })]
			});
			await revokeCoordinatorGrant({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03'
			});
			expect(db[key(EMAIL)].roles).toEqual([]);
			expect(db[key(EMAIL)].role_grants).toEqual([]);
			expect(audits()).toMatchObject([
				{
					reason: 'role_grant.revoked',
					context: { actor: 'staff03', granted_by: 'other-coord' }
				}
			]);
		});

		it('still refuses a revoke of a role a manager gave (403, no write)', async () => {
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'] });
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
			expect(written).toEqual([]);
		});

		it('shortens it, keeping the issuer, with a shortened audit naming both (FR-17, FR-19)', async () => {
			const theirs = mine({ granted_by: 'other-coord', expires_at: '2026-11-03T16:59:59.999Z' });
			seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [theirs] });
			const shorter = mine({ expires_at: '2026-10-30T16:59:59.999Z' });
			await grantCoordinatorRole(input(shorter));
			expect(db[key(EMAIL)].role_grants).toEqual([
				{ ...shorter, granted_by: 'other-coord', granted_at: theirs.granted_at }
			]);
			expect(audits()).toMatchObject([
				{
					reason: 'role_grant.shortened',
					context: {
						actor: 'staff03',
						granted_by: 'other-coord',
						expires_at: shorter.expires_at,
						previous_expires_at: theirs.expires_at
					}
				}
			]);
		});

		it('audits the original issuer of a grant it replaces with another role (W1)', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [mine({ granted_by: 'other-coord' })]
			});
			await grantCoordinatorRole(input(grant('warehouse_staff')));
			expect(audits()).toMatchObject([
				{
					reason: 'role_grant.revoked',
					context: { role: 'kitchen_staff', actor: 'staff03', granted_by: 'other-coord' }
				},
				{ reason: 'role_grant.issued', context: { role: 'warehouse_staff', actor: 'staff03' } }
			]);
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

	it('finds a legacy mixed-case account by any casing and keeps its stored name', async () => {
		const LEGACY = 'Vol@Example.com';
		seed(LEGACY, { roles: [], role_grants: [] });
		await expect(grantCoordinatorRole(input())).resolves.toMatchObject({
			created: false,
			name: LEGACY
		});
		expect(db[key(LEGACY)].roles).toEqual(['shelter:SH001', 'SH001:kitchen_staff']);
		expect(db[key(EMAIL)]).toBeUndefined();
		await revokeCoordinatorGrant({
			name: EMAIL,
			volunteer_id: 'volunteer:V1',
			shelter_code: 'SH001',
			role: 'kitchen_staff',
			actor: 'staff03'
		});
		expect(db[key(LEGACY)].roles).not.toContain('SH001:kitchen_staff');
		expect(db[key(EMAIL)]).toBeUndefined();
	});

	it('re-grants an account whose roles were revoked by the worker', async () => {
		seed(EMAIL, { roles: [], role_grants: [] });
		await grantCoordinatorRole(input());
		expect(db[key(EMAIL)].roles).toEqual(['shelter:SH001', 'SH001:kitchen_staff']);
		expect(db[key(EMAIL)].shelter_id).toBe('SH001');
	});

	it('refuses (403, no write) when a manager already gave the same role (CR-221 A1-2)', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:registration_staff'] });
		const before = JSON.stringify(db);
		await expect(grantCoordinatorRole(input())).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'ตำแหน่งนี้ผู้จัดการศูนย์ให้ไว้แล้ว'
		});
		expect(JSON.stringify(db)).toBe(before);
		expect(written).toEqual([]);
	});

	it('still grants when a manager gave a role in another shelter only', async () => {
		seed(EMAIL, { roles: ['shelter:SH002', 'SH002:registration_staff'] });
		await grantCoordinatorRole(input());
		expect(db[key(EMAIL)].roles).toEqual([
			'shelter:SH002',
			'SH002:registration_staff',
			'shelter:SH001',
			'SH001:kitchen_staff'
		]);
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

	it('answers CONFLICT, not a 500, when the account changed between read and write', async () => {
		seed(EMAIL, { roles: ['shelter:SH001', 'SH001:kitchen_staff'], role_grants: [grant()] });
		const put = vi.mocked(couchAdmin.adminRaw);
		const impl = put.getMockImplementation()!;
		put.mockImplementation(async (path, method, body) =>
			method === 'PUT' && String(path).startsWith('/_users/')
				? { status: 409, data: { error: 'conflict' } }
				: impl(path, method, body)
		);
		await expect(
			grantCoordinatorRole(
				input(grant('kitchen_staff', { expires_at: '2026-11-01T16:59:59.999Z' }))
			)
		).rejects.toMatchObject({ code: 'CONFLICT' });
		await expect(
			revokeCoordinatorGrant({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03'
			})
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(written).toEqual([]);
	});

	it('never grants a role outside the coordinator list', async () => {
		await expect(grantCoordinatorRole(input(grant('kiosk_staff')))).rejects.toMatchObject({
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

		it('refuses (403) to close or reopen a volunteer account (FR-23), writing nothing', async () => {
			const before = JSON.stringify(db);
			await expect(updateUser(EMAIL, { active: false }, sm)).rejects.toMatchObject({
				code: 'FORBIDDEN',
				message: 'บัญชีจิตอาสาใช้การถอนสิทธิ์ในศูนย์แทนการปิดบัญชี'
			});
			seed(EMAIL, { roles: granted, role_grants: [grant()], active: false });
			await expect(updateUser(EMAIL, { active: true }, sm)).rejects.toMatchObject({
				code: 'FORBIDDEN'
			});
			expect(JSON.stringify(db)).not.toBe(before);
			expect(db[key(EMAIL)].active).toBe(false);
		});

		it('accepts an unchanged `active` on a volunteer account from a manager', async () => {
			await updateUser(EMAIL, { active: true, display_name: 'ใหม่' }, sm);
			expect(db[key(EMAIL)].display_name).toBe('ใหม่');
		});

		it('lets a system admin close a volunteer account', async () => {
			await updateUser(EMAIL, { active: false }, sa);
			expect(db[key(EMAIL)].active).toBe(false);
		});

		it('leaves a staff account to its manager as before', async () => {
			seed('staff@example.com', { personnel_type: 'staff', roles: granted });
			await updateUser('staff@example.com', { active: false }, sm);
			expect(db[key('staff@example.com')].active).toBe(false);
		});

		it('a system admin may make a role permanent too', async () => {
			await updateUser(EMAIL, { permanent_roles: ['SH001:facility_staff'] }, sa);
			expect(db[key(EMAIL)].role_grants).toEqual([grant()]);
		});

		describe('giving a volunteer a new role for good (CR-221 A1-7, A1-8)', () => {
			const verify = vi.fn(async () => {});

			beforeEach(() => verify.mockReset());

			it('checks the identity in the shelter of the new role, then audits it', async () => {
				await updateUser(EMAIL, { roles: [...granted, 'SH001:medical_staff'] }, sm, {
					verifyVolunteerRoles: verify
				});
				expect(verify).toHaveBeenCalledWith(['SH001'], 'volunteer:V1');
				expect(db[key(EMAIL)].roles).toContain('SH001:medical_staff');
				expect(audits()).toEqual([
					{
						db: 'shelter_sh001',
						reason: 'role_grant.permanent_issued',
						target: `org.couchdb.user:${EMAIL}`,
						context: { role: 'medical_staff', expires_at: null, actor: 'sm01' }
					}
				]);
			});

			it('writes nothing when the check refuses', async () => {
				verify.mockRejectedValueOnce(
					new couchAdmin.ServiceError('VALIDATION', 'อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้')
				);
				const before = JSON.stringify(db);
				await expect(
					updateUser(EMAIL, { roles: [...granted, 'SH001:medical_staff'] }, sm, {
						verifyVolunteerRoles: verify
					})
				).rejects.toMatchObject({ code: 'VALIDATION' });
				expect(JSON.stringify(db)).toBe(before);
				expect(written).toEqual([]);
			});

			it.each([
				['keeps the roles', { roles: granted, display_name: 'ใหม่' }],
				['removes a role', { roles: ['shelter:SH001', 'SH001:facility_staff'] }],
				['edits another field', { display_name: 'ใหม่' }],
				['makes a grant permanent', { roles: granted, permanent_roles: ['SH001:kitchen_staff'] }]
			])('neither checks nor audits an issue when the save %s', async (_what, change) => {
				await updateUser(EMAIL, change, sm, { verifyVolunteerRoles: verify });
				expect(verify).not.toHaveBeenCalled();
				expect(audits().map((a) => a.reason)).not.toContain('role_grant.permanent_issued');
			});

			it('leaves a staff account alone', async () => {
				seed('staff@example.com', { personnel_type: 'staff', roles: granted });
				await updateUser('staff@example.com', { roles: [...granted, 'SH001:medical_staff'] }, sm, {
					verifyVolunteerRoles: verify
				});
				expect(verify).not.toHaveBeenCalled();
				expect(written).toEqual([]);
			});

			it('checks every shelter a system admin adds a role in', async () => {
				await updateUser(
					EMAIL,
					{ roles: [...granted, 'shelter:SH002', 'SH002:kitchen_staff'] },
					sa,
					{ verifyVolunteerRoles: verify }
				);
				expect(verify).toHaveBeenCalledWith(['SH002'], 'volunteer:V1');
				expect(audits()).toMatchObject([
					{
						db: 'shelter_sh002',
						reason: 'role_grant.permanent_issued',
						context: { role: 'kitchen_staff', actor: 'sa01' }
					}
				]);
			});

			it('audits each role of a new volunteer account a manager creates', async () => {
				await createOrMergeUser(
					{
						name: 'new@example.com',
						password: PASSWORD,
						display_name: 'ใหม่',
						roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:registration_staff'],
						personnel_type: 'volunteer',
						volunteer_id: 'volunteer:V9'
					},
					sm
				);
				expect(audits()).toMatchObject([
					{ reason: 'role_grant.permanent_issued', context: { role: 'kitchen_staff' } },
					{ reason: 'role_grant.permanent_issued', context: { role: 'registration_staff' } }
				]);
			});

			it('audits the role a manager merges into an existing volunteer account', async () => {
				seed('other@example.com', { roles: ['shelter:SH002', 'SH002:kitchen_staff'] });
				await createOrMergeUser(
					{
						name: 'other@example.com',
						password: PASSWORD,
						display_name: 'อื่น',
						roles: ['shelter:SH001', 'SH001:registration_staff'],
						personnel_type: 'volunteer',
						volunteer_id: 'volunteer:V1'
					},
					sm
				);
				expect(db[key('other@example.com')].roles).toEqual([
					'shelter:SH002',
					'SH002:kitchen_staff',
					'shelter:SH001',
					'SH001:registration_staff'
				]);
				expect(audits()).toMatchObject([
					{
						db: 'shelter_sh001',
						reason: 'role_grant.permanent_issued',
						context: { role: 'registration_staff', actor: 'sm01' }
					}
				]);
			});
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

		it('revokes another coordinator grant, auditing the caller and the issuer (FR-17)', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [grant('kitchen_staff', { granted_by: 'x' })]
			});
			await revoke();
			expect(db[key(EMAIL)].roles).toEqual([]);
			expect(audits()).toMatchObject([
				{ reason: 'role_grant.revoked', context: { actor: 'staff03', granted_by: 'x' } }
			]);
		});

		it('refuses a role outside the coordinator list', async () => {
			await expect(revoke({ role: 'kiosk_staff' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});
	});
	describe('revoke name resolution skips soft-deleted docs (CR-171)', () => {
		it('resolves a live case-variant when the exact name is soft-deleted', async () => {
			seed('vol@x.test', { deleted_at: '2026-10-01T00:00:00.000Z', deleted_by: 'admin' });
			seed('Vol@x.test', {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [grant()]
			});
			await revokeCoordinatorGrant({
				name: 'vol@x.test',
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03'
			});
			expect(db[key('Vol@x.test')].roles).toEqual([]);
			expect(db[key('vol@x.test')].deleted_at).toBeTruthy();
		});
	});
	describe('edge_shelters on grant / revoke (CR-171 FR-1)', () => {
		it('grant then revoke on an account with no SH001 keeps SH001 in edge_shelters', async () => {
			seed(EMAIL, { roles: [], edge_shelters: [] });
			await grantCoordinatorRole(input());
			expect(db[key(EMAIL)].edge_shelters).toContain('SH001');
			await revokeCoordinatorGrant({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03'
			});
			expect(db[key(EMAIL)].roles).toEqual([]);
			expect(db[key(EMAIL)].edge_shelters).toContain('SH001');
		});

		it('revoke folds roles into edge_shelters on a pre-backfill account (no edge_shelters)', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff'],
				role_grants: [grant()]
			});
			delete db[key(EMAIL)].edge_shelters;
			await revokeCoordinatorGrant({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				actor: 'staff03'
			});
			expect(db[key(EMAIL)].roles).toEqual([]);
			expect(db[key(EMAIL)].edge_shelters).toEqual(['SH001']);
		});

		it('grant folds existing roles into edge_shelters on a pre-backfill account', async () => {
			seed(EMAIL, { roles: ['shelter:SH002'] });
			delete db[key(EMAIL)].edge_shelters;
			await grantCoordinatorRole(input());
			expect(db[key(EMAIL)].edge_shelters).toEqual(expect.arrayContaining(['SH002', 'SH001']));
		});
	});

	describe('soft-deleted accounts are not volunteer accounts (CR-171 FR-5)', () => {
		const deleted = { deleted_at: '2026-11-01T00:00:00.000Z', roles: [], role_grants: [grant()] };

		it('readVolunteerAccount counts a soft-deleted account as none', async () => {
			seed(EMAIL, deleted);
			expect(
				await readVolunteerAccount({
					name: EMAIL,
					volunteer_id: 'volunteer:V1',
					shelter_code: 'SH001'
				})
			).toEqual({ exists: false, grants: [], permanent_roles: [] });
		});

		it('readShelterVolunteerAccounts skips it, wide and narrow', async () => {
			seed(EMAIL, deleted);
			const links = [{ volunteer_id: 'volunteer:V1', name: EMAIL }];
			expect(await readShelterVolunteerAccounts(links, 'SH001')).toEqual([]);
			expect(await readShelterVolunteerAccounts(links, 'SH001', { narrow: true })).toEqual([]);
		});
	});

	describe('reading a volunteer account for the dialog (FR-8, #1044)', () => {
		const read = (over: Record<string, unknown> = {}) =>
			readVolunteerAccount({
				name: EMAIL,
				volunteer_id: 'volunteer:V1',
				shelter_code: 'SH001',
				...over
			});

		it("returns only this shelter's grants and the roles a manager gave here", async () => {
			const other = grant('kitchen_staff', { shelter_code: 'SH002' });
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:registration_staff'],
				role_grants: [grant(), other]
			});
			expect(await read()).toEqual({
				exists: true,
				grants: [grant()],
				permanent_roles: ['registration_staff']
			});
		});

		it('counts a missing account or one linked to another volunteer as none', async () => {
			const none = { exists: false, grants: [], permanent_roles: [] };
			expect(await read()).toEqual(none);
			seed(EMAIL, { role_grants: [grant()], volunteer_id: 'volunteer:V2' });
			expect(await read()).toEqual(none);
		});
	});

	describe("reading a shelter's volunteer accounts for the tables (#1044)", () => {
		it('returns each linked account with its roles here, an ended one included', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:registration_staff'],
				role_grants: [grant(), grant('kitchen_staff', { shelter_code: 'SH002' })]
			});
			seed('ended@example.com', { roles: [], role_grants: [], volunteer_id: 'volunteer:V3' });
			seed('other@example.com', { volunteer_id: 'volunteer:V9', active: false });

			const accounts = await readShelterVolunteerAccounts(
				[
					{ volunteer_id: 'volunteer:V1', name: EMAIL },
					{ volunteer_id: 'volunteer:V3', name: 'ended@example.com' },
					{ volunteer_id: 'volunteer:V4', name: 'other@example.com' },
					{ volunteer_id: 'volunteer:V5', name: 'gone@example.com' }
				],
				'SH001'
			);

			expect(accounts).toEqual([
				{
					volunteer_id: 'volunteer:V1',
					name: EMAIL,
					active: true,
					grants: [
						{
							role: 'kitchen_staff',
							expires_at: grant().expires_at,
							granted_by: grant().granted_by
						}
					],
					permanent_roles: ['registration_staff']
				},
				{
					volunteer_id: 'volunteer:V3',
					name: 'ended@example.com',
					active: true,
					grants: [],
					permanent_roles: []
				}
			]);
		});

		it('reads the same accounts with _find and a field list when narrow: no hash, salt or key loaded', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:registration_staff'],
				role_grants: [grant()]
			});
			seed('staff@example.com', { personnel_type: 'staff', volunteer_id: 'volunteer:V6' });
			const links = [
				{ volunteer_id: 'volunteer:V1', name: EMAIL },
				{ volunteer_id: 'volunteer:V6', name: 'staff@example.com' },
				{ volunteer_id: 'volunteer:V5', name: 'gone@example.com' }
			];
			const spy = vi.mocked(couchAdmin.adminRaw);

			const wide = await readShelterVolunteerAccounts(links, 'SH001');
			spy.mockClear();
			const narrow = await readShelterVolunteerAccounts(links, 'SH001', { narrow: true });

			expect(narrow).toEqual(wide);
			expect(narrow.map((a) => a.name)).toEqual([EMAIL]);
			const [path, method, body] = spy.mock.calls[0];
			expect([path, method]).toEqual(['/_users/_find', 'POST']);
			const { fields } = body as { fields: string[] };
			for (const secret of ['derived_key', 'salt', 'password_scheme', 'password']) {
				expect(fields).not.toContain(secret);
			}
		});

		it('names who issued each grant here, and nothing more of the grant (CR-221 FR-8)', async () => {
			seed(EMAIL, {
				roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'],
				role_grants: [
					grant('kitchen_staff'),
					grant('facility_staff', {
						granted_by: 'coord-other',
						verified_by: { shelter_code: 'SH001', volunteer_id: 'volunteer:V1' }
					})
				]
			});

			const [account] = await readShelterVolunteerAccounts(
				[{ volunteer_id: 'volunteer:V1', name: EMAIL }],
				'SH001'
			);

			expect(account.grants).toEqual([
				{ role: 'kitchen_staff', expires_at: grant().expires_at, granted_by: 'staff03' },
				{ role: 'facility_staff', expires_at: grant().expires_at, granted_by: 'coord-other' }
			]);
			expect(account.permanent_roles).toEqual([]);
		});

		it('leaves out a staff account, or one with no volunteer link, that a profile names (R2)', async () => {
			seed('staff@example.com', {
				personnel_type: 'staff',
				volunteer_id: 'volunteer:V6',
				roles: ['shelter:SH001', 'SH001:registration_staff']
			});
			seed('nolink@example.com', {
				volunteer_id: undefined,
				roles: ['shelter:SH001', 'SH001:kitchen_staff']
			});
			seed('stafflink@example.com', {
				personnel_type: 'staff',
				volunteer_id: undefined,
				roles: ['shelter:SH001', 'SH001:kitchen_staff']
			});
			expect(
				await readShelterVolunteerAccounts(
					[
						{ volunteer_id: 'volunteer:V6', name: 'staff@example.com' },
						{ volunteer_id: 'volunteer:V7', name: 'nolink@example.com' },
						{ volunteer_id: 'volunteer:V8', name: 'stafflink@example.com' }
					],
					'SH001'
				)
			).toEqual([]);
		});

		it('asks for nothing when no profile is linked', async () => {
			vi.mocked(couchAdmin.adminRaw).mockClear();
			expect(await readShelterVolunteerAccounts([], 'SH001')).toEqual([]);
			expect(couchAdmin.adminRaw).not.toHaveBeenCalled();
		});
	});
});
