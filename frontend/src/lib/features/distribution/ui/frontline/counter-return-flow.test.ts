import { describe, expect, it } from 'vitest';
import type { DistributionLog } from '../../domain/food-supplies';
import {
	canPerformFrontlineDistribution,
	canReceivePhysicalStock
} from '../../application/food-supplies/auth';
import type { AuthorContext } from '$lib/db/model';
import {
	isLoanReturnCandidate,
	isBulkClearedLoan,
	calculateLoanRemainingQty,
	calculateNewCumulativeReturned,
	validateCounterReturnQuantity,
	validateNonPhysicalClear,
	getLoanStatusBadge,
	isEligibleBulkPool,
	validateBulkGateClear
} from '../model/loan-return';

const createMockContext = (
	capabilities: string[],
	shelterCode: string = 'SH001'
): AuthorContext => {
	const roles: string[] = [];
	for (const cap of capabilities) {
		if (cap === 'system_admin' || cap === '_admin') {
			roles.push(cap);
		} else if (cap.startsWith('shelter:')) {
			roles.push(cap);
		} else if (cap.includes(':')) {
			roles.push(cap);
		} else {
			if (!roles.includes(`shelter:${shelterCode}`)) {
				roles.push(`shelter:${shelterCode}`);
			}
			roles.push(`${shelterCode}:${cap}`);
			roles.push(cap);
		}
	}
	return {
		shelterCode,
		createdBy: 'user_test',
		roles
	};
};

