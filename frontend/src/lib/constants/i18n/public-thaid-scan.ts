import { getTranslation } from '$lib/utils/i18n';

export const PUBLIC_THAID_SCAN_I18N = {
	th: {
		pageTitleError: 'เกิดข้อผิดพลาดในการยืนยันตัวตน',
		pageTitleSuccess: 'ยืนยันตัวตนสำเร็จ',
		errorHeading: 'ยืนยันตัวตนไม่สำเร็จ',
		backHome: 'กลับสู่หน้าหลัก',
		kioskSuccessHeading: 'ยืนยันตัวตนสำเร็จ',
		kioskSuccessBody: 'กลับไปที่ตู้เพื่อเลือกสมาชิกและรับบัตรคิว ปิดหน้านี้ได้',
		successHeading: 'ยืนยันตัวตนสำเร็จ!',
		successBody: 'ข้อมูลของคุณถูกส่งไปยังหน้าจอลงทะเบียนหลักแล้ว',
		successSaved: '✓ บันทึกข้อมูลส่วนตัวและที่อยู่เรียบร้อย',
		successCloseWindow: 'ท่านสามารถปิดหน้าต่างเบราว์เซอร์นี้ได้ทันที',
		errorKioskInvalidState: 'ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่ที่ตู้',
		errorInvalidState:
			'ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่จากหน้าจอลงทะเบียน',
		errorKioskSessionExpired: 'QR หมดอายุ กรุณาสร้าง QR ใหม่ที่ตู้',
		errorThaidDisabled: 'ระบบยืนยันตัวตน ThaiD ถูกปิดใช้งานชั่วคราว',
		errorSessionExpired: 'QR Code นี้หมดอายุแล้ว กรุณาแจ้งผู้ลงทะเบียนหลักเพื่อสร้าง QR Code ใหม่',
		errorMissingSession: 'ไม่พบรหัสการเชื่อมต่อ (Invalid Session)',
		errorGeneric: 'การยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
	},
	en: {
		pageTitleError: 'Identity verification error',
		pageTitleSuccess: 'Identity verified',
		errorHeading: 'Identity verification failed',
		backHome: 'Back to home',
		kioskSuccessHeading: 'Identity verified',
		kioskSuccessBody:
			'Go back to the kiosk to choose household members and collect your queue ticket. You can close this page.',
		successHeading: 'Identity verified!',
		successBody: 'Your details have been sent to the main registration screen.',
		successSaved: '✓ Personal details and address saved',
		successCloseWindow: 'You can close this browser window now.',
		errorKioskInvalidState:
			'The verification data is invalid or has expired. Please scan a new QR code at the kiosk.',
		errorInvalidState:
			'The verification data is invalid or has expired. Please scan a new QR code from the registration screen.',
		errorKioskSessionExpired:
			'The QR code has expired. Please generate a new QR code at the kiosk.',
		errorThaidDisabled: 'ThaiD identity verification is temporarily disabled.',
		errorSessionExpired:
			'This QR code has expired. Please ask the primary registrant to generate a new QR code.',
		errorMissingSession: 'Connection code not found (Invalid Session)',
		errorGeneric: 'Identity verification failed. Please try again.'
	}
};

/** Message for the ThaiD scan result page, chosen by the `error` query param. */
export function thaidScanMessage(
	errorParam: string | null,
	lang: string | undefined,
	isKioskFlow = false
): string {
	const t = getTranslation(PUBLIC_THAID_SCAN_I18N, lang);
	if (isKioskFlow && errorParam === 'invalid_state') return t.errorKioskInvalidState;
	if (errorParam === 'invalid_state') return t.errorInvalidState;
	if (isKioskFlow && errorParam === 'session_expired') return t.errorKioskSessionExpired;
	if (errorParam === 'thaid_disabled') return t.errorThaidDisabled;
	if (errorParam === 'session_expired') return t.errorSessionExpired;
	if (errorParam === 'missing_session') return t.errorMissingSession;
	return t.errorGeneric;
}
