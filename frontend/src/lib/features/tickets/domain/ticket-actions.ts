import {
	hasStaffCapability,
	isShelterManager,
	isSystemAdmin,
	isWarehouseStaff
} from '$lib/auth/roles';
import type { TicketStatus } from './ticket';

// UI mirror of the kitchen requisition carve-out in shelter-access-design.ts
// (rule 11). The CouchDB validate_doc_update is the real boundary; this only
// decides which controls to show.

export type TicketActions = {
	/** PENDING_PICK: edit allocations and approve. */
	canAllocateApprove: boolean;
	/** READY_FOR_DISPATCH: release goods and post the stock ledger. */
	canDispatch: boolean;
	/** IN_TRANSIT: confirm receipt at the kitchen. */
	canReceive: boolean;
	/** PENDING_PICK / READY_FOR_DISPATCH: cancel the ticket. */
	canCancel: boolean;
};

/** Which actions `roles` may take on a ticket in `status`, scoped to `shelterCode`. */
export function ticketActionsFor(
	status: TicketStatus,
	roles: readonly string[],
	shelterCode: string | null
): TicketActions {
	const admin = isSystemAdmin(roles);
	const manager = isShelterManager(roles, shelterCode);
	const warehouse = isWarehouseStaff(roles, shelterCode);
	const kitchen = hasStaffCapability(roles, 'kitchen_staff', shelterCode);

	return {
		canAllocateApprove: status === 'PENDING_PICK' && (admin || warehouse || manager),
		canDispatch: status === 'READY_FOR_DISPATCH' && (admin || warehouse),
		canReceive: status === 'IN_TRANSIT' && (admin || kitchen),
		canCancel:
			(status === 'PENDING_PICK' && (admin || kitchen || warehouse || manager)) ||
			(status === 'READY_FOR_DISPATCH' && (admin || warehouse || manager))
	};
}
