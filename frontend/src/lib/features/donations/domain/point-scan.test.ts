import { describe, expect, it } from 'vitest';
import {
	ANY_DROP_OFF_POINT_LABEL,
	canCloseByPoints,
	defaultStoragePointId,
	hasOtherPointLines,
	linePointLabel,
	namesDropOffPoints,
	otherPointLineCount,
	pointReceiptFields,
	recordedAtLabel,
	scanCounterLabel,
	scanIdleSubmitLabel,
	scanLineStates,
	scanReceiveMode,
	type PointScanSource
} from './point-scan';

const GYM = 'pt-gym';
const MED = 'pt-med';
const both = new Set([GYM, MED]);
const none = new Set<string>();

// AC-1: water to the gym, medicine to the infirmary, one line for any point.
const split: PointScanSource = {
	items: [{ drop_off_point_id: GYM }, { drop_off_point_id: MED }, { drop_off_point_id: null }]
};

const states = (
	donation: PointScanSource,
	chosenPointId: string | null,
	otherPointsUnlocked = false,
	currentPointIds: ReadonlySet<string> = both
) => scanLineStates(donation, { currentPointIds, chosenPointId, otherPointsUnlocked });

describe('scanReceiveMode (FR-MP-18b, FR-MP-24)', () => {
	it('receives a booking with a current point by point', () => {
		expect(scanReceiveMode(split, both)).toBe('by_point');
	});

	it('receives an old, parcel or pointless booking whole', () => {
		expect(scanReceiveMode({ items: [{}, { drop_off_point_id: null }] }, both)).toBe('whole');
	});

	it('receives whole once every point of the booking was unticked before any receipt (AC-21)', () => {
		expect(scanReceiveMode(split, none)).toBe('whole');
		expect(scanReceiveMode(split, new Set(['pt-other']))).toBe('whole');
	});

	it('keeps receiving by line after a receipt when no point is left (FR-MP-18b)', () => {
		const started = { ...split, point_receipts: [{ point_id: GYM, line_nos: [0] }] };
		expect(scanReceiveMode(started, none)).toBe('no_point_left');
		expect(scanReceiveMode(started, both)).toBe('by_point');
	});
});

describe('scanLineStates (FR-MP-19, FR-MP-21)', () => {
	it('lets the gym record its own line and the any-point line, not the infirmary’s (AC-5)', () => {
		expect(states(split, GYM)).toEqual([
			{ kind: 'receivable', pointId: GYM, borrowed: false },
			{ kind: 'other_point', pointId: MED },
			{ kind: 'receivable', pointId: null, borrowed: false }
		]);
	});

	it('locks every unrecorded line, any-point ones too, until a point is chosen (FR-MP-18a)', () => {
		expect(states(split, null, true).map((s) => s.kind)).toEqual([
			'needs_point',
			'needs_point',
			'needs_point'
		]);
	});

	it('does not lock when the shelter has no point left, and keeps recorded / refused lines', () => {
		expect(states(split, null, false, none).map((s) => s.kind)).toEqual([
			'receivable',
			'receivable',
			'receivable'
		]);
		const mixed = {
			items: [
				{ drop_off_point_id: GYM },
				{ drop_off_point_id: GYM, review_status: 'rejected' as const },
				{ drop_off_point_id: MED }
			],
			point_receipts: [{ point_id: MED, line_nos: [2] }]
		};
		expect(states(mixed, null).map((s) => s.kind)).toEqual([
			'needs_point',
			'review_rejected',
			'recorded'
		]);
	});

	it('counts only still-locked other-point lines', () => {
		expect(otherPointLineCount(states(split, GYM))).toBe(1);
		expect(otherPointLineCount(states(split, GYM, true))).toBe(0);
		expect(otherPointLineCount(states(split, null))).toBe(0);
		const started = { ...split, point_receipts: [{ point_id: MED, line_nos: [1] }] };
		expect(otherPointLineCount(states(started, GYM))).toBe(0);
	});

	it('words the counter with the other-point count, never a bare 0 / 0 (#1059)', () => {
		const base = { verified: 0, decidable: 0, otherPointCount: 0, needsPoint: false };
		expect(scanCounterLabel({ ...base, otherPointCount: 3 })).toBe(
			'ตรวจแล้ว 0 / 0 รายการ · อีก 3 รายการอยู่จุดอื่น'
		);
		expect(
			scanCounterLabel({ verified: 1, decidable: 2, otherPointCount: 1, needsPoint: false })
		).toBe('ตรวจแล้ว 1 / 2 รายการ · อีก 1 รายการอยู่จุดอื่น');
		expect(scanCounterLabel({ ...base, verified: 1, decidable: 2 })).toBe('ตรวจแล้ว 1 / 2 รายการ');
		const needs = scanCounterLabel({ ...base, needsPoint: true, otherPointCount: 2 });
		expect(needs).toBe('เลือกจุดที่ประจำก่อนจึงจะตรวจรับได้');
		expect(needs).not.toContain('0 / 0');
	});

	it('words the idle save button', () => {
		expect(scanIdleSubmitLabel({ needsPoint: true, noneToSave: true, otherPointCount: 1 })).toBe(
			'เลือกจุดที่ประจำก่อน'
		);
		expect(scanIdleSubmitLabel({ needsPoint: false, noneToSave: true, otherPointCount: 2 })).toBe(
			'ไม่มีรายการของจุดนี้ให้รับ'
		);
		expect(
			scanIdleSubmitLabel({ needsPoint: false, noneToSave: false, otherPointCount: 2 })
		).toBeNull();
		expect(
			scanIdleSubmitLabel({ needsPoint: false, noneToSave: true, otherPointCount: 0 })
		).toBeNull();
	});

	it('unlocks another point’s unrecorded line on "รับรายการของจุดอื่น" (AC-10)', () => {
		expect(states(split, GYM, true)[1]).toEqual({
			kind: 'receivable',
			pointId: MED,
			borrowed: true
		});
	});

	it('shows recorded lines with the point that recorded them, unlocked or not', () => {
		const started = { ...split, point_receipts: [{ point_id: MED, line_nos: [1] }] };
		expect(states(started, GYM, true)[1]).toEqual({ kind: 'recorded', receiptPointId: MED });
	});

	it('treats a point unticked after booking as any point (AC-13)', () => {
		expect(states(split, MED, false, new Set([MED]))[0]).toEqual({
			kind: 'receivable',
			pointId: null,
			borrowed: false
		});
	});

	it('keeps a line refused at review out of the receipt', () => {
		const reviewed = { items: [{ drop_off_point_id: GYM, review_status: 'rejected' as const }] };
		expect(states(reviewed, GYM)).toEqual([{ kind: 'review_rejected' }]);
	});

	it('opens every unrecorded line once no point is left (FR-MP-18b)', () => {
		const started = { ...split, point_receipts: [{ point_id: GYM, line_nos: [0] }] };
		expect(states(started, null, false, none)).toEqual([
			{ kind: 'recorded', receiptPointId: GYM },
			{ kind: 'receivable', pointId: null, borrowed: false },
			{ kind: 'receivable', pointId: null, borrowed: false }
		]);
	});

	it('tells when another point has lines left', () => {
		expect(hasOtherPointLines(states(split, GYM))).toBe(true);
		expect(hasOtherPointLines(states(split, GYM, true))).toBe(true);
		expect(hasOtherPointLines(states({ items: [{ drop_off_point_id: GYM }] }, GYM))).toBe(false);
	});
});

