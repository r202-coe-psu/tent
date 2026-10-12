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
