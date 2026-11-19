import { CONSENT_COPY } from '$lib/features/consent';

/** Walk-in done page strings (route-local: a route may not reach into feature internals). */
const th = {
	pageTitle: 'ลงทะเบียนสำเร็จ — SmartShelter Kiosk',
	wizardStep: 'ลงทะเบียน',
	title: 'ลงทะเบียนสำเร็จ',
	takeQrThaid: 'รับ QR Code แล้วไปที่จุดคัดกรอง',
	takeQrCard: 'กรุณานำบัตรออกจากเครื่อง รับ QR Code แล้วไปที่จุดคัดกรอง',
	// The consent block's own wording, so the reference reads the same as on the consent screen.
	consentRef: CONSENT_COPY.summary.ref as string,
	printFailedHint: (error: string) => `${error} กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่`,
	printRenderFailed: 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ',
	qrIssueFailed: 'ออก QR ไม่สำเร็จ ยังไม่ได้พิมพ์ กรุณาติดต่อเจ้าหน้าที่เพื่อพิมพ์ QR ใหม่',
	removeCard: 'กรุณานำบัตรออกจากเครื่อง',
	contactStaff: 'กรุณาติดต่อเจ้าหน้าที่เพื่อพิมพ์ QR Code',
	printAgain: 'พิมพ์อีกครั้ง',
	showOnScreen: 'แสดง QR บนจอแทน',
	home: 'กลับหน้าแรก',
	/** The same texts for a kiosk without a printer: the QR is shown on screen, nothing is printed. */
	onScreen: {
		failedHint: (error: string) => `${error} กดแสดง QR อีกครั้ง หรือติดต่อเจ้าหน้าที่`,
		printRenderFailed: 'สร้าง QR Code ไม่สำเร็จ',
		qrIssueFailed: 'ออก QR ไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่เพื่อแสดง QR ใหม่',
		contactStaff: 'กรุณาติดต่อเจ้าหน้าที่เพื่อแสดง QR Code',
		showAgain: 'แสดง QR อีกครั้ง'
	}
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
	qrIssueFailed:
		'Could not issue a QR, so nothing was printed. Please contact staff to print a new QR.',
	removeCard: 'Please take your card out of the reader',
	contactStaff: 'Please contact staff to print your QR Code',
	printAgain: 'Print again',
	showOnScreen: 'Show the QR on screen instead',
	home: 'Back to home',
	onScreen: {
		failedHint: (error: string) => `${error} Press show QR again or contact staff.`,
		printRenderFailed: 'Could not create the QR Code',
		qrIssueFailed: 'Could not issue a QR. Please contact staff to show a new QR.',
		contactStaff: 'Please contact staff to show your QR Code',
		showAgain: 'Show QR again'
	}
};

export const KIOSK_REGISTER_DONE_I18N = { th, en };
