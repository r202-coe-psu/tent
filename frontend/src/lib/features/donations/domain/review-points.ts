import type { DonationItem } from '$lib/features/operations';
import { hasLineReview, type LineReviewDecision } from './item-review';

/**
 * Staff choose each approved line's drop-off point at review (draft CR "เจ้าหน้าที่กำหนดจุด
 * รับบริจาค" FR-AP-17 steps 2–5, FR-AP-17a). The donor no longer picks one, so a line the
 * donor typed in has none until review gives it one.
 */
export interface ReviewPointsInput {
	items: readonly Pick<DonationItem, 'review_status' | 'drop_off_point_id'>[];
	/** `undefined` = the body sent no `lines`: approve every pending line (FR-AP-17a). */
	lines:
		readonly Pick<LineReviewDecision, 'index' | 'decision' | 'drop_off_point_id'>[] | undefined;
	deliveryMethod: string | undefined;
	/** Lines a drop-off point already recorded (`point_receipts[].line_nos`). */
	recordedLineNos: ReadonlySet<number>;
}

export type ReviewPointsErrorCode = 'INVALID_REVIEW' | 'UNKNOWN_DROP_OFF_POINT' | 'POINT_REQUIRED';

export type ReviewPointsResult =
	/** `points` = the point to write on each line it names; a line it does not name keeps its own. */
	| { ok: true; points: ReadonlyMap<number, string | null> }
	| { ok: false; code: ReviewPointsErrorCode; lines: number[] };

/** The lines whose point is checked against the shelter's current points. */
function linesToCheck(input: ReviewPointsInput): number[] {
	if (input.deliveryMethod !== 'self_dropoff') return [];
	const recorded = input.recordedLineNos;
	if (input.lines === undefined) {
		if (!hasLineReview(input.items)) return [];
		return input.items.flatMap((item, index) =>
			item.review_status === 'pending' && !recorded.has(index) ? [index] : []
		);
	}
	return input.lines.flatMap(({ index, decision }) =>
		decision === 'approved' && !recorded.has(index) ? [index] : []
	);
}

/**
 * True when {@link reviewDropOffPoints} needs the shelter's current points. A refusal, and a
 * booking that is not a self drop-off, never reads the registry (FR-AP-17).
 */
export function needsCurrentDropOffPoints(input: ReviewPointsInput): boolean {
	return linesToCheck(input).length > 0;
}

const NO_WRITES: ReviewPointsResult = { ok: true, points: new Map() };

/**
 * Check and resolve the points an approval writes, in the order FR-AP-17 sets. Runs after
 * `applyLineReview` accepted the decisions, so every index names a pending line.
 *
 * `currentPointIds` is the shelter's current drop-off points, or `'not_needed'` when
 * {@link needsCurrentDropOffPoints} said so.
 */
export function reviewDropOffPoints(
	input: ReviewPointsInput & { currentPointIds: ReadonlySet<string> | 'not_needed' }
): ReviewPointsResult {
	const { items, lines, recordedLineNos } = input;
	const checked = linesToCheck(input);
	const currentPoints = (): ReadonlySet<string> => {
		if (input.currentPointIds === 'not_needed') {
			throw new Error('The shelter’s current drop-off points are needed for this review');
		}
		return input.currentPointIds;
	};

	if (lines === undefined) {
		// FR-AP-17a — the one-button approve keeps every point; it only refuses to leave a
		// line with none in a shelter that has points.
		if (checked.length === 0) return NO_WRITES;
		const ids = currentPoints();
		if (ids.size === 0) return NO_WRITES;
		const missing = checked.filter((index) => !isCurrent(items[index]?.drop_off_point_id, ids));
		return missing.length > 0 ? { ok: false, code: 'POINT_REQUIRED', lines: missing } : NO_WRITES;
	}

	const approved = lines.filter(({ decision }) => decision === 'approved');
	// Step 2 — only a self drop-off goes to a point; whatever the body sent is ignored.
	if (input.deliveryMethod !== 'self_dropoff') {
		return {
			ok: true,
			points: new Map(
				approved
					.filter(({ index }) => !recordedLineNos.has(index))
					.map(({ index }) => [index, null])
			)
		};
	}

	// Step 3 (D-13) — a point already took this line in; naming another one contradicts it.
	const recordedWithPoint = approved
		.filter(
			({ index, drop_off_point_id }) =>
				recordedLineNos.has(index) && drop_off_point_id !== undefined
		)
		.map(({ index }) => index);
	if (recordedWithPoint.length > 0) {
		return { ok: false, code: 'INVALID_REVIEW', lines: recordedWithPoint };
	}
	if (checked.length === 0) return NO_WRITES;

	const ids = currentPoints();
	const decided = approved.filter(({ index }) => !recordedLineNos.has(index));
	// Step 4 — a point the shelter does not offer now.
	const unknown = decided
		.filter(({ drop_off_point_id }) => drop_off_point_id != null && !ids.has(drop_off_point_id))
		.map(({ index }) => index);
	if (unknown.length > 0) return { ok: false, code: 'UNKNOWN_DROP_OFF_POINT', lines: unknown };

	// Step 5 (D-3) — sending nothing keeps the line's point; the shelter having points means
	// every approved line must end with a current one.
	const points = new Map<number, string | null>(
		decided.map(({ index, drop_off_point_id }) => [
			index,
			drop_off_point_id === undefined
				? (items[index]?.drop_off_point_id ?? null)
				: drop_off_point_id
		])
	);
	if (ids.size > 0) {
		const missing = [...points]
			.filter(([, point]) => !isCurrent(point, ids))
			.map(([index]) => index);
		if (missing.length > 0) return { ok: false, code: 'POINT_REQUIRED', lines: missing };
	}
	return { ok: true, points };
}

function isCurrent(point: string | null | undefined, ids: ReadonlySet<string>): boolean {
	return point != null && ids.has(point);
}
