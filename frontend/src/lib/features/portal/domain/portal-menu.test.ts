import { describe, it, expect } from 'vitest';
import {
	PORTAL_DEPARTMENTS,
	canSeePortalPublicLink,
	filterPortalMenu,
	isPortalItemVisible,
	resolvePortalHref,
	type PortalDepartmentView,
	type PortalFeatures,
	type PortalItemState
} from './portal-menu';

const ON: PortalFeatures = { medicalScreening: true };
const OFF: PortalFeatures = { medicalScreening: false };
const UNKNOWN: PortalFeatures = { medicalScreening: null };

const SA = ['system_admin'];
const staff = (cap: string, code = 'SH001') => [`shelter:${code}`, `${code}:${cap}`];

function menu(
	roles: string[],
	features: PortalFeatures = ON,
	shelterCode: string | null = 'SH001'
) {
	return filterPortalMenu({ roles, shelterCode, features });
}
const deptIds = (views: PortalDepartmentView[]) => views.map((v) => v.id);
const itemIds = (view: PortalDepartmentView | undefined) => view?.items.map((i) => i.item.id) ?? [];
const dept = (views: PortalDepartmentView[], id: string) => views.find((v) => v.id === id);
const stations = (views: PortalDepartmentView[]) =>
	(dept(views, 'registration')?.items ?? []).flatMap((i) =>
		i.item.station ? [i.item.station] : []
	);
const stateOf = (views: PortalDepartmentView[], id: string): PortalItemState | undefined =>
	views.flatMap((v) => v.items).find((i) => i.item.id === id)?.state;

const ORDER = [
	'registration',
	'kitchen',
	'supply',
	'volunteer',
	'security',
	'facility',
	'management',
	'central'
];

describe('filterPortalMenu — system admin', () => {
	it('sees every department in the fixed order with the flag on', () => {
		const views = menu(SA, ON);
		expect(deptIds(views)).toEqual(ORDER);
		expect(stations(views)).toEqual([1, 2, 3]);
		expect(stateOf(views, 'station-2')).toBe('ready');
	});

	it('hides Station 2 when the flag is off (even for SA)', () => {
		const views = menu(SA, OFF);
		expect(deptIds(views)).toEqual(ORDER);
		expect(stations(views)).toEqual([1, 3]);
	});

	it('shows Station 2 as checking while the flag is unknown', () => {
		const views = menu(SA, UNKNOWN);
		expect(stations(views)).toEqual([1, 2, 3]);
		expect(stateOf(views, 'station-2')).toBe('checking');
	});

	it('sees the central department regardless of the selected shelter', () => {
		expect(deptIds(menu(SA, ON, null))).toContain('central');
	});
});

describe('filterPortalMenu — shelter manager', () => {
	const sm = ['shelter:SH001', 'SH001:shelter_manager'];

	it('sees everything in their own shelter except the central department', () => {
		const views = menu(sm, ON);
		expect(deptIds(views)).toEqual(ORDER.filter((id) => id !== 'central'));
		expect(itemIds(dept(views, 'management'))).toEqual([
			'shelter-manage',
			'shelter-readiness',
			'shelter-users',
			'referrals',
			'back-office'
		]);
	});

	it('also has Station 2 gated by the shelter flag', () => {
		expect(stations(menu(sm, OFF))).toEqual([1, 3]);
		expect(stateOf(menu(sm, UNKNOWN), 'station-2')).toBe('checking');
	});

	it('points the shelter-manage tile at the selected shelter, or the list when none', () => {
		const item = PORTAL_DEPARTMENTS.flatMap((d) => d.items).find((i) => i.id === 'shelter-manage')!;
		expect(resolvePortalHref(item, 'SH001')).toBe('/back-office/shelters/edit/SH001');
		expect(resolvePortalHref(item, null)).toBe('/back-office/shelters');
	});

	it('is only a manager in the shelter they manage', () => {
		const roles = [
			'shelter:SH001',
			'shelter:SH002',
			'SH001:shelter_manager',
			'SH002:registration_staff'
		];
		const views = menu(roles, ON, 'SH002');
		expect(deptIds(views)).toEqual(['registration']);
		expect(stations(views)).toEqual([1, 2, 3]);
		expect(dept(views, 'management')).toBeUndefined();
	});
});

describe('filterPortalMenu — registration_staff', () => {
	it('sees only registration: stations 1-3 and the three tools when the flag is on', () => {
		const views = menu(staff('registration_staff'), ON);
		expect(deptIds(views)).toEqual(['registration']);
		expect(stations(views)).toEqual([1, 2, 3]);
		expect(itemIds(dept(views, 'registration'))).toEqual([
			'station-1',
			'station-2',
			'station-3',
			'evacuee-search-edit',
			'scan-check-in-out',
			'evacuee-database'
		]);
	});

	it('sees stations 1 and 3 when the flag is off', () => {
		const views = menu(staff('registration_staff'), OFF);
		expect(stations(views)).toEqual([1, 3]);
		expect(itemIds(dept(views, 'registration'))).not.toContain('station-2');
	});

	it('sees a Station 2 skeleton (checking) while the flag is unknown', () => {
		const views = menu(staff('registration_staff'), UNKNOWN);
		expect(stateOf(views, 'station-2')).toBe('checking');
		expect(stateOf(views, 'station-1')).toBe('ready');
	});
});

describe('filterPortalMenu — flag unknown only affects Station 2 viewers', () => {
	it('shows nothing as checking for kitchen staff', () => {
		const views = menu(staff('kitchen_staff'), UNKNOWN);
		expect(views.flatMap((v) => v.items).some((i) => i.state === 'checking')).toBe(false);
	});

	it('shows nothing as checking for facility staff', () => {
		const views = menu(staff('facility_staff'), UNKNOWN);
		expect(views.flatMap((v) => v.items).some((i) => i.state === 'checking')).toBe(false);
	});
});

