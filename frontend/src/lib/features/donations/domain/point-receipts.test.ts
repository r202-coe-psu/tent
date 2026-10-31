import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	donationShortfall,
	type DonationCloseReason,
	type DonationItem,
	type DonationPointReceipt
} from '$lib/features/operations';
import {
	allLinesRecorded,
	closeDonationByPoints,
	currentLinePoint,
	hasPointReceipts,
	isReceivedByPoint,
	receivedLineNos,
	recordedLineNos,
	refusedReceivedLines
} from './point-receipts';

/**
 * CR-206 FR-MP-29b — the worker closes expired bookings with a Python port of these, so both
 * sides read the same cases (`packages/donation-close-fixtures`, also `worker/tests/test_donation_close.py`).
 */
type Fixtures = {
	shortfall: {
		name: string;
		declared: { item_id?: string | null; qty: string }[];
		counted: { item_id?: string | null; qty: string }[];
		expected: unknown[];
	}[];
	close: {
		name: string;
		donation: { items: DonationItem[]; point_receipts: DonationPointReceipt[] };
		opts: { closed_by: string; closed_reason: DonationCloseReason; now: string };
		expected: unknown;
	}[];
};

const FIXTURES = fileURLToPath(
	new URL('../../../../../../packages/donation-close-fixtures/cases.json', import.meta.url)
);
const fixtures: Fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'));

describe('donation-close-fixtures (shared with the worker)', () => {
	it.each(fixtures.shortfall.map((c) => [c.name, c] as const))('shortfall: %s', (_, c) => {
		expect(donationShortfall(c.declared, c.counted)).toEqual(c.expected);
	});

	it.each(fixtures.close.map((c) => [c.name, c] as const))('close: %s', (_, c) => {
		const result = closeDonationByPoints(c.donation, {
			closedBy: c.opts.closed_by,
			closedReason: c.opts.closed_reason,
			now: c.opts.now
		});
		expect(result).toEqual(c.expected);
	});
});

const receipt = (lineNos: number[]): DonationPointReceipt => ({
	point_id: 'p-gym',
	line_nos: lineNos,
	received_at: '2026-10-28T02:00:00.000Z',
	received_by: 'gym',
	audit_id: 'audit:x',
	ledger_ids: [],
	items: []
});

describe('point receipt helpers', () => {
	const current = new Set(['p-gym', 'p-med']);

	it('reads recorded lines across receipts', () => {
		expect([...recordedLineNos({ point_receipts: [receipt([0, 2]), receipt([1])] })]).toEqual([
			0, 2, 1
		]);
		expect(recordedLineNos({}).size).toBe(0);
		expect(hasPointReceipts({ point_receipts: [] })).toBe(false);
		expect(hasPointReceipts({ point_receipts: [receipt([0])] })).toBe(true);
	});

	it('flags a review refusal of a line a point took in, not of one it turned away', () => {
		const donation = {
			point_receipts: [
				{
					line_nos: [0, 1],
					items: [
						{ line_no: 0, qty: '5' },
						{ line_no: 1, qty: '0', rejected: true }
					]
				}
			]
		};
		expect([...receivedLineNos(donation)]).toEqual([0]);
		expect(
			refusedReceivedLines(donation, [
				{ index: 2, decision: 'rejected' },
				{ index: 1, decision: 'rejected' },
				{ index: 0, decision: 'rejected' }
			])
		).toEqual([0]);
		expect(refusedReceivedLines(donation, [{ index: 0, decision: 'approved' }])).toEqual([]);
		expect(refusedReceivedLines({}, [{ index: 0, decision: 'rejected' }])).toEqual([]);
	});

	it('treats a point the shelter no longer offers as no point (FR-MP-19)', () => {
		expect(currentLinePoint({ drop_off_point_id: 'p-gym' }, current)).toBe('p-gym');
		expect(currentLinePoint({ drop_off_point_id: 'p-gone' }, current)).toBeNull();
		expect(currentLinePoint({ drop_off_point_id: null }, current)).toBeNull();
		expect(currentLinePoint({}, current)).toBeNull();
	});

	it('receives point by point only while a line names a current point or a receipt exists', () => {
		expect(isReceivedByPoint({ items: [{ drop_off_point_id: 'p-gym' }] }, current)).toBe(true);
		// FR-MP-24 / AC-21 — every point unticked after booking: received whole again.
		expect(isReceivedByPoint({ items: [{ drop_off_point_id: 'p-gym' }] }, new Set())).toBe(false);
		expect(isReceivedByPoint({ items: [{}] }, current)).toBe(false);
		// FR-MP-18b — once started, it stays point by point even with no point left.
		expect(
			isReceivedByPoint(
				{ items: [{ drop_off_point_id: 'p-gym' }], point_receipts: [receipt([0])] },
				new Set()
			)
		).toBe(true);
	});

	it('counts a line refused at review as recorded', () => {
		const items: DonationItem[] = [
			{ qty: '1', unit: 'pack', drop_off_point_id: 'p-gym' },
			{ qty: '1', unit: 'pack', drop_off_point_id: 'p-med', review_status: 'rejected' }
		];
		expect(allLinesRecorded({ items, point_receipts: [receipt([0])] })).toBe(true);
		expect(allLinesRecorded({ items, point_receipts: [] })).toBe(false);
	});

	it('refuses the remaining lines of a reviewed booking when nothing was received', () => {
		const result = closeDonationByPoints(
			{
				items: [
					{ item_id: 'item:a', qty: '1', unit: 'pack', review_status: 'approved' },
					{ item_id: 'item:b', qty: '1', unit: 'pack', review_status: 'approved' }
				],
				point_receipts: [
					{
						...receipt([0]),
						items: [
							{
								line_no: 0,
								item_id: 'item:a',
								qty: '0',
								unit: 'pack',
								rejected: true,
								reject_reason: 'หมดอายุ',
								reject_reason_code: 'expired'
							}
						]
					}
				]
			},
			{ closedBy: 'lead', closedReason: 'staff_close', now: '2026-10-29T00:00:00.000Z' }
		);
		expect(result.status).toBe('rejected');
		expect(result.received_at).toBeUndefined();
		expect(result.reject_reason_code).toBe('expired');
		expect(result.items?.map((item) => item.review_status)).toEqual(['rejected', 'rejected']);
	});
});
