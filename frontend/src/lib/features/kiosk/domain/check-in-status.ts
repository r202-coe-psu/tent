import type { LanguageCode } from '$lib/utils/language';

const ALREADY_CHECKED_IN_STAY_STATUSES = [
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave'
] as const;

const LISTED_STAY_STATUSES = ['pre_registered', ...ALREADY_CHECKED_IN_STAY_STATUSES] as const;

export function isAlreadyCheckedInStatus(status: string | null | undefined): boolean {
	return ALREADY_CHECKED_IN_STAY_STATUSES.some((candidate) => candidate === status);
}

/** Stay statuses whose QR the kiosk phone menu may reprint (not `temporary_leave`). */
const REPRINTABLE_STAY_STATUSES = ['arriving', 'active', 'room_confirmed'] as const;

export function isReprintableStatus(status: string | null | undefined): boolean {
	return REPRINTABLE_STAY_STATUSES.some((candidate) => candidate === status);
}

export const REPRINT_PRE_REGISTERED_REASON = 'ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD';
export const REPRINT_TEMPORARY_LEAVE_REASON = 'ออกนอกศูนย์ชั่วคราว — พิมพ์ QR ไม่ได้';
export const REPRINT_NOBODY_REASON = 'ไม่มีผู้ที่พิมพ์ QR ได้ กรุณาติดต่อเจ้าหน้าที่';

/** English wording of the three reasons above, keyed by their Thai text. */
const REPRINT_REASONS_EN: Record<string, string> = {
	[REPRINT_PRE_REGISTERED_REASON]: 'Not registered yet — use your ID card or ThaiD',
	[REPRINT_TEMPORARY_LEAVE_REASON]: 'Temporarily away from the shelter — cannot print QR',
	[REPRINT_NOBODY_REASON]: 'No one can print a QR. Please contact staff'
};

/**
 * Shows a reprint reason in `language`. The reasons travel as Thai text (the constants above), so
 * a screen passes what it holds through here; text that is not a known reason comes back as is.
 */
export function localizeReprintReason(reason: string, language: LanguageCode = 'th'): string {
	return language === 'en' ? (REPRINT_REASONS_EN[reason] ?? reason) : reason;
}

/** Why a listed member cannot be reprinted; null when no dedicated reason applies. */
export function reprintUnavailableReason(
	status: string | null | undefined,
	language: LanguageCode = 'th'
): string | null {
	if (status === 'pre_registered') {
		return localizeReprintReason(REPRINT_PRE_REGISTERED_REASON, language);
	}
	if (status === 'temporary_leave') {
		return localizeReprintReason(REPRINT_TEMPORARY_LEAVE_REASON, language);
	}
	return null;
}

/** Members a kiosk may list: expected or present, unless they opted out of search. */
export function isListedHouseholdMember(doc: {
	current_stay?: { status?: string };
	privacy?: { search_excluded?: boolean };
}): boolean {
	const status = doc.current_stay?.status;
	return (
		status !== undefined &&
		LISTED_STAY_STATUSES.some((candidate) => candidate === status) &&
		doc.privacy?.search_excluded !== true
	);
}
