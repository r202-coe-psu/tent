import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import type { Icon } from '@lucide/svelte';
import {
	House,
	Home,
	MapPin,
	Megaphone,
	Settings,
	Tent,
	Users,
	Building
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

const base = '/portal/system-management';

export const systemManagementNavbarGroups: SystemManagementNavbarGroup[] = [
	{
		title: '1. ศูนย์สั่งการและภาพรวม',
		items: [
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
			{ label: 'จัดการบ้านพี่เลี้ยง', href: resolve(`${base}/host-houses`), icon: House }
		]
	},
	{
		title: '2. ตั้งค่าระบบส่วนกลาง',
		items: [
			{
				label: 'ตั้งค่าระบบ',
				href: null,
				icon: Settings,
				children: [
					{
						label: '1. ข้อมูลหลักบุคคล',
						href: resolve(`${base}/registration-config`),
						icon: Users,
						requiresAdmin: true
					},
					{
						label: '2. ตั้งค่าศูนย์พักพิง',
						href: resolve(`${base}/shelter-config`),
						icon: Tent,
						requiresAdmin: true
					},
					{
						label: '3. ตั้งค่าครัวเรือน',
						href: resolve(`${base}/household-master-data`),
						icon: Home,
						requiresAdmin: true
					},
					{ label: '4. อาสาสมัคร', href: null, icon: Users },
					{ label: '5. โลจิสติกส์ & GIS', href: null, icon: MapPin }
				]
			}
		]
	}
];

export const systemManagementHomePath: ResolvedPathname = resolve('/portal/system-management');

export { isGroup };
