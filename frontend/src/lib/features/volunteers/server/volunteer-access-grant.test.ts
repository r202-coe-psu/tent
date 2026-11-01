import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminRaw, grantCoordinatorRole, readVolunteerGrants, revokeCoordinatorGrant, shelterRefs } =
	vi.hoisted(() => ({
		adminRaw: vi.fn(),
		grantCoordinatorRole: vi.fn(),
		readVolunteerGrants: vi.fn(),
		revokeCoordinatorGrant: vi.fn(),
		shelterRefs: vi.fn()
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
	readVolunteerGrants,
	revokeCoordinatorGrant
}));
vi.mock('./public-schedule-action', () => ({ shelterRefs }));

import { sha256Hex } from '$lib/db/hash';
import {
	grantVolunteerAccessAsCoordinator,
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
	shelterRefs.mockResolvedValue([
		{ dbName: 'shelter_sh001', code: 'SH001', name: 'SH001' },
		...Object.keys(others).map((dbName) => ({
			dbName,
			code: dbName.replace('shelter_', '').toUpperCase(),
			name: dbName
		}))
	]);
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
		it.each([
			'medical_staff',
			'triage_staff',
			'warehouse_staff',
			'volunteer_coordinator',
			'shelter_manager',
			'system_admin',
			undefined
		])('rejects %s', async (role) => {
			await expect(grant(body({ role }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it.each(['registration_staff', 'kitchen_staff', 'distribution_staff', 'facility_staff'])(
			'allows %s',
			async (role) => {
				await grant(body({ role }));
				expect(grantCoordinatorRole).toHaveBeenCalled();
			}
		);
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

	describe('identity verification', () => {
		it('rejects (422) a volunteer not verified here and with no phone to look up', async () => {
			couch(unverified({ phone: null }));
			await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it('rejects when no other shelter has a verified profile with the same phone and national ID', async () => {
			couch(unverified(), {
				shelter_sh002: [
					unverified({ shelter_code: 'SH002', phone_hash: 'x', national_id_hash: 'y' })
				]
			});
			await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
		});

		it('accepts a profile verified in another shelter with the same phone_hash and national_id_hash', async () => {
			const phoneHash = await sha256Hex('0812345678');
			couch(unverified(), {
				shelter_sh002: [
					volunteer({
						_id: 'volunteer:V9',
						shelter_code: 'SH002',
						phone_hash: phoneHash,
						national_id_hash: 'nid-hash-1'
					})
				]
			});
			await expect(grant()).resolves.toBeDefined();
			expect(adminRaw).toHaveBeenCalledWith('/shelter_sh002/_find', 'POST', {
				selector: { type: 'volunteer', phone_hash: phoneHash, national_id_hash: 'nid-hash-1' },
				limit: 20
			});
			expect(grantCoordinatorRole).toHaveBeenCalledWith(
				expect.objectContaining({
					grant: expect.objectContaining({
						verified_by: {
							shelter_code: 'SH002',
							volunteer_id: 'volunteer:V9',
							reviewed_by: 'staff03'
						}
					})
				})
			);
		});

		it('rejects (422) a profile verified elsewhere that matches the phone only', async () => {
			const phoneHash = await sha256Hex('0812345678');
			couch(unverified(), {
				shelter_sh002: [
					volunteer({
						_id: 'volunteer:V9',
						shelter_code: 'SH002',
						phone_hash: phoneHash,
						national_id_hash: 'someone-else'
					})
				]
			});
			await expect(grant()).rejects.toMatchObject({ code: 'VALIDATION' });
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it('uses this shelter only when the profile has no national ID', async () => {
			couch(unverified({ national_id_hash: null }), {
				shelter_sh002: [
					volunteer({
						shelter_code: 'SH002',
						phone_hash: await sha256Hex('0812345678'),
						national_id_hash: null
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

		it('does not look elsewhere when the volunteer is verified here', async () => {
			couch(volunteer(), { shelter_sh002: [] });
			await grant();
			expect(adminRaw).not.toHaveBeenCalledWith(
				expect.stringContaining('_find'),
				expect.anything(),
				expect.anything()
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

	it('hands the account, shelter, role and the caller as the issuer to the service', async () => {
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
		['a role outside the four', input({ role: 'medical_staff' }), COORDINATOR],
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
		readVolunteerGrants.mockResolvedValue([
			stored('staff03'),
			{ ...stored('staff09'), role: 'facility_staff' }
		]);
		expect(await list()).toEqual({
			email: 'vol@example.com',
			grants: [
				{ role: 'kitchen_staff', expires_at: '2026-10-31T16:59:59.999Z', mine: true },
				{ role: 'facility_staff', expires_at: '2026-10-31T16:59:59.999Z', mine: false }
			]
		});
		expect(readVolunteerGrants).toHaveBeenCalledWith({
			name: 'vol@example.com',
			volunteer_id: 'volunteer:V1',
			shelter_code: 'SH001'
		});
	});

	it('has nothing to read for a profile without an account', async () => {
		expect(await list()).toEqual({ email: null, grants: [] });
		expect(readVolunteerGrants).not.toHaveBeenCalled();
	});

	it('refuses another shelter with 403 and reads nothing', async () => {
		await expect(
			list({ shelter_code: 'SH002', volunteer_id: 'volunteer:V1' })
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(adminRaw).not.toHaveBeenCalled();
	});
});
