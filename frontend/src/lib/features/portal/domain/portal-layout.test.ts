import { describe, it, expect } from 'vitest';
import {
	filterPortalDepartments,
	portalLayoutMode,
	resolvePortalDepartmentSelection
} from './portal-layout';
import { filterPortalMenu, type PortalDepartmentView } from './portal-menu';

const ON = { medicalScreening: true };
const SH = 'SH001';
const staff = (cap: string) => [`shelter:${SH}`, `${SH}:${cap}`];
const menu = (roles: string[]): PortalDepartmentView[] =>
	filterPortalMenu({ roles, shelterCode: SH, features: ON });
const idsOf = (views: PortalDepartmentView[]) => views.map((v) => v.id);

describe('portalLayoutMode', () => {
	it('is focused for a single visible department', () => {
		expect(portalLayoutMode(menu(staff('registration_staff')))).toBe('focused');
	});

	it('is focused for two visible departments', () => {
		const views = menu([...staff('kitchen_staff'), `${SH}:supply_coordinator`]);
		expect(idsOf(views)).toEqual(['kitchen', 'supply']);
		expect(portalLayoutMode(views)).toBe('focused');
	});

	it('is focused when no department is visible', () => {
		expect(portalLayoutMode([])).toBe('focused');
	});

	it('is overview for three visible departments', () => {
		const views = menu([
			...staff('kitchen_staff'),
			`${SH}:supply_coordinator`,
			`${SH}:volunteer_coordinator`
		]);
		expect(idsOf(views)).toHaveLength(3);
		expect(portalLayoutMode(views)).toBe('overview');
	});

	it('is overview for a system admin (every department visible)', () => {
		expect(portalLayoutMode(menu(['system_admin']))).toBe('overview');
	});
});

describe('resolvePortalDepartmentSelection', () => {
	const views = menu([
		...staff('kitchen_staff'),
		`${SH}:supply_coordinator`,
		`${SH}:volunteer_coordinator`
	]);

	it.each([
		['null', null],
		['undefined', undefined],
		['empty string', ''],
		['all', 'all']
	])('treats %s as all departments', (_label, value) => {
		expect(resolvePortalDepartmentSelection(views, value)).toBe('all');
	});

	it('keeps a visible department id', () => {
		expect(resolvePortalDepartmentSelection(views, 'supply')).toBe('supply');
	});

	it('falls back to all for a department that is not visible to the roles', () => {
		expect(resolvePortalDepartmentSelection(views, 'registration')).toBe('all');
	});

	it('falls back to all for an unknown stored value', () => {
		expect(resolvePortalDepartmentSelection(views, 'not-a-department')).toBe('all');
	});

	it('falls back to all when nothing is visible', () => {
		expect(resolvePortalDepartmentSelection([], 'supply')).toBe('all');
	});
});

describe('filterPortalDepartments', () => {
	const views = menu(['system_admin']);

	it('returns every department in the fixed order for all', () => {
		expect(idsOf(filterPortalDepartments(views, 'all'))).toEqual(idsOf(views));
	});

	it('returns only the selected department', () => {
		const picked = filterPortalDepartments(views, 'kitchen');
		expect(idsOf(picked)).toEqual(['kitchen']);
		expect(picked[0].items.length).toBeGreaterThan(0);
	});

	it('returns every visible department when the selection is not visible', () => {
		const onlyKitchen = menu(staff('kitchen_staff'));
		expect(idsOf(filterPortalDepartments(onlyKitchen, 'supply'))).toEqual(['kitchen']);
	});

	it('returns a new array so callers cannot mutate the input', () => {
		const result = filterPortalDepartments(views, 'all');
		expect(result).not.toBe(views);
	});
});
