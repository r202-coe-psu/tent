import { describe, expect, it } from 'vitest';
import type { RequisitionTicket, RequisitionTicketStatus } from '../../domain/food-supplies';
import {
	isTicketReadyForApproval,
	isTerminalTicketStatus,
	isReturnsStageStatus,
	getLifecycleSteps
} from './ticket-lifecycle';

const createValidTicket = (
	status: RequisitionTicketStatus = 'PENDING_PICK',
	overrides: Partial<RequisitionTicket> = {}
): RequisitionTicket => {
	const base: RequisitionTicket = {
		_id: 'requisition_ticket:tkt_test_01',
		type: 'requisition_ticket',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-19T10:00:00.000Z',
		updated_at: '2026-09-19T10:00:00.000Z',
		created_by: 'staff_test',
		ticket_no: 'TKT-FOOD-0001',
		requisition_type: 'food',
		status,
		source_location: 'ครัวกลาง',
		destination_location: 'เต็นท์ A',
		requested_by: 'staff_test',
		items: [
			{
				item_id: 'item:meal_01',
				item_name: 'ข้าวกล่อง',
				type_class: 'CONSUMABLE',
				requested_qty: '50',
				allocated_qty: '50'
			}
		]
	};

	return {
		...base,
		...overrides,
		schema_v: overrides.schema_v ?? base.schema_v,
		shelter_code: overrides.shelter_code ?? base.shelter_code,
		created_at: overrides.created_at ?? base.created_at,
		updated_at: overrides.updated_at ?? base.updated_at,
		created_by: overrides.created_by ?? base.created_by
	};
};

