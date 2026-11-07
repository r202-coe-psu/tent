/** Error texts the kiosk API layer builds itself (the server's own messages are shown as sent). */
const th = {
	partialCheckIn: 'รายงานตัวได้บางส่วน กรุณาตรวจผลและลองรายการที่เหลืออีกครั้ง',
	generic: 'ระบบไม่สามารถทำรายการได้',
	timeout: 'เชื่อมต่อช้า กรุณาลองอีกครั้ง'
};

const en: typeof th = {
	partialCheckIn:
		'Only part of the check-in went through. Please review the results and retry the rest',
	generic: 'The system could not complete this request',
	timeout: 'Connection is slow. Please try again'
};

export const KIOSK_CHECK_IN_MESSAGES_I18N = { th, en };
