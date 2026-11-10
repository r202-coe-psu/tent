import {
	localizeReprintReason,
	REPRINT_NOBODY_REASON,
	REPRINT_PRE_REGISTERED_REASON
} from '../domain/check-in-status';

/** What the reprint flow tells the visitor when a step fails or is blocked. */
const th = {
	notFound: 'ไม่พบข้อมูลที่ลงทะเบียนด้วยเบอร์นี้',
	rateLimited: 'ลองผิดหลายครั้ง กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่',
	unverifiable: 'ไม่สามารถยืนยันตัวตนได้ กรุณาติดต่อเจ้าหน้าที่',
	verifyFailed: 'เลข 4 ตัวท้ายไม่ถูกต้อง',
	generic: 'ระบบไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง',
	printRenderFailed: 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ',
	tooManyMatches: 'พบหลายรายการ กรุณาติดต่อเจ้าหน้าที่',
	methodDisabled: 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่',
	/** CR-233 FR-EQR-24: no QR could be issued, so nothing is printed. */
	qrIssueFailed: 'ออก QR ใหม่ไม่สำเร็จ ยังไม่ได้พิมพ์ กรุณาลองอีกครั้งหรือติดต่อเจ้าหน้าที่',
	blockedPreRegistered: REPRINT_PRE_REGISTERED_REASON,
	blockedNobody: REPRINT_NOBODY_REASON
};

const en: typeof th = {
	notFound: 'No record was found for this phone number',
	rateLimited: 'Too many wrong tries. Please wait a moment or contact staff.',
	unverifiable: 'We could not verify who you are. Please contact staff.',
	verifyFailed: 'The last 4 digits are not correct',
	generic: 'The system could not complete this. Please try again.',
	printRenderFailed: 'Could not create the QR Code to print',
	tooManyMatches: 'Several records matched. Please contact staff.',
	methodDisabled: 'This option is switched off. Please contact staff.',
	qrIssueFailed:
		'Could not issue a new QR, so nothing was printed. Please try again or contact staff.',
	blockedPreRegistered: localizeReprintReason(REPRINT_PRE_REGISTERED_REASON, 'en'),
	blockedNobody: localizeReprintReason(REPRINT_NOBODY_REASON, 'en')
};

export type ReprintSessionMessages = typeof th;

export const REPRINT_SESSION_I18N = { th, en };
