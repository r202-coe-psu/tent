/**
 * Which drop-off point a campaign need gets, decided by staff when they write the
 * campaign (CR draft-donation-staff-assigned-drop-off FR-AP-2 – FR-AP-4a, FR-AP-6).
 * One rule for the create form, the edit form and the board, so they cannot drift.
 */

export interface NeedDropOffPointOption {
	id: string;
	name: string;
}

export type NeedPointField =
	/** The shelter has no drop-off point: no dropdown, the need stores `null`. */
	| { mode: 'none'; value: null }
	/** Exactly one point: chosen for staff, nothing else to pick. */
	| { mode: 'auto'; value: string }
	/** Two or more: staff must choose. `value` is the starting choice, `null` = empty. */
	| { mode: 'required'; value: string | null };

/**
 * `stored` is the need's current value (create: `null`). With two or more points a
 * stored id that is `null` or no longer a current point starts empty, so a save cannot
 * silently keep a deleted point.
 */
export function resolveNeedPointField(
	points: readonly NeedDropOffPointOption[],
	stored: string | null | undefined = null
): NeedPointField {
	if (points.length === 0) return { mode: 'none', value: null };
	if (points.length === 1) return { mode: 'auto', value: points[0].id };
	const current = stored != null && points.some((p) => p.id === stored) ? stored : null;
	return { mode: 'required', value: current };
}

/** The value to save for the field, or `undefined` while a required choice is missing. */
export function needPointToSave(
	field: NeedPointField,
	chosen: string | null
): string | null | undefined {
	if (field.mode === 'none') return null;
	if (field.mode === 'auto') return field.value;
	return chosen != null && chosen !== '' ? chosen : undefined;
}

export type NeedPointBadge = 'unset' | 'deleted' | null;

/**
 * Board badge for a need (FR-AP-6). Nothing is flagged when the shelter has no points,
 * because then `null` is the correct value.
 */
export function needPointBadge(
	points: readonly NeedDropOffPointOption[],
	stored: string | null | undefined
): NeedPointBadge {
	if (points.length === 0) return null;
	if (stored == null) return 'unset';
	return points.some((p) => p.id === stored) ? null : 'deleted';
}
