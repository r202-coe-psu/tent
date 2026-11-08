const th = {
	clearSearchAria: 'ล้างคำค้น',
	scanQr: 'สแกน QR',
	searching: 'กำลังค้นหา...',
	thisShelter: 'ในศูนย์นี้',
	statusLabel: 'สถานะ:',
	zoneName: (name: string) => `โซน ${name}`,
	idCardLabel: 'เลขบัตร:',
	phoneLabel: 'โทร:',
	viewStatus: 'ดูสถานะ',
	centralQueue: 'คิวกลาง',
	retry: 'ลองอีกครั้ง',
	registeredAt: (when: string) => `ลงทะเบียนเมื่อ ${when}`,
	claimIntoShelter: 'รับเข้าศูนย์',
	notFoundInPool: 'ไม่พบในคิวกลาง',
	notFoundTitle: 'ไม่พบรายการ',
	registerNowHint: 'ลงทะเบียนใหม่ได้ทันที'
};

const en: typeof th = {
	clearSearchAria: 'Clear search',
	scanQr: 'Scan QR',
	searching: 'Searching...',
	thisShelter: 'In this shelter',
	statusLabel: 'Status:',
	zoneName: (name: string) => `Zone ${name}`,
	idCardLabel: 'ID no.:',
	phoneLabel: 'Phone:',
	viewStatus: 'View status',
	centralQueue: 'Central queue',
	retry: 'Try again',
	registeredAt: (when: string) => `Registered ${when}`,
	claimIntoShelter: 'Claim into shelter',
	notFoundInPool: 'Not found in the central queue',
	notFoundTitle: 'No records found',
	registerNowHint: 'You can register them as new right away'
};

export const STATION1_INTAKE_I18N = { th, en };
