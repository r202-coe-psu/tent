import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import type { Icon } from '@lucide/svelte';
import {
	Users,
	HeartHandshake,
	ClipboardList,
	Package,
	FileCheck,
	FileText,
	Building,
	UserCog,
	Database,
	Warehouse,
	House,
	Calculator,
	HandHeart,
	MapPin,
	UtensilsCrossed,
	Tent,
	Home
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

export type BackofficeNavbarNode = Leaf | Group;

const isGroup = (n: BackofficeNavbarNode): n is Group => 'children' in n;

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
			{ label: 'จัดการอาสาสมัคร', href: null, icon: HeartHandshake }
		]
	},
	{
		title: '2. บริหารทรัพยากร',
		items: [
			{ label: 'การประเมินประจำวัน (Daily SOP)', href: null, icon: ClipboardList },
			{
				label: 'คลังสิ่งของและบริจาค',
				href: null,
				icon: Package,
				children: [
					{ label: 'แผงควบคุมสต็อก', href: resolve('/back-office/supply'), icon: Warehouse },
					{
						label: 'กระดานรับบริจาค',
						href: resolve('/back-office/stock-donations'),
						icon: HandHeart
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
				label: 'ตั้งค่าโครงสร้างศูนย์',
				href: null,
				icon: Building,
				requiresAdmin: true,
				children: [
					{
						label: 'ตั้งค่าศูนย์พักพิง',
						href: resolve('/back-office/shelters'),
						icon: Building,
						requiresAdmin: true
					},
					{ label: 'จัดการบ้านพี่เลี้ยง', href: null, icon: House }
				]
			},
			{ label: 'จัดการผู้ใช้งานและสิทธิ์', href: resolve('/back-office/users'), icon: UserCog },
			{
				label: 'จัดการข้อมูลหลัก (Master Data)',
				href: null,
				icon: Database,
				children: [
					{
						label: '1. ข้อมูลบุคคล',
						href: resolve('/back-office/registration-config'),
						icon: Users
					},
					{
						label: '2. ตั้งค่าศูนย์พักพิง',
						href: resolve('/back-office/shelter-config'),
						icon: Tent,
						requiresAdmin: true
					},
					{
						label: '3. ตั้งค่าครัวเรือน',
						href: resolve('/back-office/household-master-data'),
						icon: Home,
						requiresAdmin: true
					},
					{ label: '4. คลังสินค้า', href: null, icon: Warehouse },
					{ label: '5. พารามิเตอร์', href: null, icon: Calculator },
					{ label: '6. อาสาสมัคร', href: null, icon: HandHeart },
					{ label: '7. โลจิสติกส์ & GIS', href: null, icon: MapPin }
				]
			}
		]
	}
];

export const backofficeHomePath: ResolvedPathname = resolve('/');

export { isGroup };
