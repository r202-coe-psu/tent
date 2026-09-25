import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { bulkReturnPoolDocSchema, createBulkReturnPool } from './bulk-return-pool';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:flow2' };
const ULID = '01J00000000000000000000000';
const TICKET_ID = `requisition_ticket:${ULID}`;

describe('Food & Supplies BulkReturnPool contract', () => {
	it('creates a Decimal-safe active pool with an exact quota equation', () => {
		const pool = createBulkReturnPool(
			{
				item_id: 'item:wheelchair',
				stock_ledger_id: `stock_ledger:${ULID}`,
				ticket_id: TICKET_ID,
				total_received_qty: '2.5'
			},
			ctx,
			ULID
		);
		expect(pool).toMatchObject({ claimed_qty: '0', unclaimed_quota: '2.5', status: 'ACTIVE' });
		expect(
			bulkReturnPoolDocSchema.safeParse({ ...pool, claimed_qty: '1', unclaimed_quota: '1' }).success
		).toBe(false);
		expect(
			bulkReturnPoolDocSchema.safeParse({
				...pool,
				claimed_qty: '2.5',
				unclaimed_quota: '0',
				status: 'EXHAUSTED'
			}).success
		).toBe(true);
		expect(
			bulkReturnPoolDocSchema.safeParse({
				...pool,
				status: 'CLOSED',
				closed_at: '2026-09-16T01:00:00.000Z',
				closed_by: 'staff:warehouse'
			}).success
		).toBe(true);
	});

	it('rejects numeric quantities in persisted BulkReturnPool documents', () => {
		const pool = createBulkReturnPool(
			{
				item_id: 'item:wheelchair',
				stock_ledger_id: `stock_ledger:${ULID}`,
				total_received_qty: '2'
			},
			ctx,
			ULID
		);
		expect(bulkReturnPoolDocSchema.safeParse({ ...pool, total_received_qty: 2 }).success).toBe(
			false
		);
	});
});
