/**
 * Portal home menu — one section per department (ฝ่าย), each holding the role-gated tiles shown
 * on `/portal`. Pure data + a pure filter; icons are referenced by key and resolved in the UI
 * layer. Decision sync 2026-10-10 (docs/prd/role-permission-matrix.md, ADR 0001).
 *
 * Visibility rule (see {@link isPortalItemVisible}):
 *  - `system_admin` (global) sees every item.
 *  - `scope: 'system'` items are SA-only.
 *  - `shelter_manager` of the *selected* shelter sees every `scope: 'shelter'` item.
 *  - otherwise an item is visible when the user holds one of its capabilities in the selected
 *    shelter (`hasCapabilityInShelter`); `warehouse_staff` counts as `supply_coordinator`.
 *  - unknown / empty roles see nothing.
 * Items gated by a shelter feature flag (`requires`) additionally follow {@link PortalFeatures}
 * for everyone, SA/SM included. A department with no visible item is not rendered at all.
 *
 * Colour: each department carries one work-domain colour family (`domain`); its items inherit it
 * and carry no colour of their own (see {@link portalDepartmentCssVars}).
 */
import type { Pathname } from '$app/types';
import { domainVar, type DomainId } from '$lib/tokens';
import {
	hasCapabilityInShelter,
	isShelterManager,
	isSystemAdmin,
	isWarehouseStaff
} from '$lib/auth/roles';

export type PortalDepartmentId =
	| 'registration'
	| 'kitchen'
	| 'supply'
	| 'volunteer'
	| 'security'
	| 'facility'
	| 'management'
	| 'central';

export type PortalIconKey =
	| 'ambulance'
	| 'building'
	| 'building-2'
	| 'clipboard-check'
	| 'clipboard-list'
	| 'database'
	| 'globe'
	| 'hand-heart'
	| 'heart-handshake'
	| 'heart-pulse'
	| 'house'
	| 'map-pin'
	| 'monitor'
	| 'package'
	| 'package-check'
	| 'scan-line'
	| 'search'
	| 'settings'
	| 'shield'
	| 'shield-alert'
	| 'tent'
	| 'user-check'
	| 'user-cog'
	| 'users'
	| 'utensils'
	| 'utensils-crossed';

/** Staff capability keys that gate an item (docs/prd/role-permission-matrix.md §1.1). */
export type PortalCapability =
	| 'registration_staff'
	| 'triage_staff'
	| 'medical_staff'
	| 'kitchen_staff'
	| 'supply_coordinator'
	| 'volunteer_coordinator'
	| 'security_officer'
	| 'facility_staff';

/**
 * Per-shelter feature availability. `null` = not known yet (shelter still loading): items that
 * depend on the flag render a skeleton instead of flashing in/out. Defined here so the domain
 * has no dependency on the shelters feature types.
 */
export type PortalFeatures = { medicalScreening: boolean | null };

export type PortalItemState = 'ready' | 'soon' | 'checking';

type PortalHref = Pathname | ((shelterCode: string | null | undefined) => Pathname);

export type PortalMenuItem = {
	id: string;
	label: string;
	desc: string;
	icon: PortalIconKey;
	/** Route (or a resolver from the selected shelter code). `null` = placeholder, no route yet. */
	href: PortalHref | null;
	/** `system` = SA only; `shelter` = SM of the selected shelter + capability holders. */
	scope: 'shelter' | 'system';
	/** Capabilities that may see the item (SA/SM always may when scope is `shelter`). */
	roles: readonly PortalCapability[];
	/** Onsite station number — rendered as a "สถานี N" badge. */
	station?: 1 | 2 | 3;
	/** Sub-section inside a department that has both (registration only). */
	group?: 'stations' | 'tools';
	/** Shelter feature flag this item depends on. */
	requires?: 'medicalScreening';
};

export type PortalDepartment = {
	id: PortalDepartmentId;
	label: string;
	desc: string;
	/**
	 * Work-domain colour family for the whole department; every item inherits it (items are told
	 * apart by icon and station number, never by their own colour).
	 */
	domain: DomainId;
	/** Which step of the family is the department accent; defaults to `base`. */
	tone?: 'base' | 'strong';
	icon: PortalIconKey;
	items: readonly PortalMenuItem[];
};

export type PortalVisibleItem = { item: PortalMenuItem; state: PortalItemState };

export type PortalDepartmentView = Omit<PortalDepartment, 'items'> & {
	items: PortalVisibleItem[];
};

export const PORTAL_GROUP_LABELS: Record<NonNullable<PortalMenuItem['group']>, string> = {
	stations: 'สถานีหน้างาน',
	tools: 'เครื่องมือทะเบียน'
};

