import { describe, expect, it, vi } from 'vitest';
import Users from '@lucide/svelte/icons/users';
import {
	activeNavHref,
	backofficeNavbarGroups,
	canSeeNavNode,
	isGroup,
	navLeafHrefs,
	type BackofficeNavbarNode,
	type NavVisibilityContext
} from './static';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const ctx = (roles: string[], shelterCode: string | null = 'SH001') => ({ roles, shelterCode });

const leaf = (extra: Partial<BackofficeNavbarNode> = {}): BackofficeNavbarNode => ({
	label: 'ทดสอบ',
	href: null,
	icon: Users,
	...extra
});

describe('canSeeNavNode — visibleTo', () => {
	it('lets visibleTo grant a leaf that the flags would hide', () => {
		const node = leaf({ requiresAdmin: true, visibleTo: () => true });
		expect(canSeeNavNode(node, ctx(['registration_staff']))).toBe(true);
	});

	it('lets visibleTo hide a leaf that the flags would show, even for system_admin', () => {
		const node = leaf({ visibleTo: () => false });
		expect(canSeeNavNode(node, ctx(['system_admin']))).toBe(false);
	});

	it('decides from the roles it is given', () => {
		const node = leaf({ visibleTo: (roles) => roles.includes('SH001:shelter_manager') });
		expect(canSeeNavNode(node, ctx(['SH001:shelter_manager']))).toBe(true);
		expect(canSeeNavNode(node, ctx(['SH001:registration_staff']))).toBe(false);
	});
});

describe('canSeeNavNode — requiresAdmin', () => {
	const node = leaf({ requiresAdmin: true });

	it('shows an admin-only leaf to system_admin', () => {
		expect(canSeeNavNode(node, ctx(['system_admin']))).toBe(true);
	});

	it('hides an admin-only leaf from everyone else', () => {
		expect(canSeeNavNode(node, ctx(['SH001:shelter_manager']))).toBe(false);
		expect(canSeeNavNode(node, ctx(['registration_staff']))).toBe(false);
	});
});

describe('canSeeNavNode — requiresManager', () => {
	const node = leaf({ requiresManager: true });

	it('shows a manager-only leaf to the manager of the active shelter', () => {
		expect(canSeeNavNode(node, ctx(['shelter:SH001', 'SH001:shelter_manager'], 'SH001'))).toBe(
			true
		);
	});

	it('hides it from a manager of a different shelter', () => {
		expect(canSeeNavNode(node, ctx(['shelter:SH002', 'SH002:shelter_manager'], 'SH001'))).toBe(
			false
		);
	});

	it('hides it from non-managers', () => {
		expect(canSeeNavNode(node, ctx(['shelter:SH001', 'SH001:registration_staff'], 'SH001'))).toBe(
			false
		);
	});

	it('shows it to system_admin regardless of the active shelter', () => {
		expect(canSeeNavNode(node, ctx(['system_admin'], 'SH001'))).toBe(true);
		expect(canSeeNavNode(node, ctx(['system_admin'], null))).toBe(true);
	});
});

describe('canSeeNavNode — groups', () => {
	const group = (children: BackofficeNavbarNode[], extra: Partial<BackofficeNavbarNode> = {}) =>
		({ ...leaf(extra), children }) as BackofficeNavbarNode;

	it('hides a group whose children are all hidden', () => {
		const node = group([leaf({ requiresAdmin: true }), leaf({ visibleTo: () => false })]);
		expect(canSeeNavNode(node, ctx(['registration_staff']))).toBe(false);
	});

	it('shows a group when at least one child is visible', () => {
		const node = group([leaf({ requiresAdmin: true }), leaf()]);
		expect(canSeeNavNode(node, ctx(['registration_staff']))).toBe(true);
	});

	it('counts a nested group as visible only through its own visible children', () => {
		const hiddenInner = group([leaf({ requiresAdmin: true })]);
		const visibleInner = group([leaf()]);
		expect(canSeeNavNode(group([hiddenInner]), ctx(['registration_staff']))).toBe(false);
		expect(canSeeNavNode(group([hiddenInner, visibleInner]), ctx(['registration_staff']))).toBe(
			true
		);
	});

	it('still applies the group’s own flags on top of its children', () => {
		const node = group([leaf()], { requiresAdmin: true });
		expect(canSeeNavNode(node, ctx(['registration_staff']))).toBe(false);
		expect(canSeeNavNode(node, ctx(['system_admin']))).toBe(true);
	});

	it('lets a group’s visibleTo win over its children', () => {
		const node = group([leaf({ visibleTo: () => false })], { visibleTo: () => true });
		expect(canSeeNavNode(node, ctx(['registration_staff']))).toBe(true);
	});
});

