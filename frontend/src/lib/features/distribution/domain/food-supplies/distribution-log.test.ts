import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	assertDistributionLogIssuanceImmutable,
	createDistributionLog,
	distributionLogDocSchema,
	distributionLogInputSchema
} from './distribution-log';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:flow2' };
const ULID = '01J00000000000000000000000';
const TICKET_ID = `requisition_ticket:${ULID}`;

describe('Food & Supplies DistributionLog contract', () => {
	const foodLogInput = {
		ticket_id: TICKET_ID,
		item_id: 'item:ready-meal',
		meal_service_id: `meal_service:${ULID}`,
		qty: '1',
		recipient_type: 'evacuee' as const,
		recipient_id: `evacuee:${ULID}`,
		meal: 'lunch' as const,
		is_returnable: false,
		is_override: false
	};

	it('creates an append-only Food log and validates recipient identity without return_events', () => {
		const log = createDistributionLog(foodLogInput, ctx, ULID);
		expect(log.status).toBe('fulfilled');
		expect(log.distributed_by).toBe(ctx.createdBy);
		expect(log).not.toHaveProperty('return_events');
		expect(
			distributionLogInputSchema.safeParse({
				...foodLogInput,
				recipient_id: `volunteer:${ULID}`
			}).success
		).toBe(false);
		expect(() => assertDistributionLogIssuanceImmutable(log, { ...log, qty: '2' })).toThrow(
			/immutable/
		);
	});

	it('rejects numeric quantities in persisted DistributionLog documents', () => {
		const log = createDistributionLog(foodLogInput, ctx, ULID);
		expect(distributionLogDocSchema.safeParse({ ...log, qty: 1 }).success).toBe(false);
	});

	it('requires canonical void audit for consumable logs', () => {
		const log = createDistributionLog(foodLogInput, ctx, ULID);
		expect(
			distributionLogDocSchema.safeParse({
				...log,
				status: 'voided',
				voided_at: null,
				voided_by: null
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...log,
				status: 'voided',
				voided_at: '2026-09-16T01:00:00.000Z',
				voided_by: 'staff:warehouse'
			}).success
		).toBe(true);
	});

	it('rejects voided loans that retain return or clear activity', () => {
		const loan = createDistributionLog(
			{
				...foodLogInput,
				item_id: 'item:wheelchair',
				meal_service_id: undefined,
				meal: undefined,
				qty: '2',
				is_returnable: true
			},
			ctx,
			ULID
		);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'voided',
				qty_returned: '1',
				clear_reason: 'routine',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout',
				voided_at: '2026-09-16T02:00:00.000Z',
				voided_by: 'staff:warehouse'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'voided',
				clear_reason: 'lost',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout',
				notes: 'Lost during evacuation',
				voided_at: '2026-09-16T02:00:00.000Z',
				voided_by: 'staff:warehouse'
			}).success
		).toBe(false);
	});

	it('models current returnable supplies statuses with clear audit and quantity limits', () => {
		const loan = createDistributionLog(
			{
				...foodLogInput,
				item_id: 'item:wheelchair',
				meal_service_id: undefined,
				meal: undefined,
				qty: '2',
				is_returnable: true
			},
			ctx,
			ULID
		);
		expect(loan.status).toBe('active');
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'partially_returned',
				qty_returned: '1',
				clear_reason: 'routine',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(true);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'partially_returned',
				qty_returned: '0',
				clear_reason: 'routine',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'partially_returned',
				qty_returned: '2',
				clear_reason: 'routine',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'returned',
				qty_returned: '2',
				clear_reason: 'lost',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'lost',
				clear_reason: 'lost',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'lost',
				clear_reason: 'lost',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout',
				notes: 'Borrower reported the wheelchair lost'
			}).success
		).toBe(true);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'waived',
				clear_reason: 'waived',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'waived',
				clear_reason: 'waived',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout',
				notes: 'Shelter manager waived the loan after assessment'
			}).success
		).toBe(true);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'returned',
				qty_returned: '1',
				clear_reason: 'routine',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'returned',
				qty_returned: '2',
				clear_reason: 'bulk_dropoff',
				bulk_pool_id: `bulk_return_pool:${ULID}`,
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(true);
		expect(
			distributionLogDocSchema.safeParse({
				...loan,
				status: 'lost',
				qty_returned: '3',
				clear_reason: 'lost',
				returned_at: '2026-09-16T01:00:00.000Z',
				returned_by: 'staff:checkout'
			}).success
		).toBe(false);
	});
});
