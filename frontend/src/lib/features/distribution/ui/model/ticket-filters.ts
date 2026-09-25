import type { RequisitionTicket, RequisitionTicketStatus } from '../../domain/food-supplies';

export type TicketWorkflowGroupId =
	'all' | 'pending_ready' | 'in_progress' | 'returns_closeout' | 'completed';

export interface WorkflowGroupDefinition {
	id: TicketWorkflowGroupId;
	label: string;
	statuses: readonly RequisitionTicketStatus[];
}

/**
 * Exactly 5 workflow groups per Phase 5 frozen plan §5.1 / prompt §17.
 * Single source of truth for grouped status mapping.
 */
export const WORKFLOW_GROUPS: readonly WorkflowGroupDefinition[] = [
	{
		id: 'all',
		label: 'ทั้งหมด',
		statuses: [
			'PENDING_PICK',
			'READY_FOR_DISPATCH',
			'IN_TRANSIT',
			'DISTRIBUTING',
			'SHIFT_CLOSED',
			'RETURN_PENDING_RECEIPT',
			'RETURN_COMPLETED',
			'COMPLETED',
			'CANCELLED'
		]
	},
	{
		id: 'pending_ready',
		label: 'รอจัด / พร้อมส่ง',
		statuses: ['PENDING_PICK', 'READY_FOR_DISPATCH']
	},
	{
		id: 'in_progress',
		label: 'กำลังดำเนินการ',
		statuses: ['IN_TRANSIT', 'DISTRIBUTING', 'SHIFT_CLOSED']
	},
	{
		id: 'returns_closeout',
		label: 'รับคืน / รอปิดงาน',
		statuses: ['RETURN_PENDING_RECEIPT', 'RETURN_COMPLETED']
	},
	{
		id: 'completed',
		label: 'เสร็จสมบูรณ์',
		statuses: ['COMPLETED', 'CANCELLED']
	}
] as const;

export const WORKFLOW_GROUP_MAP: Record<TicketWorkflowGroupId, WorkflowGroupDefinition> = {
	all: WORKFLOW_GROUPS[0],
	pending_ready: WORKFLOW_GROUPS[1],
	in_progress: WORKFLOW_GROUPS[2],
	returns_closeout: WORKFLOW_GROUPS[3],
	completed: WORKFLOW_GROUPS[4]
};

/**
 * Checks if a ticket status belongs to a given workflow group.
 */
export function matchesWorkflowGroup(
	status: RequisitionTicketStatus,
	groupId: TicketWorkflowGroupId
): boolean {
	const group = WORKFLOW_GROUP_MAP[groupId];
	if (!group) return true;
	return group.statuses.includes(status);
}

/**
 * Finds which workflow group a given status belongs to (excluding 'all').
 */
export function getWorkflowGroupForStatus(status: RequisitionTicketStatus): TicketWorkflowGroupId {
	if (status === 'PENDING_PICK' || status === 'READY_FOR_DISPATCH') {
		return 'pending_ready';
	}
	if (status === 'IN_TRANSIT' || status === 'DISTRIBUTING' || status === 'SHIFT_CLOSED') {
		return 'in_progress';
	}
	if (status === 'RETURN_PENDING_RECEIPT' || status === 'RETURN_COMPLETED') {
		return 'returns_closeout';
	}
	if (status === 'COMPLETED' || status === 'CANCELLED') {
		return 'completed';
	}
	return 'all';
}

export type TicketGroupCounts = Record<TicketWorkflowGroupId, number>;

/**
 * Computes aggregate ticket counts for each of the 5 workflow groups from authoritative data.
 */
export function computeTicketGroupCounts(tickets: readonly RequisitionTicket[]): TicketGroupCounts {
	const counts: TicketGroupCounts = {
		all: tickets.length,
		pending_ready: 0,
		in_progress: 0,
		returns_closeout: 0,
		completed: 0
	};

	for (const ticket of tickets) {
		const group = getWorkflowGroupForStatus(ticket.status);
		if (group !== 'all') {
			counts[group] += 1;
		}
	}

	return counts;
}

export interface TicketFilterOptions {
	groupId: TicketWorkflowGroupId;
	detailedStatus?: RequisitionTicketStatus | 'all';
	destination?: string | 'all';
	search?: string;
}

/**
 * Pure filter predicate combining workflow group, detailed canonical status,
 * destination location, and text search across ticket_no and requested_by.
 */
export function filterRequisitionTickets(
	tickets: readonly RequisitionTicket[],
	filters: TicketFilterOptions
): RequisitionTicket[] {
	const trimmedSearch = filters.search?.trim().toLowerCase() ?? '';

	return tickets.filter((ticket) => {
		// 1. Grouped workflow filter
		if (filters.groupId !== 'all') {
			if (!matchesWorkflowGroup(ticket.status, filters.groupId)) {
				return false;
			}
		}

		// 2. Detailed canonical status filter (refines inside group)
		if (filters.detailedStatus && filters.detailedStatus !== 'all') {
			if (ticket.status !== filters.detailedStatus) {
				return false;
			}
		}

		// 3. Destination location filter
		if (filters.destination && filters.destination !== 'all') {
			if (ticket.destination_location !== filters.destination) {
				return false;
			}
		}

		// 4. Text search by ticket_no or requested_by
		if (trimmedSearch.length > 0) {
			const matchTicketNo = ticket.ticket_no.toLowerCase().includes(trimmedSearch);
			const matchRequester = ticket.requested_by.toLowerCase().includes(trimmedSearch);
			const matchDestination = ticket.destination_location.toLowerCase().includes(trimmedSearch);
			if (!matchTicketNo && !matchRequester && !matchDestination) {
				return false;
			}
		}

		return true;
	});
}
