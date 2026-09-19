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
		switchLanguage: 'เปลี่ยนภาษา (Language)'
	},
	en: {
		appTitle: 'Smart Shelter',
		appSubtitle: 'PUBLIC PORTAL',
		home: 'Home',
		shelters: 'Shelters',
		search: 'Search Evacuees',
		preRegister: 'Pre-Registration',
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
		switchLanguage: 'Switch Language'
	}
} as const;
