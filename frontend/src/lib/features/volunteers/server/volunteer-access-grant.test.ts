import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	adminRaw,
	grantCoordinatorRole,
	readShelterVolunteerAccounts,
	readVolunteerAccount,
	revokeCoordinatorGrant
} = vi.hoisted(() => ({
	adminRaw: vi.fn(),
	grantCoordinatorRole: vi.fn(),
	readShelterVolunteerAccounts: vi.fn(),
	readVolunteerAccount: vi.fn(),
	revokeCoordinatorGrant: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw,
	serviceErrorFromCouch: (action: string) => new Error(`couch: ${action}`),
	ServiceError: class ServiceError extends Error {
		constructor(
			readonly code: string,
			message: string
		) {
			super(message);
		}
	}
}));
vi.mock('$lib/server/user-service', () => ({
	grantCoordinatorRole,
	readShelterVolunteerAccounts,
	readVolunteerAccount,
	revokeCoordinatorGrant
}));

import { sha256Hex } from '$lib/db/hash';
import {
	assertVolunteerVerifiedForAccess,
	grantVolunteerAccessAsCoordinator,
	listShelterVolunteerAccounts,
	listVolunteerGrantsAsCoordinator,
	revokeVolunteerAccessAsCoordinator
} from './volunteer-access-grant';

// 2026-10-28 in Bangkok.
const NOW = new Date('2026-10-27T18:30:00Z');
const COORDINATOR = { name: 'staff03', roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] };

const body = (over: Record<string, unknown> = {}) => ({
	shelter_code: 'SH001',
	volunteer_id: 'volunteer:V1',
	email: 'vol@example.com',
	password: 'Temp-Pass-123!',
	role: 'distribution_staff',
	expires_on: '2026-10-31',
	...over
});

const volunteer = (over: Record<string, unknown> = {}) => ({
	_id: 'volunteer:V1',
	type: 'volunteer',
	shelter_code: 'SH001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	national_id_hash: 'nid-hash-1',
	identity_verified: true,
	identity_verification: { status: 'verified', reviewed_by: 'staff03' },
	...over
});

const unverified = (over: Record<string, unknown> = {}) =>
	volunteer({ identity_verified: false, identity_verification: { status: 'pending' }, ...over });

/** `shelter_sh001` holds `local`; `others` maps another shelter DB to its phone matches. */
function couch(local: Record<string, unknown>, others: Record<string, unknown[]> = {}) {
	adminRaw.mockImplementation(async (path: string, _method?: string, body?: unknown) => {
		if (path === '/shelter_sh001/volunteer%3AV1') return { status: 200, data: local };
		const db = path.split('/')[1];
		if (path.endsWith('/_find') && others[db]) {
			const selector = (body ?? {}) as { selector?: Record<string, unknown> };
			const wanted = Object.entries(selector.selector ?? {}).filter(([k]) => k !== 'type');
			// Like Mango: a doc matches when every selector field equals the doc's.
			const docs = others[db].filter((d) =>
				wanted.every(([k, v]) => (d as Record<string, unknown>)[k] === v)
			);
			return { status: 200, data: { docs } };
		}
		return { status: 404, data: null };
	});
}

const grant = (input = body(), caller: { name: string; roles: string[] } = COORDINATOR) =>
	grantVolunteerAccessAsCoordinator(caller, input, NOW);

beforeEach(() => {
	vi.clearAllMocks();
	grantCoordinatorRole.mockResolvedValue({ created: true, unchanged: false });
	readVolunteerAccount.mockResolvedValue({ exists: false, grants: [], permanent_roles: [] });
	couch(volunteer());
});