describe('Ticket Lifecycle & Approval Readiness (Slice 5.2)', () => {
	describe('isTicketReadyForApproval', () => {
		it('returns ready=true when ticket is PENDING_PICK and all items have positive allocated_qty', () => {
			const ticket = createValidTicket('PENDING_PICK', {
				items: [
					{
						item_id: 'item:1',
						item_name: 'ข้าวกล่อง 1',
						type_class: 'CONSUMABLE',
						requested_qty: '30',
						allocated_qty: '30'
					},
					{
						item_id: 'item:2',
						item_name: 'ข้าวกล่อง 2',
						type_class: 'CONSUMABLE',
						requested_qty: '20',
						allocated_qty: '15'
					}
				]
			});

			const result = isTicketReadyForApproval(ticket);
			expect(result.ready).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		it('returns ready=false when status is not PENDING_PICK', () => {
			const ticket = createValidTicket('READY_FOR_DISPATCH');
			const result = isTicketReadyForApproval(ticket);
			expect(result.ready).toBe(false);
			expect(result.reason).toContain('PENDING_PICK');
		});

		it('returns ready=false when items array is empty', () => {
			const ticket = createValidTicket('PENDING_PICK', { items: [] });
			const result = isTicketReadyForApproval(ticket);
			expect(result.ready).toBe(false);
			expect(result.reason).toContain('ไม่มีรายการ');
		});

		it('returns ready=false when any item lacks positive allocated_qty (allocated_qty is 0)', () => {
			const ticket = createValidTicket('PENDING_PICK', {
				items: [
					{
						item_id: 'item:1',
						item_name: 'ข้าวกล่อง 1',
						type_class: 'CONSUMABLE',
						requested_qty: '30',
						allocated_qty: '30'
					},
					{
						item_id: 'item:2',
						item_name: 'ข้าวกล่อง 2',
						type_class: 'CONSUMABLE',
						requested_qty: '20',
						allocated_qty: '0'
					}
				]
			});

			const result = isTicketReadyForApproval(ticket);
			expect(result.ready).toBe(false);
			expect(result.reason).toContain('ข้าวกล่อง 2');
		});

		it('returns ready=false when an allocated_qty is zero or negative', () => {
			const ticket = createValidTicket('PENDING_PICK', {
				items: [
					{
						item_id: 'item:1',
						item_name: 'ข้าวกล่อง 1',
						type_class: 'CONSUMABLE',
						requested_qty: '30',
						allocated_qty: '0'
					}
				]
			});

			const result = isTicketReadyForApproval(ticket);
			expect(result.ready).toBe(false);
			expect(result.reason).toContain('ข้าวกล่อง 1');
		});
	});

	describe('isTerminalTicketStatus & isReturnsStageStatus', () => {
		it('identifies COMPLETED and CANCELLED as terminal', () => {
			expect(isTerminalTicketStatus('COMPLETED')).toBe(true);
			expect(isTerminalTicketStatus('CANCELLED')).toBe(true);
			expect(isTerminalTicketStatus('PENDING_PICK')).toBe(false);
			expect(isTerminalTicketStatus('READY_FOR_DISPATCH')).toBe(false);
			expect(isTerminalTicketStatus('IN_TRANSIT')).toBe(false);
			expect(isTerminalTicketStatus('DISTRIBUTING')).toBe(false);
			expect(isTerminalTicketStatus('SHIFT_CLOSED')).toBe(false);
		});

		it('identifies return stage statuses accurately', () => {
			expect(isReturnsStageStatus('RETURN_PENDING_RECEIPT')).toBe(true);
			expect(isReturnsStageStatus('RETURN_COMPLETED')).toBe(true);
			expect(isReturnsStageStatus('SHIFT_CLOSED')).toBe(false);
			expect(isReturnsStageStatus('COMPLETED')).toBe(false);
		});
	});

	describe('getLifecycleSteps', () => {
		it('handles CANCELLED as a terminal branch rather than a sequential next step', () => {
			const { isCancelled, steps } = getLifecycleSteps('CANCELLED');
			expect(isCancelled).toBe(true);
			expect(steps).toHaveLength(2);
			expect(steps[1].state).toBe('branched');
			expect(steps[1].label).toBe('ยกเลิกตั๋ว');
		});

		it('marks PENDING_PICK as current and subsequent as upcoming', () => {
			const { isCancelled, steps } = getLifecycleSteps('PENDING_PICK');
			expect(isCancelled).toBe(false);
			expect(steps[0].id).toBe('pending_pick');
			expect(steps[0].state).toBe('current');
			expect(steps[1].state).toBe('upcoming');
			expect(steps[2].state).toBe('upcoming');
		});

		it('marks READY_FOR_DISPATCH as current and preceding as completed', () => {
			const { steps } = getLifecycleSteps('READY_FOR_DISPATCH');
			expect(steps[0].state).toBe('completed');
			expect(steps[1].state).toBe('current');
			expect(steps[2].state).toBe('upcoming');
		});

		it('marks IN_TRANSIT as current', () => {
			const { steps } = getLifecycleSteps('IN_TRANSIT');
			expect(steps[0].state).toBe('completed');
			expect(steps[1].state).toBe('completed');
			expect(steps[2].state).toBe('current');
			expect(steps[3].state).toBe('upcoming');
		});

		it('marks DISTRIBUTING as current', () => {
			const { steps } = getLifecycleSteps('DISTRIBUTING');
			expect(steps[2].state).toBe('completed');
			expect(steps[3].state).toBe('current');
			expect(steps[4].state).toBe('upcoming');
		});

		it('marks SHIFT_CLOSED as current', () => {
			const { steps } = getLifecycleSteps('SHIFT_CLOSED');
			expect(steps[3].state).toBe('completed');
			expect(steps[4].state).toBe('current');
			expect(steps[5].state).toBe('upcoming');
		});

		it('marks return stage as current for RETURN_PENDING_RECEIPT and RETURN_COMPLETED', () => {
			const receipt = getLifecycleSteps('RETURN_PENDING_RECEIPT');
			expect(receipt.steps[5].state).toBe('current');

			const returnCompleted = getLifecycleSteps('RETURN_COMPLETED');
			expect(returnCompleted.steps[5].state).toBe('current');
		});

		it('marks COMPLETED as current and preceding as completed', () => {
			const { steps } = getLifecycleSteps('COMPLETED');
			expect(steps[0].state).toBe('completed');
			expect(steps[1].state).toBe('completed');
			expect(steps[2].state).toBe('completed');
			expect(steps[3].state).toBe('completed');
			expect(steps[4].state).toBe('completed');
			expect(steps[5].state).toBe('completed');
			expect(steps[6].state).toBe('current');
		});
	});
});
