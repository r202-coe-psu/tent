import { describe, expect, it } from 'vitest';
import {
	isLoanReturnCandidate,
	isBulkClearedLoan,
	calculateLoanRemainingQty,
	calculateNewCumulativeReturned,
	validateCounterReturnQuantity,
	getLoanStatusBadge
} from './loan-return';
import type { DistributionLog } from '../../domain/food-supplies';

describe('loan-return model helpers', () => {
	const baseLoanLog: DistributionLog = {
		_id: 'distribution_log:01J00000000000000000000001',
		type: 'distribution_log',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-23T10:00:00.000Z',
		updated_at: '2026-09-23T10:00:00.000Z',
		created_by: 'staff_1',
		ticket_id: 'requisition_ticket:01J00000000000000000000001',
		item_id: 'item_master:blanket',
		qty: '5',
		recipient_type: 'evacuee',
		recipient_id: 'evacuee:01J00000000000000000000001',
		is_returnable: true,
		status: 'active',
		distributed_at: '2026-09-23T10:00:00.000Z',
		distributed_by: 'staff_1',
		is_override: false
	};

	describe('isLoanReturnCandidate', () => {
		it('identifies active returnable loan as a return candidate', () => {
			expect(isLoanReturnCandidate(baseLoanLog)).toBe(true);
		});

		it('identifies partially_returned returnable loan as a return candidate', () => {
			const partialLog: DistributionLog = {
				...baseLoanLog,
				status: 'partially_returned',
				qty_returned: '2'
			};
			expect(isLoanReturnCandidate(partialLog)).toBe(true);
		});

		it('rejects consumable/non-returnable log', () => {
			const consumableLog: DistributionLog = {
				...baseLoanLog,
				is_returnable: false,
				status: 'fulfilled'
			};
			expect(isLoanReturnCandidate(consumableLog)).toBe(false);
		});

		it('rejects returned, lost, waived, or voided logs', () => {
			expect(isLoanReturnCandidate({ ...baseLoanLog, status: 'returned', qty_returned: '5' })).toBe(
				false
			);
			expect(isLoanReturnCandidate({ ...baseLoanLog, status: 'lost' })).toBe(false);
			expect(isLoanReturnCandidate({ ...baseLoanLog, status: 'waived' })).toBe(false);
			expect(isLoanReturnCandidate({ ...baseLoanLog, status: 'voided' })).toBe(false);
		});
	});

	describe('isBulkClearedLoan', () => {
		it('returns true when status is returned and clear_reason is bulk_dropoff', () => {
			const bulkLog: DistributionLog = {
				...baseLoanLog,
				status: 'returned',
				qty_returned: '5',
				clear_reason: 'bulk_dropoff',
				bulk_pool_id: 'bulk_return_pool:01J00000000000000000000001'
			};
			expect(isBulkClearedLoan(bulkLog)).toBe(true);
		});

		it('returns false for routine physical return', () => {
			const routineLog: DistributionLog = {
				...baseLoanLog,
				status: 'returned',
				qty_returned: '5',
				clear_reason: 'routine'
			};
			expect(isBulkClearedLoan(routineLog)).toBe(false);
		});

		it('returns false for active or partially returned loans', () => {
			expect(isBulkClearedLoan(baseLoanLog)).toBe(false);
		});
	});

	describe('calculateLoanRemainingQty', () => {
		it('returns initial qty when no returns have been made', () => {
			expect(calculateLoanRemainingQty({ qty: '5', qty_returned: undefined })).toBe('5');
			expect(calculateLoanRemainingQty({ qty: '5', qty_returned: '0' })).toBe('5');
		});

		it('calculates remaining quantity after partial return', () => {
			expect(calculateLoanRemainingQty({ qty: '5', qty_returned: '2' })).toBe('3');
			expect(calculateLoanRemainingQty({ qty: '10', qty_returned: '7' })).toBe('3');
		});

		it('returns 0 when fully returned', () => {
			expect(calculateLoanRemainingQty({ qty: '5', qty_returned: '5' })).toBe('0');
		});

		it('handles decimal string precision correctly', () => {
			expect(calculateLoanRemainingQty({ qty: '5.5', qty_returned: '2.2' })).toBe('3.3');
		});
	});

	describe('calculateNewCumulativeReturned', () => {
		it('calculates new cumulative returned from 0 and delta', () => {
			expect(calculateNewCumulativeReturned(undefined, '2')).toBe('2');
			expect(calculateNewCumulativeReturned('0', '3')).toBe('3');
		});

		it('calculates cumulative returned across multiple partial returns', () => {
			expect(calculateNewCumulativeReturned('2', '2')).toBe('4');
			expect(calculateNewCumulativeReturned('4', '1')).toBe('5');
		});

		it('emits compact canonical Decimal string without trailing zero padding', () => {
			// '3.3400' + '6.6600' = 10 -> persistQty emits '10'
			expect(calculateNewCumulativeReturned('3.3400', '6.6600')).toBe('10');
			expect(calculateNewCumulativeReturned('1.5000', '0.5000')).toBe('2');
			expect(calculateNewCumulativeReturned('1.2500', '0.2500')).toBe('1.5');
		});
	});

	describe('validateCounterReturnQuantity', () => {
		it('accepts valid quantity less than or equal to remaining', () => {
			expect(validateCounterReturnQuantity('1', '3').isValid).toBe(true);
			expect(validateCounterReturnQuantity('3', '3').isValid).toBe(true);
			expect(validateCounterReturnQuantity('2.5', '3.0').isValid).toBe(true);
		});

		it('accepts canonical decimal format with leading zeros', () => {
			expect(validateCounterReturnQuantity('0001.2500', '3').isValid).toBe(true);
		});

		it('rejects empty or whitespace-only input', () => {
			const res = validateCounterReturnQuantity('', '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('กรุณาระบุจำนวน');

			const resWhitespace = validateCounterReturnQuantity('   ', '3');
			expect(resWhitespace.isValid).toBe(false);
			expect(resWhitespace.error).toContain('กรุณาระบุจำนวน');
		});

		it('rejects zero or negative input', () => {
			expect(validateCounterReturnQuantity('0', '3').isValid).toBe(false);
			expect(validateCounterReturnQuantity('-1', '3').isValid).toBe(false);
			expect(validateCounterReturnQuantity('-0.5', '3').isValid).toBe(false);
		});

		it('rejects non-numeric and malformed input', () => {
			expect(validateCounterReturnQuantity('abc', '3').isValid).toBe(false);
			expect(validateCounterReturnQuantity('1abc', '3').isValid).toBe(false);
			expect(validateCounterReturnQuantity('1e3', '3').isValid).toBe(false);
			expect(validateCounterReturnQuantity('1.2.3', '3').isValid).toBe(false);
		});

		it('rejects input with excessive decimal precision (> 4 fractional digits)', () => {
			expect(validateCounterReturnQuantity('1.23456', '3').isValid).toBe(false);
		});

		it('rejects quantity exceeding remaining balance', () => {
			const res = validateCounterReturnQuantity('4', '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('เกินจำนวนคงค้าง');
		});
	});

	describe('getLoanStatusBadge', () => {
		it('returns correct Thai badge label and styling for each status', () => {
			expect(getLoanStatusBadge({ ...baseLoanLog, status: 'active' }).label).toBe('กำลังยืม');
			expect(getLoanStatusBadge({ ...baseLoanLog, status: 'partially_returned' }).label).toBe(
				'คืนบางส่วน'
			);
			expect(
				getLoanStatusBadge({
					...baseLoanLog,
					status: 'returned',
					clear_reason: 'bulk_dropoff'
				}).label
			).toContain('Bulk');
			expect(
				getLoanStatusBadge({
					...baseLoanLog,
					status: 'returned',
					clear_reason: 'routine'
				}).label
			).toBe('คืนครบแล้ว');
			expect(getLoanStatusBadge({ ...baseLoanLog, status: 'lost' }).label).toContain('สูญหาย');
			expect(getLoanStatusBadge({ ...baseLoanLog, status: 'waived' }).label).toBe('ยกเว้นการคืน');
			expect(getLoanStatusBadge({ ...baseLoanLog, status: 'voided' }).label).toBe('ยกเลิกรายการ');
		});
	});
});
