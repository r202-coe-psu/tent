const th = {
	unspecified: 'ไม่ระบุ',
	via: {
		kiosk: 'ตู้ Kiosk',
		web: 'ออนไลน์ Web',
		staff: 'โต๊ะเจ้าหน้าที่',
		backoffice: 'Backoffice',
		import: 'นำเข้าไฟล์',
		paper: 'เอกสารกระดาษ',
		app: 'แอปพลิเคชัน'
	} as Record<string, string>
};

const en: typeof th = {
	unspecified: 'Not specified',
	via: {
		kiosk: 'Kiosk',
		web: 'Online (Web)',
		staff: 'Staff desk',
		backoffice: 'Backoffice',
		import: 'File import',
		paper: 'Paper form',
		app: 'Application'
	}
};

export const SHARED_BADGES_I18N = { th, en };