describe('real backofficeNavbarGroups — visible leaves per role (regression guard)', () => {
	const visibleLeafLabels = (c: NavVisibilityContext): string[] => {
		const walk = (nodes: BackofficeNavbarNode[]): string[] =>
			nodes
				.filter((n) => canSeeNavNode(n, c))
				.flatMap((n) => (isGroup(n) ? walk(n.children) : [n.label]));
		return backofficeNavbarGroups.flatMap((g) => walk(g.items));
	};

	const everyoneSees = [
		'จัดการผู้เข้าพัก',
		'จัดการอาสาสมัคร',
		'การส่งต่อผู้เข้าพัก',
		'การประเมินความพร้อมศูนย์',
		'การประเมินประจำวัน',
		'คลัง',
		'บริจาค',
		'จัดการเบิกจ่ายพัสดุและอาหาร',
		'เบิกวัตถุดิบครัว',
		'ครัวกลางและอาหาร',
		'รายงานความโปร่งใส',
		'รายงานสรุปหลังเหตุการณ์',
		'จัดการศูนย์พักพิง',
		'จัดการผู้ใช้งานและสิทธิ์',
		'ข้อมูลหลัก',
		'คลังสินค้า',
		'พารามิเตอร์',
		'โลจิสติกส์ & GIS'
	];
	const incidentLog = 'บันทึกเหตุการณ์ประจำวัน';
	const withIncidents = (labels: string[]): string[] => {
		const at = labels.indexOf('ครัวกลางและอาหาร') + 1;
		return [...labels.slice(0, at), incidentLog, ...labels.slice(at)];
	};
	const scannerDevices = 'จัดการอุปกรณ์';
	const bannerManagement = 'จัดการแบนเนอร์';
	const afterUsers = everyoneSees.indexOf('จัดการผู้ใช้งานและสิทธิ์') + 1;
	const withScanners = [
		...everyoneSees.slice(0, afterUsers),
		scannerDevices,
		bannerManagement,
		...everyoneSees.slice(afterUsers)
	];
	const withScannersAndIncidents = withIncidents(withScanners);

	it('system_admin sees every leaf', () => {
		expect(visibleLeafLabels(ctx(['system_admin']))).toEqual(withScannersAndIncidents);
	});

	it('the shelter_manager of the active shelter sees every leaf', () => {
		const roles = ['shelter:SH001', 'SH001:shelter_manager'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual(withScannersAndIncidents);
	});

	it('registration_staff does not see the kiosk device management', () => {
		const roles = ['shelter:SH001', 'SH001:registration_staff'];
		const labels = visibleLeafLabels(ctx(roles, 'SH001'));
		expect(labels).toEqual(everyoneSees);
		expect(labels).not.toContain(scannerDevices);
		expect(labels).not.toContain(bannerManagement);
		expect(labels).not.toContain('จัดการ Kiosk');
	});

	it('a manager of another shelter keeps the kiosk devices', () => {
		const roles = ['shelter:SH002', 'SH002:shelter_manager'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual(withScannersAndIncidents);
	});

	it('incident log is visible to system_admin, security_officer and shelter_manager only', () => {
		const sees = (roles: string[]) => visibleLeafLabels(ctx(roles, 'SH001')).includes(incidentLog);
		expect(sees(['system_admin'])).toBe(true);
		expect(sees(['shelter:SH001', 'SH001:security_officer'])).toBe(true);
		expect(sees(['shelter:SH001', 'SH001:shelter_manager'])).toBe(true);
		expect(sees(['shelter:SH001', 'SH001:kitchen_staff'])).toBe(false);
		expect(sees(['shelter:SH001', 'SH001:registration_staff'])).toBe(false);
	});

	it('kiosk_staff-only sees the kiosk device and banner management, nothing else (AC-SBO-21, FR-KBR-22)', () => {
		const roles = ['shelter:SH001', 'SH001:kiosk_staff'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual([scannerDevices, bannerManagement]);
		const kioskGroup = backofficeNavbarGroups
			.flatMap((g) => g.items)
			.find((n) => n.label === 'จัดการ Kiosk');
		expect(kioskGroup && canSeeNavNode(kioskGroup, ctx(roles, 'SH001'))).toBe(true);
	});

	it('pr_staff-only sees only the banner management and its Kiosk group (#930)', () => {
		const roles = ['shelter:SH001', 'SH001:pr_staff'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual([bannerManagement]);
		const kioskGroup = backofficeNavbarGroups
			.flatMap((g) => g.items)
			.find((n) => n.label === 'จัดการ Kiosk');
		expect(kioskGroup && canSeeNavNode(kioskGroup, ctx(roles, 'SH001'))).toBe(true);
	});

	it('kiosk_staff together with pr_staff sees both kiosk leaves (#930)', () => {
		const roles = ['shelter:SH001', 'SH001:kiosk_staff', 'SH001:pr_staff'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual([scannerDevices, bannerManagement]);
	});

	it('kiosk_staff with another capability in the shelter keeps the other menus too', () => {
		const roles = ['shelter:SH001', 'SH001:kiosk_staff', 'SH001:registration_staff'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual(withScanners);
	});
});

describe('activeNavHref — longest path-segment match (FR-KBR-24, draft CR kiosk-banner-design-revision)', () => {
	const hrefs = ['/back-office/kiosks', '/back-office/kiosks/banners', '/back-office/users'];

	it('picks the nested item on its own page and sub-pages', () => {
		expect(activeNavHref('/back-office/kiosks/banners', hrefs)).toBe('/back-office/kiosks/banners');
		expect(activeNavHref('/back-office/kiosks/banners/new', hrefs)).toBe(
			'/back-office/kiosks/banners'
		);
		expect(activeNavHref('/back-office/kiosks/banners/compact', hrefs)).toBe(
			'/back-office/kiosks/banners'
		);
	});

	it('picks the parent item when the path is not under the nested one', () => {
		expect(activeNavHref('/back-office/kiosks', hrefs)).toBe('/back-office/kiosks');
		expect(activeNavHref('/back-office/kiosks/KSK-001', hrefs)).toBe('/back-office/kiosks');
	});

	it('is order independent', () => {
		expect(activeNavHref('/back-office/kiosks/banners', [...hrefs].reverse())).toBe(
			'/back-office/kiosks/banners'
		);
	});

	it('matches whole path segments only', () => {
		expect(activeNavHref('/back-office/kiosks-x', hrefs)).toBeNull();
		expect(activeNavHref('/back-office/kiosks/bannersX', hrefs)).toBe('/back-office/kiosks');
	});

	it('ignores a trailing slash on the path', () => {
		expect(activeNavHref('/back-office/kiosks/banners/', hrefs)).toBe(
			'/back-office/kiosks/banners'
		);
	});

	it('returns null when nothing matches', () => {
		expect(activeNavHref('/portal', hrefs)).toBeNull();
		expect(activeNavHref('/back-office/kiosks', [])).toBeNull();
	});
});

describe('kiosk banner management nav child (FR-KBR-22)', () => {
	const kioskChildren = () => {
		const group = backofficeNavbarGroups
			.flatMap((g) => g.items)
			.find((n) => n.label === 'จัดการ Kiosk');
		return group && isGroup(group) ? group.children : [];
	};

	it('sits right after the device management and links to the banner list', () => {
		const children = kioskChildren();
		expect(children.map((c) => c.label)).toEqual(['จัดการอุปกรณ์', 'จัดการแบนเนอร์']);
		expect(children[1].href).toBe('/back-office/kiosks/banners');
	});
});

describe('navLeafHrefs', () => {
	it('collects every leaf href of the real nav, skipping null hrefs and group parents', () => {
		const hrefs = navLeafHrefs(backofficeNavbarGroups);
		expect(hrefs).toContain('/back-office/kiosks');
		expect(hrefs).toContain('/back-office/distribution');
		expect(hrefs).not.toContain(null);
		expect(hrefs.every((h) => typeof h === 'string')).toBe(true);
	});
});
