import { describe, it, expect } from 'vitest';
import {
	PORTAL_PREVIEW_ROLES,
	applyPreviewFeatures,
	buildPreviewRoles,
	createPortalPreviewState,
	isPortalPreviewActive,
	isPortalPreviewAvailable,
	portalPreviewRoleLabel,
	resolvePortalPreview,
	type PortalPreviewRole,
	type PortalPreviewState
} from './portal-preview';
import { portalLayoutMode } from './portal-layout';
import { filterPortalMenu, type PortalFeatures } from './portal-menu';

const SH = 'SH001';
const SA = ['system_admin'];
const SM = [`shelter:${SH}`, `${SH}:shelter_manager`];
const ON: PortalFeatures = { medicalScreening: true };
const OFF: PortalFeatures = { medicalScreening: false };
const UNKNOWN: PortalFeatures = { medicalScreening: null };

const previewOf = (
	role: PortalPreviewRole,
	medicalScreening: PortalPreviewState['medicalScreening'] = 'real'
) => ({
	role,
	medicalScreening
});

describe('buildPreviewRoles', () => {
	it('gives a system admin only the system_admin role', () => {
		expect(buildPreviewRoles('system_admin', SH, SM)).toEqual(['system_admin']);
	});

	it('gives a shelter manager the shelter scope and the manager capability', () => {
		expect(buildPreviewRoles('shelter_manager', SH, SA)).toEqual([
			'shelter:SH001',
			'SH001:shelter_manager'
		]);
	});

	it.each([
		['registration_staff', 'SH001:registration_staff'],
		['triage_staff', 'SH001:triage_staff'],
		['medical_staff', 'SH001:medical_staff'],
		['kitchen_staff', 'SH001:kitchen_staff'],
		['supply_coordinator', 'SH001:supply_coordinator'],
		['warehouse_staff', 'SH001:warehouse_staff'],
		['volunteer_coordinator', 'SH001:volunteer_coordinator'],
		['security_officer', 'SH001:security_officer'],
		['facility_staff', 'SH001:facility_staff']
	] as const)('gives %s the shelter scope and the compound capability', (role, compound) => {
		expect(buildPreviewRoles(role, SH, SA)).toEqual(['shelter:SH001', compound]);
	});

	it('returns the real roles when no shelter is selected', () => {
		expect(buildPreviewRoles('registration_staff', null, SA)).toEqual(SA);
		expect(buildPreviewRoles('system_admin', undefined, SA)).toEqual(SA);
	});

	it('returns a copy, not the caller array, when no shelter is selected', () => {
		const real = [...SA];
		expect(buildPreviewRoles('shelter_manager', '', real)).not.toBe(real);
	});

	it('covers every role offered by the picker', () => {
		expect(PORTAL_PREVIEW_ROLES).toHaveLength(11);
		expect(PORTAL_PREVIEW_ROLES[0].value).toBe('system_admin');
	});
});

describe('applyPreviewFeatures', () => {
	it('keeps the real value for "ตามศูนย์"', () => {
		expect(applyPreviewFeatures(OFF, 'real')).toEqual(OFF);
		expect(applyPreviewFeatures(UNKNOWN, 'real')).toEqual(UNKNOWN);
	});

	it('forces the flag on or off', () => {
		expect(applyPreviewFeatures(OFF, 'on')).toEqual(ON);
		expect(applyPreviewFeatures(ON, 'off')).toEqual(OFF);
	});
});

describe('resolvePortalPreview', () => {
	const features = ON;

	it('is inactive for a system admin with no preview choice', () => {
		const result = resolvePortalPreview({
			realRoles: SA,
			shelterCode: SH,
			features,
			preview: createPortalPreviewState()
		});
		expect(result).toEqual({ roles: SA, features, active: false });
	});

	it('is never active for a non-admin, even with a stored preview', () => {
		const result = resolvePortalPreview({
			realRoles: SM,
			shelterCode: SH,
			features,
			preview: previewOf('registration_staff', 'off')
		});
		expect(result).toEqual({ roles: SM, features, active: false });
	});

	it('is inactive when no shelter is selected', () => {
		const result = resolvePortalPreview({
			realRoles: SA,
			shelterCode: null,
			features,
			preview: previewOf('registration_staff')
		});
		expect(result.active).toBe(false);
		expect(result.roles).toEqual(SA);
	});

	it('uses the previewed roles for an admin previewing another role', () => {
		const result = resolvePortalPreview({
			realRoles: SA,
			shelterCode: SH,
			features,
			preview: previewOf('registration_staff')
		});
		expect(result.active).toBe(true);
		expect(result.roles).toEqual(['shelter:SH001', 'SH001:registration_staff']);
		expect(result.features).toEqual(ON);
	});

	it('applies the medical override even when the role is the admin view', () => {
		const result = resolvePortalPreview({
			realRoles: SA,
			shelterCode: SH,
			features: OFF,
			preview: previewOf('system_admin', 'on')
		});
		expect(result.active).toBe(true);
		expect(result.roles).toEqual(SA);
		expect(result.features).toEqual(ON);
	});
});

describe('preview availability and state', () => {
	it('is available only to a system admin with a shelter', () => {
		expect(isPortalPreviewAvailable(SA, SH)).toBe(true);
		expect(isPortalPreviewAvailable(SA, null)).toBe(false);
		expect(isPortalPreviewAvailable(SM, SH)).toBe(false);
	});

	it('is active only when the role or the medical override differs', () => {
		expect(isPortalPreviewActive(createPortalPreviewState())).toBe(false);
		expect(isPortalPreviewActive(previewOf('kitchen_staff'))).toBe(true);
		expect(isPortalPreviewActive(previewOf('system_admin', 'off'))).toBe(true);
	});

	it('labels every role with its picker text', () => {
		expect(portalPreviewRoleLabel('registration_staff')).toBe('ทะเบียน');
		expect(portalPreviewRoleLabel('system_admin')).toBe('ตัวเอง (ผู้ดูแลระบบส่วนกลาง)');
	});
});

describe('previewed roles drive the portal menu', () => {
	const menuFor = (roles: string[], features = ON) =>
		filterPortalMenu({ roles, shelterCode: SH, features });

	it('previewing registration gives the focused layout with only the registration department', () => {
		const resolved = resolvePortalPreview({
			realRoles: SA,
			shelterCode: SH,
			features: ON,
			preview: previewOf('registration_staff')
		});
		const views = menuFor(resolved.roles, resolved.features);
		expect(views.map((v) => v.id)).toEqual(['registration']);
		expect(portalLayoutMode(views)).toBe('focused');
	});

	it('previewing a shelter manager gives the overview layout', () => {
		const resolved = resolvePortalPreview({
			realRoles: SA,
			shelterCode: SH,
			features: ON,
			preview: previewOf('shelter_manager')
		});
		expect(portalLayoutMode(menuFor(resolved.roles, resolved.features))).toBe('overview');
	});

	it('the medical override hides station 2 for the previewed role', () => {
		const resolved = resolvePortalPreview({
			realRoles: SA,
			shelterCode: SH,
			features: ON,
			preview: previewOf('registration_staff', 'off')
		});
		const stations = menuFor(resolved.roles, resolved.features)
			.flatMap((v) => v.items)
			.map((i) => i.item.id);
		expect(stations).not.toContain('station-2');
		expect(stations).toContain('station-1');
	});
});
