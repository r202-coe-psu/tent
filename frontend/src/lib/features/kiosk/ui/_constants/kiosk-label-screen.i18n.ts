/** Label screen for kiosks without a printer: the QR labels are shown on screen to photograph. */
const th = {
	previous: 'ก่อนหน้า',
	next: 'ถัดไป',
	done: 'เสร็จสิ้น',
	hint: 'ถ่ายรูป QR นี้เก็บไว้ แล้วแสดงให้เจ้าหน้าที่สแกน',
	counter: (index: number, total: number) => `${index} / ${total}`,
	imageAlt: (index: number, total: number) => `QR ${index} / ${total}`
};

const en: typeof th = {
	previous: 'Previous',
	next: 'Next',
	done: 'Done',
	hint: 'Take a photo of this QR code and show it to staff to scan.',
	counter: (index: number, total: number) => `${index} / ${total}`,
	imageAlt: (index: number, total: number) => `QR ${index} / ${total}`
};

export const KIOSK_LABEL_SCREEN_I18N = { th, en };
