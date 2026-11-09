import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', () => ({ env }));

import * as couchAdmin from './couch-admin';
import type { Caller } from './couch-admin';
import { assertUsersWritable, isEdgeMode } from './edge-mode';
import {
	createOrMergeUser,
	createUser,
	deleteUser,
	grantCoordinatorRole,
	linkGoogleMfa,
	linkThaidMfa,
	resetUserPasswordByAdmin,
	revokeCoordinatorGrant,
	setupSecurityQuestionAndResetPassword,
	touchGoogleMfaVerified,
	touchThaidMfaVerified,
	unlinkGoogleMfa,
	unlinkThaidMfa,
	updateOwnProfile,
	updateUser,
	verifySecurityQuestionAndResetPassword
} from './user-service';
import { rotateStaffCard } from './staff-card-service';

const MESSAGE = 'แก้ไขบัญชีได้เฉพาะที่ระบบกลาง';
const options = { verifyVolunteerRoles: async () => undefined };
const caller = { isSA: true, name: 'sa', roles: ['system_admin'] } as unknown as Caller;

const writers: [string, () => Promise<unknown>][] = [
	[
		'createUser',
		() => createUser({ name: 'u', password: 'Temp-Pass-123', display_name: 'U', roles: [] })
	],
	[
		'createOrMergeUser',
		() =>
			createOrMergeUser(
				{ name: 'u', password: 'Temp-Pass-123', display_name: 'U', roles: [] },
				caller,
				options
			)
	],
	['updateUser', () => updateUser('u', { display_name: 'V' }, caller, options)],
	['deleteUser', () => deleteUser('u', caller)],
	['resetUserPasswordByAdmin', () => resetUserPasswordByAdmin('u', caller)],
	['rotateStaffCard', () => rotateStaffCard(caller, 'u')],
	['updateOwnProfile', () => updateOwnProfile('u', { display_name: 'V' })],
	[
		'verifySecurityQuestionAndResetPassword',
		() => verifySecurityQuestionAndResetPassword('u', 'q', 'a', 'pw')
	],
	[
		'setupSecurityQuestionAndResetPassword',
		() =>
			setupSecurityQuestionAndResetPassword({ username: 'u', question_id: 'q', raw_answer: 'a' })
	],
	['linkGoogleMfa', () => linkGoogleMfa('u', { subject: 's' })],
	['linkThaidMfa', () => linkThaidMfa('u', { subject: 's' })],
	['unlinkGoogleMfa', () => unlinkGoogleMfa('u', caller)],
	['unlinkThaidMfa', () => unlinkThaidMfa('u', caller)],
	[
		'grantCoordinatorRole',
		() =>
			grantCoordinatorRole({
				name: 'u',
				password: 'x',
				display_name: 'U',
				organization: null,
				phone: null,
				volunteer_id: 'v',
				linked_user_name: null,
				grant: {
					shelter_code: 'SH001',
					role: 'registration_staff',
					granted_by: 'sa'
				} as unknown as Parameters<typeof grantCoordinatorRole>[0]['grant']
			})
	],
	[
		'revokeCoordinatorGrant',
		() =>
			revokeCoordinatorGrant({
				name: 'u',
				volunteer_id: 'v',
				shelter_code: 'SH001',
				role: 'registration_staff',
				actor: 'sa'
			})
	]
];

describe('EDGE_MODE (CR-171 FR-13/14)', () => {
	let adminRaw: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		delete env.EDGE_MODE;
		env.COUCHDB_ADMIN_URL = 'http://admin:pw@couchdb:5984';
		adminRaw = vi
			.spyOn(couchAdmin, 'adminRaw')
			.mockResolvedValue({ status: 404, data: { error: 'not_found' } });
	});

	it('is on only for the exact string "true"', () => {
		expect(isEdgeMode()).toBe(false);
		env.EDGE_MODE = 'false';
		expect(isEdgeMode()).toBe(false);
		env.EDGE_MODE = '1';
		expect(isEdgeMode()).toBe(false);
		env.EDGE_MODE = 'true';
		expect(isEdgeMode()).toBe(true);
	});

	it('assertUsersWritable throws FORBIDDEN only when on', () => {
		expect(() => assertUsersWritable()).not.toThrow();
		env.EDGE_MODE = 'true';
		expect(() => assertUsersWritable()).toThrow(MESSAGE);
	});

	describe('flag on', () => {
		beforeEach(() => {
			env.EDGE_MODE = 'true';
		});

		it.each(writers)('%s rejects with FORBIDDEN before touching CouchDB', async (_n, run) => {
			await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN', message: MESSAGE });
			expect(adminRaw).not.toHaveBeenCalled();
		});

		it.each([
			['touchGoogleMfaVerified', touchGoogleMfaVerified],
			['touchThaidMfaVerified', touchThaidMfaVerified]
		])('%s is a silent no-op', async (_n, touch) => {
			await expect(touch('u')).resolves.toBeUndefined();
			expect(adminRaw).not.toHaveBeenCalled();
		});
	});

	describe('flag off (central)', () => {
		it.each(writers)('%s passes the edge guard and reaches CouchDB', async (_n, run) => {
			const err = await run().then(
				() => null,
				(e: unknown) => e
			);
			expect((err as Error | null)?.message).not.toBe(MESSAGE);
			expect(adminRaw).toHaveBeenCalled();
		});

		it('touch* still reads the doc', async () => {
			await touchGoogleMfaVerified('u').catch(() => undefined);
			expect(adminRaw).toHaveBeenCalled();
		});
	});
});
