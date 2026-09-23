export type IdentityMethodId = 'qr' | 'smart-card' | 'phone' | 'thaid';

export interface IdentityMethodDefinition {
	id: IdentityMethodId;
	icon: 'qr' | 'card' | 'phone' | 'thaid';
	title: string;
	description: string;
	facts: readonly string[];
	buttonLabel: string;
	enabled: boolean;
	href?: string;
}

export const KIOSK_QR_PATH = '/kiosk/qr';
export const KIOSK_CARD_PATH = '/kiosk/scanner/waiting';

export const IDENTITY_METHODS: readonly IdentityMethodDefinition[] = [
	{
		id: 'qr',
		icon: 'qr',
		title: 'สแกน QR Code',
		description: 'สแกน QR จากการจอง แล้วกรอกเบอร์โทรศัพท์ที่ใช้จองเพื่อยืนยันข้อมูล',
		facts: ['เตรียม QR จากอีเมลหรือ SMS', 'ใช้เบอร์โทรศัพท์ที่ลงทะเบียน'],
		buttonLabel: 'สแกน QR Code',
		enabled: true,
		href: KIOSK_QR_PATH
	},
	{
		id: 'smart-card',
		icon: 'card',
		title: 'บัตรประชาชนแบบ Smart Card',
		description: 'เสียบบัตรประชาชนที่เครื่องอ่าน ระบบจะดึงข้อมูลพื้นฐานให้อัตโนมัติ',
		facts: ['ใช้เวลาประมาณ 1–2 นาที', 'เตรียมบัตรประชาชนตัวจริง'],
		buttonLabel: 'เสียบบัตรประชาชน',
		enabled: true,
		href: KIOSK_CARD_PATH
	},
	{
		id: 'phone',
		icon: 'phone',
		title: 'ยืนยันด้วยเบอร์โทรศัพท์',
		description: 'ค้นหาข้อมูลการลงทะเบียนด้วยเบอร์โทรศัพท์ที่แจ้งไว้',
		facts: [],
		buttonLabel: 'ยังไม่เปิดใช้งาน',
		enabled: false
	},
	{
		id: 'thaid',
		icon: 'thaid',
		title: 'ยืนยันผ่านแอป ThaiD',
		description: 'สแกน QR Code และยืนยันผ่านแอป ThaiD บนโทรศัพท์ของคุณ',
		facts: [],
		buttonLabel: 'ยังไม่เปิดใช้งาน',
		enabled: false
	}
] as const;
