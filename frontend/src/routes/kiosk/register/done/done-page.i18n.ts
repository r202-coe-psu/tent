import { CONSENT_COPY } from '$lib/features/consent';

/** Walk-in done page strings (route-local: a route may not reach into feature internals). */
const th = {
	pageTitle: 'ลงทะเบียนสำเร็จ — SmartShelter Kiosk',
	wizardStep: 'ลงทะเบียน',
	title: 'ลงทะเบียนสำเร็จ',
	takeQrThaid: 'รับ QR Code แล้วไปที่จุดคัดกรอง',
	takeQrCard: 'กรุณานำบัตรออกจากเครื่อง รับ QR Code แล้วไปที่จุดคัดกรอง',
	// The consent block's own wording, so the reference reads the same as on the consent screen.
	consentRef: CONSENT_COPY.summary.ref,
	printFailedHint: (error: string) => `${error} กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่`,
	printRenderFailed: 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ',
	removeCard: 'กรุณานำบัตรออกจากเครื่อง',
	contactStaff: 'กรุณาติดต่อเจ้าหน้าที่เพื่อพิมพ์ QR Code',
	printAgain: 'พิมพ์อีกครั้ง',
	home: 'กลับหน้าแรก'
};

const en: typeof th = {
	pageTitle: 'Registration complete — SmartShelter Kiosk',
	wizardStep: 'Register',
	title: 'Registration complete',
	takeQrThaid: 'Take your QR Code, then go to the screening point',
	takeQrCard:
		'Please take your card out of the reader, take your QR Code, then go to the screening point',
	consentRef: 'Consent reference',
	printFailedHint: (error: string) => `${error} Press print again or contact staff.`,
	printRenderFailed: 'Could not create the QR Code to print',
	removeCard: 'Please take your card out of the reader',
	contactStaff: 'Please contact staff to print your QR Code',
	printAgain: 'Print again',
	home: 'Back to home'
};

export const KIOSK_REGISTER_DONE_I18N = { th, en };
