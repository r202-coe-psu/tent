import { describe, it, expect } from 'vitest';
import {
	loanReturnReservationDocSchema,
	createLoanReturnReservation,
	assertLoanReturnReservationTransition,
	isAllowedReservationTransition,
	type LoanReturnReservation
} from './return-reservation';
import type { AuthorContext } from '$lib/db/model';

describe('return-reservation domain contract', () => {
	const CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'wh_staff',
		roles: ['shelter:SH001', 'warehouse_staff']
	};

	const makeSampleReservation = (
		overrides: Partial<LoanReturnReservation> = {}
	): LoanReturnReservation => ({
		_id: 'loan_return_reservation:01J00000000000000000000001',
		type: 'loan_return_reservation',
		schema_v: 1,
		shelter_code: 'SH001',
		distribution_log_id: 'distribution_log:01J00000000000000000000001',
		mode: 'PHYSICAL',
		status: 'RESERVED',
		operation_id: '01J00000000000000000000002',
		operation_by: 'wh_staff',
		qty_returned: '1',
		return_condition: 'READY',
		created_at: '2026-09-24T11:57:00.000Z',
		created_by: 'wh_staff',
		updated_at: '2026-09-24T11:57:00.000Z',
		...overrides
	});

	it('accepts valid PHYSICAL, BULK, and NON_PHYSICAL reservations with FENCED status', () => {
		const physicalFenced = makeSampleReservation({
			status: 'FENCED',
			mode: 'PHYSICAL',
			qty_returned: '2',
			return_condition: 'BROKEN'
		});
		expect(() => loanReturnReservationDocSchema.parse(physicalFenced)).not.toThrow();

		const bulkFenced = makeSampleReservation({
			status: 'FENCED',
			mode: 'BULK',
			qty_returned: undefined,
			return_condition: undefined,
			bulk_pool_id: 'bulk_return_pool:01J00000000000000000000099',
			claimed_qty: '2'
		});
		expect(() => loanReturnReservationDocSchema.parse(bulkFenced)).not.toThrow();

		const nonPhysicalFenced = makeSampleReservation({
			status: 'FENCED',
			mode: 'NON_PHYSICAL',
			qty_returned: undefined,
			return_condition: undefined,
			clear_reason: 'lost'
		});
		expect(() => loanReturnReservationDocSchema.parse(nonPhysicalFenced)).not.toThrow();
	});

	it('accepts canonical condition READY, MAINTENANCE, BROKEN and rejects good, damaged, unusable', () => {
		for (const cond of ['READY', 'MAINTENANCE', 'BROKEN'] as const) {
			const valid = makeSampleReservation({ return_condition: cond });
			expect(() => loanReturnReservationDocSchema.parse(valid)).not.toThrow();
		}

		for (const legacyCond of ['good', 'damaged', 'unusable']) {
			const invalid = loanReturnReservationDocSchema.safeParse({
				...makeSampleReservation(),
				return_condition: legacyCond
			});
			expect(invalid.success).toBe(false);
		}
	});

	it('rejects invalid state and missing durable intent field combinations', () => {
		// PHYSICAL missing qty_returned
		const invalidPhysical = makeSampleReservation({
			mode: 'PHYSICAL',
			qty_returned: undefined
		});
		expect(() => loanReturnReservationDocSchema.parse(invalidPhysical)).toThrow(
			/PHYSICAL reservation requires qty_returned/
		);

		// BULK missing claimed_qty
		const invalidBulk = makeSampleReservation({
			mode: 'BULK',
			qty_returned: undefined,
			bulk_pool_id: 'bulk_return_pool:01J00000000000000000000099',
			claimed_qty: undefined
		});
		expect(() => loanReturnReservationDocSchema.parse(invalidBulk)).toThrow(
			/BULK reservation requires claimed_qty/
		);

		// NON_PHYSICAL missing clear_reason
		const invalidNonPhysical = makeSampleReservation({
			mode: 'NON_PHYSICAL',
			qty_returned: undefined,
			clear_reason: undefined
		});
		expect(() => loanReturnReservationDocSchema.parse(invalidNonPhysical)).toThrow(
			/NON_PHYSICAL reservation requires clear_reason/
		);
	});

	it('enforces allowed status transitions', () => {
		expect(isAllowedReservationTransition('RESERVED', 'FENCED')).toBe(true);
		expect(isAllowedReservationTransition('RESERVED', 'ABORTED')).toBe(true);
		expect(isAllowedReservationTransition('FENCED', 'COMMITTED')).toBe(true);
		expect(isAllowedReservationTransition('COMMITTED', 'RESERVED')).toBe(true);
		expect(isAllowedReservationTransition('ABORTED', 'RESERVED')).toBe(true);

		// Forbidden transitions:
		expect(isAllowedReservationTransition('FENCED', 'ABORTED')).toBe(false);
		expect(isAllowedReservationTransition('RESERVED', 'COMMITTED')).toBe(false);
		expect(isAllowedReservationTransition('COMMITTED', 'ABORTED')).toBe(false);
		expect(isAllowedReservationTransition('ABORTED', 'COMMITTED')).toBe(false);
	});

	it('assertLoanReturnReservationTransition blocks forbidden state changes', () => {
		const fenced = makeSampleReservation({ status: 'FENCED' });
		const aborted = { ...fenced, status: 'ABORTED' as const };
		expect(() => assertLoanReturnReservationTransition(fenced, aborted)).toThrow(
			/Invalid loan_return_reservation transition from FENCED to ABORTED/
		);

		const reserved = makeSampleReservation({ status: 'RESERVED' });
		const committed = { ...reserved, status: 'COMMITTED' as const };
		expect(() => assertLoanReturnReservationTransition(reserved, committed)).toThrow(
			/Invalid loan_return_reservation transition from RESERVED to COMMITTED/
		);
	});

	it('assertLoanReturnReservationTransition enforces attempt-scoped immutability while active', () => {
		const reserved = makeSampleReservation({ status: 'RESERVED' });
		const fencedWithDifferentQty = {
			...reserved,
			status: 'FENCED' as const,
			qty_returned: '5'
		};
		expect(() => assertLoanReturnReservationTransition(reserved, fencedWithDifferentQty)).toThrow(
			/loan_return_reservation\.qty_returned is attempt-scoped immutable/
		);

		const fencedWithDifferentOp = {
			...reserved,
			status: 'FENCED' as const,
			operation_id: '01J00000000000000000000099'
		};
		expect(() => assertLoanReturnReservationTransition(reserved, fencedWithDifferentOp)).toThrow(
			/loan_return_reservation\.operation_id is attempt-scoped immutable/
		);
	});

	it('assertLoanReturnReservationTransition enforces permanent immutability', () => {
		const reserved = makeSampleReservation({ status: 'RESERVED' });
		const changedLogId = {
			...reserved,
			status: 'FENCED' as const,
			distribution_log_id: 'distribution_log:01J00000000000000000000099'
		};
		expect(() => assertLoanReturnReservationTransition(reserved, changedLogId)).toThrow(
			/loan_return_reservation\.distribution_log_id is permanently immutable/
		);

		const changedCreatedBy = {
			...reserved,
			status: 'FENCED' as const,
			created_by: 'other_user'
		};
		expect(() => assertLoanReturnReservationTransition(reserved, changedCreatedBy)).toThrow(
			/loan_return_reservation\.created_by is permanently immutable/
		);
	});

	it('createLoanReturnReservation binds operation_by and durable intent without lease', () => {
		const created = createLoanReturnReservation(
			{
				distribution_log_id: 'distribution_log:01J00000000000000000000001',
				operation_id: '01J00000000000000000000002',
				mode: 'PHYSICAL',
				qty_returned: '1',
				return_condition: 'READY',
				notes: 'Test return'
			},
			CTX
		);

		expect(created.status).toBe('RESERVED');
		expect(created.mode).toBe('PHYSICAL');
		expect(created.created_by).toBe('wh_staff');
		expect(created.operation_by).toBe('wh_staff');
		expect(created.qty_returned).toBe('1');
		expect(created.return_condition).toBe('READY');
	});
});
