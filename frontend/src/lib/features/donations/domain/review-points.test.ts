import { describe, expect, it } from 'vitest';
import type { DonationItem } from '$lib/features/operations';
import {
	needsCurrentDropOffPoints,
	reviewDropOffPoints,
	type ReviewPointsInput,
	type ReviewPointsResult
} from './review-points';

const GYM = 'point-gym';
const MED = 'point-med';
const DELETED = 'point-deleted';
const TWO_POINTS = new Set([GYM, MED]);

const line = (over: Partial<DonationItem>): DonationItem => ({ qty: '1', unit: 'piece', ...over });
// AC-AP-13: rice is a campaign line with the gym point, blankets were typed in by the donor.
const rice = line({ item_id: 'item:rice', review_status: 'approved', drop_off_point_id: GYM });
const blanket = line({ free_text: 'ผ้าห่ม', review_status: 'pending', drop_off_point_id: null });
const water = line({ free_text: 'น้ำดื่ม', review_status: 'pending', drop_off_point_id: null });

function input(over: Partial<ReviewPointsInput>): ReviewPointsInput {
	return {
		items: [rice, blanket],
		lines: [{ index: 1, decision: 'approved' }],
		deliveryMethod: 'self_dropoff',
		recordedLineNos: new Set(),
		...over
	};
}

const ok = (entries: [number, string | null][]): ReviewPointsResult => ({
	ok: true,
	points: new Map(entries)
});

describe('reviewDropOffPoints (FR-AP-17)', () => {
	it.each<
		[string, Partial<ReviewPointsInput>, ReadonlySet<string> | 'not_needed', ReviewPointsResult]
	>([
		[
			'AC-AP-10: writes the point staff chose for each approved line',
			{
				items: [blanket, water],
				lines: [
					{ index: 0, decision: 'approved', drop_off_point_id: GYM },
					{ index: 1, decision: 'approved', drop_off_point_id: MED }
				]
			},
			TWO_POINTS,
			ok([
				[0, GYM],
				[1, MED]
			])
		],
		[
			'AC-AP-11: an approved line without a point in a shelter that has points',
			{},
			TWO_POINTS,
			{ ok: false, code: 'POINT_REQUIRED', lines: [1] }
		],
		[
			'AC-AP-11: sending null counts as no point',
			{ lines: [{ index: 1, decision: 'approved', drop_off_point_id: null }] },
			TWO_POINTS,
			{ ok: false, code: 'POINT_REQUIRED', lines: [1] }
		],
		[
			'AC-AP-12: a point the shelter does not offer',
			{ lines: [{ index: 1, decision: 'approved', drop_off_point_id: DELETED }] },
			TWO_POINTS,
			{ ok: false, code: 'UNKNOWN_DROP_OFF_POINT', lines: [1] }
		],
		[
			'step 4 before step 5: an unknown point wins over a missing one',
			{
				items: [blanket, water],
				lines: [
					{ index: 0, decision: 'approved' },
					{ index: 1, decision: 'approved', drop_off_point_id: DELETED }
				]
			},
			TWO_POINTS,
			{ ok: false, code: 'UNKNOWN_DROP_OFF_POINT', lines: [1] }
		],
		[
			'AC-AP-12: a refused line keeps its point and is not checked',
			{
				items: [blanket, water],
				lines: [
					{ index: 0, decision: 'rejected' },
					{ index: 1, decision: 'approved', drop_off_point_id: GYM }
				]
			},
			TWO_POINTS,
			ok([[1, GYM]])
		],
		[
			'AC-AP-12a: a parcel booking writes null whatever the body sent',
			{
				deliveryMethod: 'parcel',
				lines: [{ index: 1, decision: 'approved', drop_off_point_id: DELETED }]
			},
			'not_needed',
			ok([[1, null]])
		],
		[
			'step 2: a pickup booking writes null on approved lines only',
			{
				deliveryMethod: 'shelter_pickup',
				items: [blanket, water],
				lines: [
					{ index: 0, decision: 'approved' },
					{ index: 1, decision: 'rejected' }
				]
			},
			'not_needed',
			ok([[0, null]])
		],
		[
			'step 2 + step 3: a non-drop-off booking leaves a recorded line alone',
			{
				deliveryMethod: 'parcel',
				items: [blanket, water],
				lines: [
					{ index: 0, decision: 'approved', drop_off_point_id: GYM },
					{ index: 1, decision: 'approved' }
				],
				recordedLineNos: new Set([0])
			},
			'not_needed',
			ok([[1, null]])
		],
		[
			'AC-AP-12c: a line a point already received needs no point and is not written',
			{ recordedLineNos: new Set([1]) },
			'not_needed',
			ok([])
		],
		[
			'AC-AP-12c: naming a point for a line a point already received',
			{
				lines: [{ index: 1, decision: 'approved', drop_off_point_id: GYM }],
				recordedLineNos: new Set([1])
			},
			'not_needed',
			{ ok: false, code: 'INVALID_REVIEW', lines: [1] }
		],
		[
			'step 3: sending null for a received line is refused too',
			{
				lines: [{ index: 1, decision: 'approved', drop_off_point_id: null }],
				recordedLineNos: new Set([1])
			},
			'not_needed',
			{ ok: false, code: 'INVALID_REVIEW', lines: [1] }
		],
		[
			'step 3 before step 4: a received line with a point wins over an unknown point',
			{
				items: [blanket, water],
				lines: [
					{ index: 0, decision: 'approved', drop_off_point_id: GYM },
					{ index: 1, decision: 'approved', drop_off_point_id: DELETED }
				],
				recordedLineNos: new Set([0])
			},
			TWO_POINTS,
			{ ok: false, code: 'INVALID_REVIEW', lines: [0] }
		],
		[
			'AC-AP-13a / D-AP-3: sending nothing keeps a line that still has a current point',
			{
				items: [line({ item_id: 'item:rice', review_status: 'pending', drop_off_point_id: GYM })],
				lines: [{ index: 0, decision: 'approved' }]
			},
			TWO_POINTS,
			ok([[0, GYM]])
		],
		[
			'AC-AP-13a: a line whose point was deleted needs a new one',
			{
				items: [
					line({ item_id: 'item:rice', review_status: 'pending', drop_off_point_id: DELETED })
				],
				lines: [{ index: 0, decision: 'approved' }]
			},
			TWO_POINTS,
			{ ok: false, code: 'POINT_REQUIRED', lines: [0] }
		],
		[
			'staff may move a line that had a point to another one',
			{
				items: [line({ item_id: 'item:rice', review_status: 'pending', drop_off_point_id: GYM })],
				lines: [{ index: 0, decision: 'approved', drop_off_point_id: MED }]
			},
			TWO_POINTS,
			ok([[0, MED]])
		],
		['a shelter without points keeps the line as it is', {}, new Set<string>(), ok([[1, null]])],
		[
			'a shelter without points refuses a point it cannot offer',
			{ lines: [{ index: 1, decision: 'approved', drop_off_point_id: GYM }] },
			new Set<string>(),
			{ ok: false, code: 'UNKNOWN_DROP_OFF_POINT', lines: [1] }
		],
		[
			'refusing every line reads no points and writes none',
			{ lines: [{ index: 1, decision: 'rejected' }] },
			'not_needed',
			ok([])
		]
	])('%s', (_label, over, currentPointIds, expected) => {
		expect(reviewDropOffPoints({ ...input(over), currentPointIds })).toEqual(expected);
	});
});

