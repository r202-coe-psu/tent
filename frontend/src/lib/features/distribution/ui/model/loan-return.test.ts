import { describe, expect, it } from 'vitest';
import {
	isLoanReturnCandidate,
	isBulkClearedLoan,
	calculateLoanRemainingQty,
	calculateNewCumulativeReturned,
	validateCounterReturnQuantity,
	validateNonPhysicalClear,
	shouldResetLoanDialog,
	NON_PHYSICAL_CLEAR_REASON_OPTIONS,
	getLoanStatusBadge,
	isEligibleBulkPool,
	validateBulkGateClear,
	validateBulkForwardRecovery,
	resolveCounterRecoveryHydration,
	resolveNonPhysicalRecoveryHydration
} from './loan-return';
import type { DistributionLog, LoanReturnReservation } from '../../domain/food-supplies';

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

	describe('5.5C validateNonPhysicalClear & Reason Options', () => {
		it('exposes exactly canonical lost and waived options', () => {
			expect(NON_PHYSICAL_CLEAR_REASON_OPTIONS).toHaveLength(2);
			expect(NON_PHYSICAL_CLEAR_REASON_OPTIONS.map((o) => o.value)).toEqual(['lost', 'waived']);
		});

		it('accepts valid clear with reason lost and non-empty notes', () => {
			const res = validateNonPhysicalClear('lost', 'Flood surge swept equipment away');
			expect(res.isValid).toBe(true);
			expect(res.error).toBeUndefined();
		});

		it('accepts valid clear with reason waived and non-empty notes', () => {
			const res = validateNonPhysicalClear('waived', 'Approved by shelter manager for departure');
			expect(res.isValid).toBe(true);
			expect(res.error).toBeUndefined();
		});

		it('rejects empty or missing reason', () => {
			expect(validateNonPhysicalClear(null, 'Valid note').isValid).toBe(false);
			expect(validateNonPhysicalClear(undefined, 'Valid note').isValid).toBe(false);
			expect(validateNonPhysicalClear('', 'Valid note').isValid).toBe(false);
		});

		it('strictly rejects non-canonical clear reasons like damaged or routine', () => {
			expect(validateNonPhysicalClear('damaged', 'Broken in tent').isValid).toBe(false);
			expect(validateNonPhysicalClear('routine', 'Physical return').isValid).toBe(false);
			expect(validateNonPhysicalClear('bulk_dropoff', 'Sweep').isValid).toBe(false);
		});

		it('strictly rejects empty or whitespace-only notes', () => {
			const emptyRes = validateNonPhysicalClear('lost', '');
			expect(emptyRes.isValid).toBe(false);
			expect(emptyRes.error).toContain('กรุณาระบุหมายเหตุ');

			const whitespaceRes = validateNonPhysicalClear('waived', '   ');
			expect(whitespaceRes.isValid).toBe(false);
			expect(whitespaceRes.error).toContain('กรุณาระบุหมายเหตุ');
		});
	});

	describe('shouldResetLoanDialog', () => {
		it('returns true on initial open when lastInitializedLogId is null', () => {
			expect(shouldResetLoanDialog(null, true, 'distribution_log:01')).toBe(true);
		});

		it('returns false during retry or reactive updates when the same loan remains open', () => {
			// Critical async retry guarantee: mutation error does not re-initialize or wipe operator input
			expect(shouldResetLoanDialog('distribution_log:01', true, 'distribution_log:01')).toBe(false);
		});

		it('returns true when switching to a different loan record while open', () => {
			expect(shouldResetLoanDialog('distribution_log:01', true, 'distribution_log:02')).toBe(true);
		});

		it('returns false when dialog is closed', () => {
			expect(shouldResetLoanDialog(null, false, 'distribution_log:01')).toBe(false);
			expect(shouldResetLoanDialog('distribution_log:01', false, 'distribution_log:01')).toBe(
				false
			);
		});

		it('returns false when current log id is missing or undefined', () => {
			expect(shouldResetLoanDialog(null, true, undefined)).toBe(false);
			expect(shouldResetLoanDialog(null, true, null)).toBe(false);
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

	describe('isEligibleBulkPool', () => {
		const basePool = {
			item_id: 'item_master:blanket',
			status: 'ACTIVE',
			unclaimed_quota: '10'
		};

		it('accepts pool matching item_id, ACTIVE status, and positive quota', () => {
			expect(isEligibleBulkPool(basePool, 'item_master:blanket')).toBe(true);
		});

		it('accepts pool when requiredQty is less than or equal to unclaimed_quota', () => {
			expect(isEligibleBulkPool(basePool, 'item_master:blanket', '5')).toBe(true);
			expect(isEligibleBulkPool(basePool, 'item_master:blanket', '10')).toBe(true);
		});

		it('rejects pool when requiredQty exceeds unclaimed_quota', () => {
			expect(isEligibleBulkPool(basePool, 'item_master:blanket', '11')).toBe(false);
		});

		it('rejects pool when item_id does not match', () => {
			expect(isEligibleBulkPool(basePool, 'item_master:cot')).toBe(false);
		});

		it('rejects pool when status is EXHAUSTED', () => {
			expect(
				isEligibleBulkPool(
					{ ...basePool, status: 'EXHAUSTED', unclaimed_quota: '0' },
					'item_master:blanket'
				)
			).toBe(false);
		});

		it('rejects pool when status is CLOSED', () => {
			expect(
				isEligibleBulkPool(
					{ ...basePool, status: 'CLOSED', unclaimed_quota: '5' },
					'item_master:blanket'
				)
			).toBe(false);
		});

		it('rejects pool when unclaimed_quota is 0', () => {
			expect(isEligibleBulkPool({ ...basePool, unclaimed_quota: '0' }, 'item_master:blanket')).toBe(
				false
			);
		});
	});

	describe('validateBulkGateClear', () => {
		const activePool = {
			status: 'ACTIVE',
			unclaimed_quota: '5'
		};

		it('validates successfully when pool is selected, ACTIVE, and quota >= required', () => {
			expect(validateBulkGateClear(activePool, '3').isValid).toBe(true);
			expect(validateBulkGateClear(activePool, '5').isValid).toBe(true);
		});

		it('rejects when no pool is selected', () => {
			const res = validateBulkGateClear(null, '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('เลือกจุดรวมคืน');
		});

		it('rejects when selected pool is not ACTIVE', () => {
			const res = validateBulkGateClear({ status: 'EXHAUSTED', unclaimed_quota: '0' }, '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ไม่อยู่ในสถานะใช้งานได้');
		});

		it('rejects when selected pool has zero quota', () => {
			const res = validateBulkGateClear({ status: 'ACTIVE', unclaimed_quota: '0' }, '3');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ไม่มีโควตาคงเหลือ');
		});

		it('rejects when requiredQty exceeds unclaimed_quota', () => {
			const res = validateBulkGateClear(activePool, '6');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ไม่เพียงพอกับยอดคงค้าง');
		});
	});

	describe('validateBulkForwardRecovery', () => {
		it('allows forward recovery when pool is EXHAUSTED because quota was already consumed', () => {
			const res = validateBulkForwardRecovery(
				{ item_id: 'item:fan', status: 'EXHAUSTED' },
				'item:fan'
			);
			expect(res.isValid).toBe(true);
			expect(res.error).toBeUndefined();
		});

		it('allows forward recovery when pool is ACTIVE', () => {
			const res = validateBulkForwardRecovery(
				{ item_id: 'item:fan', status: 'ACTIVE' },
				'item:fan'
			);
			expect(res.isValid).toBe(true);
		});

		it('rejects when recovery pool is null/missing', () => {
			const res = validateBulkForwardRecovery({ pool: null, expectedItemId: 'item:fan' });
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ไม่พบข้อมูลจุดรวมคืน');
		});

		it('returns loading error when isLoading is true', () => {
			const res = validateBulkForwardRecovery({ pool: null, isLoading: true });
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('กำลังโหลดข้อมูลจุดรวมคืน');
		});

		it('rejects when recovery pool is CLOSED', () => {
			const res = validateBulkForwardRecovery(
				{ item_id: 'item:fan', status: 'CLOSED' },
				'item:fan'
			);
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ถูกปิดแล้ว');
		});
	});

	describe('resolveCounterRecoveryHydration', () => {
		const physicalRes: LoanReturnReservation = {
			_id: 'loan_return_reservation:01J00000000000000000000002',
			type: 'loan_return_reservation',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-09-24T10:00:00.000Z',
			updated_at: '2026-09-24T10:00:00.000Z',
			created_by: 'staff_1',
			operation_by: 'staff_1',
			operation_id: '01J00000000000000000000099',
			distribution_log_id: 'distribution_log:01J00000000000000000000002',
			mode: 'PHYSICAL',
			status: 'FENCED',
			qty_returned: '3',
			return_condition: 'READY',
			notes: 'Recovered item'
		};

		it('hydrates form state when matching PHYSICAL reservation arrives asynchronously', () => {
			const hydrated = resolveCounterRecoveryHydration({
				open: true,
				logId: 'distribution_log:01J00000000000000000000002',
				reservation: physicalRes,
				hydratedOperationId: null
			});

			expect(hydrated).not.toBeNull();
			expect(hydrated?.operationUlid).toBe('01J00000000000000000000099');
			expect(hydrated?.qtyInput).toBe('3');
			expect(hydrated?.returnCondition).toBe('READY');
			expect(hydrated?.notes).toBe('Recovered item');
		});

		it('hydrates exactly once per operation_id and ignores subsequent query ticks', () => {
			const hydratedAgain = resolveCounterRecoveryHydration({
				open: true,
				logId: 'distribution_log:01J00000000000000000000002',
				reservation: physicalRes,
				hydratedOperationId: '01J00000000000000000000099'
			});
			expect(hydratedAgain).toBeNull();
		});

		it('does not hydrate when dialog is closed or logId is null', () => {
			expect(
				resolveCounterRecoveryHydration({
					open: false,
					logId: 'distribution_log:01J00000000000000000000002',
					reservation: physicalRes,
					hydratedOperationId: null
				})
			).toBeNull();

			expect(
				resolveCounterRecoveryHydration({
					open: true,
					logId: null,
					reservation: physicalRes,
					hydratedOperationId: null
				})
			).toBeNull();
		});

		it('cross-mode safety: ignores non-PHYSICAL reservations (BULK or NON_PHYSICAL)', () => {
			const bulkRes: LoanReturnReservation = {
				...physicalRes,
				mode: 'BULK',
				bulk_pool_id: 'bulk_return_pool:01J00000000000000000000001',
				claimed_qty: '1'
			};
			expect(
				resolveCounterRecoveryHydration({
					open: true,
					logId: 'distribution_log:01J00000000000000000000002',
					reservation: bulkRes,
					hydratedOperationId: null
				})
			).toBeNull();
		});
	});

	describe('resolveNonPhysicalRecoveryHydration', () => {
		const nonPhysicalRes: LoanReturnReservation = {
			_id: 'loan_return_reservation:01J00000000000000000000003',
			type: 'loan_return_reservation',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-09-24T10:00:00.000Z',
			updated_at: '2026-09-24T10:00:00.000Z',
			created_by: 'staff_1',
			operation_by: 'staff_1',
			operation_id: '01J00000000000000000000100',
			distribution_log_id: 'distribution_log:01J00000000000000000000003',
			mode: 'NON_PHYSICAL',
			status: 'FENCED',
			clear_reason: 'waived',
			notes: 'Executive waiver approved'
		};

		it('hydrates form state when matching NON_PHYSICAL reservation arrives asynchronously', () => {
			const hydrated = resolveNonPhysicalRecoveryHydration({
				open: true,
				logId: 'distribution_log:01J00000000000000000000003',
				reservation: nonPhysicalRes,
				hydratedOperationId: null
			});

			expect(hydrated).not.toBeNull();
			expect(hydrated?.operationUlid).toBe('01J00000000000000000000100');
			expect(hydrated?.reason).toBe('waived');
			expect(hydrated?.notes).toBe('Executive waiver approved');
		});

		it('hydrates exactly once and does not overwrite modified form with defaults', () => {
			const secondTick = resolveNonPhysicalRecoveryHydration({
				open: true,
				logId: 'distribution_log:01J00000000000000000000003',
				reservation: nonPhysicalRes,
				hydratedOperationId: '01J00000000000000000000100'
			});
			expect(secondTick).toBeNull();
		});

		it('cross-mode safety: ignores PHYSICAL or BULK reservations in NON_PHYSICAL dialog', () => {
			const physicalRes: LoanReturnReservation = {
				...nonPhysicalRes,
				mode: 'PHYSICAL',
				qty_returned: '1',
				return_condition: 'READY'
			};
			expect(
				resolveNonPhysicalRecoveryHydration({
					open: true,
					logId: 'distribution_log:01J00000000000000000000003',
					reservation: physicalRes,
					hydratedOperationId: null
				})
			).toBeNull();
		});
	});
});
