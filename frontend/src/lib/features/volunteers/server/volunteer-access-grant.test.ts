import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminRaw, grantCoordinatorRole, shelterRefs } = vi.hoisted(() => ({
	adminRaw: vi.fn(),
	grantCoordinatorRole: vi.fn(),
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
vi.mock('$lib/server/user-service', () => ({ grantCoordinatorRole }));
vi.mock('./public-schedule-action', () => ({ shelterRefs }));

import { sha256Hex } from '$lib/db/hash';
import { grantVolunteerAccessAsCoordinator } from './volunteer-access-grant';

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
	identity_verified: true,
	identity_verification: { status: 'verified' },
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
	adminRaw.mockImplementation(async (path: string) => {
		if (path === '/shelter_sh001/volunteer%3AV1') return { status: 200, data: local };
		const db = path.split('/')[1];
		if (path.endsWith('/_find') && others[db]) return { status: 200, data: { docs: others[db] } };
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
					granted_at: NOW.toISOString()
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
		it('rejects a volunteer not verified in this shelter and with no phone to look up', async () => {
			couch(unverified({ phone: null }));
			await expect(grant()).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(grantCoordinatorRole).not.toHaveBeenCalled();
		});

		it('rejects when no other shelter has a verified profile with the same phone', async () => {
			couch(unverified(), { shelter_sh002: [unverified({ shelter_code: 'SH002' })] });
			await expect(grant()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		it('accepts a profile verified in another shelter with the same phone_hash', async () => {
			couch(unverified(), {
				shelter_sh002: [volunteer({ _id: 'volunteer:V9', shelter_code: 'SH002' })]
			});
			await expect(grant()).resolves.toBeDefined();
			expect(adminRaw).toHaveBeenCalledWith('/shelter_sh002/_find', 'POST', {
				selector: { type: 'volunteer', phone_hash: await sha256Hex('0812345678') },
				limit: 20
			});
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
