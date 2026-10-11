import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import type { Icon } from '@lucide/svelte';
import Calculator from '@lucide/svelte/icons/calculator';
import KeyRound from '@lucide/svelte/icons/key-round';
import MapPin from '@lucide/svelte/icons/map-pin';
import Megaphone from '@lucide/svelte/icons/megaphone';
import Settings from '@lucide/svelte/icons/settings';
import Shield from '@lucide/svelte/icons/shield';
import Users from '@lucide/svelte/icons/users';
import Building from '@lucide/svelte/icons/building';
import UserCog from '@lucide/svelte/icons/user-cog';
import Warehouse from '@lucide/svelte/icons/warehouse';
import Cpu from '@lucide/svelte/icons/cpu';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import Database from '@lucide/svelte/icons/database';
import Flag from '@lucide/svelte/icons/flag';

type Leaf = {
	label: string;
	href: ResolvedPathname | null;
	icon: typeof Icon;
	requiresAdmin?: boolean;
};

type Group = Leaf & {
	children: Leaf[];
};

export type SystemManagementNavbarNode = Leaf | Group;

const isGroup = (node: SystemManagementNavbarNode): node is Group => 'children' in node;

export type SystemManagementNavbarGroup = {
	title: string;
	items: SystemManagementNavbarNode[];
};

const base = '/system-management';

export const systemManagementNavbarGroups: SystemManagementNavbarGroup[] = [
	{
		title: 'ศูนย์สั่งการและภาพรวม',
		items: [
			{
				label: 'ภาพรวมระบบ',
				href: resolve(`${base}/overview`),
				icon: LayoutDashboard,
				requiresAdmin: true
			},
			{
				label: 'ลงทะเบียนล่วงหน้า',
				href: resolve(`${base}/pre-registrations`),
				icon: ClipboardList,
				requiresAdmin: true
			},
			{
				label: 'การจัดการประกาศด่วน',
				href: resolve(`${base}/announcements`),
				icon: Megaphone
			},
			{
				label: 'จัดการศูนย์พักพิง',
				href: resolve(`${base}/shelters`),
				icon: Building,
				requiresAdmin: true
			},
			{
				label: 'จัดการผู้ใช้งานและสิทธิ์',
				href: resolve(`${base}/users`),
				icon: UserCog,
				requiresAdmin: true
			},
			{
				label: 'API Keys',
				href: resolve(`${base}/api-keys`),
				icon: KeyRound,
				requiresAdmin: true
			},
			{
				label: 'เครื่องสแกนบัตร (Scanners)',
				href: resolve(`${base}/scanners`),
				icon: Cpu,
				requiresAdmin: true
			}
		]
	},
	{
		title: 'การตั้งค่าระบบส่วนกลาง',
		items: [
			{
				label: 'ตั้งค่าระบบ',
				href: null,
				icon: Settings,
				children: [
					{
						label: 'Master Data',
						href: resolve(`${base}/master-data`),
						icon: Database,
						requiresAdmin: true
					},
					{
						label: 'คลังสินค้า',
						href: resolve(`${base}/catalog`),
						icon: Warehouse,
						requiresAdmin: true
					},
					{
						label: 'พารามิเตอร์มาตรฐาน SOP',
						href: resolve(`${base}/sop-parameters`),
						icon: Calculator,
						requiresAdmin: true
					},
					{
						label: 'คำถามที่พบบ่อย (FAQ)',
						href: resolve(`${base}/public-portal-config`),
						icon: Megaphone,
						requiresAdmin: true
					},
					{
						label: 'อาสาสมัคร',
						href: resolve(`${base}/volunteer-config`),
						icon: Users,
						requiresAdmin: true
					},
					{
						label: 'ความปลอดภัย / reCAPTCHA',
						href: resolve(`${base}/security`),
						icon: Shield,
						requiresAdmin: true
					},
					{
						label: 'แบนเนอร์ระบบ',
						href: resolve(`${base}/system-banner`),
						icon: Flag,
						requiresAdmin: true
					},
					{ label: 'งานอาสาสมัคร', href: null, icon: Users },
					{ label: 'โลจิสติกส์และผังพิกัด (GIS)', href: null, icon: MapPin }
				]
			}
		]
	}
];

export const systemManagementHomePath: ResolvedPathname = resolve('/system-management');

export { isGroup };