describe('grantVolunteerAccessAsCoordinator', () => {
	it('lowercases the email used as the account name', async () => {
		await grant(body({ email: ' Vol@Example.COM ' }));
		expect(grantCoordinatorRole).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'vol@example.com' })
		);
	});

	it('refuses a profile whose phone is not a 10-digit mobile (CR-210 FR-8)', async () => {
		couch(volunteer({ phone: '022222222' }));
		await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(grantCoordinatorRole).not.toHaveBeenCalled();
	});

	it('grants a verified volunteer one role with an expiry at the end of the chosen Bangkok day', async () => {
		await expect(grant()).resolves.toEqual({ created: true, unchanged: false });
		expect(grantCoordinatorRole).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'vol@example.com',
				volunteer_id: 'volunteer:V1',
				phone: '0812345678',
				grant: {
					shelter_code: 'SH001',
					role: 'distribution_staff',
					expires_at: '2026-10-31T16:59:59.999Z',
					granted_by: 'staff03',
					granted_at: NOW.toISOString(),
					// The coordinator verified and granted alone: kept so a manager can see it.
					verified_by: {
						shelter_code: 'SH001',
						volunteer_id: 'volunteer:V1',
						reviewed_by: 'staff03'
					}
				}
			})
		);
	});

	it('accepts a coordinator whose roles are the legacy flat form', async () => {
		await grant(body(), { name: 'staff03', roles: ['shelter:SH001', 'volunteer_coordinator'] });
		expect(grantCoordinatorRole).toHaveBeenCalled();
	});

	describe('shelter', () => {
		it.each([
			['another shelter', ['shelter:SH002', 'SH002:volunteer_coordinator']],
			['no coordinator role', ['shelter:SH001', 'SH001:registration_staff']],
			['shelter manager only', ['shelter:SH001', 'SH001:shelter_manager']],
			['system admin', ['system_admin']],
			['nothing', []]
		])('rejects a caller with %s', async (_label, roles) => {
			await expect(grant(body(), { name: 'x', roles })).rejects.toMatchObject({
				code: 'FORBIDDEN'
			});
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it('rejects a shelter the coordinator does not hold', async () => {
			await expect(grant(body({ shelter_code: 'SH002' }))).rejects.toMatchObject({
				code: 'FORBIDDEN'
			});
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it('reads the shelter from the session when the body names none', async () => {
			await grant(body({ shelter_code: undefined }));
			expect(grantCoordinatorRole).toHaveBeenCalledWith(
				expect.objectContaining({ grant: expect.objectContaining({ shelter_code: 'SH001' }) })
			);
		});

		it('makes a coordinator of two shelters name one, and rejects the one they do not hold', async () => {
			const both = {
				name: 'staff03',
				roles: [
					'shelter:SH001',
					'SH001:volunteer_coordinator',
					'shelter:SH002',
					'SH002:registration_staff'
				]
			};
			await expect(grant(body(), both)).resolves.toBeDefined();
			const two = {
				name: 'staff03',
				roles: [
					'shelter:SH001',
					'SH001:volunteer_coordinator',
					'shelter:SH002',
					'SH002:volunteer_coordinator'
				]
			};
			await expect(grant(body({ shelter_code: undefined }), two)).rejects.toMatchObject({
				code: 'VALIDATION'
			});
		});

		it('rejects a volunteer profile that belongs to another shelter', async () => {
			couch(volunteer({ shelter_code: 'SH002' }));
			await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
		});
	});

	describe('role', () => {
		it.each(['kiosk_staff', 'volunteer_coordinator', 'shelter_manager', 'system_admin', undefined])(
			'rejects %s',
			async (role) => {
				await expect(grant(body({ role }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
				expect(grantCoordinatorRole).not.toHaveBeenCalled();
			}
		);

		it.each([
			'registration_staff',
			'triage_staff',
			'medical_staff',
			'kitchen_staff',
			'supply_coordinator',
			'warehouse_staff',
			'distribution_staff',
			'pr_staff',
			'facility_staff',
			'security_officer'
		])('allows %s', async (role) => {
			await grant(body({ role }));
			expect(grantCoordinatorRole).toHaveBeenCalled();
		});
	});

	describe('expiry', () => {
		it('is required', async () => {
			await expect(grant(body({ expires_on: undefined }))).rejects.toMatchObject({
				code: 'VALIDATION'
			});
			await expect(grant(body({ expires_on: '' }))).rejects.toMatchObject({ code: 'VALIDATION' });
		});

		it('allows today and today + 7 days, not yesterday or day 8', async () => {
			await grant(body({ expires_on: '2026-10-28' }));
			await grant(body({ expires_on: '2026-11-04' }));
			await expect(grant(body({ expires_on: '2026-10-27' }))).rejects.toMatchObject({
				code: 'VALIDATION'
			});
			await expect(grant(body({ expires_on: '2026-11-05' }))).rejects.toMatchObject({
				code: 'VALIDATION'
			});
			expect(grantCoordinatorRole).toHaveBeenCalledTimes(2);
		});
	});

	describe('closed profile (CR-221 FR-21)', () => {
		it('rejects (422) an inactive profile, even a verified one, and grants nothing', async () => {
			couch(volunteer({ status: 'inactive' }));
			await expect(grant()).rejects.toMatchObject({
				code: 'VALIDATION',
				message: 'เปิดใช้งานอาสาสมัครก่อนจึงจะออกสิทธิ์ได้'
			});
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it('grants an active profile', async () => {
			couch(volunteer({ status: 'active' }));
			await expect(grant()).resolves.toBeDefined();
		});
	});

	describe('identity verification', () => {
		it('rejects (422) a volunteer not verified here', async () => {
			couch(unverified());
			await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		// #1044: another shelter's check no longer stands in, even with the same phone and ID.
		it('rejects a volunteer verified only in another shelter, without looking there', async () => {
			couch(unverified(), {
				shelter_sh002: [
					volunteer({
						_id: 'volunteer:V9',
						shelter_code: 'SH002',
						phone_hash: await sha256Hex('0812345678'),
						national_id_hash: 'nid-hash-1'
					})
				]
			});
			await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
			expect(adminRaw).not.toHaveBeenCalledWith(
				expect.stringContaining('_find'),
				expect.anything(),
				expect.anything()
			);
		});

		describe('editing a grant the account already holds (FR-3: no re-verification)', () => {
			const holds = (grants: { role: string; expires_at: string }[]) =>
				readVolunteerAccount.mockResolvedValue({ exists: true, grants, permanent_roles: [] });

			it('allows an unverified profile whose account holds a grant here, with no verified_by', async () => {
				couch(unverified({ user_name: 'vol@example.com' }));
				holds([{ role: 'kitchen_staff', expires_at: '2026-10-30T16:59:59.999Z' }]);
				await expect(grant()).resolves.toBeDefined();
				expect(readVolunteerAccount).toHaveBeenCalledWith(
					expect.objectContaining({ name: 'vol@example.com', shelter_code: 'SH001' })
				);
				const passed = grantCoordinatorRole.mock.calls[0][0].grant;
				expect(passed.verified_by).toBeUndefined();
			});

			it('still rejects (422) a lapsed account: no grant here any more', async () => {
				couch(unverified({ user_name: 'vol@example.com' }));
				holds([]);
				await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
				expect(grantCoordinatorRole).not.toHaveBeenCalled();
			});

			it('still rejects (422) a new grant, where there is no account', async () => {
				couch(unverified());
				readVolunteerAccount.mockResolvedValue({ exists: false, grants: [], permanent_roles: [] });
				await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
			});

			it('does not look the account up for a verified profile', async () => {
				await grant();
				expect(readVolunteerAccount).not.toHaveBeenCalled();
			});
		});

		it('records the verification here on the grant', async () => {
			await grant();
			expect(grantCoordinatorRole).toHaveBeenCalledWith(
				expect.objectContaining({
					grant: expect.objectContaining({
						verified_by: {
							shelter_code: 'SH001',
							volunteer_id: 'volunteer:V1',
							reviewed_by: 'staff03'
						}
					})
				})
			);
		});

		it('treats the legacy identity_verified flag as verified', async () => {
			couch(volunteer({ identity_verification: null, identity_verified: true }));
			await expect(grant()).resolves.toBeDefined();
		});
	});

	it('rejects a bad email before reading anything', async () => {
		await expect(grant(body({ email: 'nope' }))).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(adminRaw).not.toHaveBeenCalled();
	});
});

describe('assertVolunteerVerifiedForAccess (CR-221 FR-3, SA / SM path)', () => {
	it('passes a profile verified in the shelter', async () => {
		await expect(
			assertVolunteerVerifiedForAccess(['SH001'], 'volunteer:V1')
		).resolves.toBeUndefined();
	});

	it('rejects (422) a profile not verified in the shelter', async () => {
		couch(unverified());
		await expect(assertVolunteerVerifiedForAccess(['SH001'], 'volunteer:V1')).rejects.toMatchObject(
			{
				code: 'VALIDATION',
				message: 'อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้'
			}
		);
	});

	it('rejects (422) a profile that is not in the shelter at all', async () => {
		await expect(assertVolunteerVerifiedForAccess(['SH002'], 'volunteer:V1')).rejects.toMatchObject(
			{
				code: 'VALIDATION'
			}
		);
	});

	it('checks nothing for roles in no shelter', async () => {
		await expect(assertVolunteerVerifiedForAccess([], 'volunteer:V1')).resolves.toBeUndefined();
		expect(adminRaw).not.toHaveBeenCalled();
	});
});

describe('revokeVolunteerAccessAsCoordinator', () => {
	const input = (over: Record<string, unknown> = {}) => ({
		shelter_code: 'SH001',
		volunteer_id: 'volunteer:V1',
		email: 'vol@example.com',
		role: 'kitchen_staff',
		...over
	});
	const revoke = (i = input(), caller: { name: string; roles: string[] } = COORDINATOR) =>
		revokeVolunteerAccessAsCoordinator(caller, i);

	it('lowercases the email before naming the account', async () => {
		await revoke(input({ email: 'Vol@EXAMPLE.com' }));
		expect(revokeCoordinatorGrant).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'vol@example.com' })
		);
	});

	it('hands the account, shelter, role and the caller as the actor to the service', async () => {
		await revoke();
		expect(revokeCoordinatorGrant).toHaveBeenCalledWith({
			name: 'vol@example.com',
			volunteer_id: 'volunteer:V1',
			shelter_code: 'SH001',
			role: 'kitchen_staff',
			actor: 'staff03'
		});
	});

	it.each([
		['another shelter', input({ shelter_code: 'SH002' }), COORDINATOR],
		['a role the coordinator may not grant', input({ role: 'kiosk_staff' }), COORDINATOR],
		[
			'a shelter manager',
			input(),
			{ name: 'm', roles: ['shelter:SH001', 'SH001:shelter_manager'] }
		],
		['no roles', input(), { name: 'x', roles: [] }]
	])('refuses %s with 403 and writes nothing', async (_label, i, caller) => {
		await expect(revoke(i, caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(revokeCoordinatorGrant).not.toHaveBeenCalled();
	});

	it('needs the account and the volunteer', async () => {
		await expect(revoke(input({ email: '' }))).rejects.toMatchObject({ code: 'VALIDATION' });
		await expect(revoke(input({ volunteer_id: undefined }))).rejects.toMatchObject({
			code: 'VALIDATION'
		});
	});
});

describe('listVolunteerGrantsAsCoordinator', () => {
	const list = (
		i: { shelter_code: unknown; volunteer_id: unknown } = {
			shelter_code: 'SH001',
			volunteer_id: 'volunteer:V1'
		},
		caller: { name: string; roles: string[] } = COORDINATOR
	) => listVolunteerGrantsAsCoordinator(caller, i);
	const stored = (granted_by: string) => ({
		shelter_code: 'SH001',
		role: 'kitchen_staff',
		expires_at: '2026-10-31T16:59:59.999Z',
		granted_by,
		granted_at: '2026-10-28T01:30:00.000Z'
	});

	it("reads the profile's own account and marks the caller's grants", async () => {
		couch(volunteer({ user_name: 'vol@example.com' }));
		readVolunteerAccount.mockResolvedValue({
			exists: true,
			grants: [stored('staff03'), { ...stored('staff09'), role: 'facility_staff' }],
			permanent_roles: ['registration_staff']
		});
		expect(await list()).toEqual({
			email: 'vol@example.com',
			has_account: true,
			grants: [
				{
					role: 'kitchen_staff',
					expires_at: '2026-10-31T16:59:59.999Z',
					granted_by: 'staff03',
					mine: true
				},
				{
					role: 'facility_staff',
					expires_at: '2026-10-31T16:59:59.999Z',
					granted_by: 'staff09',
					mine: false
				}
			],
			permanent_roles: ['registration_staff'],
			last_ended: null
		});
		expect(readVolunteerAccount).toHaveBeenCalledWith({
			name: 'vol@example.com',
			volunteer_id: 'volunteer:V1',
			shelter_code: 'SH001'
		});
	});

	it('has nothing to read for a profile without an account', async () => {
		expect(await list()).toEqual({
			email: null,
			has_account: false,
			grants: [],
			permanent_roles: [],
			last_ended: null
		});
		expect(readVolunteerAccount).not.toHaveBeenCalled();
	});

	it('says the account is gone when the profile keeps a user_name without one', async () => {
		couch(volunteer({ user_name: 'vol@example.com' }));
		readVolunteerAccount.mockResolvedValue({ exists: false, grants: [], permanent_roles: [] });
		expect(await list()).toMatchObject({ email: 'vol@example.com', has_account: false });
	});

	it.each([
		['role_grant.expired', 'expired', 'worker'],
		['role_grant.revoked', 'revoked', 'coord01']
	])(
		'tells how the last grant ended (%s) when the account holds nothing here (#1044)',
		async (reason, ending, actor) => {
			couch(volunteer({ user_name: 'vol@example.com' }));
			readVolunteerAccount.mockResolvedValue({ exists: true, grants: [], permanent_roles: [] });
			adminRaw.mockImplementation(async (path: string) =>
				path.endsWith('/_find')
					? {
							status: 200,
							data: {
								docs: [
									{
										target_id: 'org.couchdb.user:vol@example.com',
										reason: 'role_grant.issued',
										created_at: '2026-10-29T01:00:00.000Z',
										context: { role: 'kitchen_staff', actor: 'coord01' }
									},
									{
										target_id: 'org.couchdb.user:vol@example.com',
										reason,
										created_at: '2026-10-31T17:00:00.000Z',
										context: { role: 'kitchen_staff', actor }
									}
								].filter((d) => d.reason !== 'role_grant.issued')
							}
						}
					: { status: 200, data: volunteer({ user_name: 'vol@example.com' }) }
			);
			expect((await list()).last_ended).toEqual({
				role: 'kitchen_staff',
				reason: ending,
				at: '2026-10-31T17:00:00.000Z',
				by: actor
			});
		}
	);

	it('refuses another shelter with 403 and reads nothing', async () => {
		await expect(
			list({ shelter_code: 'SH002', volunteer_id: 'volunteer:V1' })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(adminRaw).not.toHaveBeenCalled();
	});
});

describe('listShelterVolunteerAccounts (#1044)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		adminRaw.mockResolvedValue({
			status: 200,
			data: {
				docs: [
					{ _id: 'volunteer:V1', user_name: ' vol@example.com ' },
					{ _id: 'volunteer:V2', user_name: '' }
				]
			}
		});
		readShelterVolunteerAccounts.mockResolvedValue([]);
	});

	it.each([
		['a coordinator', COORDINATOR.roles],
		['a shelter manager', ['shelter:SH001', 'SH001:shelter_manager']],
		['a system admin', ['system_admin']]
	])('reads the linked accounts of the shelter for %s', async (_who, roles) => {
		await listShelterVolunteerAccounts({ roles }, { shelter_code: 'SH001' });
		expect(adminRaw).toHaveBeenCalledWith(
			expect.stringContaining('/_find'),
			'POST',
			expect.objectContaining({
				selector: expect.objectContaining({ type: 'volunteer', shelter_code: 'SH001' })
			})
		);
		expect(readShelterVolunteerAccounts).toHaveBeenCalledWith(
			[{ volunteer_id: 'volunteer:V1', name: 'vol@example.com' }],
			'SH001'
		);
	});

	it.each([
		['another shelter', COORDINATOR.roles, 'SH002'],
		[
			'a staff role without volunteer back-office',
			['shelter:SH001', 'SH001:kitchen_staff'],
			'SH001'
		]
	])('refuses %s with 403 and reads nothing', async (_why, roles, code) => {
		await expect(
			listShelterVolunteerAccounts({ roles }, { shelter_code: code })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(adminRaw).not.toHaveBeenCalled();
	});

	describe('how the last role ended', () => {
		const account = (name: string, grants: unknown[] = []) => ({
			volunteer_id: `volunteer:${name}`,
			name,
			active: true,
			grants,
			permanent_roles: []
		});
		const audit = (name: string, at: string, over: Record<string, unknown> = {}) => ({
			target_id: `org.couchdb.user:${name}`,
			reason: 'role_grant.revoked',
			created_at: at,
			context: { role: 'warehouse_staff', actor: 'worker', cause: 'profile_inactive' },
			...over
		});
		const auditReads = () =>
			adminRaw.mock.calls.filter(
				(call) => (call[2] as { selector?: { type?: string } })?.selector?.type === 'audit'
			);
		const list = () =>
			listShelterVolunteerAccounts({ roles: COORDINATOR.roles }, { shelter_code: 'SH001' });
		function auditsAre(docs: unknown[]) {
			adminRaw.mockImplementation(async (_path: string, _method: string, body?: unknown) => {
				const selector = (body as { selector?: { type?: string } } | undefined)?.selector;
				return selector?.type === 'audit'
					? { status: 200, data: { docs } }
					: { status: 200, data: { docs: [] } };
			});
		}

		it('says it for an account that holds nothing here, and not for one that does', async () => {
			readShelterVolunteerAccounts.mockResolvedValue([
				account('held@example.com', [
					{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z' }
				]),
				account('ended@example.com')
			]);
			auditsAre([audit('ended@example.com', '2026-11-02T07:06:06.813Z')]);

			const accounts = await list();

			expect(accounts[0]).not.toHaveProperty('last_ended');
			expect(accounts[1].last_ended).toEqual({
				role: 'warehouse_staff',
				reason: 'revoked',
				at: '2026-11-02T07:06:06.813Z',
				by: 'worker',
				cause: 'profile_inactive'
			});
		});

		it('reads the audits once for any number of lapsed accounts, newest ending per account', async () => {
			readShelterVolunteerAccounts.mockResolvedValue([
				account('a@example.com'),
				account('b@example.com'),
				account('c@example.com'),
				account('held@example.com', [
					{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z' }
				])
			]);
			auditsAre([
				audit('a@example.com', '2026-10-01T00:00:00.000Z', {
					reason: 'role_grant.expired',
					context: { role: 'kitchen_staff', actor: 'worker' }
				}),
				audit('b@example.com', '2026-10-20T00:00:00.000Z', { context: { role: 'x', actor: 'c1' } }),
				audit('a@example.com', '2026-10-15T00:00:00.000Z'),
				audit('b@example.com', '2026-10-05T00:00:00.000Z', { context: { role: 'y', actor: 'c2' } })
			]);

			const accounts = await list();

			expect(auditReads()).toHaveLength(1);
			const find = auditReads()[0][2] as {
				selector: { target_id: { $in: string[] }; reason: { $in: string[] } };
			};
			expect(find.selector.target_id.$in).toEqual([
				'org.couchdb.user:a@example.com',
				'org.couchdb.user:b@example.com',
				'org.couchdb.user:c@example.com'
			]);
			expect(find.selector.reason.$in).toContain('role_grant.revoked');
			expect(accounts[0].last_ended).toMatchObject({
				at: '2026-10-15T00:00:00.000Z',
				reason: 'revoked'
			});
			expect(accounts[1].last_ended).toMatchObject({ at: '2026-10-20T00:00:00.000Z', by: 'c1' });
			expect(accounts[2].last_ended).toBeNull();
			expect(accounts[3]).not.toHaveProperty('last_ended');
		});

		it.each([
			['answers 500', () => ({ status: 500, data: { error: 'boom' } })],
			[
				'throws',
				() => {
					throw new Error('couch down');
				}
			]
		])(
			'still returns the accounts, last_ended null, when the audit read %s',
			async (_how, fail) => {
				const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
				readShelterVolunteerAccounts.mockResolvedValue([
					account('a@example.com'),
					account('held@example.com', [
						{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z' }
					])
				]);
				adminRaw.mockImplementation(async (_path: string, _method: string, body?: unknown) => {
					const selector = (body as { selector?: { type?: string } } | undefined)?.selector;
					return selector?.type === 'audit' ? fail() : { status: 200, data: { docs: [] } };
				});

				const accounts = await list();

				expect(accounts).toHaveLength(2);
				expect(accounts[0].last_ended).toBeNull();
				expect(accounts[1]).not.toHaveProperty('last_ended');
				expect(logged).toHaveBeenCalled();
				logged.mockRestore();
			}
		);

		it('reads no audits when every account holds a role', async () => {
			readShelterVolunteerAccounts.mockResolvedValue([
				account('held@example.com', [
					{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z' }
				])
			]);
			auditsAre([]);
			await list();
			expect(auditReads()).toHaveLength(0);
		});

		it('pages through the audits so the newest ending is found past the first page', async () => {
			readShelterVolunteerAccounts.mockResolvedValue([account('a@example.com')]);
			const old = Array.from({ length: 1000 }, (_, i) =>
				audit('a@example.com', `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`)
			);
			adminRaw.mockImplementation(async (_path: string, _method: string, body?: unknown) => {
				const req = body as { selector?: { type?: string }; bookmark?: string };
				if (req.selector?.type !== 'audit') return { status: 200, data: { docs: [] } };
				return req.bookmark
					? {
							status: 200,
							data: {
								docs: [audit('a@example.com', '2026-10-30T00:00:00.000Z')],
								bookmark: 'p2'
							}
						}
					: { status: 200, data: { docs: old, bookmark: 'p1' } };
			});

			const [found] = await list();

			expect(auditReads()).toHaveLength(2);
			expect(found.last_ended).toMatchObject({ at: '2026-10-30T00:00:00.000Z' });
		});
	});

	it('needs a shelter', async () => {
		await expect(
			listShelterVolunteerAccounts({ roles: COORDINATOR.roles }, { shelter_code: '' })
		).rejects.toMatchObject({ code: 'VALIDATION' });
	});
});