const REG = 'registration_staff';
const TRG = 'triage_staff';
const MED = 'medical_staff';
const KS = 'kitchen_staff';
const SC = 'supply_coordinator';
const VC = 'volunteer_coordinator';
const SO = 'security_officer';
const FAC = 'facility_staff';

export const PORTAL_DEPARTMENTS: readonly PortalDepartment[] = [
	{
		id: 'registration',
		label: 'ฝ่ายทะเบียน',
		desc: 'รับลงทะเบียน คัดกรอง และจัดโซนผู้ประสบภัย',
		domain: 'registration',
		icon: 'clipboard-list',
		items: [
			{
				id: 'station-1',
				label: 'ลงทะเบียนครอบครัวและครัวเรือน',
				desc: 'บันทึกผู้ประสบภัย ครอบครัว และออกบัตร QR',
				icon: 'house',
				href: '/onsite/people',
				scope: 'shelter',
				roles: [REG],
				station: 1,
				group: 'stations'
			},
			{
				id: 'station-2',
				label: 'คัดกรองการแพทย์',
				desc: 'คัดกรองอาการและกลุ่มเปราะบางก่อนจัดโซน',
				icon: 'heart-pulse',
				href: '/onsite/medical-screening',
				scope: 'shelter',
				roles: [REG, TRG, MED],
				station: 2,
				group: 'stations',
				requires: 'medicalScreening'
			},
			{
				id: 'station-3',
				label: 'จัดโซน',
				desc: 'จัดผู้ประสบภัยเข้าโซนและเต็นท์ที่พัก',
				icon: 'map-pin',
				href: '/onsite/zoning',
				// FAC keeps direct-URL access via `requireZoning`, but the portal tile is REG only.
				scope: 'shelter',
				roles: [REG],
				station: 3,
				group: 'stations'
			},
			{
				id: 'evacuee-search-edit',
				label: 'ค้นหาและแก้ไขข้อมูลผู้ประสบภัย',
				desc: 'ค้นหาด้วยชื่อหรือเลขบัตร',
				icon: 'search',
				href: '/onsite/search-edit',
				scope: 'shelter',
				roles: [REG],
				group: 'tools'
			},
			{
				id: 'scan-check-in-out',
				label: 'สแกนเข้า-ออกศูนย์',
				desc: 'บันทึกการเข้าออกประจำวัน',
				icon: 'scan-line',
				href: '/onsite/scan-check-in-out',
				scope: 'shelter',
				roles: [REG],
				group: 'tools'
			},
			{
				id: 'evacuee-database',
				label: 'ฐานข้อมูลผู้ประสบภัย',
				desc: 'รายชื่อและครัวเรือนทั้งศูนย์',
				icon: 'database',
				href: '/back-office/evacuee-management',
				scope: 'shelter',
				roles: [REG],
				group: 'tools'
			}
		]
	},
	{
		id: 'kitchen',
		label: 'ฝ่ายครัว',
		desc: 'วางแผนอาหารและเบิกวัตถุดิบ',
		domain: 'kitchen',
		icon: 'utensils',
		items: [
			{
				id: 'kitchen-hub',
				label: 'ครัวกลางและอาหาร',
				desc: 'แผนมื้ออาหารและการบริการ',
				icon: 'utensils-crossed',
				href: '/back-office/kitchen',
				scope: 'shelter',
				roles: [KS]
			},
			{
				id: 'kitchen-requisition',
				label: 'เบิกวัตถุดิบครัว',
				desc: 'ใบเบิกวัตถุดิบและเสบียงอาหาร',
				icon: 'clipboard-check',
				href: '/back-office/tickets/kitchen',
				scope: 'shelter',
				roles: [KS]
			}
		]
	},
	{
		id: 'supply',
		label: 'ฝ่ายพัสดุและคลัง',
		desc: 'คลัง ของบริจาค และการแจกจ่าย',
		domain: 'donation',
		icon: 'package',
		items: [
			{
				id: 'warehouse',
				label: 'คลังพัสดุและสต็อก',
				desc: 'รับ จ่าย และตรวจนับ',
				icon: 'package',
				href: '/back-office/supply',
				scope: 'shelter',
				roles: [SC]
			},
			{
				id: 'stock-donations',
				label: 'รับบริจาค',
				desc: 'รับของบริจาคเข้าคลัง',
				icon: 'hand-heart',
				href: '/back-office/stock-donations',
				scope: 'shelter',
				roles: [SC]
			},
			{
				id: 'supply-distribution',
				label: 'เบิกจ่ายพัสดุและอาหาร',
				desc: 'ใบเบิกจากฝ่ายต่างๆ',
				icon: 'clipboard-list',
				href: '/back-office/distribution',
				scope: 'shelter',
				roles: [SC]
			},
			{
				id: 'frontline-distribution',
				label: 'จุดแจกจ่ายพัสดุและอาหาร',
				desc: 'แจกของรายครัวเรือนหน้างาน',
				icon: 'package-check',
				href: '/onsite/distribution',
				scope: 'shelter',
				roles: [SC]
			}
		]
	},
	{
		id: 'volunteer',
		label: 'ฝ่ายอาสาสมัคร',
		desc: 'งานอาสา กะงาน และการเช็คอิน',
		domain: 'volunteer',
		icon: 'heart-handshake',
		items: [
			{
				id: 'volunteer-management',
				label: 'จัดการอาสาสมัครและกะงาน',
				desc: 'ประกาศงานและจัดกะ',
				icon: 'users',
				href: '/back-office/volunteers',
				scope: 'shelter',
				roles: [VC]
			},
			{
				id: 'volunteer-check-in',
				label: 'เช็คอินอาสาสมัครเข้างาน',
				desc: 'รับรายงานตัวหน้าศูนย์',
				icon: 'user-check',
				href: '/onsite/volunteer-check-in',
				scope: 'shelter',
				roles: [VC]
			}
		]
	},
	{
		id: 'security',
		label: 'ฝ่ายรักษาความปลอดภัย',
		desc: 'เหตุการณ์และจุดเข้าออก',
		domain: 'security',
		icon: 'shield',
		items: [
			{
				id: 'security-incidents',
				label: 'ความปลอดภัยและเหตุการณ์',
				desc: 'บันทึกเหตุไม่ปลอดภัย',
				icon: 'shield-alert',
				href: null,
				scope: 'shelter',
				roles: [SO]
			}
		]
	},
	{
		id: 'facility',
		label: 'ฝ่ายอาคารสถานที่',
		desc: 'โซน เต็นท์ และสาธารณูปโภค',
		domain: 'facility',
		icon: 'building-2',
		items: [
			{
				id: 'zone-settings',
				label: 'ตั้งค่าโซน',
				desc: 'กำหนดโซน ความจุ ประเภท เปิด/ปิด',
				icon: 'tent',
				// Owner decision: placeholder until the zone configuration screen ships.
				href: null,
				scope: 'shelter',
				roles: [FAC]
			}
		]
	},
	{
		id: 'management',
		label: 'ฝ่ายบริหารศูนย์',
		desc: 'ภาพรวม ผู้ใช้ และการตั้งค่าของศูนย์',
		domain: 'admin',
		icon: 'building',
		items: [
			{
				id: 'shelter-manage',
				label: 'จัดการศูนย์พักพิงและโซน',
				desc: 'ข้อมูลศูนย์และโซนทั้งหมด',
				icon: 'building',
				href: (code) =>
					code
						? (`/back-office/shelters/edit/${encodeURIComponent(code)}` as Pathname)
						: '/back-office/shelters',
				scope: 'shelter',
				roles: []
			},
			{
				id: 'shelter-readiness',
				label: 'ความพร้อมของศูนย์',
				desc: 'ประเมินความพร้อมรายวัน',
				icon: 'clipboard-check',
				href: '/back-office/shelters/readiness',
				scope: 'shelter',
				roles: []
			},
			{
				id: 'shelter-users',
				label: 'ผู้ใช้งานของศูนย์',
				desc: 'บัญชีและบทบาทในศูนย์',
				icon: 'user-cog',
				href: '/back-office/users',
				scope: 'shelter',
				roles: []
			},
			{
				id: 'referrals',
				label: 'การส่งต่อผู้ประสบภัย',
				desc: 'ส่งต่อโรงพยาบาลหรือศูนย์อื่น',
				icon: 'ambulance',
				href: '/back-office/referrals',
				scope: 'shelter',
				roles: []
			},
			{
				id: 'back-office',
				label: 'ระบบหลังบ้าน',
				desc: 'ตั้งค่าและรายงานของศูนย์',
				icon: 'monitor',
				href: '/back-office',
				scope: 'shelter',
				roles: []
			}
		]
	},
	{
		id: 'central',
		label: 'ส่วนกลาง',
		desc: 'สำหรับผู้ดูแลระบบส่วนกลางเท่านั้น',
		domain: 'admin',
		tone: 'strong',
		icon: 'settings',
		items: [
			{
				id: 'system-management',
				label: 'ตั้งค่าระบบส่วนกลาง',
				desc: 'ศูนย์ทั้งหมดและผู้ใช้ทั้งระบบ',
				icon: 'settings',
				href: '/system-management',
				scope: 'system',
				roles: []
			}
		]
	}
];

