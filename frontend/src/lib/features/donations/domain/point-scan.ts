/**
 * The scan station's view of a booking received point by point (CR-206 FR-MP-18 – FR-MP-26):
 * which lines the staff at one drop-off point may record, where each line is shelved by
 * default, and the `point_id` / `line_nos` the receive request carries.
 */
import type { DonationPointReceipt } from '$lib/features/operations';
import {
	currentLinePoint,
	hasPointReceipts,
	isReceivedByPoint,
	recordedLineNos
} from './point-receipts';

/** A line that may go to any point of the shelter (FR-MP-16 wording, never "จุดหลัก"). */
export const ANY_DROP_OFF_POINT_LABEL = 'ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้';

/** A point a label is resolved against — a storage point's id and name. */
export type NamedPoint = { id: string; name: string };

type ScanLine = {
	drop_off_point_id?: string | null;
	review_status?: 'approved' | 'pending' | 'rejected';
};

export type PointScanSource = {
	items?: readonly ScanLine[];
	point_receipts?: readonly Pick<DonationPointReceipt, 'point_id' | 'line_nos'>[] | null;
};

/**
 * How this booking is received here:
 * - `whole` — in one go, as before CR-206 (FR-MP-24): no `point_id` / `line_nos`.
 * - `by_point` — the lines of the recorder's point (FR-MP-19).
 * - `no_point_left` — started at a point, but the shelter has no drop-off point left
 *   (FR-MP-18b): every unrecorded line, sent with `point_id: null`.
 */
export type ScanReceiveMode = 'whole' | 'by_point' | 'no_point_left';

export function scanReceiveMode(
	donation: PointScanSource,
	currentPointIds: ReadonlySet<string>
): ScanReceiveMode {
	if (!isReceivedByPoint(donation, currentPointIds)) return 'whole';
	return currentPointIds.size === 0 ? 'no_point_left' : 'by_point';
}

/**
 * One line as the station shows it:
 * - `recorded` — some point already recorded it (FR-MP-5a); read-only.
 * - `review_rejected` — refused at review (CR-174); read-only, needs no receipt.
 * - `receivable` — this point may record it. `pointId` is the line's current point (`null`
 *   = any point); `borrowed` = another point's line unlocked by "รับรายการของจุดอื่น" (FR-MP-21).
 * - `other_point` — another point's line, read-only until unlocked (FR-MP-19).
 * - `needs_point` — the shelter has drop-off points but staff have not chosen theirs yet
 *   (FR-MP-18a): nothing can be ticked, so we do not yet know which lines are "another point's".
 */
export type ScanLineState =
	| { kind: 'recorded'; receiptPointId: string | null }
	| { kind: 'review_rejected' }
	| { kind: 'receivable'; pointId: string | null; borrowed: boolean }
	| { kind: 'other_point'; pointId: string }
	| { kind: 'needs_point' };

export function scanLineStates(
	donation: PointScanSource,
	opts: {
		currentPointIds: ReadonlySet<string>;
		/** The recorder's point ("จุดที่ประจำ"); `null` = not chosen yet (FR-MP-18a). */
		chosenPointId: string | null;
		otherPointsUnlocked: boolean;
	}
): ScanLineState[] {
	const receiptOf = new Map<number, string | null>();
	for (const receipt of donation.point_receipts ?? []) {
		for (const lineNo of receipt.line_nos) {
			if (!receiptOf.has(lineNo)) receiptOf.set(lineNo, receipt.point_id);
		}
	}
	return (donation.items ?? []).map((item, lineNo): ScanLineState => {
		if (receiptOf.has(lineNo)) {
			return { kind: 'recorded', receiptPointId: receiptOf.get(lineNo) ?? null };
		}
		if (item.review_status === 'rejected') return { kind: 'review_rejected' };
		if (opts.currentPointIds.size > 0 && opts.chosenPointId === null) {
			return { kind: 'needs_point' };
		}
		const pointId = currentLinePoint(item, opts.currentPointIds);
		if (pointId === null || pointId === opts.chosenPointId) {
			return { kind: 'receivable', pointId, borrowed: false };
		}
		if (opts.otherPointsUnlocked && opts.chosenPointId !== null) {
			return { kind: 'receivable', pointId, borrowed: true };
		}
		return { kind: 'other_point', pointId };
	});
}

/** Some unrecorded line belongs to another current point — the "รับรายการของจุดอื่น" case. */
export function hasOtherPointLines(states: readonly ScanLineState[]): boolean {
	return states.some(
		(state) => state.kind === 'other_point' || (state.kind === 'receivable' && state.borrowed)
	);
}

