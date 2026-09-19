import { describe, expect, it } from 'vitest';
import type { RequisitionTicket, RequisitionTicketStatus } from '../../domain/food-supplies';
import {
	WORKFLOW_GROUPS,
	WORKFLOW_GROUP_MAP,
	matchesWorkflowGroup,
	getWorkflowGroupForStatus,
	computeTicketGroupCounts,
	filterRequisitionTickets
} from './ticket-filters';

const mockTicket = (
	id: string,
	status: RequisitionTicketStatus,
	overrides: Partial<RequisitionTicket> = {}
): RequisitionTicket => {
	const base: RequisitionTicket = {
		_id: `requisition_ticket:${id}`,
		type: 'requisition_ticket',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-19T10:00:00.000Z',
		updated_at: '2026-09-19T10:00:00.000Z',
		created_by: 'staff_1',
		ticket_no: `TKT-FOOD-${id}`,
		requisition_type: 'food',
		status,
		source_location: 'ครัวกลาง',
		destination_location: 'เต็นท์ A',
		requested_by: 'staff_1',
		items: [
			{
				item_id: 'item:meal1',
				item_name: 'ข้าวกะเพรา',
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

describe('Ticket Workflow Groups & Filtering (Slice 5.1 §17, §18, §19, §43)', () => {
	it('defines exactly 5 canonical workflow groups', () => {
		expect(WORKFLOW_GROUPS).toHaveLength(5);
		expect(WORKFLOW_GROUPS.map((g) => g.id)).toEqual([
			'all',
			'pending_ready',
			'in_progress',
			'returns_closeout',
			'completed'
		]);
		expect(WORKFLOW_GROUPS.map((g) => g.label)).toEqual([
			'ทั้งหมด',
			'รอจัด / พร้อมส่ง',
			'กำลังดำเนินการ',
			'รับคืน / รอปิดงาน',
			'เสร็จสมบูรณ์'
		]);
	});

	describe('Group status membership invariants', () => {
		it('กลุ่ม "ทั้งหมด" contains all 9 canonical statuses', () => {
			expect(WORKFLOW_GROUP_MAP.all.statuses).toHaveLength(9);
		});

		it('กลุ่ม "รอจัด / พร้อมส่ง" contains PENDING_PICK and READY_FOR_DISPATCH and excludes others', () => {
			const statuses = WORKFLOW_GROUP_MAP.pending_ready.statuses;
			expect(statuses).toEqual(['PENDING_PICK', 'READY_FOR_DISPATCH']);
			expect(matchesWorkflowGroup('PENDING_PICK', 'pending_ready')).toBe(true);
			expect(matchesWorkflowGroup('READY_FOR_DISPATCH', 'pending_ready')).toBe(true);
			expect(matchesWorkflowGroup('IN_TRANSIT', 'pending_ready')).toBe(false);
			expect(matchesWorkflowGroup('DISTRIBUTING', 'pending_ready')).toBe(false);
			expect(matchesWorkflowGroup('COMPLETED', 'pending_ready')).toBe(false);
		});

		it('กลุ่ม "กำลังดำเนินการ" contains IN_TRANSIT, DISTRIBUTING, SHIFT_CLOSED and excludes others', () => {
			const statuses = WORKFLOW_GROUP_MAP.in_progress.statuses;
			expect(statuses).toEqual(['IN_TRANSIT', 'DISTRIBUTING', 'SHIFT_CLOSED']);
			expect(matchesWorkflowGroup('IN_TRANSIT', 'in_progress')).toBe(true);
			expect(matchesWorkflowGroup('DISTRIBUTING', 'in_progress')).toBe(true);
			expect(matchesWorkflowGroup('SHIFT_CLOSED', 'in_progress')).toBe(true);
			expect(matchesWorkflowGroup('PENDING_PICK', 'in_progress')).toBe(false);
			expect(matchesWorkflowGroup('COMPLETED', 'in_progress')).toBe(false);
		});

		it('กลุ่ม "รับคืน / รอปิดงาน" contains RETURN_PENDING_RECEIPT and RETURN_COMPLETED and excludes others', () => {
			const statuses = WORKFLOW_GROUP_MAP.returns_closeout.statuses;
			expect(statuses).toEqual(['RETURN_PENDING_RECEIPT', 'RETURN_COMPLETED']);
			expect(matchesWorkflowGroup('RETURN_PENDING_RECEIPT', 'returns_closeout')).toBe(true);
			expect(matchesWorkflowGroup('RETURN_COMPLETED', 'returns_closeout')).toBe(true);
			expect(matchesWorkflowGroup('DISTRIBUTING', 'returns_closeout')).toBe(false);
			expect(matchesWorkflowGroup('COMPLETED', 'returns_closeout')).toBe(false);
		});

		it('กลุ่ม "เสร็จสมบูรณ์" contains COMPLETED and CANCELLED and excludes others', () => {
			const statuses = WORKFLOW_GROUP_MAP.completed.statuses;
			expect(statuses).toEqual(['COMPLETED', 'CANCELLED']);
			expect(matchesWorkflowGroup('COMPLETED', 'completed')).toBe(true);
			expect(matchesWorkflowGroup('CANCELLED', 'completed')).toBe(true);
			expect(matchesWorkflowGroup('PENDING_PICK', 'completed')).toBe(false);
			expect(matchesWorkflowGroup('IN_TRANSIT', 'completed')).toBe(false);
		});
	});

	describe('getWorkflowGroupForStatus', () => {
		it('correctly maps each status to its designated group', () => {
			expect(getWorkflowGroupForStatus('PENDING_PICK')).toBe('pending_ready');
			expect(getWorkflowGroupForStatus('READY_FOR_DISPATCH')).toBe('pending_ready');
			expect(getWorkflowGroupForStatus('IN_TRANSIT')).toBe('in_progress');
			expect(getWorkflowGroupForStatus('DISTRIBUTING')).toBe('in_progress');
			expect(getWorkflowGroupForStatus('SHIFT_CLOSED')).toBe('in_progress');
			expect(getWorkflowGroupForStatus('RETURN_PENDING_RECEIPT')).toBe('returns_closeout');
			expect(getWorkflowGroupForStatus('RETURN_COMPLETED')).toBe('returns_closeout');
			expect(getWorkflowGroupForStatus('COMPLETED')).toBe('completed');
			expect(getWorkflowGroupForStatus('CANCELLED')).toBe('completed');
		});
	});

	describe('computeTicketGroupCounts', () => {
		it('computes accurate counts across all 5 groups from a ticket list', () => {
			const tickets: RequisitionTicket[] = [
				mockTicket('1', 'PENDING_PICK'),
				mockTicket('2', 'READY_FOR_DISPATCH'),
				mockTicket('3', 'IN_TRANSIT'),
				mockTicket('4', 'DISTRIBUTING'),
				mockTicket('5', 'SHIFT_CLOSED'),
				mockTicket('6', 'RETURN_PENDING_RECEIPT'),
				mockTicket('7', 'RETURN_COMPLETED'),
				mockTicket('8', 'COMPLETED'),
				mockTicket('9', 'CANCELLED')
			];

			const counts = computeTicketGroupCounts(tickets);
			expect(counts).toEqual({
				all: 9,
				pending_ready: 2,
				in_progress: 3,
				returns_closeout: 2,
				completed: 2
			});
		});

		it('returns all zeros for empty ticket list', () => {
			const counts = computeTicketGroupCounts([]);
			expect(counts).toEqual({
				all: 0,
				pending_ready: 0,
				in_progress: 0,
				returns_closeout: 0,
				completed: 0
			});
		});
	});

	describe('filterRequisitionTickets', () => {
		const t1 = mockTicket('01', 'PENDING_PICK', {
			ticket_no: 'TKT-FOOD-0001',
			requested_by: 'somchai',
			destination_location: 'เต็นท์ A'
		});
		const t2 = mockTicket('02', 'READY_FOR_DISPATCH', {
			ticket_no: 'TKT-FOOD-0002',
			requested_by: 'somying',
			destination_location: 'เต็นท์ B'
		});
		const t3 = mockTicket('03', 'IN_TRANSIT', {
			ticket_no: 'TKT-SUPPLIES-0003',
			requested_by: 'somchai',
			destination_location: 'เต็นท์ A'
		});
		const t4 = mockTicket('04', 'COMPLETED', {
			ticket_no: 'TKT-FOOD-0004',
			requested_by: 'wichai',
			destination_location: 'โรงอาหาร'
		});
		const allTickets = [t1, t2, t3, t4];

		it('filters by workflow group', () => {
			const pendingReady = filterRequisitionTickets(allTickets, { groupId: 'pending_ready' });
			expect(pendingReady).toEqual([t1, t2]);

			const inProgress = filterRequisitionTickets(allTickets, { groupId: 'in_progress' });
			expect(inProgress).toEqual([t3]);

			const completed = filterRequisitionTickets(allTickets, { groupId: 'completed' });
			expect(completed).toEqual([t4]);

			const all = filterRequisitionTickets(allTickets, { groupId: 'all' });
			expect(all).toEqual(allTickets);
		});

		it('refines by detailed canonical status', () => {
			const pendingPickOnly = filterRequisitionTickets(allTickets, {
				groupId: 'pending_ready',
				detailedStatus: 'PENDING_PICK'
			});
			expect(pendingPickOnly).toEqual([t1]);

			const readyOnly = filterRequisitionTickets(allTickets, {
				groupId: 'pending_ready',
				detailedStatus: 'READY_FOR_DISPATCH'
			});
			expect(readyOnly).toEqual([t2]);
		});

		it('filters by destination location', () => {
			const tentA = filterRequisitionTickets(allTickets, {
				groupId: 'all',
				destination: 'เต็นท์ A'
			});
			expect(tentA).toEqual([t1, t3]);

			const tentB = filterRequisitionTickets(allTickets, {
				groupId: 'all',
				destination: 'เต็นท์ B'
			});
			expect(tentB).toEqual([t2]);
		});

		it('searches by ticket_no (case-insensitive, trimmed)', () => {
			const result = filterRequisitionTickets(allTickets, {
				groupId: 'all',
				search: ' food-0002 '
			});
			expect(result).toEqual([t2]);
		});

		it('searches by requested_by', () => {
			const result = filterRequisitionTickets(allTickets, {
				groupId: 'all',
				search: 'somchai'
			});
			expect(result).toEqual([t1, t3]);
		});

		it('searches by destination location', () => {
			const result = filterRequisitionTickets(allTickets, {
				groupId: 'all',
				search: 'โรงอาหาร'
			});
			expect(result).toEqual([t4]);
		});

		it('returns empty array when search has no match', () => {
			const result = filterRequisitionTickets(allTickets, {
				groupId: 'all',
				search: 'nonexistent'
			});
			expect(result).toEqual([]);
		});
	});
});