describe('defaultStoragePointId (FR-MP-20, FR-MP-21)', () => {
	it('shelves a line at its own point', () => {
		expect(defaultStoragePointId({ kind: 'receivable', pointId: MED, borrowed: false }, GYM)).toBe(
			MED
		);
	});

	it('shelves an any-point line and a borrowed line at the chosen point', () => {
		expect(defaultStoragePointId({ kind: 'receivable', pointId: null, borrowed: false }, GYM)).toBe(
			GYM
		);
		expect(defaultStoragePointId({ kind: 'receivable', pointId: MED, borrowed: true }, GYM)).toBe(
			GYM
		);
	});

	it('leaves the choice to staff when no point is chosen or left', () => {
		expect(
			defaultStoragePointId({ kind: 'receivable', pointId: null, borrowed: false }, null)
		).toBe('');
		expect(defaultStoragePointId({ kind: 'other_point', pointId: MED }, GYM)).toBe('');
	});
});

describe('pointReceiptFields (FR-MP-22, FR-MP-18b, FR-MP-24)', () => {
	it('sends nothing for a whole-booking receipt', () => {
		expect(pointReceiptFields('whole', GYM, [0, 1])).toEqual({});
	});

	it('sends the chosen point and the recorded lines, sorted', () => {
		expect(pointReceiptFields('by_point', GYM, [2, 0])).toEqual({
			point_id: GYM,
			line_nos: [0, 2]
		});
	});

	it('sends point_id null once no point is left', () => {
		expect(pointReceiptFields('no_point_left', null, [1])).toEqual({
			point_id: null,
			line_nos: [1]
		});
	});

	it('refuses a point receipt with no line or no point', () => {
		expect(() => pointReceiptFields('by_point', GYM, [])).toThrow();
		expect(() => pointReceiptFields('by_point', null, [0])).toThrow();
	});
});

describe('canCloseByPoints (FR-MP-26, FR-MP-28)', () => {
	it('offers no close before any point recorded', () => {
		expect(canCloseByPoints(split)).toBe(false);
	});

	it('offers close while a line has no result', () => {
		expect(canCloseByPoints({ ...split, point_receipts: [{ point_id: GYM, line_nos: [0] }] })).toBe(
			true
		);
	});

	it('counts a line refused at review as having a result', () => {
		const donation = {
			items: [
				{ drop_off_point_id: GYM },
				{ drop_off_point_id: MED, review_status: 'rejected' as const }
			],
			point_receipts: [{ point_id: GYM, line_nos: [0] }]
		};
		expect(canCloseByPoints(donation)).toBe(false);
	});
});

describe('point labels (FR-MP-19, FR-MP-25)', () => {
	const current = [{ id: GYM, name: 'โรงยิม' }];
	const storage = [...current, { id: MED, name: 'ห้องพยาบาล' }];

	it('names a line’s current point, else any point', () => {
		expect(linePointLabel({ drop_off_point_id: GYM }, current)).toBe('โรงยิม');
		expect(linePointLabel({ drop_off_point_id: MED }, current)).toBe(ANY_DROP_OFF_POINT_LABEL);
		expect(linePointLabel({}, current)).toBe(ANY_DROP_OFF_POINT_LABEL);
	});

	it('names where a line was recorded, even at a point unticked since', () => {
		expect(recordedAtLabel(MED, storage)).toBe('รับแล้วที่ ห้องพยาบาล');
		expect(recordedAtLabel(null, storage)).toBe('รับแล้วที่ศูนย์');
		expect(recordedAtLabel('pt-gone', storage)).toBe('รับแล้วที่จุดที่ถูกลบไปแล้ว');
	});

	it('tells a split booking from one without points', () => {
		expect(namesDropOffPoints(split.items)).toBe(true);
		expect(namesDropOffPoints([{ drop_off_point_id: null }, {}])).toBe(false);
		expect(namesDropOffPoints(undefined)).toBe(false);
	});
});
