import type { AuthorContext } from '$lib/db/model';
import {
	canDistributeInShelter,
	DISTRIBUTION_STAFF,
	hasCapabilityInShelter,
	isSystemAdmin,
	SHELTER_MANAGER,
	SUPPLY_COORDINATOR,
	WAREHOUSE_STAFF
} from '$lib/auth/roles';
import { WorkflowAuthorizationError } from './errors';

/**
 * Checks if the actor is authorized to open/create tickets.
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin, kitchen_staff (for kitchen).
 */
export function canCreateTicket(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return (
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, WAREHOUSE_STAFF) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SUPPLY_COORDINATOR) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER)
	);
}

/**
 * Checks if the actor is authorized to approve tickets for dispatch (Step 2).
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin
 * (CR-179 widens AC-TKT-03.1; aligned with VDU rule 12 `canApproveTicket`).
 */
export function canApproveTicket(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return (
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, WAREHOUSE_STAFF) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SUPPLY_COORDINATOR) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER)
	);
}

/**
 * Checks if the actor is authorized to dispatch tickets from warehouse (Step 3).
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin (CR-121 FR-SEC-01 Step 3, schema.md §8 Rule 13).
 */
export function canDispatchTicket(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return (
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, WAREHOUSE_STAFF) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SUPPLY_COORDINATOR) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER)
	);
}

/**
 * Checks if the actor is authorized to perform frontline distribution operations
 * (Step 4 receive, Step 4B handover/scan, Step 5 shift close, Step 6 submit returns).
 * Allowed: distribution_staff, shelter_manager, system_admin (CR-161 R3).
 */
export function canPerformFrontlineDistribution(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	return canDistributeInShelter(ctx.roles, ctx.shelterCode);
}

/**
 * Checks if the actor is authorized to perform physical stock receipts (StockLedger reason='receive').
 * Aligned with CouchDB VDU Rule 13 (shelter-access-design.ts §3).
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin.
 */
export function canReceivePhysicalStock(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return (
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, WAREHOUSE_STAFF) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SUPPLY_COORDINATOR) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER)
	);
}

/**
 * Checks if the actor may take a returnable loan back as physical stock (counter return,
 * `PHYSICAL` reservation): the physical-receipt roles plus distribution_staff (CR-161 R3).
 * Aligned with VDU `canReturnLoanPhysical`.
 */
export function canReturnLoanPhysical(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	return (
		canReceivePhysicalStock(ctx) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, DISTRIBUTION_STAFF)
	);
}

/**
 * #659 / #660 — may open / edit / cancel / submit / receive a bulk return pool.
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin (VDU
 * `canManageBulkReturnPool`).
 */
export function canManageBulkReturnPool(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return (
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, WAREHOUSE_STAFF) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SUPPLY_COORDINATOR) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER)
	);
}

/**
 * #659 — may add / move / void a bulk return entry (and update the loans it closes): the pool
 * managers plus distribution_staff (VDU `canWriteBulkReturnEntry`).
 */
export function canWriteBulkReturnEntry(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	return (
		canManageBulkReturnPool(ctx) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, DISTRIBUTION_STAFF)
	);
}

/**
 * Checks if the actor is authorized to inspect and receive returns at warehouse (Step 7).
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin.
 */
export function canReceiveWarehouseReturns(ctx: AuthorContext): boolean {
	return canReceivePhysicalStock(ctx);
}

export function canAllocateTicket(ctx: AuthorContext): boolean {
	return canCreateTicket(ctx);
}

export function canCancelTicket(ctx: AuthorContext): boolean {
	return canCreateTicket(ctx);
}

export function assertCanCreateTicket(ctx: AuthorContext): void {
	if (!canCreateTicket(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: ticket creation requires warehouse or management role'
		);
	}
}

export function assertCanAllocateTicket(ctx: AuthorContext): void {
	if (!canAllocateTicket(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: ticket item allocation requires warehouse or management role'
		);
	}
}

export function assertCanCancelTicket(ctx: AuthorContext): void {
	if (!canCancelTicket(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: ticket cancellation requires warehouse or management role'
		);
	}
}

export function assertCanApproveTicket(ctx: AuthorContext): void {
	if (!canApproveTicket(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: ticket approval requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanDispatchTicket(ctx: AuthorContext): void {
	if (!canDispatchTicket(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: ticket dispatch requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanPerformFrontlineDistribution(ctx: AuthorContext): void {
	if (!canPerformFrontlineDistribution(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: frontline distribution operations require distribution_staff, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanReceivePhysicalStock(ctx: AuthorContext): void {
	if (!canReceivePhysicalStock(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: physical stock receipt requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanReturnLoanPhysical(ctx: AuthorContext): void {
	if (!canReturnLoanPhysical(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: physical loan return requires warehouse_staff, supply_coordinator, distribution_staff, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanManageBulkReturnPool(ctx: AuthorContext): void {
	if (!canManageBulkReturnPool(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: managing a bulk return pool requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanWriteBulkReturnEntry(ctx: AuthorContext): void {
	if (!canWriteBulkReturnEntry(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: recording bulk return entries requires warehouse_staff, supply_coordinator, distribution_staff, shelter_manager, or system_admin role'
		);
	}
}

export function assertCanReceiveWarehouseReturns(ctx: AuthorContext): void {
	if (!canReceiveWarehouseReturns(ctx)) {
		throw new WorkflowAuthorizationError(
			'Unauthorized: warehouse return receipt requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin role'
		);
	}
}

export function canOperateReservationMode(
	mode: 'PHYSICAL' | 'BULK' | 'NON_PHYSICAL',
	ctx: AuthorContext
): boolean {
	if (mode === 'PHYSICAL') {
		return canReturnLoanPhysical(ctx);
	}
	return canPerformFrontlineDistribution(ctx);
}

export function assertReservationModeAuthority(
	mode: 'PHYSICAL' | 'BULK' | 'NON_PHYSICAL',
	ctx: AuthorContext
): void {
	if (mode === 'PHYSICAL') {
		if (!canReturnLoanPhysical(ctx)) {
			throw new WorkflowAuthorizationError(
				'Unauthorized: PHYSICAL return reservation requires warehouse_staff, supply_coordinator, distribution_staff, shelter_manager, or system_admin role'
			);
		}
	} else {
		if (!canPerformFrontlineDistribution(ctx)) {
			throw new WorkflowAuthorizationError(
				`Unauthorized: ${mode} return reservation requires distribution_staff, shelter_manager, or system_admin role`
			);
		}
	}
}
