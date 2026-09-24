export type IdentityMethodId = 'qr' | 'smart-card' | 'phone' | 'thaid';

export interface IdentityMethodDefinition {
	id: IdentityMethodId;
	icon: 'qr' | 'card' | 'phone' | 'thaid';
	title: string;
	description?: string;
	buttonLabel: string;
	enabled: boolean;
	href?: typeof KIOSK_QR_PATH | typeof KIOSK_CARD_PATH;
}

export const KIOSK_QR_PATH = '/kiosk/qr';
export const KIOSK_CARD_PATH = '/kiosk/scanner/waiting';

export const IDENTITY_METHODS: readonly IdentityMethodDefinition[] = [
	{
		id: 'qr',
		icon: 'qr',
		title: 'QR ลงทะเบียน',
		description: 'สแกน QR ที่ได้รับจากการลงทะเบียนล่วงหน้า',
		buttonLabel: 'สแกน QR',
		enabled: true,
		href: KIOSK_QR_PATH
	},
	{
		id: 'smart-card',
		icon: 'card',
		title: 'บัตรประชาชน',
		description: 'เสียบบัตรที่ใช้ลงทะเบียน',
		buttonLabel: 'เสียบบัตร',
		enabled: true,
		href: KIOSK_CARD_PATH
	},
	{
		id: 'phone',
		icon: 'phone',
		title: 'เบอร์โทรศัพท์',
		buttonLabel: 'ยังไม่เปิดใช้งาน',
		enabled: false
	},
	{
		id: 'thaid',
		icon: 'thaid',
		title: 'ThaiD',
		buttonLabel: 'ยังไม่เปิดใช้งาน',
		enabled: false
	}
] as const;
