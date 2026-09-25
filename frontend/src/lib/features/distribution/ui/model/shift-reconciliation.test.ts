import { describe, expect, it } from 'vitest';
import type { ItemReconciliationSummary } from '../../application/food-supplies/reconciliation-workflow';
import {
	buildCloseShiftOptions,
	computeItemPreview,
	computeShiftClosePreview,
	initializeReturnedQuantities,
	validateReturnedQuantity,
	validateShiftCloseForm
} from './shift-reconciliation';

describe('Shift Reconciliation UI Model', () => {
	const sampleSummaries: ItemReconciliationSummary[] = [
		{
			item_id: 'item:fan',
			item_name: 'พัดลม',
			allocated_qty: '10',
			distributed_qty: '7',
			remaining_in_hand: '3'
		},
		{
			item_id: 'item:rice',
			item_name: 'ข้าวสาร',
			allocated_qty: '50.5',
			distributed_qty: '50.5',
			remaining_in_hand: '0'
		}
	];

	describe('1. Initialization', () => {
		it('initializes returned quantities from remaining_in_hand for all items', () => {
			const initial = initializeReturnedQuantities(sampleSummaries);
			expect(initial).toEqual({
				'item:fan': '3',
				'item:rice': '0'
			});
		});
	});

	describe('2. Validation of returned quantity strings', () => {
		it('accepts valid returned quantity within remaining in hand', () => {
			const res = validateReturnedQuantity('2', '3');
			expect(res.isValid).toBe(true);
			expect(res.normalized).toBe('2');
		});

		it('accepts zero quantity', () => {
			const res = validateReturnedQuantity('0', '3');
			expect(res.isValid).toBe(true);
			expect(res.normalized).toBe('0');
		});

		it('rejects empty input', () => {
			const res = validateReturnedQuantity('   ', '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('กรุณาระบุจำนวนส่งคืน');
		});

		it('rejects negative quantity', () => {
			const res = validateReturnedQuantity('-1', '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนส่งคืนต้องไม่ติดลบ (≥ 0)');
		});

		it('rejects non-numeric quantity', () => {
			const res = validateReturnedQuantity('abc', '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องเป็นตัวเลขที่ถูกต้อง');
		});

		it('rejects returned quantity exceeding remaining in hand', () => {
			const res = validateReturnedQuantity('4', '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ต้องไม่เกินจำนวนคงเหลือในมือ');
		});

		it('normalizes decimal strings with whole-item ceiling (e.g. 2.1000 -> 3, 2.000 -> 2)', () => {
			const res = validateReturnedQuantity('2.1000', '3.5');
			expect(res.isValid).toBe(true);
			expect(res.normalized).toBe('3');
			expect(res.wasNormalized).toBe(true);

			const resWhole = validateReturnedQuantity('2.000', '3.5');
			expect(resWhole.isValid).toBe(true);
			expect(resWhole.normalized).toBe('2');
			expect(resWhole.wasNormalized).toBe(true);
		});
	});

	describe('3. Form validation across all items', () => {
		it('validates all items and produces normalizedValues when valid', () => {
			const formValues = {
				'item:fan': '2.1',
				'item:rice': '0'
			};
			const res = validateShiftCloseForm(sampleSummaries, formValues);
			expect(res.isValid).toBe(true);
			expect(res.normalizedValues).toEqual({
				'item:fan': '3',
				'item:rice': '0'
			});
			expect(Object.keys(res.errors)).toHaveLength(0);
		});

		it('collects per-item errors when any item is invalid', () => {
			const formValues = {
				'item:fan': '5', // exceeds remaining 3
				'item:rice': '-1' // negative
			};
			const res = validateShiftCloseForm(sampleSummaries, formValues);
			expect(res.isValid).toBe(false);
			expect(res.errors['item:fan']).toBeDefined();
			expect(res.errors['item:rice']).toBeDefined();
		});
	});

	describe('4. Discrepancy & Item Previews', () => {
		it('calculates 0 discrepancy when returned equals remaining in hand', () => {
			const preview = computeItemPreview(sampleSummaries[0], '3');
			expect(preview.allocated).toBe('10');
			expect(preview.distributed).toBe('7');
			expect(preview.remainingInHand).toBe('3');
			expect(preview.returned).toBe('3');
			expect(preview.discrepancy).toBe('0');
			expect(preview.hasDiscrepancy).toBe(false);
		});

		it('calculates positive discrepancy when returned is less than remaining in hand', () => {
			const preview = computeItemPreview(sampleSummaries[0], '1');
			expect(preview.returned).toBe('1');
			expect(preview.discrepancy).toBe('2'); // 10 - (7 + 1) = 2 missing
			expect(preview.hasDiscrepancy).toBe(true);
		});
	});

	describe('5. Zero-Return Fast Path vs Returns-Exist Preview (Critical Semantics)', () => {
		it('detects zero physical returns when all returned quantities are 0', () => {
			const formValues = {
				'item:fan': '0',
				'item:rice': '0'
			};
			const preview = computeShiftClosePreview(sampleSummaries, formValues);
			expect(preview.totalReturned).toBe('0');
			expect(preview.hasPhysicalReturns).toBe(false);
			expect(preview.isZeroReturnFastPath).toBe(true);
		});

		it('CRITICAL: discrepancy can be > 0 while physical returned total == 0 (does NOT conflate zero return with full distribution)', () => {
			const partialSummary: ItemReconciliationSummary = {
				item_id: 'item:tent',
				item_name: 'เต็นท์นอน',
				allocated_qty: '100',
				distributed_qty: '80',
				remaining_in_hand: '20'
			};

			// Operator enters returned = 0 (20 tents were lost/unreturned)
			const formValues = { 'item:tent': '0' };
			const preview = computeShiftClosePreview([partialSummary], formValues);

			expect(preview.totalAllocated).toBe('100');
			expect(preview.totalDistributed).toBe('80');
			expect(preview.totalRemainingInHand).toBe('20');
			expect(preview.totalReturned).toBe('0');
			expect(preview.totalDiscrepancy).toBe('20');
			expect(preview.hasDiscrepancy).toBe(true);

			// Crucial invariants:
			// 1. Physical warehouse return required is FALSE (no items to physically return)
			expect(preview.hasPhysicalReturns).toBe(false);
			// 2. Fast path to COMPLETED applies
			expect(preview.isZeroReturnFastPath).toBe(true);
			// 3. But items were NOT 100% distributed (80 != 100)
			expect(preview.totalDistributed).not.toBe(preview.totalAllocated);
		});

		it('detects returns-exist path when total returned > 0', () => {
			const formValues = {
				'item:fan': '2',
				'item:rice': '0'
			};
			const preview = computeShiftClosePreview(sampleSummaries, formValues);
			expect(preview.totalReturned).toBe('2');
			expect(preview.hasPhysicalReturns).toBe(true);
			expect(preview.isZeroReturnFastPath).toBe(false);
		});
	});

	describe('6. Mutation Options Construction', () => {
		it('builds ShiftCloseOptions with explicit returned_quantities for all items', () => {
			const normalized = {
				'item:fan': '2',
				'item:rice': '0'
			};
			const options = buildCloseShiftOptions(normalized);
			expect(options).toEqual({
				returned_quantities: {
					'item:fan': '2',
					'item:rice': '0'
				}
			});
		});
	});
});