describe('Frontline Loan Return & Routine Counter Return Flow (Slice 5.5A + 5.5B)', () => {
	const activeLoanLog: DistributionLog = {
		_id: 'distribution_log:01J00000000000000000000001',
		type: 'distribution_log',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-23T10:00:00.000Z',
		updated_at: '2026-09-23T10:00:00.000Z',
		created_by: 'staff_test',
		ticket_id: 'requisition_ticket:01J00000000000000000000001',
		item_id: 'item_master:blanket_01',
		qty: '5',
		recipient_type: 'evacuee',
		recipient_id: 'evacuee:01J00000000000000000000001',
		household_id: 'household:01J00000000000000000000001',
		is_returnable: true,
		status: 'active',
		distributed_at: '2026-09-23T10:00:00.000Z',
		distributed_by: 'staff_test',
		is_override: false
	};

	const partiallyReturnedLog: DistributionLog = {
		...activeLoanLog,
		_id: 'distribution_log:01J00000000000000000000002',
		status: 'partially_returned',
		qty_returned: '2',
		returned_at: '2026-09-23T11:00:00.000Z',
		returned_by: 'staff_test',
		clear_reason: 'routine'
	};

	const bulkClearedLog: DistributionLog = {
		...activeLoanLog,
		_id: 'distribution_log:01J00000000000000000000003',
		status: 'returned',
		qty_returned: '5',
		returned_at: '2026-09-23T12:00:00.000Z',
		returned_by: 'staff_test',
		clear_reason: 'bulk_dropoff',
		bulk_pool_id: 'bulk_return_pool:01J00000000000000000000001'
	};

	describe('Authorization Matrix (Frontline Route Access vs Physical Return Mutation)', () => {
		it('allows registration_staff (REG) to access frontline station but NOT execute physical return mutation', () => {
			const regCtx = createMockContext(['registration_staff']);
			expect(canPerformFrontlineDistribution(regCtx)).toBe(true);
			expect(canReceivePhysicalStock(regCtx)).toBe(false);
		});

		it('allows warehouse_staff (WH) to execute physical return mutation', () => {
			const whCtx = createMockContext(['warehouse_staff']);
			expect(canReceivePhysicalStock(whCtx)).toBe(true);
		});

		it('allows supply_coordinator (SC) to access frontline station AND execute physical return mutation', () => {
			const scCtx = createMockContext(['supply_coordinator']);
			expect(canPerformFrontlineDistribution(scCtx)).toBe(true);
			expect(canReceivePhysicalStock(scCtx)).toBe(true);
		});

		it('allows shelter_manager (SM) and system_admin (SA) full access to both', () => {
			const smCtx = createMockContext(['shelter_manager']);
			const saCtx = createMockContext(['system_admin']);
			expect(canPerformFrontlineDistribution(smCtx)).toBe(true);
			expect(canReceivePhysicalStock(smCtx)).toBe(true);
			expect(canPerformFrontlineDistribution(saCtx)).toBe(true);
			expect(canReceivePhysicalStock(saCtx)).toBe(true);
		});
	});

	describe('5.5A Return Station Candidate Identification & Information Display', () => {
		it('identifies initial active loan as a return candidate with full remaining balance', () => {
			expect(isLoanReturnCandidate(activeLoanLog)).toBe(true);
			expect(calculateLoanRemainingQty(activeLoanLog)).toBe('5');
			const badge = getLoanStatusBadge(activeLoanLog);
			expect(badge.label).toBe('กำลังยืม');
		});

		it('identifies partially returned loan as a return candidate with decremented remaining balance', () => {
			expect(isLoanReturnCandidate(partiallyReturnedLog)).toBe(true);
			expect(calculateLoanRemainingQty(partiallyReturnedLog)).toBe('3');
			const badge = getLoanStatusBadge(partiallyReturnedLog);
			expect(badge.label).toBe('คืนบางส่วน');
		});

		it('identifies bulk-cleared loan as NOT a return candidate (B1 Invariant)', () => {
			expect(isLoanReturnCandidate(bulkClearedLog)).toBe(false);
			expect(isBulkClearedLoan(bulkClearedLog)).toBe(true);
			const badge = getLoanStatusBadge(bulkClearedLog);
			expect(badge.label).toBe('เคลียร์ผ่านจุดรวบรวม');
		});

		it('produces empty active loan list when recipient has only closed/consumable records', () => {
			const closedLogs: DistributionLog[] = [
				bulkClearedLog,
				{ ...activeLoanLog, status: 'returned', qty_returned: '5', clear_reason: 'routine' },
				{ ...activeLoanLog, is_returnable: false, status: 'fulfilled' }
			];
			const activeCandidates = closedLogs.filter(isLoanReturnCandidate);
			expect(activeCandidates).toHaveLength(0);
		});
	});

	describe('5.5B Physical Counter Return Quantity Semantics & Calculation', () => {
		it('calculates target cumulative quantity for a partial return on an active loan', () => {
			const remaining = calculateLoanRemainingQty(activeLoanLog); // 5
			const returningNow = '2';

			const validation = validateCounterReturnQuantity(returningNow, remaining);
			expect(validation.isValid).toBe(true);

			const targetCumulative = calculateNewCumulativeReturned(
				activeLoanLog.qty_returned,
				returningNow
			);
			expect(targetCumulative).toBe('2');
		});

		it('calculates target cumulative quantity for a second partial return on a partially returned loan', () => {
			const remaining = calculateLoanRemainingQty(partiallyReturnedLog); // 3
			const returningNow = '1';

			const validation = validateCounterReturnQuantity(returningNow, remaining);
			expect(validation.isValid).toBe(true);

			const targetCumulative = calculateNewCumulativeReturned(
				partiallyReturnedLog.qty_returned, // '2'
				returningNow // '1'
			);
			expect(targetCumulative).toBe('3');
		});

		it('calculates full return target cumulative quantity matching total issued qty', () => {
			const remaining = calculateLoanRemainingQty(partiallyReturnedLog); // 3
			const returningNow = remaining; // '3'

			const targetCumulative = calculateNewCumulativeReturned(
				partiallyReturnedLog.qty_returned,
				returningNow
			);
			expect(targetCumulative).toBe(partiallyReturnedLog.qty); // '5'
		});

		it('strictly rejects quantity exceeding remaining in-hand balance before mutation', () => {
			const remaining = calculateLoanRemainingQty(partiallyReturnedLog); // 3
			const validation = validateCounterReturnQuantity('4', remaining);
			expect(validation.isValid).toBe(false);
			expect(validation.error).toContain('เกินจำนวนคงค้าง');
		});

		it('strictly rejects zero, negative, or invalid decimal quantities', () => {
			const remaining = '5';
			expect(validateCounterReturnQuantity('0', remaining).isValid).toBe(false);
			expect(validateCounterReturnQuantity('-1', remaining).isValid).toBe(false);
			expect(validateCounterReturnQuantity('', remaining).isValid).toBe(false);
			expect(validateCounterReturnQuantity('invalid', remaining).isValid).toBe(false);
		});
	});

	describe('Remote-First & Mutation Safety Guarantees', () => {
		it('preserves Decimal-safe string math without JS floating-point precision loss', () => {
			const preciseLog: DistributionLog = {
				...activeLoanLog,
				qty: '10.0000',
				qty_returned: '3.3333'
			};
			const remaining = calculateLoanRemainingQty(preciseLog);
			expect(remaining).toBe('6.6667');

			const newCumulative = calculateNewCumulativeReturned(preciseLog.qty_returned, '6.6667');
			// persistQty produces compact decimal strings (no trailing zero padding), emitting '10'
			expect(newCumulative).toBe('10');
		});
	});

	describe('Slice 5.5C Non-Physical Loan Clear (Lost / Waived Flow & Invariants)', () => {
		it('allows registration_staff (REG) to perform non-physical clear while denying physical return', () => {
			const regCtx = createMockContext(['registration_staff']);
			expect(canPerformFrontlineDistribution(regCtx)).toBe(true);
			expect(canReceivePhysicalStock(regCtx)).toBe(false);
		});

		it('allows warehouse_staff (WH) to perform physical return while denying non-physical clear without frontline role', () => {
			const whCtx = createMockContext(['warehouse_staff']);
			expect(canReceivePhysicalStock(whCtx)).toBe(true);
			expect(canPerformFrontlineDistribution(whCtx)).toBe(false);
		});

		it('allows supply_coordinator (SC), shelter_manager (SM), and system_admin (SA) both capabilities', () => {
			for (const role of ['supply_coordinator', 'shelter_manager', 'system_admin']) {
				const ctx = createMockContext([role]);
				expect(canPerformFrontlineDistribution(ctx)).toBe(true);
				expect(canReceivePhysicalStock(ctx)).toBe(true);
			}
		});

		it('validates non-physical clear inputs (requires valid reason and non-empty notes)', () => {
			expect(validateNonPhysicalClear('lost', 'Swept by flash flood').isValid).toBe(true);
			expect(validateNonPhysicalClear('waived', 'Emergency waiver approved').isValid).toBe(true);
			expect(validateNonPhysicalClear('damaged', 'Damaged in transit').isValid).toBe(false);
			expect(validateNonPhysicalClear('lost', '   ').isValid).toBe(false);
		});

		it('transitions loan to terminal state when cleared as lost, removing it from active candidates', () => {
			const lostLog: DistributionLog = {
				...activeLoanLog,
				status: 'lost',
				clear_reason: 'lost',
				notes: 'Lost in disaster surge',
				returned_at: '2026-09-23T14:00:00.000Z',
				returned_by: 'staff_test'
			};
			expect(isLoanReturnCandidate(lostLog)).toBe(false);
			const badge = getLoanStatusBadge(lostLog);
			expect(badge.label).toContain('สูญหาย');
		});

		it('transitions loan to terminal state when cleared as waived, removing it from active candidates', () => {
			const waivedLog: DistributionLog = {
				...partiallyReturnedLog,
				status: 'waived',
				clear_reason: 'waived',
				notes: 'Waived for elderly evacuee',
				returned_at: '2026-09-23T14:00:00.000Z',
				returned_by: 'staff_test'
			};
			expect(isLoanReturnCandidate(waivedLog)).toBe(false);
			const badge = getLoanStatusBadge(waivedLog);
			expect(badge.label).toBe('ยกเว้นการคืน');
		});

		it('preserves bulk-cleared B1 protection independently from non-physical write-offs', () => {
			expect(isLoanReturnCandidate(bulkClearedLog)).toBe(false);
			expect(isBulkClearedLoan(bulkClearedLog)).toBe(true);
		});
	});

	describe('CR-134 Bulk Gate Clearance Flow (Slice 5.5D)', () => {
		const mockPool = {
			_id: 'bulk_return_pool:01J00000000000000000000010',
			item_id: 'item_master:blanket_01',
			status: 'ACTIVE',
			total_received_qty: '20',
			claimed_qty: '5',
			unclaimed_quota: '15'
		};

		describe('Role Authorization Matrix for Bulk Gate Clearance', () => {
			it('allows registration_staff (REG) to execute bulk gate clearance', () => {
				const regCtx = createMockContext(['registration_staff']);
				expect(canPerformFrontlineDistribution(regCtx)).toBe(true);
			});

			it('allows supply_coordinator (SC), shelter_manager (SM), and system_admin (SA) to execute bulk gate clearance', () => {
				const scCtx = createMockContext(['supply_coordinator']);
				const smCtx = createMockContext(['shelter_manager']);
				const saCtx = createMockContext(['system_admin']);

				expect(canPerformFrontlineDistribution(scCtx)).toBe(true);
				expect(canPerformFrontlineDistribution(smCtx)).toBe(true);
				expect(canPerformFrontlineDistribution(saCtx)).toBe(true);
			});

			it('disallows warehouse_staff (WH) alone from executing bulk gate clearance (frontline gate role required)', () => {
				const whCtx = createMockContext(['warehouse_staff']);
				expect(canPerformFrontlineDistribution(whCtx)).toBe(false);
			});
		});

		describe('Pool Eligibility & Candidate Filtering', () => {
			it('identifies matching active pool with available quota as eligible for loan', () => {
				const remaining = calculateLoanRemainingQty(activeLoanLog); // 5
				expect(isEligibleBulkPool(mockPool, activeLoanLog.item_id, remaining)).toBe(true);
			});

			it('rejects pool when item does not match', () => {
				expect(isEligibleBulkPool(mockPool, 'item_master:other_item', '5')).toBe(false);
			});

			it('rejects pool when status is EXHAUSTED or CLOSED', () => {
				const exhaustedPool = { ...mockPool, status: 'EXHAUSTED', unclaimed_quota: '0' };
				const closedPool = { ...mockPool, status: 'CLOSED', unclaimed_quota: '15' };

				expect(isEligibleBulkPool(exhaustedPool, activeLoanLog.item_id)).toBe(false);
				expect(isEligibleBulkPool(closedPool, activeLoanLog.item_id)).toBe(false);
			});

			it('rejects pool when loan remaining balance exceeds pool unclaimed quota', () => {
				const smallPool = { ...mockPool, unclaimed_quota: '3' };
				const remaining = calculateLoanRemainingQty(activeLoanLog); // 5
				expect(isEligibleBulkPool(smallPool, activeLoanLog.item_id, remaining)).toBe(false);
			});
		});

		describe('Validation & State Invariants', () => {
			it('validates successfully when an eligible pool is selected with adequate quota', () => {
				const remaining = calculateLoanRemainingQty(activeLoanLog);
				const validation = validateBulkGateClear(mockPool, remaining);
				expect(validation.isValid).toBe(true);
			});

			it('rejects submission when no pool is selected', () => {
				const validation = validateBulkGateClear(null, '5');
				expect(validation.isValid).toBe(false);
				expect(validation.error).toContain('เลือกจุดรวมคืน');
			});

			it('rejects submission when selected pool has insufficient quota', () => {
				const smallPool = { ...mockPool, unclaimed_quota: '2' };
				const validation = validateBulkGateClear(smallPool, '5');
				expect(validation.isValid).toBe(false);
				expect(validation.error).toContain('ไม่เพียงพอกับยอดคงค้าง');
			});
		});

		describe('Zero-Second-Restock & B1 Invariant Preservation', () => {
			it('marks loan as returned with clear_reason bulk_dropoff and links bulk_pool_id', () => {
				const clearedViaBulk: DistributionLog = {
					...activeLoanLog,
					status: 'returned',
					qty_returned: '5',
					clear_reason: 'bulk_dropoff',
					bulk_pool_id: mockPool._id,
					returned_at: '2026-09-24T00:00:00.000Z',
					returned_by: 'staff_test'
				};

				expect(isLoanReturnCandidate(clearedViaBulk)).toBe(false);
				expect(isBulkClearedLoan(clearedViaBulk)).toBe(true);
				const badge = getLoanStatusBadge(clearedViaBulk);
				expect(badge.label).toBe('เคลียร์ผ่านจุดรวบรวม');
			});
		});
	});
});
