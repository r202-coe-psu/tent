const th = {
	filterAria: 'กรองเมนูตามฝ่าย',
	all: 'ทั้งหมด',
	empty: 'ยังไม่มีเมนูสำหรับบทบาทของคุณในศูนย์นี้',
	stationBadge: (n: number) => `สถานี ${n}`,
	checkingEnablement: (label: string) => `กำลังตรวจสอบการเปิดใช้งาน ${label}`,
	comingSoon: 'เร็วๆ นี้',
	menuUnit: 'เมนู'
};

const en: typeof th = {
	filterAria: 'Filter menu by department',
	all: 'All',
	empty: 'No menu items for your role in this shelter yet',
	stationBadge: (n: number) => `Station ${n}`,
	checkingEnablement: (label: string) => `Checking availability of ${label}`,
	comingSoon: 'Coming soon',
	menuUnit: 'items'
};

export const PORTAL_MENU_I18N = { th, en };