/** Footer link for any authenticated user with a role — deliberately not part of a department. */
export const PORTAL_PUBLIC_LINK = {
	label: 'เว็บไซต์บริการประชาชน',
	href: '/',
	icon: 'globe'
} as const satisfies { label: string; href: Pathname; icon: PortalIconKey };

/** True when the footer public-site link should show (an authenticated user with ≥1 role). */
export function canSeePortalPublicLink(roles: readonly string[]): boolean {
	return roles.length > 0;
}

/**
 * CSS custom properties a department section sets for its tiles (from the domain tokens):
 * `--c` accent (icons), `--c-strong`, `--c-subtle`, `--c-border`, `--c-text`. The `central`
 * department uses the `strong` step of its family as the accent.
 */
export function portalDepartmentCssVars(
	department: Pick<PortalDepartment, 'domain' | 'tone'>
): Record<'--c' | '--c-strong' | '--c-subtle' | '--c-border' | '--c-text', string> {
	const { domain, tone = 'base' } = department;
	return {
		'--c': domainVar(domain, tone),
		'--c-strong': domainVar(domain, 'strong'),
		'--c-subtle': domainVar(domain, 'subtle'),
		'--c-border': domainVar(domain, 'border'),
		'--c-text': domainVar(domain, 'text')
	};
}

