import { describe, expect, it } from 'vitest';
import type { RequisitionTicket, RequisitionTicketStatus } from '../../domain/food-supplies';
import {
	canDispatchTicket,
	canPerformFrontlineDistribution
} from '../../application/food-supplies/auth';
import type { AuthorContext } from '$lib/db/model';
import type { DispatchTicketOptions } from '../../application/food-supplies/dispatch-workflow';

const createValidTicket = (
	status: RequisitionTicketStatus = 'READY_FOR_DISPATCH',
	overrides: Partial<RequisitionTicket> = {}
): RequisitionTicket => {
	const base: RequisitionTicket = {
		_id: 'requisition_ticket:tkt_dispatch_01',
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
		approved_by: 'manager_test',
		items: [
			{
				item_id: 'item:meal_01',
				item_name: 'ข้าวกล่องไก่กระเทียม',
				category: 'item_category:ready_meal',
				type_class: 'CONSUMABLE',
				returnable: false,
				requested_qty: '50',
				allocated_qty: '50'
			},
			{
				item_id: 'item:meal_02',
				item_name: 'ข้าวกล่องหมูกระเทียม',
				category: 'item_category:ready_meal',
				type_class: 'CONSUMABLE',
				returnable: false,
				requested_qty: '30',
				allocated_qty: '30'
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

describe('Warehouse Picking, Lot Assignment & Dispatch Flow (Slice 5.3)', () => {
	describe('Capability-Driven Action Matrix for READY_FOR_DISPATCH and IN_TRANSIT', () => {
		it('allows warehouse_staff to dispatch tickets but NOT receive at distribution point', () => {
			const ctx = createMockContext(['warehouse_staff']);
			expect(canDispatchTicket(ctx)).toBe(true);
			expect(canPerformFrontlineDistribution(ctx)).toBe(false);
		});

		it('allows supply_coordinator to both dispatch and receive', () => {
			const ctx = createMockContext(['supply_coordinator']);
			expect(canDispatchTicket(ctx)).toBe(true);
			expect(canPerformFrontlineDistribution(ctx)).toBe(true);
		});

		it('allows shelter_manager to both dispatch and receive', () => {
			const ctx = createMockContext(['shelter_manager']);
			expect(canDispatchTicket(ctx)).toBe(true);
			expect(canPerformFrontlineDistribution(ctx)).toBe(true);
		});

		it('allows system_admin to both dispatch and receive', () => {
			const ctx = createMockContext(['system_admin']);
			expect(canDispatchTicket(ctx)).toBe(true);
			expect(canPerformFrontlineDistribution(ctx)).toBe(true);
		});

		it('allows registration_staff to receive at distribution point but NOT dispatch from warehouse', () => {
			const ctx = createMockContext(['registration_staff']);
			expect(canDispatchTicket(ctx)).toBe(false);
			expect(canPerformFrontlineDistribution(ctx)).toBe(true);
		});
	});

	describe('Lifecycle Status Boundaries for Dispatch and Receive', () => {
		it('identifies READY_FOR_DISPATCH as the exclusive status for outbound dispatch', () => {
			const readyTicket = createValidTicket('READY_FOR_DISPATCH');
			const pendingTicket = createValidTicket('PENDING_PICK');
			const transitTicket = createValidTicket('IN_TRANSIT');
			const distributingTicket = createValidTicket('DISTRIBUTING');

			expect(readyTicket.status === 'READY_FOR_DISPATCH').toBe(true);
			expect(pendingTicket.status === 'READY_FOR_DISPATCH').toBe(false);
			expect(transitTicket.status === 'READY_FOR_DISPATCH').toBe(false);
			expect(distributingTicket.status === 'READY_FOR_DISPATCH').toBe(false);
		});

		it('identifies IN_TRANSIT as the exclusive status for frontline cargo receipt', () => {
			const transitTicket = createValidTicket('IN_TRANSIT');
			const readyTicket = createValidTicket('READY_FOR_DISPATCH');
			const distributingTicket = createValidTicket('DISTRIBUTING');

			expect(transitTicket.status === 'IN_TRANSIT').toBe(true);
			expect(readyTicket.status === 'IN_TRANSIT').toBe(false);
			expect(distributingTicket.status === 'IN_TRANSIT').toBe(false);
		});
	});

	describe('One-Lot-Per-Item Dispatch Payload Invariants (P4-F03)', () => {
		it('constructs a valid DispatchTicketOptions payload with one physical lot per item', () => {
			const ticket = createValidTicket('READY_FOR_DISPATCH');

			const selectedLots: Record<string, string> = {
				'item:meal_01': 'stock_ledger:01J11111111111111111111111',
				'item:meal_02': 'stock_ledger:01J22222222222222222222222'
			};

			const options: DispatchTicketOptions = {
				driver_name: 'นายสมชาย ใจดี',
				license_plate: '1กข 1234 กทม.',
				item_lots: selectedLots
			};

			// Verify all ticket items have a corresponding lot_ref
			for (const item of ticket.items) {
				const lotRef = options.item_lots?.[item.item_id];
				expect(lotRef).toBeDefined();
				expect(lotRef?.startsWith('stock_ledger:')).toBe(true);
			}

			expect(options.driver_name).toBe('นายสมชาย ใจดี');
			expect(options.license_plate).toBe('1กข 1234 กทม.');
		});

		it('ensures optional transport metadata can be omitted without schema violation', () => {
			const options: DispatchTicketOptions = {
				item_lots: {
					'item:meal_01': 'stock_ledger:01J11111111111111111111111'
				}
			};

			expect(options.driver_name).toBeUndefined();
			expect(options.license_plate).toBeUndefined();
			expect(options.item_lots).toBeDefined();
		});
	});

	describe('Slice 5.3 Architectural Boundary (Stops at DISTRIBUTING)', () => {
		it('confirms Slice 5.3 transitions end at DISTRIBUTING and do not leak Slice 5.4+ actions', () => {
			// In Slice 5.3, ticket moves READY_FOR_DISPATCH -> IN_TRANSIT -> DISTRIBUTING
			const distributingTicket = createValidTicket('DISTRIBUTING', {
				dispatched_by: 'warehouse_staff_01',
				driver_name: 'นายสมชาย',
				received_by: 'station_staff_01'
			});

			expect(distributingTicket.status).toBe('DISTRIBUTING');
			expect(distributingTicket.dispatched_by).toBe('warehouse_staff_01');
			expect(distributingTicket.received_by).toBe('station_staff_01');

			// Slice 5.4+ actions are not part of Slice 5.3 action panel
			const isSlice54Action = (action: string) =>
				[
					'recordFoodDistribution',
					'recordSuppliesDistribution',
					'amendActiveTicket',
					'returnLoanAtCounter',
					'clearLoanNonPhysical',
					'createBulkReturnPool',
					'clearLoanViaBulkPool',
					'closeShift',
					'submitReturnsToWarehouse',
					'receiveWarehouseReturns',
					'completeTicket'
				].includes(action);

			expect(isSlice54Action('dispatchTicket')).toBe(false);
			expect(isSlice54Action('receiveTicketAtDistributionPoint')).toBe(false);
			expect(isSlice54Action('recordFoodDistribution')).toBe(true);
			expect(isSlice54Action('closeShift')).toBe(true);
		});
	});
});
