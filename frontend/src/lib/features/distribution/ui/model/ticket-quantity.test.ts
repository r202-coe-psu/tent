import { describe, expect, it } from 'vitest';
import { qtyGte, qtyLte } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';
import {
	buildAllocationItem,
	buildCreateTicketItem,
	isPositiveIntegerString,
	validatePositiveQuantity
} from './ticket-quantity';
import { ticketItemSchema } from '../../domain/food-supplies/requisition-ticket';

describe('Distribution whole-item quantity validation', () => {
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

	it.each(['1', '2', '10', '100'])('accepts positive integer %s', (raw) => {
		const result = validatePositiveQuantity(raw);
		expect(result).toEqual({ isValid: true, value: raw });
		expect(isPositiveIntegerString(raw)).toBe(true);
	});

	it.each(['0.1', '0.5', '1.01', '1.5', '1.99', '2.0', '10.01'])(
		'rejects decimal notation %s without rewriting it',
		(raw) => {
			const result = validatePositiveQuantity(raw);
			expect(result.isValid).toBe(false);
			expect(result.value).toBeUndefined();
		}
	);

	it.each(['', '-1', '-0.5', 'abc', '1e2', 'NaN', 'Infinity'])(
		'rejects malformed value %s',
		(raw) => {
			expect(validatePositiveQuantity(raw).isValid).toBe(false);
		}
	);

	it('accepts zero only when explicitly allowed', () => {
		expect(validatePositiveQuantity('0').isValid).toBe(false);
		expect(validatePositiveQuantity('0', { allowZero: true })).toEqual({
			isValid: true,
			value: '0'
		});
	});

	it('canonicalizes leading zeroes textually without numeric coercion', () => {
		expect(validatePositiveQuantity('050')).toEqual({ isValid: true, value: '50' });
	});

	it('rejects fractional values in payload builders', () => {
		expect(() => buildCreateTicketItem({ master: mockMaster, requested_qty: '1.5' })).toThrow();
		expect(() => buildAllocationItem({ item_id: 'item:123' }, '2.25')).toThrow();
	});

	it('keeps persisted ticket schema strict for fractional quantities', () => {
		expect(() =>
			ticketItemSchema.parse({
				item_id: 'item:rice',
				item_name: 'ข้าวสาร',
				type_class: 'CONSUMABLE',
				requested_qty: '0.5',
				allocated_qty: '1'
			})
		).toThrow();
	});

	it('compares large integer capacity without floating-point coercion', () => {
		const inHand = '9007199254740993';
		const exact = validatePositiveQuantity(inHand);
		const excessive = validatePositiveQuantity('9007199254740994');
		expect(qtyGte(inHand, exact.value!)).toBe(true);
		expect(qtyLte(exact.value!, inHand)).toBe(true);
		expect(qtyGte(inHand, excessive.value!)).toBe(false);
	});
});
