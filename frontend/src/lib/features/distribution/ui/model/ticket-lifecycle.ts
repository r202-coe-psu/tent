import type { RequisitionTicket, RequisitionTicketStatus } from '../../domain/food-supplies';
import { qtyGt } from '$lib/utils/qty';
import { TICKET_STATUS_LABELS } from './ticket-status';

export type LifecycleStageId =
	| 'pending_pick'
	| 'ready_dispatch'
	| 'in_transit'
	| 'distributing'
	| 'shift_closed'
	| 'returns'
	| 'completed';

export type StepState = 'completed' | 'current' | 'upcoming' | 'branched';

export interface LifecycleStep {
	id: LifecycleStageId;
	label: string;
	subLabel: string;
	state: StepState;
}

/**
 * Ordered normal progression stages (Step 1 to Step 5 then returns/completion).
 */
export const NORMAL_LIFECYCLE_SEQUENCE: readonly RequisitionTicketStatus[] = [
	'PENDING_PICK',
	'READY_FOR_DISPATCH',
	'IN_TRANSIT',
	'DISTRIBUTING',
	'SHIFT_CLOSED'
] as const;

/**
 * Evaluates whether a ticket in PENDING_PICK is fully allocated and ready for managerial approval.
 * Aligns 100% with the authoritative backend check in approveTicketForDispatch:
 * every item must have positive allocated_qty.
 */
export function isTicketReadyForApproval(ticket: RequisitionTicket): {
	ready: boolean;
	reason?: string;
} {
	if (ticket.status !== 'PENDING_PICK') {
		return {
			ready: false,
			reason: `ตั๋วต้องอยู่ในสถานะรอจัดของ (PENDING_PICK) ปัจจุบันคือ '${ticket.status}'`
		};
	}

	if (!ticket.items || ticket.items.length === 0) {
		return {
			ready: false,
			reason: 'ตั๋วไม่มีรายการสินค้า'
		};
	}

	const missingAllocations = ticket.items.filter(
		(item) => !item.allocated_qty || !qtyGt(item.allocated_qty, 0)
	);

	if (missingAllocations.length > 0) {
		const names = missingAllocations.map((i) => i.item_name).join(', ');
		return {
			ready: false,
			reason: `ยังไม่ได้จัดสรรยอดให้ครบทุกรายการ (${missingAllocations.length} รายการ: ${names})`
		};
	}

	return { ready: true };
}

/**
 * Returns whether a ticket status is terminal (read-only).
 */
export function isTerminalTicketStatus(status: RequisitionTicketStatus): boolean {
	return status === 'COMPLETED' || status === 'CANCELLED';
}

/**
 * Determines whether a ticket has active or pending returns.
 */
export function isReturnsStageStatus(status: RequisitionTicketStatus): boolean {
	return status === 'RETURN_PENDING_RECEIPT' || status === 'RETURN_COMPLETED';
}

/**
 * Derives visual step items for the ticket lifecycle progress bar.
 * Accurately models the sequential flow, the zero-return completion branch,
 * the physical returns branch, and the terminal cancellation branch.
 */
export function getLifecycleSteps(status: RequisitionTicketStatus): {
	isCancelled: boolean;
	steps: LifecycleStep[];
} {
	if (status === 'CANCELLED') {
		return {
			isCancelled: true,
			steps: [
				{
					id: 'pending_pick',
					label: 'รอจัดของ',
					subLabel: 'จุดเริ่มต้น',
					state: 'completed'
				},
				{
					id: 'ready_dispatch',
					label: 'ยกเลิกตั๋ว',
					subLabel: 'สิ้นสุดก่อนปล่อยของ',
					state: 'branched'
				}
			]
		};
	}

	const statusOrder: Record<RequisitionTicketStatus, number> = {
		PENDING_PICK: 1,
		READY_FOR_DISPATCH: 2,
		IN_TRANSIT: 3,
		DISTRIBUTING: 4,
		SHIFT_CLOSED: 5,
		RETURN_PENDING_RECEIPT: 6,
		RETURN_COMPLETED: 7,
		COMPLETED: 8,
		CANCELLED: -1
	};

	const currentOrder = statusOrder[status];

	function getStepState(stepMinOrder: number, stepMaxOrder: number = stepMinOrder): StepState {
		if (currentOrder > stepMaxOrder) return 'completed';
		if (currentOrder >= stepMinOrder && currentOrder <= stepMaxOrder) return 'current';
		return 'upcoming';
	}

	const steps: LifecycleStep[] = [
		{
			id: 'pending_pick',
			label: TICKET_STATUS_LABELS.PENDING_PICK,
			subLabel: 'คลังจัดสรรยอด',
			state: getStepState(1)
		},
		{
			id: 'ready_dispatch',
			label: TICKET_STATUS_LABELS.READY_FOR_DISPATCH,
			subLabel: 'อนุมัติ / รอปล่อยรถ',
			state: getStepState(2)
		},
		{
			id: 'in_transit',
			label: TICKET_STATUS_LABELS.IN_TRANSIT,
			subLabel: 'กำลังนำส่ง',
			state: getStepState(3)
		},
		{
			id: 'distributing',
			label: TICKET_STATUS_LABELS.DISTRIBUTING,
			subLabel: 'แจกจ่ายผู้พักพิง',
			state: getStepState(4)
		},
		{
			id: 'shift_closed',
			label: TICKET_STATUS_LABELS.SHIFT_CLOSED,
			subLabel: 'ปิดรอบแจก / กระทบยอด',
			state: getStepState(5)
		},
		{
			id: 'returns',
			label: 'ส่งคืนคลัง',
			subLabel: 'ตรวจนับรับของคืน',
			state:
				status === 'RETURN_PENDING_RECEIPT' || status === 'RETURN_COMPLETED'
					? 'current'
					: currentOrder > 7
						? 'completed'
						: 'upcoming'
		},
		{
			id: 'completed',
			label: TICKET_STATUS_LABELS.COMPLETED,
			subLabel: 'ปิดตั๋วสมบูรณ์',
			state: status === 'COMPLETED' ? 'current' : 'upcoming'
		}
	];

	return {
		isCancelled: false,
		steps
	};
}
