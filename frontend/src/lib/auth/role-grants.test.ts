import { describe, expect, it } from 'vitest';
import { COORDINATOR_GRANTABLE_CAPABILITIES } from './roles';
import {
	coordinatorShelterCodes,
	grantExpiresAt,
	grantExpiryError,
	grantExpiryLabel,
	grantExpiryRange,
	grantFor,
	isCoordinatorGrantableRole,
	pruneRoleGrants,
	withoutGrantedRole,
	type RoleGrant
} from './role-grants';

// 2026-10-27 18:30 UTC is already 2026-10-28 01:30 in Bangkok.
const NOW = new Date('2026-10-27T18:30:00Z');

const grant = (role: string, code = 'SH001'): RoleGrant => ({
	shelter_code: code,
	role,
	expires_at: '2026-10-30T16:59:59.999Z',
	granted_by: 'coord01',
	granted_at: '2026-10-28T01:30:00.000Z'
});

describe('coordinator grantable roles', () => {
	it('allows every staff role except volunteer_coordinator and kiosk_staff (#1044)', () => {
		expect([...COORDINATOR_GRANTABLE_CAPABILITIES].sort()).toEqual([
			'distribution_staff',
			'facility_staff',
			'kitchen_staff',
			'medical_staff',
			'pr_staff',
			'registration_staff',
			'security_officer',
			'supply_coordinator',
			'triage_staff',
			'warehouse_staff'
		]);
	});

	it.each([
		'kiosk_staff',
		'volunteer_coordinator',
		'shelter_manager',
		'system_admin',
		'',
		undefined
	])('rejects %s', (role) => expect(isCoordinatorGrantableRole(role)).toBe(false));
});

describe('grant expiry window (Asia/Bangkok)', () => {
	it('runs from the Bangkok today through today + 7 days', () => {
		expect(grantExpiryRange(NOW)).toEqual({ min: '2026-10-28', max: '2026-11-04' });
	});

	it('accepts both ends of the window', () => {
		expect(grantExpiryError('2026-10-28', NOW)).toBeNull();
		expect(grantExpiryError('2026-11-04', NOW)).toBeNull();
	});

	it('rejects a day in the past, one past the ceiling, and a missing date', () => {
		expect(grantExpiryError('2026-10-27', NOW)).toMatch('ผ่านมาแล้ว');
		expect(grantExpiryError('2026-11-05', NOW)).toMatch('ไม่เกิน 7 วัน');
		expect(grantExpiryError(undefined, NOW)).toMatch('เลือกวันหมดอายุ');
		expect(grantExpiryError('', NOW)).toMatch('เลือกวันหมดอายุ');
	});

	it('rejects malformed and impossible dates', () => {
		expect(grantExpiryError('28/10/2026', NOW)).toMatch('รูปแบบ');
		expect(grantExpiryError('2026-02-31', NOW)).toMatch('รูปแบบ');
		expect(grantExpiryError(20261028, NOW)).toMatch('เลือกวันหมดอายุ');
	});

	it('expires at the end of the chosen Bangkok day', () => {
		expect(grantExpiresAt('2026-10-30')).toBe('2026-10-30T16:59:59.999Z');
	});
});

describe('role grants on a user', () => {
	it('finds a grant by shelter and role', () => {
		const grants = [grant('kitchen_staff'), grant('kitchen_staff', 'SH002')];
		expect(grantFor(grants, 'SH002', 'kitchen_staff')).toBe(grants[1]);
		expect(grantFor(grants, 'SH001', 'facility_staff')).toBeNull();
		expect(grantFor(undefined, 'SH001', 'kitchen_staff')).toBeNull();
	});

	it('keeps the expiry when a save keeps the role', () => {
		const grants = [grant('kitchen_staff')];
		const roles = ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'];
		expect(pruneRoleGrants(grants, roles)).toEqual(grants);
	});

	it('drops the grant when the role is removed', () => {
		expect(
			pruneRoleGrants([grant('kitchen_staff')], ['shelter:SH001', 'SH001:facility_staff'])
		).toEqual([]);
	});

	it('removes only the grant made permanent ("ไม่มีวันหมด") and keeps the role elsewhere', () => {
		const grants = [grant('kitchen_staff'), grant('facility_staff')];
		const roles = ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'];
		expect(pruneRoleGrants(grants, roles, ['SH001:kitchen_staff'])).toEqual([grants[1]]);
	});

	it('labels the expiry with the Thai date of the Bangkok day', () => {
		expect(grantExpiryLabel(grant('kitchen_staff'))).toBe('หมดอายุสิ้นวันที่ 30/10/2569');
	});
});

describe('coordinatorShelterCodes', () => {
	it('finds compound and legacy flat coordinator scope', () => {
		expect(
			coordinatorShelterCodes(['shelter:SH001', 'SH001:volunteer_coordinator', 'shelter:SH002'])
		).toEqual(['SH001']);
		expect(coordinatorShelterCodes(['shelter:SH001', 'volunteer_coordinator'])).toEqual(['SH001']);
	});

	it('does not count a flat role across several shelters, a manager or a system admin', () => {
		expect(
			coordinatorShelterCodes(['shelter:SH001', 'shelter:SH002', 'volunteer_coordinator'])
		).toEqual([]);
		expect(coordinatorShelterCodes(['shelter:SH001', 'SH001:shelter_manager'])).toEqual([]);
		expect(coordinatorShelterCodes(['system_admin'])).toEqual([]);
	});
});

describe('withoutGrantedRole', () => {
	it('drops the role and its grant but keeps the shelter while another role is left', () => {
		const out = withoutGrantedRole(
			['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'],
			[grant('kitchen_staff'), grant('facility_staff')],
			'SH001',
			'kitchen_staff'
		);
		expect(out.roles).toEqual(['shelter:SH001', 'SH001:facility_staff']);
		expect(out.role_grants).toEqual([grant('facility_staff')]);
	});

	it('drops the shelter scope with the last role and leaves other shelters alone', () => {
		const out = withoutGrantedRole(
			['shelter:SH001', 'SH001:kitchen_staff', 'shelter:SH002', 'SH002:kitchen_staff'],
			[grant('kitchen_staff'), grant('kitchen_staff', 'SH002')],
			'SH001',
			'kitchen_staff'
		);
		expect(out.roles).toEqual(['shelter:SH002', 'SH002:kitchen_staff']);
		expect(out.role_grants).toEqual([grant('kitchen_staff', 'SH002')]);
	});
});
