import { describe, expect, it } from 'vitest';
import {
	sumDispatchAllocations,
	validateDispatchLotAllocations,
	type DispatchLotCandidate
} from './dispatch-lots';

const LOT1 = 'stock_ledger:01JLOT1000000000000000000A';
const LOT2 = 'stock_ledger:01JLOT2000000000000000000B';
const LOT3 = 'stock_ledger:01JLOT3000000000000000000C';

const candidates: DispatchLotCandidate[] = [
	{ lot_ref: LOT1, qty: '3', expired: false },
	{ lot_ref: LOT2, qty: '2', expired: false },
	{ lot_ref: LOT3, qty: '10', expired: true }
];

describe('sumDispatchAllocations', () => {
	it('sums decimal quantities exactly', () => {
		expect(
			sumDispatchAllocations([
				{ lot_ref: LOT1, qty: '0.1' },
				{ lot_ref: LOT2, qty: '0.2' }
			])
		).toBe('0.3');
	});

	it('ignores malformed and non-positive entries', () => {
		expect(
			sumDispatchAllocations([
				{ lot_ref: LOT1, qty: 'abc' },
				{ lot_ref: LOT2, qty: '-1' },
				{ lot_ref: LOT3, qty: '2' }
			])
		).toBe('2');
	});
});

describe('validateDispatchLotAllocations', () => {
	it('accepts 3 + 2 = 5 across two lots', () => {
		const result = validateDispatchLotAllocations(
			'5',
			[
				{ lot_ref: LOT1, qty: '3' },
				{ lot_ref: LOT2, qty: '2' }
			],
			candidates
		);
		expect(result).toEqual({ ok: true, total: '5' });
	});

	it('accepts a single lot that holds the full quantity', () => {
		expect(
			validateDispatchLotAllocations('2', [{ lot_ref: LOT1, qty: '2' }], candidates)
		).toMatchObject({ ok: true });
	});

	it('rejects an empty allocation list', () => {
		expect(validateDispatchLotAllocations('5', [], candidates)).toMatchObject({
			ok: false,
			reason: 'no_lots'
		});
	});

	it('rejects a short total', () => {
		expect(
			validateDispatchLotAllocations(
				'5',
				[
					{ lot_ref: LOT1, qty: '3' },
					{ lot_ref: LOT2, qty: '1' }
				],
				candidates
			)
		).toEqual({ ok: false, reason: 'sum_mismatch', total: '4' });
	});

	it('rejects an over total', () => {
		const wide: DispatchLotCandidate[] = [
			{ lot_ref: LOT1, qty: '10', expired: false },
			{ lot_ref: LOT2, qty: '10', expired: false }
		];
		expect(
			validateDispatchLotAllocations(
				'5',
				[
					{ lot_ref: LOT1, qty: '3' },
					{ lot_ref: LOT2, qty: '3' }
				],
				wide
			)
		).toEqual({ ok: false, reason: 'sum_mismatch', total: '6' });
	});

	it('rejects an expired lot', () => {
		expect(
			validateDispatchLotAllocations('4', [{ lot_ref: LOT3, qty: '4' }], candidates)
		).toMatchObject({ ok: false, reason: 'expired_lot', lot_ref: LOT3 });
	});

	it('rejects a qty above the lot remaining balance', () => {
		expect(
			validateDispatchLotAllocations(
				'5',
				[
					{ lot_ref: LOT1, qty: '4' },
					{ lot_ref: LOT2, qty: '1' }
				],
				candidates
			)
		).toMatchObject({ ok: false, reason: 'exceeds_lot_balance', lot_ref: LOT1 });
	});

	it('rejects a duplicate lot_ref', () => {
		expect(
			validateDispatchLotAllocations(
				'3',
				[
					{ lot_ref: LOT1, qty: '1' },
					{ lot_ref: LOT1, qty: '2' }
				],
				candidates
			)
		).toMatchObject({ ok: false, reason: 'duplicate_lot', lot_ref: LOT1 });
	});

	it('rejects a malformed lot_ref', () => {
		expect(
			validateDispatchLotAllocations('1', [{ lot_ref: 'lot-1', qty: '1' }], candidates)
		).toMatchObject({ ok: false, reason: 'invalid_lot_ref', lot_ref: 'lot-1' });
	});

	it('rejects zero, negative and unparseable quantities', () => {
		for (const qty of ['0', '-1', 'abc', '']) {
			expect(
				validateDispatchLotAllocations('1', [{ lot_ref: LOT1, qty }], candidates)
			).toMatchObject({ ok: false, reason: 'non_positive_qty', lot_ref: LOT1 });
		}
	});

	it('rejects a lot that is not among the candidates', () => {
		expect(
			validateDispatchLotAllocations(
				'1',
				[{ lot_ref: 'stock_ledger:01JUNKNOWN00000000000000000', qty: '1' }],
				candidates
			)
		).toMatchObject({ ok: false, reason: 'unknown_lot' });
	});
});
