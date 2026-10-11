import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	canCreateTicket,
	canDispatchTicket,
	canOperateReservationMode,
	canPerformFrontlineDistribution,
	canReceivePhysicalStock
} from './auth';

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

	it('may operate BULK and NON_PHYSICAL return reservations but not PHYSICAL', () => {
		expect(canOperateReservationMode('BULK', ctx(DIST))).toBe(true);
		expect(canOperateReservationMode('NON_PHYSICAL', ctx(DIST))).toBe(true);
		expect(canOperateReservationMode('PHYSICAL', ctx(DIST))).toBe(false);
	});

	it('gains no warehouse / ticket authority', () => {
		expect(canCreateTicket(ctx(DIST))).toBe(false);
		expect(canDispatchTicket(ctx(DIST))).toBe(false);
		expect(canReceivePhysicalStock(ctx(DIST))).toBe(false);
	});
});
