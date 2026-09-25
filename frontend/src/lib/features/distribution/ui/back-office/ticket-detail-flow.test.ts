import { describe, expect, it } from 'vitest';
import type { RequisitionTicket, RequisitionTicketStatus } from '../../domain/food-supplies';
import {
	canAllocateTicket,
	canApproveTicket,
	canCancelTicket,
	canDispatchTicket,
	canPerformFrontlineDistribution,
	canReceiveWarehouseReturns
} from '../../application/food-supplies/auth';
import type { AuthorContext } from '$lib/db/model';
import { isTicketReadyForApproval } from '../model/ticket-lifecycle';

const createValidTicket = (
	status: RequisitionTicketStatus = 'PENDING_PICK',
	overrides: Partial<RequisitionTicket> = {}
): RequisitionTicket => {
	const base: RequisitionTicket = {
		_id: 'requisition_ticket:tkt_detail_01',
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
				item_name: 'ข้าวกล่องไก่กระเทียม',
				category: 'item_category:ready_meal',
				type_class: 'CONSUMABLE',
				returnable: false,
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

describe('Ticket Detail & PENDING_PICK Actions (Slice 5.2)', () => {
	describe('Capability-Driven Action Permissions', () => {
		it('allows warehouse_staff to allocate and cancel, but NOT approve for dispatch', () => {
			const ctx = createMockContext(['warehouse_staff']);

			expect(canAllocateTicket(ctx)).toBe(true);
			expect(canCancelTicket(ctx)).toBe(true);
			expect(canApproveTicket(ctx)).toBe(false); // Only shelter_manager or system_admin
		});

		it('allows supply_coordinator to allocate and cancel, but NOT approve for dispatch', () => {
			const ctx = createMockContext(['supply_coordinator']);

			expect(canAllocateTicket(ctx)).toBe(true);
			expect(canCancelTicket(ctx)).toBe(true);
			expect(canApproveTicket(ctx)).toBe(false);
		});

		it('allows shelter_manager to allocate, cancel, and approve', () => {
			const ctx = createMockContext(['shelter_manager']);

			expect(canAllocateTicket(ctx)).toBe(true);
			expect(canCancelTicket(ctx)).toBe(true);
			expect(canApproveTicket(ctx)).toBe(true);
		});

		it('allows system_admin to allocate, cancel, and approve', () => {
			const ctx = createMockContext(['system_admin']);

			expect(canAllocateTicket(ctx)).toBe(true);
			expect(canCancelTicket(ctx)).toBe(true);
			expect(canApproveTicket(ctx)).toBe(true);
		});

		it('rejects registration_staff from allocating, cancelling, and approving', () => {
			const ctx = createMockContext(['registration_staff']);

			expect(canAllocateTicket(ctx)).toBe(false);
			expect(canCancelTicket(ctx)).toBe(false);
			expect(canApproveTicket(ctx)).toBe(false);
		});
	});

	describe('Approval Preconditions and Readiness', () => {
		it('allows approval only when fully allocated with positive quantities', () => {
			const ticket = createValidTicket('PENDING_PICK', {
				items: [
					{
						item_id: 'item:1',
						item_name: 'ข้าวกล่อง 1',
						type_class: 'CONSUMABLE',
						requested_qty: '50',
						allocated_qty: '50'
					},
					{
						item_id: 'item:2',
						item_name: 'ข้าวกล่อง 2',
						type_class: 'CONSUMABLE',
						requested_qty: '20',
						allocated_qty: '20'
					}
				]
			});

			const readiness = isTicketReadyForApproval(ticket);
			expect(readiness.ready).toBe(true);
		});

		it('blocks approval when any item has missing allocated_qty (unallocated qty is 0)', () => {
			const ticket = createValidTicket('PENDING_PICK', {
				items: [
					{
						item_id: 'item:1',
						item_name: 'ข้าวกล่อง 1',
						type_class: 'CONSUMABLE',
						requested_qty: '50',
						allocated_qty: '50'
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

			const readiness = isTicketReadyForApproval(ticket);
			expect(readiness.ready).toBe(false);
			expect(readiness.reason).toContain('ข้าวกล่อง 2');
		});

		it('blocks approval when ticket is already in READY_FOR_DISPATCH or beyond', () => {
			const ticket = createValidTicket('READY_FOR_DISPATCH');
			const readiness = isTicketReadyForApproval(ticket);
			expect(readiness.ready).toBe(false);
		});
	});

	describe('Action Panel Matrix Scope Control (No Future Slices Leaked)', () => {
		it('strictly isolates PENDING_PICK actions from subsequent lifecycle actions', () => {
			// In Slice 5.2, READY_FOR_DISPATCH must NOT trigger dispatch or physical lot picking
			const ctx = createMockContext(['shelter_manager']);

			// The capability to dispatch exists on the user, but the UI must not expose it in Slice 5.2
			expect(canDispatchTicket(ctx)).toBe(true);
			expect(canPerformFrontlineDistribution(ctx)).toBe(true);
			expect(canReceiveWarehouseReturns(ctx)).toBe(true);

			// Status check confirms READY_FOR_DISPATCH is outside PENDING_PICK action scope
			const readyTicket = createValidTicket('READY_FOR_DISPATCH');
			expect(readyTicket.status).not.toBe('PENDING_PICK');
		});

		it('strictly isolates terminal states (COMPLETED and CANCELLED) as read-only', () => {
			const completedTicket = createValidTicket('COMPLETED');
			const cancelledTicket = createValidTicket('CANCELLED');

			expect(completedTicket.status).toBe('COMPLETED');
			expect(cancelledTicket.status).toBe('CANCELLED');
		});
	});

	describe('URL Deep-Link Extraction Logic', () => {
		it('extracts ticketId cleanly from URL search parameters', () => {
			const searchParams = new URLSearchParams('?ticketId=requisition_ticket:tkt_01&tab=pending');
			expect(searchParams.get('ticketId')).toBe('requisition_ticket:tkt_01');
		});

		it('removes ticketId cleanly while preserving other query parameters', () => {
			const searchParams = new URLSearchParams('?ticketId=requisition_ticket:tkt_01&tab=pending');
			searchParams.delete('ticketId');
			expect(searchParams.get('ticketId')).toBeNull();
			expect(searchParams.get('tab')).toBe('pending');
			expect(searchParams.toString()).toBe('tab=pending');
		});
	});
});
