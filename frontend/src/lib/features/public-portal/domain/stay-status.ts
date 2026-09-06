/**
 * Stay status as the public family search reports it (CR-080 + CR-112).
 * Pure: no I/O, no Svelte.
 */

export const PUBLIC_STAY_STATUSES = [
	'pre_registered',
	'arriving',
	'active',
	'room_confirmed',
	'in_shelter',
	'temporary_leave',
	'transferred',
	'checked_out',
	'deceased',
	'cancelled'
] as const;

export type PublicStayStatus = (typeof PUBLIC_STAY_STATUSES)[number];
export type StayStatusTone = 'safe' | 'pending' | 'moved' | 'ended' | 'grave';

export const PUBLIC_STAY_STATUS_LABELS: Record<'th' | 'en', Record<PublicStayStatus, string>> = {
	th: {
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		arriving: 'อยู่ระหว่างรอเข้าพัก',
		active: 'เข้าพักแล้ว',
		room_confirmed: 'ยืนยันถึงโซนแล้ว',
		in_shelter: 'พักพิงอยู่ในศูนย์',
		temporary_leave: 'ออกชั่วคราว',
		transferred: 'ย้ายไปแล้ว',
		checked_out: 'ย้ายออก/กลับภูมิลำเนา',
		deceased: 'เสียชีวิต',
		cancelled: 'ยกเลิกการลงทะเบียนล่วงหน้า'
	},
	en: {
		pre_registered: 'Pre-registered',
		arriving: 'Arriving',
		active: 'Checked-in',
		room_confirmed: 'Zone Arrival Confirmed',
		in_shelter: 'In Shelter',
		temporary_leave: 'Temporary Leave',
		transferred: 'Transferred',
		checked_out: 'Checked-out/Returned',
		deceased: 'Deceased',
		cancelled: 'Cancelled'
	}
};

const TONES: Record<PublicStayStatus, StayStatusTone> = {
	active: 'safe',
	room_confirmed: 'safe',
	in_shelter: 'safe',
	pre_registered: 'pending',
	arriving: 'pending',
	temporary_leave: 'pending',
	transferred: 'moved',
	checked_out: 'ended',
	cancelled: 'ended',
	deceased: 'grave'
};

function asKnown(status: string | null | undefined): PublicStayStatus | null {
	return PUBLIC_STAY_STATUSES.includes(status as PublicStayStatus)
		? (status as PublicStayStatus)
		: null;
}

export function publicStayStatusLabel(
	status: string | null | undefined,
	lang: 'th' | 'en' = 'th'
): string {
	const known = asKnown(status);
	if (known) return PUBLIC_STAY_STATUS_LABELS[lang][known];
	return status?.trim() || (lang === 'th' ? 'ไม่ทราบสถานะ' : 'Unknown status');
}

export function publicStayStatusTone(status: string | null | undefined): StayStatusTone {
	const known = asKnown(status);
	return known ? TONES[known] : 'ended';
}

/**
 * Present Occupancy oriented “in shelter?” helper (CR-112):
 * `active` | `room_confirmed` | `temporary_leave` (+ legacy `in_shelter`).
 */
export function isInShelterStatus(status: string | null | undefined): boolean {
	return (
		status === 'active' ||
		status === 'room_confirmed' ||
		status === 'temporary_leave' ||
		status === 'in_shelter'
	);
}
