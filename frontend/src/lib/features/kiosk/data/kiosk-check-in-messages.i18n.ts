/** Error texts the kiosk API layer builds itself. */
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

/**
 * English for the error codes the kiosk API answers with. The server writes its messages in Thai,
 * so the Thai screen shows them as sent and the English screen words them from the code.
 */
export const KIOSK_SERVER_ERROR_EN: Partial<Record<string, string>> = {
	DEVICE_AUTH_FAILED: 'This kiosk could not be verified. Please contact staff.',
	DEPENDENCY_UNAVAILABLE:
		'The service is not available right now. Please try again or contact staff.',
	KIOSK_LOOKUP_UNAVAILABLE: 'The search service is not available right now. Please try again.',
	KIOSK_LOOKUP_FAILED: 'The search did not work. Please try again.',
	KIOSK_METHOD_DISABLED: 'This option is switched off. Please contact staff.',
	KIOSK_CLOSED: 'This kiosk is closed right now.',
	KIOSK_THAID_SESSION_INVALID: 'The ThaiD check has expired or is not valid. Please scan again.',
	INVALID_GATE_INPUT: 'The details to search with are not valid.',
	INVALID_CHECK_IN_INPUT: 'The list of people is not valid.',
	INVALID_INPUT: 'The details are not valid.',
	PRE_REGISTRATION_NOT_FOUND: 'No pre-registration was found at this shelter.',
	KIOSK_TOO_MANY_MATCHES: 'Several records matched. Please contact staff.',
	KIOSK_CLAIM_CONFLICT:
		'Someone in this group was admitted to another shelter or cancelled. Please contact staff.',
	KIOSK_CLAIM_PERSON_MISMATCH:
		'This card does not match the registered person. Please contact staff.',
	KIOSK_QUEUE_UNAVAILABLE: 'The central queue is not available. Please contact staff.',
	KIOSK_CLAIM_FAILED: 'Admission to the shelter did not go through. Please try again.',
	KIOSK_CHECK_IN_FAILED: 'Could not save the check-in. Please try again.',
	INVALID_REPRINT_INPUT: 'The details for reprinting are not valid.',
	KIOSK_REPRINT_VERIFY_FAILED: 'The last 4 digits are not correct',
	KIOSK_REPRINT_STAFF_PIN_INVALID: 'The PIN is not correct',
	staff_pin_not_set: 'This step cannot be skipped yet. Please contact the administrator.',
	RATE_LIMITED: 'Checking the PIN. Please wait a moment.',
	KIOSK_REPRINT_UNVERIFIABLE: 'We could not verify who you are. Please contact staff.',
	KIOSK_REPRINT_NOT_FOUND: 'Nothing was found to reprint',
	KIOSK_REPRINT_FAILED: 'Reprinting did not work. Please try again.',
	INVALID_VOLUNTEER_CARD_INPUT: 'The phone number is not valid.',
	KIOSK_VOLUNTEER_CARD_NOT_FOUND:
		'No volunteer at this shelter uses this phone number. Please contact staff.',
	KIOSK_VOLUNTEER_CARD_FAILED: 'Could not show the volunteer card. Please try again.',
	KIOSK_CONSENT_EXPIRED: 'Your consent timed out. Please give consent again',
	INVALID_KIOSK_REGISTRATION: 'The card or consent details are not valid.',
	KIOSK_REGISTRATION_DISABLED: 'Registering at the kiosk is switched off.',
	KIOSK_REGISTRATION_BLOCKED: 'An existing record was found. Please see staff.',
	KIOSK_PHONE_DUPLICATE:
		'This phone number is already registered. Enter another number or tap "No phone"',
	KIOSK_REGISTRATION_FAILED: 'Registration failed. Please try again'
};
