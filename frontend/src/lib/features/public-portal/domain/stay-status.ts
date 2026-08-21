/**
 * Stay status as the public family search now reports it (CR-080).
 *
 * Until CR-080 the public plane collapsed every staff `current_stay.status` into
 * three buckets (`in_shelter` / `moved` / `checked_out`, FS-2 / CR-005). That
 * made the answer to "did my relative make it?" wrong in the case the public
 * booking flow (CR-070 / T-71) creates most often: someone who reserved a place
 * online but never arrived is `pre_registered`, and the old mapping displayed
 * them as safely inside the shelter. The API now returns the real status and the
 * public UI labels it exactly as the backoffice does, so the two planes cannot
 * disagree about what happened to a person.
 *
 * Pure: no I/O, no Svelte. `tone` is a semantic name, not a colour — the mapping
 * to classes lives in `ui/stay-status-chip.svelte`.
 */

/** The seven `stayStatusSchema` values, plus the fallback for anything else. */
export const PUBLIC_STAY_STATUSES = [
	'pre_registered',
	'active',
	'temporary_leave',
	'transferred',
	'checked_out',
	'deceased',
	'cancelled'
] as const;

export type PublicStayStatus = (typeof PUBLIC_STAY_STATUSES)[number];

export type StayStatusTone = 'safe' | 'pending' | 'moved' | 'ended' | 'grave';

/**
 * Verbatim the backoffice wording (`people/ui/evacuee-search.svelte`).
 *
 * Copied rather than imported: reaching into the `people` feature from
 * `public-portal` would cross a barrel boundary the lint rules forbid, and the
 * staff labels are UI copy that happens to be shared, not a domain contract.
 * If one side is reworded, reword both.
 */
export const PUBLIC_STAY_STATUS_LABELS: Record<PublicStayStatus, string> = {
	pre_registered: 'ลงทะเบียนล่วงหน้า',
	active: 'เข้าพักแล้ว',
	temporary_leave: 'ออกชั่วคราว',
	transferred: 'ย้ายไปแล้ว',
	checked_out: 'ย้ายออก/กลับภูมิลำเนา',
	deceased: 'เสียชีวิต',
	cancelled: 'ยกเลิกการลงทะเบียนล่วงหน้า'
};

const TONES: Record<PublicStayStatus, StayStatusTone> = {
	// Only `active` means "we have seen this person inside the shelter".
	active: 'safe',
	// Reserved a place, not yet arrived — the distinction CR-080 exists for.
	pre_registered: 'pending',
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

/**
 * Thai label for a status. An unrecognised value is echoed back rather than
 * hidden — a projection that starts emitting a new status should be visible in
 * the UI, not silently rendered as "unknown".
 */
export function publicStayStatusLabel(status: string | null | undefined): string {
	const known = asKnown(status);
	if (known) return PUBLIC_STAY_STATUS_LABELS[known];
	return status?.trim() || 'ไม่ทราบสถานะ';
}

export function publicStayStatusTone(status: string | null | undefined): StayStatusTone {
	const known = asKnown(status);
	return known ? TONES[known] : 'ended';
}

/**
 * Is this person physically at the shelter right now?
 *
 * `temporary_leave` is deliberately false: they are checked in but not on site,
 * and a searcher asking "are they there?" should not be told yes.
 */
export function isInShelterStatus(status: string | null | undefined): boolean {
	return status === 'active';
}
