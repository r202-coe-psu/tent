import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	assertCanManageBulkReturnPool,
	assertCanWriteBulkReturnEntry,
	canCreateTicket,
	canDispatchTicket,
	canManageBulkReturnPool,
	canOperateReservationMode,
	canPerformFrontlineDistribution,
	canReceivePhysicalStock,
	canReturnLoanPhysical,
	canWriteBulkReturnEntry
} from './auth';
import { WorkflowAuthorizationError } from './errors';

const ctx = (roles: string[], shelterCode = 'SH001'): AuthorContext => ({
	shelterCode,
	createdBy: 'dist',
	roles
});

const DIST = ['shelter:SH001', 'SH001:distribution_staff'];

describe('distribution_staff authorization', () => {
	it('may perform frontline distribution in their own shelter', () => {
		expect(canPerformFrontlineDistribution(ctx(DIST))).toBe(true);
	});

	it('may not perform frontline distribution in another shelter', () => {
		expect(
			canPerformFrontlineDistribution(ctx(['shelter:SH002', 'SH002:distribution_staff']))
		).toBe(false);
		expect(
			canPerformFrontlineDistribution(
				ctx(['shelter:SH001', 'shelter:SH002', 'SH002:distribution_staff'])
			)
		).toBe(false);
	});

	it('may operate BULK, NON_PHYSICAL and PHYSICAL return reservations (CR-161 R3)', () => {
		expect(canOperateReservationMode('BULK', ctx(DIST))).toBe(true);
		expect(canOperateReservationMode('NON_PHYSICAL', ctx(DIST))).toBe(true);
		expect(canOperateReservationMode('PHYSICAL', ctx(DIST))).toBe(true);
	});

	it('gains no warehouse / ticket authority', () => {
		expect(canCreateTicket(ctx(DIST))).toBe(false);
		expect(canDispatchTicket(ctx(DIST))).toBe(false);
		expect(canReceivePhysicalStock(ctx(DIST))).toBe(false);
	});
});

const scoped = (capability: string, shelterCode = 'SH001'): string[] => [
	`shelter:${shelterCode}`,
	`${shelterCode}:${capability}`
];

describe('canPerformFrontlineDistribution (CR-161 R3)', () => {
	it.each([
		['distribution_staff', scoped('distribution_staff')],
		['shelter_manager', scoped('shelter_manager')],
		['system_admin', ['system_admin']]
	])('allows %s', (_label, roles) => {
		expect(canPerformFrontlineDistribution(ctx(roles))).toBe(true);
	});

	it.each([
		['registration_staff', scoped('registration_staff')],
		['supply_coordinator', scoped('supply_coordinator')],
		['warehouse_staff', scoped('warehouse_staff')],
		['shelter_manager of another shelter', scoped('shelter_manager', 'SH002')],
		['no roles', [] as string[]]
	])('rejects %s', (_label, roles) => {
		expect(canPerformFrontlineDistribution(ctx(roles))).toBe(false);
	});

	it('rejects a context without roles', () => {
		expect(canPerformFrontlineDistribution({ shelterCode: 'SH001', createdBy: 'x' })).toBe(false);
	});
});

describe('canReturnLoanPhysical (CR-161 R3)', () => {
	it.each([
		['warehouse_staff', scoped('warehouse_staff')],
		['supply_coordinator', scoped('supply_coordinator')],
		['shelter_manager', scoped('shelter_manager')],
		['system_admin', ['system_admin']],
		['distribution_staff', scoped('distribution_staff')]
	])('allows %s', (_label, roles) => {
		expect(canReturnLoanPhysical(ctx(roles))).toBe(true);
	});

	it.each([
		['registration_staff', scoped('registration_staff')],
		['distribution_staff of another shelter', scoped('distribution_staff', 'SH002')],
		['kitchen_staff', scoped('kitchen_staff')],
		['no roles', [] as string[]]
	])('rejects %s', (_label, roles) => {
		expect(canReturnLoanPhysical(ctx(roles))).toBe(false);
	});

	it('rejects a context without roles', () => {
		expect(canReturnLoanPhysical({ shelterCode: 'SH001', createdBy: 'x' })).toBe(false);
	});
});

describe('canManageBulkReturnPool (#659)', () => {
	it.each([
		['warehouse_staff', scoped('warehouse_staff')],
		['supply_coordinator', scoped('supply_coordinator')],
		['shelter_manager', scoped('shelter_manager')],
		['system_admin', ['system_admin']]
	])('allows %s', (_label, roles) => {
		expect(canManageBulkReturnPool(ctx(roles))).toBe(true);
	});

	it.each([
		['distribution_staff', scoped('distribution_staff')],
		['registration_staff', scoped('registration_staff')],
		['shelter_manager of another shelter', scoped('shelter_manager', 'SH002')],
		['no roles', [] as string[]]
	])('rejects %s', (_label, roles) => {
		expect(canManageBulkReturnPool(ctx(roles))).toBe(false);
	});

	it('rejects a context without roles', () => {
		expect(canManageBulkReturnPool({ shelterCode: 'SH001', createdBy: 'x' })).toBe(false);
	});
});

describe('canWriteBulkReturnEntry (#659)', () => {
	it.each([
		['warehouse_staff', scoped('warehouse_staff')],
		['supply_coordinator', scoped('supply_coordinator')],
		['shelter_manager', scoped('shelter_manager')],
		['distribution_staff', scoped('distribution_staff')],
		['system_admin', ['system_admin']]
	])('allows %s', (_label, roles) => {
		expect(canWriteBulkReturnEntry(ctx(roles))).toBe(true);
	});

	it.each([
		['registration_staff', scoped('registration_staff')],
		['distribution_staff of another shelter', scoped('distribution_staff', 'SH002')],
		['no roles', [] as string[]]
	])('rejects %s', (_label, roles) => {
		expect(canWriteBulkReturnEntry(ctx(roles))).toBe(false);
	});

	it('rejects a context without roles', () => {
		expect(canWriteBulkReturnEntry({ shelterCode: 'SH001', createdBy: 'x' })).toBe(false);
	});
});

describe('assertCanManageBulkReturnPool (#659)', () => {
	it('passes for a pool manager and throws WorkflowAuthorizationError otherwise', () => {
		expect(() => assertCanManageBulkReturnPool(ctx(scoped('warehouse_staff')))).not.toThrow();
		expect(() => assertCanManageBulkReturnPool(ctx(DIST))).toThrow(WorkflowAuthorizationError);
	});
});

describe('assertCanWriteBulkReturnEntry (#659)', () => {
	it('passes for distribution_staff and throws WorkflowAuthorizationError otherwise', () => {
		expect(() => assertCanWriteBulkReturnEntry(ctx(DIST))).not.toThrow();
		expect(() => assertCanWriteBulkReturnEntry(ctx(scoped('registration_staff')))).toThrow(
			WorkflowAuthorizationError
		);
	});
});
