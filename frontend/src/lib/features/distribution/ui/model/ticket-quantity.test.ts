import { describe, expect, it } from 'vitest';
import { qtyGte, qtyLte } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';
import {
	buildAllocationItem,
	buildCreateTicketItem,
	formatNormalizationNotice,
	isPositiveIntegerString,
	normalizeWholeItemInput,
	validatePositiveQuantity
} from './ticket-quantity';
import {
	ticketItemSchema,
	createFlow2RequisitionTicket,
	requisitionTicketDocSchema
} from '../../domain/food-supplies/requisition-ticket';

describe('Transactional Whole-Item Ceiling Normalization & Positive Contract', () => {
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

	describe('1. Canonical Normalizer — Valid Whole Numbers (no modification)', () => {
		it('preserves "1" -> "1"', () => {
			const res = normalizeWholeItemInput('1');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('1');
			expect(res.wasNormalized).toBe(false);
			expect(isPositiveIntegerString('1')).toBe(true);
		});

		it('preserves "5" -> "5"', () => {
			const res = normalizeWholeItemInput('5');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('5');
			expect(res.wasNormalized).toBe(false);
			expect(isPositiveIntegerString('5')).toBe(true);
		});

		it('preserves "100" -> "100"', () => {
			const res = normalizeWholeItemInput('100');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('100');
			expect(res.wasNormalized).toBe(false);
			expect(isPositiveIntegerString('100')).toBe(true);
		});

		it('normalizes redundant leading zeros ("01" -> "1", "050" -> "50")', () => {
			const r1 = normalizeWholeItemInput('01');
			expect(r1.isValid).toBe(true);
			expect(r1.value).toBe('1');
			expect(r1.wasNormalized).toBe(true);

			const r2 = normalizeWholeItemInput('050');
			expect(r2.isValid).toBe(true);
			expect(r2.value).toBe('50');
			expect(r2.wasNormalized).toBe(true);
		});
	});

	describe('2. Canonical Normalizer — Ceiling (Rounding UP) Behavior', () => {
		it('normalizes "0.1" -> "1"', () => {
			const res = normalizeWholeItemInput('0.1');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('1');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "0.5" -> "1"', () => {
			const res = normalizeWholeItemInput('0.5');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('1');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "1.01" -> "2"', () => {
			const res = normalizeWholeItemInput('1.01');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('2');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "1.5" -> "2"', () => {
			const res = normalizeWholeItemInput('1.5');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('2');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "1.99" -> "2"', () => {
			const res = normalizeWholeItemInput('1.99');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('2');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "2.0001" -> "3"', () => {
			const res = normalizeWholeItemInput('2.0001');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('3');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "10.01" -> "11" and "10.001" -> "11"', () => {
			const r1 = normalizeWholeItemInput('10.01');
			expect(r1.isValid).toBe(true);
			expect(r1.value).toBe('11');
			expect(r1.wasNormalized).toBe(true);

			const r2 = normalizeWholeItemInput('10.001');
			expect(r2.isValid).toBe(true);
			expect(r2.value).toBe('11');
			expect(r2.wasNormalized).toBe(true);
		});

		it('preserves exact large integer digits without IEEE-754 precision loss', () => {
			const largeInt = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2
			const res = normalizeWholeItemInput(`${largeInt}.0001`);
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('9007199254740994');
		});
	});

	describe('3. Canonical Normalizer — Equivalent Whole Decimals', () => {
		it('normalizes "1.0" -> "1"', () => {
			const res = normalizeWholeItemInput('1.0');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('1');
			expect(res.wasNormalized).toBe(true);
		});

		it('normalizes "2.000" -> "2"', () => {
			const res = normalizeWholeItemInput('2.000');
			expect(res.isValid).toBe(true);
			expect(res.value).toBe('2');
			expect(res.wasNormalized).toBe(true);
		});
	});

	describe('4. Canonical Normalizer — Invalid Inputs Remain Invalid', () => {
		it('rejects empty string ""', () => {
			const res = normalizeWholeItemInput('');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('กรุณาระบุจำนวน');
		});

		it('rejects "0" when allowZero is false', () => {
			const res = normalizeWholeItemInput('0');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
		});

		it('rejects "-1" and "-0.5"', () => {
			expect(normalizeWholeItemInput('-1').isValid).toBe(false);
			expect(normalizeWholeItemInput('-0.5').isValid).toBe(false);
		});

		it('rejects non-numeric "abc"', () => {
			expect(normalizeWholeItemInput('abc').isValid).toBe(false);
		});

		it('rejects scientific notation "1e2" and "1E2"', () => {
			expect(normalizeWholeItemInput('1e2').isValid).toBe(false);
			expect(normalizeWholeItemInput('1E2').isValid).toBe(false);
		});

		it('rejects "NaN" and "Infinity"', () => {
			expect(normalizeWholeItemInput('NaN').isValid).toBe(false);
			expect(normalizeWholeItemInput('Infinity').isValid).toBe(false);
		});

		it('supports allowZero: true for return reconciliation ("0" -> "0", "0.5" -> "1")', () => {
			const r0 = normalizeWholeItemInput('0', { allowZero: true });
			expect(r0.isValid).toBe(true);
			expect(r0.value).toBe('0');
			expect(r0.wasNormalized).toBe(false);

			const r00 = normalizeWholeItemInput('0.0', { allowZero: true });
			expect(r00.isValid).toBe(true);
			expect(r00.value).toBe('0');
			expect(r00.wasNormalized).toBe(true);

			const r05 = normalizeWholeItemInput('0.5', { allowZero: true });
			expect(r05.isValid).toBe(true);
			expect(r05.value).toBe('1');
			expect(r05.wasNormalized).toBe(true);
		});
	});

	describe('5. Visible Feedback Formatter', () => {
		it('formats informative Thai notice when normalization occurs', () => {
			const msg1 = formatNormalizationNotice('1.5', '2');
			expect(msg1).toBe('จำนวนต้องเป็นจำนวนเต็ม ระบบปรับจาก 1.5 เป็น 2');

			const msg2 = formatNormalizationNotice('0.5', '1', 'ชิ้น');
			expect(msg2).toBe('จำนวนต้องเป็นจำนวนเต็ม ระบบปรับจาก 0.5 เป็น 1 ชิ้น');
		});
	});

	describe('6. Payload Builders & UI Model Ceiling Integration', () => {
		it('buildCreateTicketItem normalizes fractional input with ceiling (1.5 -> 2)', () => {
			const item = buildCreateTicketItem({
				master: mockMaster,
				requested_qty: '1.5'
			});
			expect(item.requested_qty).toBe('2');
			expect(item.allocated_qty).toBe('2');
		});

		it('buildAllocationItem normalizes fractional input with ceiling (2.25 -> 3)', () => {
			const alloc = buildAllocationItem(
				{ item_id: 'item:123', item_name: 'ชุดเครื่องนอน' },
				'2.25'
			);
			expect(alloc.allocated_qty).toBe('3');
		});

		it('payload builders still throw on invalid negative, zero, or scientific notation', () => {
			expect(() =>
				buildCreateTicketItem({ master: mockMaster, requested_qty: '0' })
			).toThrow('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');

			expect(() =>
				buildCreateTicketItem({ master: mockMaster, requested_qty: '-1' })
			).toThrow();

			expect(() =>
				buildCreateTicketItem({ master: mockMaster, requested_qty: '1e2' })
			).toThrow();
		});
	});

	describe('7. Architectural Invariant — Persisted Schema Rejects vs Input Schema Normalizes', () => {
		it('persisted document ticketItemSchema STILL strictly rejects fractional numbers ("0.5")', () => {
			expect(() =>
				ticketItemSchema.parse({
					item_id: 'item:rice',
					item_name: 'ข้าวสาร',
					type_class: 'CONSUMABLE',
					requested_qty: '0.5',
					allocated_qty: '1'
				})
			).toThrow();

			expect(() =>
				ticketItemSchema.parse({
					item_id: 'item:rice',
					item_name: 'ข้าวสาร',
					type_class: 'CONSUMABLE',
					requested_qty: '1',
					allocated_qty: '0.5'
				})
			).toThrow();
		});

		it('input boundary createFlow2RequisitionTicket accepts and normalizes "1.5" to "2"', () => {
			const ctx = { shelterCode: 'SH001', createdBy: 'user:test' };
			const ticket = createFlow2RequisitionTicket(
				{
					ticket_no: 'TKT-FOOD-999',
					requisition_type: 'food',
					meal: 'lunch',
					source_location: 'ครัวกลาง',
					destination_location: 'จุดจ่าย 1',
					items: [
						{
							item_id: 'item:meal_box',
							item_name: 'ข้าวกล่อง',
							type_class: 'CONSUMABLE',
							requested_qty: '1.5',
							allocated_qty: '1.5'
						}
					]
				},
				ctx
			);

			// Persisted document must have the whole-number ceiling "2"
			expect(ticket.items[0].requested_qty).toBe('2');
			expect(ticket.items[0].allocated_qty).toBe('2');
			// And passing it through the strict persisted document schema succeeds
			expect(() => requisitionTicketDocSchema.parse(ticket)).not.toThrow();
		});
	});

	describe('8. Frontline Capacity Comparison Precision', () => {
		const inHandQty = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
		const validRequested = '9007199254740992';
		const exactRequested = '9007199254740993';
		const excessiveRequested = '9007199254740994';

		it('compares large integer capacity accurately where parseFloat loses precision', () => {
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
	});
});
