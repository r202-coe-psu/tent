/** ThaiD scan screen strings. */
const th = {
	pageTitle: 'สแกนด้วย ThaiD — SmartShelter Kiosk',
	wizardStep: 'สแกนด้วย ThaiD',
	heading: 'สแกน QR ด้วยมือถือ',
	steps: ['เปิดกล้องหรือ LINE', 'สแกน QR', 'ยืนยันในแอป ThaiD'],
	qrAlt: 'QR สำหรับยืนยันตัวตนด้วย ThaiD',
	creatingQr: 'กำลังสร้าง QR',
	expiresIn: (countdown: string) => `QR หมดอายุใน ${countdown}`,
	expired: {
		title: 'QR หมดอายุ',
		body: 'กรุณาสร้าง QR ใหม่แล้วสแกนอีกครั้ง',
		newQr: 'สร้าง QR ใหม่'
	},
	rateLimited: {
		title: 'ขอ QR บ่อยเกินไป',
		body: 'กรุณารอสักครู่ แล้วลองอีกครั้ง'
	},
	unavailable: {
		title: 'ใช้ ThaiD ไม่ได้ในขณะนี้',
		body: 'ระบบ ThaiD ไม่พร้อมใช้งาน กรุณาลองอีกครั้ง หรือเลือกวิธีอื่น'
	},
	retry: 'ลองอีกครั้ง',
	backHome: 'กลับหน้าเริ่มต้น'
};

const en: typeof th = {
	pageTitle: 'Scan with ThaiD — SmartShelter Kiosk',
	wizardStep: 'Scan with ThaiD',
	heading: 'Scan the QR with your phone',
	steps: ['Open the camera or LINE', 'Scan the QR', 'Confirm in the ThaiD app'],
	qrAlt: 'QR code to verify your identity with ThaiD',
	creatingQr: 'Creating QR',
	expiresIn: (countdown) => `QR expires in ${countdown}`,
	expired: {
		title: 'QR expired',
		body: 'Please create a new QR and scan again.',
		newQr: 'New QR'
	},
	rateLimited: {
		title: 'Too many QR requests',
		body: 'Please wait a moment, then try again.'
	},
	unavailable: {
		title: 'ThaiD is unavailable right now',
		body: 'ThaiD is not available. Please try again or choose another method.'
	},
	retry: 'Try again',
	backHome: 'Back to start'
};

export const KIOSK_THAID_I18N = { th, en };
