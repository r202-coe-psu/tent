import { describe, expect, it, vi } from 'vitest';
import Users from '@lucide/svelte/icons/users';
import {
	backofficeNavbarGroups,
	canSeeNavNode,
	isGroup,
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
		'จัดการผู้ประสบภัย',
		'จัดการอาสาสมัคร',
		'การส่งต่อผู้ประสบภัย',
		'การประเมินความพร้อมศูนย์',
		'การประเมินประจำวัน',
		'คลัง',
		'บริจาค',
		'จัดการเบิกจ่ายพัสดุและอาหาร',
		'โรงครัวและเสบียงอาหาร',
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
	const scannerDevices = 'จัดการอุปกรณ์';
	const afterUsers = everyoneSees.indexOf('จัดการผู้ใช้งานและสิทธิ์') + 1;
	const withScanners = [
		...everyoneSees.slice(0, afterUsers),
		scannerDevices,
		...everyoneSees.slice(afterUsers)
	];

	it('system_admin sees every leaf', () => {
		expect(visibleLeafLabels(ctx(['system_admin']))).toEqual(withScanners);
	});

	it('the shelter_manager of the active shelter sees every leaf', () => {
		const roles = ['shelter:SH001', 'SH001:shelter_manager'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual(withScanners);
	});

	it('registration_staff does not see the kiosk device management', () => {
		const roles = ['shelter:SH001', 'SH001:registration_staff'];
		const labels = visibleLeafLabels(ctx(roles, 'SH001'));
		expect(labels).toEqual(everyoneSees);
		expect(labels).not.toContain(scannerDevices);
		expect(labels).not.toContain('จัดการ Kiosk');
	});

	it('a manager of another shelter keeps the kiosk devices', () => {
		const roles = ['shelter:SH002', 'SH002:shelter_manager'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual(withScanners);
	});

	it('kiosk_staff-only sees the kiosk device management and nothing else (AC-SBO-21)', () => {
		const roles = ['shelter:SH001', 'SH001:kiosk_staff'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual([scannerDevices]);
		const kioskGroup = backofficeNavbarGroups
			.flatMap((g) => g.items)
			.find((n) => n.label === 'จัดการ Kiosk');
		expect(kioskGroup && canSeeNavNode(kioskGroup, ctx(roles, 'SH001'))).toBe(true);
	});

	it('kiosk_staff with another capability in the shelter keeps the other menus too', () => {
		const roles = ['shelter:SH001', 'SH001:kiosk_staff', 'SH001:registration_staff'];
		expect(visibleLeafLabels(ctx(roles, 'SH001'))).toEqual(withScanners);
	});
});
