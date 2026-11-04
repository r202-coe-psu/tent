import { describe, it, expect } from 'vitest';
import { ticketActionsFor } from './ticket-actions';
import type { TicketStatus } from './ticket';

const SH = 'SH001';
const KITCHEN = ['shelter:SH001', 'kitchen_staff'];
const WAREHOUSE = ['shelter:SH001', 'warehouse_staff'];
const MANAGER = ['shelter:SH001', 'shelter_manager'];
const ADMIN = ['system_admin'];

const act = (s: TicketStatus, roles: string[], shelter: string | null = SH) =>
	ticketActionsFor(s, roles, shelter);

describe('ticketActionsFor', () => {
	it('PENDING_PICK: warehouse and manager allocate/approve, kitchen does not', () => {
		expect(act('PENDING_PICK', WAREHOUSE).canAllocateApprove).toBe(true);
		expect(act('PENDING_PICK', MANAGER).canAllocateApprove).toBe(true);
		expect(act('PENDING_PICK', KITCHEN).canAllocateApprove).toBe(false);
	});

	it('READY_FOR_DISPATCH: only warehouse dispatches', () => {
		expect(act('READY_FOR_DISPATCH', WAREHOUSE).canDispatch).toBe(true);
		expect(act('READY_FOR_DISPATCH', MANAGER).canDispatch).toBe(false);
		expect(act('READY_FOR_DISPATCH', KITCHEN).canDispatch).toBe(false);
	});

	it('IN_TRANSIT: only kitchen receives', () => {
		expect(act('IN_TRANSIT', KITCHEN).canReceive).toBe(true);
		expect(act('IN_TRANSIT', WAREHOUSE).canReceive).toBe(false);
		expect(act('IN_TRANSIT', MANAGER).canReceive).toBe(false);
	});

	it('cancel: PENDING_PICK allows kitchen/warehouse/manager', () => {
		expect(act('PENDING_PICK', KITCHEN).canCancel).toBe(true);
		expect(act('PENDING_PICK', WAREHOUSE).canCancel).toBe(true);
		expect(act('PENDING_PICK', MANAGER).canCancel).toBe(true);
	});

	it('cancel: READY_FOR_DISPATCH allows warehouse/manager, not kitchen', () => {
		expect(act('READY_FOR_DISPATCH', WAREHOUSE).canCancel).toBe(true);
		expect(act('READY_FOR_DISPATCH', MANAGER).canCancel).toBe(true);
		expect(act('READY_FOR_DISPATCH', KITCHEN).canCancel).toBe(false);
	});

	it('no cancel once in transit or finished', () => {
		for (const s of ['IN_TRANSIT', 'COMPLETED', 'CANCELLED'] as const) {
			expect(act(s, ADMIN).canCancel).toBe(false);
		}
	});

	it('system_admin may do the action of each step', () => {
		expect(act('PENDING_PICK', ADMIN)).toMatchObject({ canAllocateApprove: true, canCancel: true });
		expect(act('READY_FOR_DISPATCH', ADMIN)).toMatchObject({ canDispatch: true, canCancel: true });
		expect(act('IN_TRANSIT', ADMIN).canReceive).toBe(true);
	});

	it('actions of other steps are never granted', () => {
		const a = act('PENDING_PICK', ADMIN);
		expect(a.canDispatch).toBe(false);
		expect(a.canReceive).toBe(false);
	});

	it('multiple roles get the union', () => {
		const roles = ['shelter:SH001', 'kitchen_staff', 'warehouse_staff'];
		expect(act('READY_FOR_DISPATCH', roles).canDispatch).toBe(true);
		expect(act('IN_TRANSIT', roles).canReceive).toBe(true);
		expect(act('PENDING_PICK', roles).canAllocateApprove).toBe(true);
	});

	it('a role scoped to another shelter grants nothing', () => {
		const other = ['shelter:SH002', 'warehouse_staff', 'shelter_manager', 'kitchen_staff'];
		expect(act('PENDING_PICK', other)).toEqual({
			canAllocateApprove: false,
			canDispatch: false,
			canReceive: false,
			canCancel: false
		});
		expect(act('IN_TRANSIT', other).canReceive).toBe(false);
	});

	it('compound capability roles are scoped per shelter', () => {
		const roles = ['shelter:SH001', 'shelter:SH002', 'SH002:warehouse_staff'];
		expect(act('READY_FOR_DISPATCH', roles, 'SH002').canDispatch).toBe(true);
		expect(act('READY_FOR_DISPATCH', roles, 'SH001').canDispatch).toBe(false);
	});
});
