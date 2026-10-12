import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import type { Icon } from '@lucide/svelte';
import {
	hasCapabilityAnywhere,
	isKioskStaffOnly,
	isShelterManager,
	isSystemAdmin,
	SCANNER_MANAGER_CAPABILITIES
} from '$lib/auth/roles';
import Users from '@lucide/svelte/icons/users';
import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import Package from '@lucide/svelte/icons/package';
import FileCheck from '@lucide/svelte/icons/file-check';
import FileText from '@lucide/svelte/icons/file-text';
import Building from '@lucide/svelte/icons/building';
import UserCog from '@lucide/svelte/icons/user-cog';
import Database from '@lucide/svelte/icons/database';
import Warehouse from '@lucide/svelte/icons/warehouse';
import Calculator from '@lucide/svelte/icons/calculator';
import HandHeart from '@lucide/svelte/icons/hand-heart';
import MapPin from '@lucide/svelte/icons/map-pin';
import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import Cpu from '@lucide/svelte/icons/cpu';
import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';

type Leaf = {
	label: string;
	href: ResolvedPathname | null;
	icon: typeof Icon;
	requiresAdmin?: boolean;
	requiresManager?: boolean;
	/** Fine-grained visibility (e.g. capability in any shelter). Wins over the boolean flags. */
	visibleTo?: (roles: readonly string[]) => boolean;
};

type Group = Leaf & {
	children: BackofficeNavbarNode[];
};

export type BackofficeNavbarNode = Leaf | Group;

const isGroup = (n: BackofficeNavbarNode): n is Group => 'children' in n;

export type NavVisibilityContext = {
	roles: readonly string[];
	/** Active shelter — scopes `requiresManager` to a manager of this shelter. */
	shelterCode?: string | null;
};

/**
 * Whether the signed-in user sees a nav node. `visibleTo` wins; a group also needs at least one
 * visible child (no empty parents); otherwise `requiresAdmin` / `requiresManager` apply. A
 * kiosk_staff-only user of the active shelter sees only leaves whose `visibleTo` admits them
 * (FR-SBO-29).
 */
export function canSeeNavNode(node: BackofficeNavbarNode, ctx: NavVisibilityContext): boolean {
	if (node.visibleTo) return node.visibleTo(ctx.roles);
	if (!isGroup(node) && isKioskStaffOnly(ctx.roles, ctx.shelterCode)) return false;
	const isSA = isSystemAdmin(ctx.roles);
	if (node.requiresAdmin && !isSA) return false;
	if (node.requiresManager && !isSA && !isShelterManager(ctx.roles, ctx.shelterCode)) return false;
	if (isGroup(node)) return node.children.some((child) => canSeeNavNode(child, ctx));
	return true;
}

export type BackofficeNavbarGroup = {
	title: string;
	items: BackofficeNavbarNode[];
};

export type BackofficeNavbarLeaf = Leaf;

export const backofficeNavbarGroups: BackofficeNavbarGroup[] = [
	{
		title: '1. ทะเบียนและกำลังพล',
		items: [
			{ label: 'จัดการผู้ประสบภัย', href: resolve('/back-office/evacuee-management'), icon: Users },
			{
				label: 'จัดการอาสาสมัคร',
				href: resolve('/back-office/volunteers'),
				icon: HeartHandshake
			},
			{
				label: 'การส่งต่อผู้ประสบภัย',
				href: resolve('/back-office/referrals'),
				icon: ClipboardList
			}
		]
	},
	{
		title: '2. บริหารทรัพยากร',
		items: [
			{
				label: 'การประเมินความพร้อมศูนย์',
				href: resolve('/back-office/shelters/readiness' as '/back-office/shelters'),
				icon: ClipboardCheck
			},
			{
				label: 'การประเมินประจำวัน',
				href: resolve('/back-office/dailysop'),
				icon: ClipboardList
			},
			{
				label: 'คลัง',
				href: resolve('/back-office/supply'),
				icon: Package
			},
			{
				label: 'บริจาค',
				href: resolve('/back-office/stock-donations'),
				icon: HandHeart
			},
			{
				label: 'จัดการคำร้องเบิกจ่าย',
				href: null,
				icon: ClipboardList,
				children: [
					{
						label: 'จัดการเบิกจ่ายพัสดุและอาหาร',
						href: resolve('/back-office/distribution'),
						icon: ClipboardList
					},
					{
						label: 'โรงครัวและเสบียงอาหาร',
						href: resolve('/back-office/tickets/kitchen'),
						icon: UtensilsCrossed
					}
				]
			},
			{
				label: 'ครัวกลางและอาหาร',
				href: resolve('/back-office/kitchen'),
				icon: UtensilsCrossed
			}
		]
	},
	{
		title: '3. รายงานและการตรวจสอบ',
		items: [
			{ label: 'รายงานความโปร่งใส', href: null, icon: FileCheck },
			{ label: 'รายงานสรุปหลังเหตุการณ์', href: null, icon: FileText }
		]
	},
	{
		title: '4. ตั้งค่าระบบ',
		items: [
			{
				label: 'จัดการศูนย์พักพิง',
				href: resolve('/back-office/shelters'),
				icon: Building
			},
			{ label: 'จัดการผู้ใช้งานและสิทธิ์', href: resolve('/back-office/users'), icon: UserCog },
			{
				label: 'จัดการ Kiosk',
				href: null,
				icon: MonitorSmartphone,
				children: [
					{
						label: 'จัดการอุปกรณ์',
						href: resolve('/back-office/scanners'),
						icon: Cpu,
						visibleTo: (roles) => hasCapabilityAnywhere(roles, SCANNER_MANAGER_CAPABILITIES)
					}
				]
			},
			{
				label: 'จัดการข้อมูลหลัก',
				href: null,
				icon: Database,
				children: [
					{
						label: 'ข้อมูลหลัก',
						href: resolve('/back-office/master-data'),
						icon: Database
					},
					{
						label: 'คลังสินค้า',
						href: resolve('/back-office/supply?tab=catalog' as '/back-office/supply'),
						icon: Warehouse
					},
					{
						label: '5. พารามิเตอร์',
						href: resolve('/back-office/sop-parameters'),
						icon: Calculator
					},
					{ label: '7. โลจิสติกส์ & GIS', href: null, icon: MapPin }
				]
			}
		]
	}
];

export const backofficeHomePath: ResolvedPathname = resolve('/portal');

export { isGroup };
