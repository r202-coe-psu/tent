import type { AuthorContext } from '$lib/db/model';
import {
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
 * Allowed: shelter_manager, system_admin (AC-TKT-03.1).
 */
export function canApproveTicket(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER);
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
 * Allowed: registration_staff, supply_coordinator, shelter_manager, system_admin.
 */
export function canPerformFrontlineDistribution(ctx: AuthorContext): boolean {
	if (!ctx.roles) return false;
	if (isSystemAdmin(ctx.roles)) return true;
	return (
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, 'registration_staff') ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SUPPLY_COORDINATOR) ||
		hasCapabilityInShelter(ctx.roles, ctx.shelterCode, SHELTER_MANAGER)
	);
}

/**
 * Checks if the actor is authorized to inspect and receive returns at warehouse (Step 7).
 * Allowed: warehouse_staff, supply_coordinator, shelter_manager, system_admin.
 */
export function canReceiveWarehouseReturns(ctx: AuthorContext): boolean {
	return canDispatchTicket(ctx);
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
			'Unauthorized: ticket approval requires shelter_manager or system_admin role'
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
			'Unauthorized: frontline distribution operations require registration_staff, supply_coordinator, shelter_manager, or system_admin role'
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
