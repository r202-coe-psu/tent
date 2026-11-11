/** Copy of the "kiosk closed" page (/kiosk/closed), shown while an admin has closed this device. */
const th = {
	pageTitle: 'ตู้ปิดให้บริการ',
	title: 'ตู้นี้ปิดให้บริการชั่วคราว',
	body: 'ขณะนี้ไม่เปิดให้ลงทะเบียนหรือรายงานตัว กรุณาติดต่อเจ้าหน้าที่',
	languageGroupAria: 'เปลี่ยนภาษา'
};

const en: typeof th = {
	pageTitle: 'Kiosk closed',
	title: 'This kiosk is temporarily closed',
	body: 'Registration and check-in are not available right now. Please contact staff.',
	languageGroupAria: 'Change language'
};

export const KIOSK_CLOSED_PAGE_I18N = { th, en };

/** Each language names itself in its own script, so the switch reads the same in either language. */
export const KIOSK_CLOSED_LANGUAGE_OPTIONS = [
	{ code: 'th', label: 'ไทย' },
	{ code: 'en', label: 'English' }
] as const;
