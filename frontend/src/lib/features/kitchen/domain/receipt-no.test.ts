import { describe, expect, it } from 'vitest';
import { mealServiceRef, nextReceiptNo } from './receipt-no';

describe('nextReceiptNo', () => {
	it('starts at 0001 for an empty list', () => {
		expect(nextReceiptNo([])).toBe('RCV-KITCHEN-0001');
	});
	it('returns max+1 over existing numbers', () => {
		expect(nextReceiptNo(['RCV-KITCHEN-0001', 'RCV-KITCHEN-0005', 'RCV-KITCHEN-0003'])).toBe(
			'RCV-KITCHEN-0006'
		);
	});
	it('ignores undefined / legacy entries', () => {
		expect(nextReceiptNo([undefined, '', 'RCV-KITCHEN-0002', undefined])).toBe('RCV-KITCHEN-0003');
		expect(nextReceiptNo([undefined, undefined])).toBe('RCV-KITCHEN-0001');
	});
	it('ignores other prefixes', () => {
		expect(nextReceiptNo(['TKT-KITCHEN-0099', 'RCV-OTHER-0050', 'RCV-KITCHEN-0004'])).toBe(
			'RCV-KITCHEN-0005'
		);
	});
	it('ignores malformed suffixes', () => {
		expect(
			nextReceiptNo(['RCV-KITCHEN-abc', 'RCV-KITCHEN-', 'RCV-KITCHEN-12x', 'RCV-KITCHEN--5'])
		).toBe('RCV-KITCHEN-0001');
	});
	it('pads to 4 digits', () => {
		expect(nextReceiptNo(['RCV-KITCHEN-0008'])).toBe('RCV-KITCHEN-0009');
		expect(nextReceiptNo(['RCV-KITCHEN-0098'])).toBe('RCV-KITCHEN-0099');
	});
	it('grows past 9999 without truncating', () => {
		expect(nextReceiptNo(['RCV-KITCHEN-9999'])).toBe('RCV-KITCHEN-10000');
		expect(nextReceiptNo(['RCV-KITCHEN-10000'])).toBe('RCV-KITCHEN-10001');
	});
});

describe('mealServiceRef', () => {
	it('uses receipt_no when present', () => {
		expect(
			mealServiceRef({
				_id: 'meal_service:01ARZ3NDEKTSV4RRFFQ69G5FAV',
				receipt_no: 'RCV-KITCHEN-0003'
			})
		).toBe('RCV-KITCHEN-0003');
	});
	it('falls back to the _id-derived code for legacy docs', () => {
		expect(mealServiceRef({ _id: 'meal_service:01ARZ3NDEKTSV4RRFFQ69G5FAV' })).toBe(
			'RCV-69G5FAV'.replace('69G5FAV', 'Q69G5FAV'.slice(-6))
		);
	});
});