describe('reviewDropOffPoints without lines (FR-AP-17a)', () => {
	it.each<
		[string, Partial<ReviewPointsInput>, ReadonlySet<string> | 'not_needed', ReviewPointsResult]
	>([
		[
			'AC-AP-12b: a pending line with no point in a shelter that has points',
			{ lines: undefined },
			TWO_POINTS,
			{ ok: false, code: 'POINT_REQUIRED', lines: [1] }
		],
		[
			'a pending line whose point was deleted counts as none',
			{
				lines: undefined,
				items: [
					rice,
					line({ free_text: 'ผ้าห่ม', review_status: 'pending', drop_off_point_id: DELETED })
				]
			},
			TWO_POINTS,
			{ ok: false, code: 'POINT_REQUIRED', lines: [1] }
		],
		[
			'every pending line already has a current point: approve, points kept',
			{
				lines: undefined,
				items: [line({ item_id: 'item:rice', review_status: 'pending', drop_off_point_id: GYM })]
			},
			TWO_POINTS,
			ok([])
		],
		[
			'a line a point already received does not count',
			{ lines: undefined, recordedLineNos: new Set([1]) },
			'not_needed',
			ok([])
		],
		[
			'a shelter without points approves as before',
			{ lines: undefined },
			new Set<string>(),
			ok([])
		],
		[
			'a parcel booking approves as before',
			{ lines: undefined, deliveryMethod: 'parcel' },
			'not_needed',
			ok([])
		],
		[
			'AC-AP-12b: a booking from before schema_v 7 approves as before, points untouched',
			{
				lines: undefined,
				items: [line({ item_id: 'item:rice' }), line({ free_text: 'ผ้าห่ม' })]
			},
			'not_needed',
			ok([])
		]
	])('%s', (_label, over, currentPointIds, expected) => {
		expect(reviewDropOffPoints({ ...input(over), currentPointIds })).toEqual(expected);
	});
});

describe('needsCurrentDropOffPoints (FR-AP-17 registry read)', () => {
	it.each<[string, Partial<ReviewPointsInput>, boolean]>([
		['an approved self drop-off line', {}, true],
		['only refusals', { lines: [{ index: 1, decision: 'rejected' }] }, false],
		['a parcel booking', { deliveryMethod: 'parcel' }, false],
		['a booking with no delivery method on file', { deliveryMethod: undefined }, false],
		['only lines a point already received', { recordedLineNos: new Set([1]) }, false],
		['no lines and a pending line left', { lines: undefined }, true],
		[
			'no lines on a booking from before schema_v 7',
			{ lines: undefined, items: [line({ free_text: 'ผ้าห่ม' })] },
			false
		]
	])('%s → %s', (_label, over, expected) => {
		expect(needsCurrentDropOffPoints(input(over))).toBe(expected);
	});

	it('is asked first: without the points a check that needs them throws', () => {
		expect(() => reviewDropOffPoints({ ...input({}), currentPointIds: 'not_needed' })).toThrow();
	});
});
