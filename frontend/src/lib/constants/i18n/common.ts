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
		shelters: 'ตรวจสอบศูนย์พักพิง',
		search: 'สืบค้นญาติ',
		donate: 'บริจาค',
		donateAndBook: 'บริจาคและจองคิว',
		trackDonation: 'ตรวจสอบสถานะ',
		trackDonationLong: 'ตรวจสอบสถานะบริจาค',
		backoffice: 'ระบบหลังบ้าน'
	},
	en: {
		appTitle: 'Smart Shelter',
		appSubtitle: 'Public & RFL Portal',
		home: 'Home',
		shelters: 'Check Shelters',
		search: 'Find Relatives',
		donate: 'Donate',
		donateAndBook: 'Donate & Queue',
		trackDonation: 'Track Status',
		trackDonationLong: 'Track Donation Status',
		backoffice: 'Backoffice'
	}
} as const;
