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
		donateAndBook: 'แจ้งบริจาคสิ่งของ',
		trackDonation: 'ตรวจสอบสถานะการบริจาค',
		trackDonationLong: 'ตรวจสอบสถานะการบริจาค',
		volunteer: 'จิตอาสา',
		backoffice: 'สำหรับเจ้าหน้าที่',
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
		donateAndBook: 'Donate Supplies',
		trackDonation: 'Track Donation',
		trackDonationLong: 'Track Donation',
		volunteer: 'Volunteer',
		backoffice: 'Staff Portal',
		alerts: 'Emergency Alerts',
		switchLanguage: 'Switch Language'
	}
} as const;
