import {
	thailandCalendarDay,
	type RequisitionTicket,
	type RequisitionTicketStatus,
	type RequisitionType
} from '../../domain/food-supplies';

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
	requisitionType?: RequisitionType | 'all';
	search?: string;
	/** Multi-select statuses; empty/undefined = no filter. */
	statuses?: readonly RequisitionTicketStatus[];
	/** Inclusive `YYYY-MM-DD` lower bound on `created_at` (Thailand calendar day). */
	createdFrom?: string;
	/** Inclusive `YYYY-MM-DD` upper bound on `created_at` (Thailand calendar day). */
	createdTo?: string;
}

/** Statuses where the warehouse side must act next. */
export const WAREHOUSE_FOLLOW_UP_STATUSES: readonly RequisitionTicketStatus[] = [
	'PENDING_PICK',
	'READY_FOR_DISPATCH',
	'RETURN_PENDING_RECEIPT',
	'RETURN_COMPLETED'
];

/** Statuses where the frontline side must act next. */
export const FRONTLINE_FOLLOW_UP_STATUSES: readonly RequisitionTicketStatus[] = ['IN_TRANSIT'];

/**
 * Statuses that need follow-up from the current user, by role capability.
 * Empty when the user has neither capability.
 */
export function followUpStatusesFor(caps: {
	canWarehouse: boolean;
	canFrontline: boolean;
}): RequisitionTicketStatus[] {
	const out: RequisitionTicketStatus[] = [];
	if (caps.canWarehouse) out.push(...WAREHOUSE_FOLLOW_UP_STATUSES);
	if (caps.canFrontline) out.push(...FRONTLINE_FOLLOW_UP_STATUSES);
	return out;
}

/** Statuses selectable while `groupId` is active (all statuses for `all`). */
export function statusesForGroup(
	groupId: TicketWorkflowGroupId
): readonly RequisitionTicketStatus[] {
	return (WORKFLOW_GROUP_MAP[groupId] ?? WORKFLOW_GROUP_MAP.all).statuses;
}

/** Drops selected statuses that are not part of `groupId`. */
export function constrainStatusesToGroup(
	statuses: readonly RequisitionTicketStatus[],
	groupId: TicketWorkflowGroupId
): RequisitionTicketStatus[] {
	const allowed = statusesForGroup(groupId);
	return statuses.filter((s) => allowed.includes(s));
}

/**
 * Pure filter predicate combining workflow group, detailed canonical status,
 * requisition type, destination location, and text search across ticket_no and requested_by.
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

		// 2b. Multi-select statuses
		if (filters.statuses && filters.statuses.length > 0) {
			if (!filters.statuses.includes(ticket.status)) {
				return false;
			}
		}

		// 2c. Created date range (inclusive, Thailand calendar day)
		if (filters.createdFrom || filters.createdTo) {
			const day = thailandCalendarDay(ticket.created_at);
			if (filters.createdFrom && day < filters.createdFrom) return false;
			if (filters.createdTo && day > filters.createdTo) return false;
		}

		// 3. Requisition type filter (food, supplies, kitchen, transfer)
		if (filters.requisitionType && filters.requisitionType !== 'all') {
			if (ticket.requisition_type !== filters.requisitionType) {
				return false;
			}
		}

		// 4. Destination location filter
		if (filters.destination && filters.destination !== 'all') {
			if (ticket.destination_location !== filters.destination) {
				return false;
			}
		}

		// 5. Text search by ticket_no, requested_by, or destination_location
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

export type TicketSortField = 'created_at';
export type TicketSortDirection = 'asc' | 'desc';

export interface TicketSortOption {
	field: TicketSortField;
	direction: TicketSortDirection;
}

/**
 * Default ticket ordering: Newest -> Oldest (created_at DESC).
 * Deterministic secondary tie-breaker: ticket._id (DESC).
 */
export const DEFAULT_TICKET_SORT: TicketSortOption = {
	field: 'created_at',
	direction: 'desc'
};

/**
 * Sorts tickets deterministically.
 * Default: newest first (created_at DESC).
 * Secondary tie-breaker: ticket._id.
 * Does not mutate original tickets array.
 */
export function sortRequisitionTickets(
	tickets: readonly RequisitionTicket[],
	sort: TicketSortOption = DEFAULT_TICKET_SORT
): RequisitionTicket[] {
	return [...tickets].sort((a, b) => {
		const timeA = new Date(a.created_at).getTime();
		const timeB = new Date(b.created_at).getTime();

		if (timeA !== timeB) {
			return sort.direction === 'asc' ? timeA - timeB : timeB - timeA;
		}

		// Stable secondary tie-break by _id
		return sort.direction === 'asc' ? a._id.localeCompare(b._id) : b._id.localeCompare(a._id);
	});
}

/**
 * Pure helper combining filtering and deterministic sorting.
 */
export function filterAndSortRequisitionTickets(
	tickets: readonly RequisitionTicket[],
	filters: TicketFilterOptions,
	sort: TicketSortOption = DEFAULT_TICKET_SORT
): RequisitionTicket[] {
	const filtered = filterRequisitionTickets(tickets, filters);
	return sortRequisitionTickets(filtered, sort);
}

/**
 * Tickets the Distribution Desk works on: food and supplies only. Transfer tickets complete at
 * the warehouse (`IN_TRANSIT → COMPLETED`) and must not reach the receive or close-out lists.
 */
export function filterDeskTickets<T extends Pick<RequisitionTicket, 'requisition_type'>>(
	tickets: readonly T[]
): T[] {
	return tickets.filter((t) => t.requisition_type === 'food' || t.requisition_type === 'supplies');
}