describe('filterPortalMenu — single-department roles', () => {
	it('facility_staff sees only the facility placeholder, no Station 3 tile', () => {
		const views = menu(staff('facility_staff'), ON);
		expect(deptIds(views)).toEqual(['facility']);
		expect(itemIds(dept(views, 'facility'))).toEqual(['zone-settings']);
		expect(stateOf(views, 'zone-settings')).toBe('soon');
		expect(itemIds(dept(views, 'registration'))).toEqual([]);
	});

	it.each(['triage_staff', 'medical_staff'])(
		'%s sees only Station 2 under registration (flag on)',
		(cap) => {
			const views = menu(staff(cap), ON);
			expect(deptIds(views)).toEqual(['registration']);
			expect(itemIds(dept(views, 'registration'))).toEqual(['station-2']);
		}
	);

	it.each(['triage_staff', 'medical_staff'])('%s sees nothing when the flag is off', (cap) => {
		expect(menu(staff(cap), OFF)).toEqual([]);
	});

	it('kitchen_staff sees only the kitchen department', () => {
		const views = menu(staff('kitchen_staff'));
		expect(deptIds(views)).toEqual(['kitchen']);
		expect(itemIds(views[0])).toEqual(['kitchen-hub', 'kitchen-requisition']);
	});

	it('supply_coordinator sees only the supply department', () => {
		const views = menu(staff('supply_coordinator'));
		expect(deptIds(views)).toEqual(['supply']);
		expect(itemIds(views[0])).toEqual([
			'warehouse',
			'stock-donations',
			'supply-distribution',
			'frontline-distribution'
		]);
	});

	it('warehouse_staff is treated as supply_coordinator', () => {
		expect(menu(staff('warehouse_staff'))).toEqual(menu(staff('supply_coordinator')));
	});

	it('volunteer_coordinator sees only the volunteer department', () => {
		const views = menu(staff('volunteer_coordinator'));
		expect(deptIds(views)).toEqual(['volunteer']);
		expect(itemIds(views[0])).toEqual(['volunteer-management', 'volunteer-check-in']);
	});

	it('security_officer sees only the security placeholder', () => {
		const views = menu(staff('security_officer'));
		expect(deptIds(views)).toEqual(['security']);
		expect(stateOf(views, 'security-incidents')).toBe('soon');
	});
});

describe('filterPortalMenu — multiple capabilities and shelter scope', () => {
	it('shows each held department in the fixed order', () => {
		const roles = [
			'shelter:SH001',
			'SH001:security_officer',
			'SH001:kitchen_staff',
			'SH001:registration_staff'
		];
		expect(deptIds(menu(roles, ON))).toEqual(['registration', 'kitchen', 'security']);
	});

	it('does not show a capability held in another shelter', () => {
		const roles = [
			'shelter:SH001',
			'shelter:SH002',
			'SH001:registration_staff',
			'SH002:kitchen_staff'
		];
		expect(deptIds(menu(roles, ON, 'SH001'))).toEqual(['registration']);
		expect(deptIds(menu(roles, ON, 'SH002'))).toEqual(['kitchen']);
	});
});

describe('filterPortalMenu — no usable roles', () => {
	it.each([[[]], [['foo']], [['shelter:SH001']]])('returns nothing for %j', (roles) => {
		expect(menu(roles, ON)).toEqual([]);
	});

	it('does not let an unknown role see items for the selected shelter', () => {
		expect(isPortalItemVisible(PORTAL_DEPARTMENTS[0].items[0], ['foo'], 'SH001')).toBe(false);
	});
});

describe('canSeePortalPublicLink', () => {
	it('needs at least one role', () => {
		expect(canSeePortalPublicLink([])).toBe(false);
		expect(canSeePortalPublicLink(['foo'])).toBe(true);
		expect(canSeePortalPublicLink(staff('kitchen_staff'))).toBe(true);
	});
});

describe('portal data integrity', () => {
	const all = PORTAL_DEPARTMENTS.flatMap((d) => d.items.map((item) => ({ dept: d.id, item })));

	it('lists departments in the fixed order', () => {
		expect(PORTAL_DEPARTMENTS.map((d) => d.id)).toEqual(ORDER);
	});

	it('has unique item ids, each in exactly one department', () => {
		const ids = all.map((a) => a.item.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('only the registration department has stations, exactly 1, 2 and 3', () => {
		const withStation = all.filter((a) => a.item.station);
		expect(new Set(withStation.map((a) => a.dept))).toEqual(new Set(['registration']));
		expect(withStation.map((a) => a.item.station).sort()).toEqual([1, 2, 3]);
	});

	it('placeholders are exactly the items without a route', () => {
		const noRoute = all.filter((a) => a.item.href === null).map((a) => a.item.id);
		const soon = menu(SA, ON)
			.flatMap((v) => v.items)
			.filter((i) => i.state === 'soon')
			.map((i) => i.item.id);
		expect(soon.sort()).toEqual(noRoute.sort());
		expect(noRoute.sort()).toEqual(['security-incidents', 'zone-settings']);
	});

	it('only the central item is system scope', () => {
		expect(all.filter((a) => a.item.scope === 'system').map((a) => a.item.id)).toEqual([
			'system-management'
		]);
	});

	it('only Station 2 depends on the medical flag', () => {
		expect(all.filter((a) => a.item.requires).map((a) => a.item.id)).toEqual(['station-2']);
	});
});
