/** Walk-in phone page strings (route-local: a route may not reach into feature internals). */
const th = {
	pageTitle: 'เบอร์โทรศัพท์ — SmartShelter Kiosk',
	stepConsent: 'ยินยอม',
	stepThaid: 'ThaiD',
	stepCard: 'อ่านบัตร',
	stepPhone: 'เบอร์โทร',
	failedTitle: 'ลงทะเบียนไม่สำเร็จ',
	failedRetry: 'ลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง',
	scanThaidAgain: 'สแกน ThaiD ใหม่',
	retry: 'ลองอีกครั้ง',
	cancel: 'ยกเลิก',
	savingTitle: 'กำลังบันทึกข้อมูล',
	pleaseWait: 'กรุณารอสักครู่'
};

const en: typeof th = {
	pageTitle: 'Phone number — SmartShelter Kiosk',
	stepConsent: 'Consent',
	stepThaid: 'ThaiD',
	stepCard: 'Read card',
	stepPhone: 'Phone',
	failedTitle: 'Registration failed',
	failedRetry: 'Registration failed. Please try again.',
	scanThaidAgain: 'Scan ThaiD again',
	retry: 'Try again',
	cancel: 'Cancel',
	savingTitle: 'Saving your details',
	pleaseWait: 'Please wait'
};

export const KIOSK_REGISTER_PHONE_PAGE_I18N = { th, en };
