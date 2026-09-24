const ALREADY_CHECKED_IN_STAY_STATUSES = [
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave'
] as const;

export function isAlreadyCheckedInStatus(status: string | null | undefined): boolean {
	return ALREADY_CHECKED_IN_STAY_STATUSES.some((candidate) => candidate === status);
}
