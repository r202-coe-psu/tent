import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import type { Icon } from '@lucide/svelte';
import {
	BANNER_MANAGER_CAPABILITIES,
	hasCapabilityAnywhere,
	isKioskStaffOnly,
	isShelterManager,
	isSystemAdmin,
	canAccessIncidents,
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
import ForkSpoon from '$lib/components/icons/fork-spoon.svelte';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import NotebookPen from '@lucide/svelte/icons/notebook-pen';
import Cpu from '@lucide/svelte/icons/cpu';
import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
import Images from '@lucide/svelte/icons/images';

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
 * kiosk_staff-only or pr_staff-only user of the active shelter sees only leaves whose `visibleTo`
 * admits them (FR-SBO-29): device management admits SCANNER_MANAGER_CAPABILITIES holders, banner
 * management admits BANNER_MANAGER_CAPABILITIES holders (#930).
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
			{ label: 'จัดการผู้เข้าพัก', href: resolve('/back-office/evacuee-management'), icon: Users },
			{
				label: 'จัดการอาสาสมัคร',
				href: resolve('/back-office/volunteers'),
				icon: HeartHandshake
			},
			{
				label: 'การส่งต่อผู้เข้าพัก',
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
						label: 'เบิกวัตถุดิบครัว',
						href: resolve('/back-office/tickets/kitchen'),
						icon: ClipboardCheck
					}
				]
			},
			{
				label: 'ครัวกลางและอาหาร',
				href: resolve('/back-office/kitchen'),
				icon: ForkSpoon
			}
		]
	},
	{
		title: '3. รายงานและการตรวจสอบ',
		items: [
			{
				label: 'บันทึกเหตุการณ์ประจำวัน',
				href: resolve('/back-office/incidents'),
				icon: NotebookPen,
				visibleTo: (roles) => canAccessIncidents(roles)
			},
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
						href: resolve('/back-office/kiosks'),
						icon: Cpu,
						visibleTo: (roles) => hasCapabilityAnywhere(roles, SCANNER_MANAGER_CAPABILITIES)
					},
					{
						label: 'จัดการแบนเนอร์',
						href: resolve('/back-office/kiosks/banners'),
						icon: Images,
						visibleTo: (roles) => hasCapabilityAnywhere(roles, BANNER_MANAGER_CAPABILITIES)
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
						label: 'พารามิเตอร์',
						href: resolve('/back-office/sop-parameters'),
						icon: Calculator
					},
					{ label: 'โลจิสติกส์ & GIS', href: null, icon: MapPin }
				]
			}
		]
	}
];

export const backofficeHomePath: ResolvedPathname = resolve('/portal');

const stripTrailingSlash = (path: string): string => path.replace(/\/$/, '');

/** Every non-null nav href in the tree (groups included), depth-first. */
export function navLeafHrefs(
	items: readonly BackofficeNavbarNode[] | readonly BackofficeNavbarGroup[]
): string[] {
	const result: string[] = [];
	const walk = (nodes: readonly (BackofficeNavbarNode | BackofficeNavbarGroup)[]): void => {
		for (const node of nodes) {
			if ('items' in node) {
				walk(node.items);
				continue;
			}
			if (node.href) result.push(String(node.href));
			if (isGroup(node)) walk(node.children);
		}
	};
	walk(items);
	return result;
}

/**
 * The single nav href that owns `path`: the LONGEST href equal to the path or a path-segment
 * prefix of it (`href + '/'`). Lets a nested page (`/kiosks/banners`) win over its parent
 * (`/kiosks`) — FR-KBR-24, draft CR kiosk-banner-design-revision. Null when no href matches.
 */
export function activeNavHref(path: string, hrefs: readonly string[]): string | null {
	const current = stripTrailingSlash(path);
	let best: string | null = null;
	for (const href of hrefs) {
		const target = stripTrailingSlash(href);
		if (current !== target && !current.startsWith(target + '/')) continue;
		if (best === null || target.length > stripTrailingSlash(best).length) best = href;
	}
	return best;
}

export { isGroup };
