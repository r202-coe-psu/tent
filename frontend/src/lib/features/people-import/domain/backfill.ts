import {
	BACKFILL_IMPORT_REASON,
	createMovement,
	type Evacuee,
	type Movement
} from '$lib/features/people';
import { now, type AuthorContext } from '$lib/db/model';
import type { ImportStay } from './import-row';

/**
 * Turn one imported person's reported stay into the history the system would have recorded had it
 * been live at the time (#1399): a back-dated `check_in`, and for someone who already left a
 * `check_out` with `reason = backfill_import` and no destination.
 *
 * `applyMovementToStay` is deliberately not used: it refuses a `check_in` without a zone, but a
 * person who left may arrive in the file with no zone known (CR-112's zone guard is for people who
 * are housed). The final `current_stay` is therefore set directly from the stay — status of the
 * last movement, `since` = its time, zone kept only while the person is still `active`.
 */
export function buildBackfilledStay(
	evacuee: Evacuee,
	stay: ImportStay,
	ctx: AuthorContext
): { evacuee: Evacuee; movements: Movement[] } {
	const movements: Movement[] = [
		createMovement(
			{
				evacuee_id: evacuee._id,
				action: 'check_in',
				zone: stay.zone,
				occurred_at: stay.arrivedAt
			},
			ctx
		)
	];
	if (stay.status === 'checked_out' && stay.departedAt) {
		movements.push(
			createMovement(
				{
					evacuee_id: evacuee._id,
					action: 'check_out',
					zone: null,
					reason: BACKFILL_IMPORT_REASON,
					occurred_at: stay.departedAt
				},
				ctx
			)
		);
	}
	const last = movements[movements.length - 1];
	return {
		movements,
		evacuee: {
			...evacuee,
			updated_at: now(),
			current_stay: {
				status: stay.status,
				zone: stay.status === 'active' ? stay.zone : null,
				since: last.occurred_at
			}
		}
	};
}
