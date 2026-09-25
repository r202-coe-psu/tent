import { describe, expect, it } from 'vitest';
import { persistQty, qtyGte, qtyLte } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';
import {
	buildAllocationItem,
	buildCreateTicketItem,
	validatePositiveQuantity
} from './ticket-quantity';

describe('Transactional Ticket Quantity Canonical Decimal Contract (Phase 5.7A)', () => {
	const mockMaster: ItemMaster = {
		_id: 'item:test_large_pack',
		type: 'item_master',
		schema_v: 1,
		created_at: '2026-09-24T10:00:00.000Z',
		updated_at: '2026-09-24T10:00:00.000Z',
		created_by: 'staff_test',
		name: 'ชุดเครื่องนอนฉุกเฉิน',
		base_unit: 'ชุด',
		type_class: 'EQUIPMENT',
		returnable: true,
		conversions: [],
		dietary: []
	};

	describe('1. Large Integer Precision (> Number.MAX_SAFE_INTEGER)', () => {
		const largeInt = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2

		it('preserves exact integer digits without IEEE-754 mantissa truncation', () => {
			// Under IEEE-754 binary floating point:
			// parseFloat("9007199254740993") === 9007199254740992
			expect(String(parseFloat(largeInt))).toBe('9007199254740992'); // Demonstrates the bug

			const res = validatePositiveQuantity(largeInt);
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('9007199254740993');
			expect(res.value).not.toBe('9007199254740992');
		});

		it('builds ticket creation payload preserving large integer precision', () => {
			const item = buildCreateTicketItem({
				master: mockMaster,
				requested_qty: largeInt
			});

			expect(item.requested_qty).toBe('9007199254740993');
			expect(item.allocated_qty).toBe('9007199254740993');
			expect(typeof item.requested_qty).toBe('string');
			expect(typeof item.allocated_qty).toBe('string');
		});

		it('builds allocation payload preserving large integer precision', () => {
			const allocation = buildAllocationItem(
				{ item_id: 'item:test_large_pack', item_name: 'ชุดเครื่องนอน' },
				largeInt
			);

			expect(allocation.allocated_qty).toBe('9007199254740993');
			expect(typeof allocation.allocated_qty).toBe('string');
		});
	});

	describe('2. Fractional Precision & Decimal Scale (QTY_DECIMALS = 4)', () => {
		it('preserves fractional decimal strings within 4 decimal places', () => {
			const res = validatePositiveQuantity('0.1001');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('0.1001');
		});

		it('accepts minimum positive canonical decimal quantum (0.0001)', () => {
			const res = validatePositiveQuantity('0.0001');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('0.0001');
		});

		it('canonicalizes fractional input using persistQty policy without floating point noise', () => {
			// In JS IEEE-754: 0.1 + 0.2 = 0.30000000000000004
			const input = '0.3';
			const res = validatePositiveQuantity(input);
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('0.3');
		});

		it('normalizes input beyond canonical scale according to persistQty policy', () => {
			const input = '0.10000001';
			const expected = persistQty(input); // Rounds to 4 decimal places with HALF_UP -> "0.1"
			const res = validatePositiveQuantity(input);
			expect(res.isValid).toBe(true);
			expect(res.value).toBe(expected);
			expect(res.value).toBe('0.1');
		});
	});

	describe('3. Canonical Normalization (Leading / Trailing Zeros)', () => {
		it('normalizes redundant leading and trailing zeros (001.5000 -> 1.5)', () => {
			const res = validatePositiveQuantity('001.5000');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('1.5');
			expect(res.value).toBe(persistQty('001.5000'));
		});

		it('normalizes padded integer strings (050 -> 50)', () => {
			const res = validatePositiveQuantity('050');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('50');
			expect(res.value).toBe(persistQty('050'));
		});
	});

	describe('4. Invalid Inputs (Strict Rejection without Thrown Exceptions)', () => {
		it('rejects empty string', () => {
			const res = validatePositiveQuantity('');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();
			expect(res.error).toBeDefined();
		});

		it('rejects whitespace string', () => {
			const res = validatePositiveQuantity('   ');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();
		});

		it('rejects non-numeric alphabetic text', () => {
			const res = validatePositiveQuantity('abc');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();
		});

		it('rejects NaN text safely', () => {
			const res = validatePositiveQuantity('NaN');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();
		});

		it('rejects Infinity text safely', () => {
			const res = validatePositiveQuantity('Infinity');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();
		});

		it('rejects negative numbers (strictly positive contract > 0)', () => {
			const res = validatePositiveQuantity('-1');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();

			const resSmall = validatePositiveQuantity('-0.0001');
			expect(resSmall.isValid).toBe(false);
			expect(resSmall.value).toBeUndefined();
		});

		it('rejects zero (strictly positive contract > 0)', () => {
			const res = validatePositiveQuantity('0');
			expect(res.isValid).toBe(false);
			expect(res.value).toBeUndefined();

			const resZeroDec = validatePositiveQuantity('0.0000');
			expect(resZeroDec.isValid).toBe(false);
			expect(resZeroDec.value).toBeUndefined();
		});

		it('throws descriptive error in buildCreateTicketItem when input is invalid', () => {
			expect(() =>
				buildCreateTicketItem({
					master: mockMaster,
					requested_qty: '0'
				})
			).toThrow('จำนวนเบิกของ ชุดเครื่องนอนฉุกเฉิน ต้องมากกว่า 0');
		});

		it('throws descriptive error in buildAllocationItem when input is invalid', () => {
			expect(() =>
				buildAllocationItem({ item_id: 'item:123', item_name: 'ชุดเครื่องนอน' }, '-5')
			).toThrow('จำนวนจัดสรรของ ชุดเครื่องนอน ต้องมากกว่า 0');
		});
	});

	describe('5. Payload Type Verification (Zero JS Numbers)', () => {
		it('ensures requested_qty and allocated_qty are strictly strings in create ticket items', () => {
			const item = buildCreateTicketItem({
				master: mockMaster,
				requested_qty: '25.5'
			});

			expect(typeof item.requested_qty).toBe('string');
			expect(typeof item.allocated_qty).toBe('string');
			expect(item.requested_qty).toBe('25.5');
			expect(item.allocated_qty).toBe('25.5');
		});

		it('ensures allocated_qty is strictly a string in allocation mutation payload', () => {
			const allocation = buildAllocationItem({ item_id: 'item:tent' }, '10');

			expect(typeof allocation.allocated_qty).toBe('string');
			expect(allocation.allocated_qty).toBe('10');
		});

		it('ensures frontline distribution and top-up validation outputs pure strings', () => {
			const topUpRes = validatePositiveQuantity('15.5');
			expect(topUpRes.isValid).toBe(true);
			expect(typeof topUpRes.value).toBe('string');
			expect(topUpRes.value).toBe('15.5');

			const foodRes = validatePositiveQuantity('5');
			expect(foodRes.isValid).toBe(true);
			expect(typeof foodRes.value).toBe('string');
			expect(foodRes.value).toBe('5');
		});
	});

	describe('6. Frontline Capacity Comparison Precision (Phase 5.7A-2)', () => {
		const inHandQty = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
		const validRequested = '9007199254740992';
		const exactRequested = '9007199254740993';
		const excessiveRequested = '9007199254740994';

		it('compares large integer capacity accurately where parseFloat loses precision', () => {
			// Under IEEE-754:
			// parseFloat("9007199254740993") is coerced to 9007199254740992
			// which would cause faulty comparison against 9007199254740992 or 9007199254740993
			expect(parseFloat(inHandQty)).toBe(9007199254740992);

			const validRes = validatePositiveQuantity(validRequested);
			expect(validRes.isValid).toBe(true);
			expect(qtyGte(inHandQty, validRes.value!)).toBe(true);
			expect(qtyLte(validRes.value!, inHandQty)).toBe(true);

			const exactRes = validatePositiveQuantity(exactRequested);
			expect(exactRes.isValid).toBe(true);
			expect(qtyGte(inHandQty, exactRes.value!)).toBe(true);
			expect(qtyLte(exactRes.value!, inHandQty)).toBe(true);

			const excessiveRes = validatePositiveQuantity(excessiveRequested);
			expect(excessiveRes.isValid).toBe(true);
			expect(qtyGte(inHandQty, excessiveRes.value!)).toBe(false);
			expect(qtyLte(excessiveRes.value!, inHandQty)).toBe(false);
		});

		it('compares fractional capacity accurately within canonical 4-decimal scale', () => {
			const fractionalInHand = '10.0000';
			const validFraction = '9.9999';
			const exactFraction = '10.0000';
			const excessiveFraction = '10.0001';

			const validRes = validatePositiveQuantity(validFraction);
			expect(validRes.isValid).toBe(true);
			expect(qtyGte(fractionalInHand, validRes.value!)).toBe(true);

			const exactRes = validatePositiveQuantity(exactFraction);
			expect(exactRes.isValid).toBe(true);
			expect(qtyGte(fractionalInHand, exactRes.value!)).toBe(true);

			const excessiveRes = validatePositiveQuantity(excessiveFraction);
			expect(excessiveRes.isValid).toBe(true);
			expect(qtyGte(fractionalInHand, excessiveRes.value!)).toBe(false);
		});
	});
});