/** Lines of another point still locked here — what the banner and the counter report. */
export function otherPointLineCount(states: readonly ScanLineState[]): number {
	return states.filter((state) => state.kind === 'other_point').length;
}

/** The "ตรวจแล้ว X / Y" counter; never a bare 0 / 0 (#1059). */
export function scanCounterLabel(opts: {
	verified: number;
	decidable: number;
	otherPointCount: number;
	needsPoint: boolean;
}): string {
	if (opts.needsPoint) return 'เลือกจุดที่ประจำก่อนจึงจะตรวจรับได้';
	const base = `ตรวจแล้ว ${opts.verified} / ${opts.decidable} รายการ`;
	return opts.otherPointCount > 0
		? `${base} · อีก ${opts.otherPointCount} รายการอยู่จุดอื่น`
		: base;
}

/** The label of the save button when there is nothing to save yet, else `null`. */
export function scanIdleSubmitLabel(opts: {
	needsPoint: boolean;
	noneToSave: boolean;
	otherPointCount: number;
}): string | null {
	if (opts.needsPoint) return 'เลือกจุดที่ประจำก่อน';
	if (opts.noneToSave && opts.otherPointCount > 0) return 'ไม่มีรายการของจุดนี้ให้รับ';
	return null;
}

/**
 * Where a receivable line is shelved unless staff change it (FR-MP-20, FR-MP-21): its own
 * point, else the recorder's point, else '' (main store / staff pick — FR-MP-18b).
 */
export function defaultStoragePointId(state: ScanLineState, chosenPointId: string | null): string {
	if (state.kind !== 'receivable') return '';
	if (state.pointId !== null && !state.borrowed) return state.pointId;
	return chosenPointId ?? '';
}

/**
 * The point fields of the receive request (FR-MP-22, FR-MP-18b, FR-MP-24). `lineNos` are the
 * lines recorded this time, received or turned away; they go out sorted.
 */
export function pointReceiptFields(
	mode: ScanReceiveMode,
	chosenPointId: string | null,
	lineNos: readonly number[]
): { point_id?: string | null; line_nos?: number[] } {
	if (mode === 'whole') return {};
	const line_nos = [...lineNos].sort((a, b) => a - b);
	if (line_nos.length === 0) throw new Error('A point receipt records at least one line');
	if (mode === 'no_point_left') return { point_id: null, line_nos };
	if (chosenPointId === null) throw new Error('A point receipt needs the recorder’s point');
	return { point_id: chosenPointId, line_nos };
}

/**
 * "ปิดใบ" is offered once a point recorded something and a line still has no result
 * (FR-MP-26, FR-MP-28). A line refused at review counts as having one, as in `allLinesRecorded`.
 */
export function canCloseByPoints(donation: PointScanSource): boolean {
	if (!hasPointReceipts(donation)) return false;
	const recorded = recordedLineNos(donation);
	return (donation.items ?? []).some(
		(item, lineNo) => !recorded.has(lineNo) && item.review_status !== 'rejected'
	);
}

/** Some line names a drop-off point — the booking was split between points at booking. */
export function namesDropOffPoints(items: readonly ScanLine[] | undefined): boolean {
	return (items ?? []).some((item) => !!item.drop_off_point_id);
}

/**
 * Where a line goes, for staff (FR-MP-25): its point's name while the shelter still offers
 * it, otherwise "any point" (FR-MP-16 — unticked or deleted after booking counts as none).
 */
export function linePointLabel(
	item: Pick<ScanLine, 'drop_off_point_id'>,
	currentPoints: readonly NamedPoint[]
): string {
	const id = item.drop_off_point_id;
	return (id && currentPoints.find((point) => point.id === id)?.name) || ANY_DROP_OFF_POINT_LABEL;
}

/**
 * "รับแล้วที่ <จุด>" for a recorded line (FR-MP-19). Resolved against every storage point,
 * since the point may have been unticked since; `null` = recorded after the shelter had no
 * drop-off point left (FR-MP-18b), shown as at the shelter like the tracking page (FR-MP-13).
 */
export function recordedAtLabel(
	receiptPointId: string | null,
	storagePoints: readonly NamedPoint[]
): string {
	if (receiptPointId === null) return 'รับแล้วที่ศูนย์';
	const name = storagePoints.find((point) => point.id === receiptPointId)?.name;
	return name ? `รับแล้วที่ ${name}` : 'รับแล้วที่จุดที่ถูกลบไปแล้ว';
}