/** Resolve an item's route for the selected shelter; `null` for placeholders. */
export function resolvePortalHref(
	item: PortalMenuItem,
	selectedShelterCode: string | null | undefined
): Pathname | null {
	if (item.href === null) return null;
	return typeof item.href === 'function' ? item.href(selectedShelterCode) : item.href;
}

function holdsCapability(
	roles: readonly string[],
	shelterCode: string | null | undefined,
	capability: PortalCapability
): boolean {
	// warehouse_staff is an alias of supply_coordinator in the portal (matrix §1.1).
	if (capability === 'supply_coordinator') return isWarehouseStaff(roles, shelterCode);
	return hasCapabilityInShelter(roles, shelterCode, capability);
}

/** Role-only visibility (ignores feature flags). */
export function isPortalItemVisible(
	item: PortalMenuItem,
	roles: readonly string[],
	selectedShelterCode: string | null | undefined
): boolean {
	if (roles.length === 0) return false;
	if (isSystemAdmin(roles)) return true;
	if (item.scope === 'system') return false;
	if (isShelterManager(roles, selectedShelterCode)) return true;
	return item.roles.some((capability) => holdsCapability(roles, selectedShelterCode, capability));
}

function itemState(item: PortalMenuItem, features: PortalFeatures): PortalItemState | null {
	if (item.requires && features[item.requires] === false) return null;
	if (item.requires && features[item.requires] === null) return 'checking';
	return item.href === null ? 'soon' : 'ready';
}

export type FilterPortalMenuInput = {
	roles: readonly string[];
	shelterCode: string | null | undefined;
	features: PortalFeatures;
};

/** Ordered departments with only the items the user may see (empty departments are dropped). */
export function filterPortalMenu({
	roles,
	shelterCode,
	features
}: FilterPortalMenuInput): PortalDepartmentView[] {
	const views: PortalDepartmentView[] = [];
	for (const department of PORTAL_DEPARTMENTS) {
		const items: PortalVisibleItem[] = [];
		for (const item of department.items) {
			if (!isPortalItemVisible(item, roles, shelterCode)) continue;
			const state = itemState(item, features);
			if (state !== null) items.push({ item, state });
		}
		if (items.length > 0) views.push({ ...department, items });
	}
	return orderForRole(views, roles, shelterCode);
}

/**
 * Departments a role works in most, shown first: SA → central then management, SM (of the
 * selected shelter) → management. Everyone else keeps the declared order.
 */
export function portalPriorityDepartments(
	roles: readonly string[],
	shelterCode: string | null | undefined
): readonly PortalDepartmentId[] {
	if (isSystemAdmin(roles)) return ['central', 'management'];
	if (isShelterManager(roles, shelterCode)) return ['management'];
	return [];
}

function orderForRole(
	views: PortalDepartmentView[],
	roles: readonly string[],
	shelterCode: string | null | undefined
): PortalDepartmentView[] {
	const priority = portalPriorityDepartments(roles, shelterCode);
	if (priority.length === 0) return views;
	const rank = (id: PortalDepartmentId) => {
		const index = priority.indexOf(id);
		return index === -1 ? priority.length : index;
	};
	// Array#sort is stable, so non-priority departments keep their declared order.
	return [...views].sort((a, b) => rank(a.id) - rank(b.id));
}
