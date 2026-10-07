export type Language = {
	code: string;
	name: string;
	isDefault?: boolean;
};

export const SUPPORTED_LANGUAGES: Language[] = [
	{ code: 'th', name: 'ไทย', isDefault: true },
	{ code: 'en', name: 'English' }
];

export const PUBLIC_NAVBAR_I18N = {
	th: {
		appTitle: 'Smart Shelter',
		appSubtitle: 'Public & RFL Portal',
		home: 'หน้าแรก',
		shelters: 'ค้นหาศูนย์พักพิง',
		search: 'ค้นหาผู้พักพิง',
		preRegister: 'ลงทะเบียนล่วงหน้า',
		registerShort: 'ลงทะเบียน',
		donate: 'บริจาค',
		donateAndBook: 'บริจาคและจองคิว',
		trackDonation: 'ตรวจสอบสถานะ',
		trackDonationLong: 'ตรวจสอบสถานะบริจาค',
		volunteers: 'อาสาฯ / พี่เลี้ยง',
		volunteer: 'จิตอาสา',
		volunteerJobBoard: 'สมัครอาสาสมัคร (Job Board)',
		volunteerPortal: 'เข้าสู่ระบบจิตอาสา / ตารางงาน',
		backoffice: 'ระบบหลังบ้าน',
		alerts: 'การแจ้งเตือนภัย',
		switchLanguage: 'เปลี่ยนภาษา (Language)',
		switchLanguageAria: 'Switch to English',
		openMenu: 'เปิดเมนู',
		closeMenu: 'ปิดเมนู',
		menuTitle: 'เมนู'
	},
	en: {
		appTitle: 'Smart Shelter',
		appSubtitle: 'PUBLIC PORTAL',
		home: 'Home',
		shelters: 'Shelters',
		search: 'Search Evacuees',
		preRegister: 'Pre-Registration',
		registerShort: 'Register',
		donate: 'Donate',
		donateAndBook: 'Donate & Queue',
		trackDonation: 'Track Status',
		trackDonationLong: 'Track Donation Status',
		volunteers: 'Volunteer',
		volunteer: 'Volunteer',
		volunteerJobBoard: 'Volunteer Job Board',
		volunteerPortal: 'Volunteer Portal / My Schedule',
		backoffice: 'Backoffice',
		alerts: 'Emergency Alerts',
		switchLanguage: 'Switch Language',
		switchLanguageAria: 'เปลี่ยนเป็นภาษาไทย',
		openMenu: 'Open menu',
		closeMenu: 'Close menu',
		menuTitle: 'Menu'
	}
} as const;

export const PUBLIC_FOOTER_I18N = {
	th: {
		tagline: '',
		emergencyNumbers: 'เบอร์ติดต่อฉุกเฉิน',
		disasterWarning: 'ศูนย์เตือนภัย ปภ.',
		rescueHotline: 'สายด่วนกู้ชีพ',
		onlineChannels: 'ช่องทางออนไลน์ด่วน',
		lineOa: 'LINE OA ฉุกเฉิน',
		facebook: 'Facebook ข่าวสาร EOC',
		copyright: '© 2026 SmartShelter • คุ้มครองข้อมูลตาม พ.ร.บ. PDPA'
	},
	en: {
		tagline: '',
		emergencyNumbers: 'Emergency numbers',
		disasterWarning: 'DDPM warning center',
		rescueHotline: 'Emergency medical hotline',
		onlineChannels: 'Quick online channels',
		lineOa: 'Emergency LINE OA',
		facebook: 'EOC news on Facebook',
		copyright: '© 2026 SmartShelter • Data protected under the Thai PDPA'
	}
} as const;
