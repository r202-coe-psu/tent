import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import type { Icon } from '@lucide/svelte';
import {
	Calculator,
	KeyRound,
	MapPin,
	Megaphone,
	Settings,
	Shield,
	Users,
	Building,
	UserCog,
	Warehouse,
	Cpu,
	LayoutDashboard,
	ClipboardList,
	Database
} from '@lucide/svelte/icons';

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
						label: 'ความปลอดภัย / reCAPTCHA',
						href: resolve(`${base}/security`),
						icon: Shield,
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
