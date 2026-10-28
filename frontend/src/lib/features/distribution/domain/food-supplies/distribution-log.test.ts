import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	applyBulkEntryToLog,
	assertDistributionLogCanBeVoided,
	assertDistributionLogIssuanceImmutable,
	createDistributionLog,
	DISTRIBUTION_LOG_SCHEMA_V,
	distributionLogDocSchema,
	distributionLogInputSchema,
	revertBulkEntryFromLog,
	type DistributionLog
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

	it('keeps allergen conflicts only on an overridden log (#607)', () => {
		const overridden = createDistributionLog(
			{
				...foodLogInput,
				is_override: true,
				override_reason: 'รับไปให้ลูกที่ไม่แพ้',
				allergen_conflicts: ['egg']
			},
			ctx,
			ULID
		);
		expect(overridden.allergen_conflicts).toEqual(['egg']);
		expect(
			distributionLogInputSchema.safeParse({ ...foodLogInput, allergen_conflicts: ['egg'] }).success
		).toBe(false);
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

describe('DistributionLog schema_v and v3 bulk fields', () => {
	const ENTRY_A = 'bulk_return_entry:01J0000000000000000000000A';
	const AT = '2026-10-22T01:00:00.000Z';
	const loan = (): DistributionLog =>
		createDistributionLog(
			{
				ticket_id: TICKET_ID,
				item_id: 'item:wheelchair',
				qty: '5',
				recipient_type: 'outside',
				is_returnable: true,
				is_override: false
			},
			ctx,
			ULID
		);
	const returned = { returned_at: AT, returned_by: 'staff:dst', clear_reason: 'bulk_dropoff' };

	it('creates new logs at schema_v 2', () => {
		expect(DISTRIBUTION_LOG_SCHEMA_V).toBe(2);
		expect(loan().schema_v).toBe(2);
	});

	it('still reads schema_v 1 documents and rejects other versions', () => {
		expect(distributionLogDocSchema.safeParse({ ...loan(), schema_v: 1 }).success).toBe(true);
		expect(distributionLogDocSchema.safeParse({ ...loan(), schema_v: 3 }).success).toBe(false);
	});

	it('accepts applied_bulk_entry_ids only on schema_v 2, unique, entry ULID ids', () => {
		const base = { ...loan(), applied_bulk_entry_ids: [ENTRY_A] };
		expect(distributionLogDocSchema.safeParse(base).success).toBe(true);
		expect(distributionLogDocSchema.safeParse({ ...base, schema_v: 1 }).success).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({ ...base, applied_bulk_entry_ids: [ENTRY_A, ENTRY_A] })
				.success
		).toBe(false);
		expect(
			distributionLogDocSchema.safeParse({
				...base,
				applied_bulk_entry_ids: ['bulk_return_entry:x']
			}).success
		).toBe(false);
	});

	it('bulk_dropoff requires a legacy bulk_pool_id or an applied_bulk_entry_ids array', () => {
		const full = { ...loan(), status: 'returned', qty_returned: '5', ...returned };
		const rejected = distributionLogDocSchema.safeParse(full);
		expect(rejected.success).toBe(false);
		expect(JSON.stringify(rejected.error?.issues)).toMatch(/bulk_dropoff requires bulk_pool_id/);
		expect(
			distributionLogDocSchema.safeParse({ ...full, applied_bulk_entry_ids: [ENTRY_A] }).success
		).toBe(true);
		expect(
			distributionLogDocSchema.safeParse({ ...full, bulk_pool_id: `bulk_return_pool:${ULID}` })
				.success
		).toBe(true);
	});

	it('rejects a void of a loan with applied bulk entries', () => {
		expect(
			distributionLogDocSchema.safeParse({
				...loan(),
				status: 'voided',
				voided_at: AT,
				voided_by: 'staff:wh',
				applied_bulk_entry_ids: [ENTRY_A]
			}).success
		).toBe(false);
	});
});

describe('assertDistributionLogIssuanceImmutable schema_v', () => {
	const log = createDistributionLog(
		{
			ticket_id: TICKET_ID,
			item_id: 'item:wheelchair',
			qty: '2',
			recipient_type: 'outside',
			is_returnable: true,
			is_override: false
		},
		ctx,
		ULID
	);
	const v1: DistributionLog = { ...log, schema_v: 1 };
	const v2: DistributionLog = { ...log, schema_v: 2 };

	it('allows schema_v to stay equal or upgrade 1 -> 2', () => {
		expect(() => assertDistributionLogIssuanceImmutable(v1, v1)).not.toThrow();
		expect(() => assertDistributionLogIssuanceImmutable(v2, v2)).not.toThrow();
		expect(() => assertDistributionLogIssuanceImmutable(v1, v2)).not.toThrow();
	});

	it('rejects a 2 -> 1 downgrade', () => {
		expect(() => assertDistributionLogIssuanceImmutable(v2, v1)).toThrow(/schema_v/);
	});
});

describe('assertDistributionLogCanBeVoided', () => {
	const base = createDistributionLog(
		{
			ticket_id: TICKET_ID,
			item_id: 'item:wheelchair',
			qty: '2',
			recipient_type: 'outside',
			is_returnable: true,
			is_override: false
		},
		ctx,
		ULID
	);

	it('allows an untouched loan', () => {
		expect(() => assertDistributionLogCanBeVoided(base)).not.toThrow();
		expect(() =>
			assertDistributionLogCanBeVoided({ ...base, applied_bulk_entry_ids: [] })
		).not.toThrow();
	});

	it('blocks a loan with applied bulk entries or a legacy bulk_pool_id', () => {
		expect(() =>
			assertDistributionLogCanBeVoided({
				...base,
				applied_bulk_entry_ids: ['bulk_return_entry:01J0000000000000000000000A']
			})
		).toThrow(/Cannot void/);
		expect(() =>
			assertDistributionLogCanBeVoided({ ...base, bulk_pool_id: `bulk_return_pool:${ULID}` })
		).toThrow(/Cannot void/);
	});
});

describe('applyBulkEntryToLog', () => {
	const ENTRY_A = 'bulk_return_entry:01J0000000000000000000000A';
	const ENTRY_B = 'bulk_return_entry:01J0000000000000000000000B';
	const AT = '2026-10-22T01:00:00.000Z';
	const loan = (): DistributionLog =>
		createDistributionLog(
			{
				ticket_id: TICKET_ID,
				item_id: 'item:wheelchair',
				qty: '5',
				recipient_type: 'outside',
				is_returnable: true,
				is_override: false
			},
			ctx,
			ULID
		);

	it('partially returns a loan, records the entry and stamps the actor', () => {
		const next = applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT);
		expect(next).toMatchObject({
			schema_v: 2,
			status: 'partially_returned',
			qty_returned: '2',
			clear_reason: 'bulk_dropoff',
			applied_bulk_entry_ids: [ENTRY_A],
			returned_at: AT,
			returned_by: 'staff:dst',
			updated_at: AT
		});
		expect(next).not.toHaveProperty('bulk_pool_id');
	});

	it('returns the loan once the full qty is applied, appending to existing ids', () => {
		const first = applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT);
		const second = applyBulkEntryToLog(first, { entry_id: ENTRY_B, qty: '3' }, 'staff:dst', AT);
		expect(second).toMatchObject({
			status: 'returned',
			qty_returned: '5',
			applied_bulk_entry_ids: [ENTRY_A, ENTRY_B]
		});
	});

	it('is idempotent when the entry is already applied', () => {
		const first = applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT);
		expect(applyBulkEntryToLog(first, { entry_id: ENTRY_A, qty: '2' }, 'staff:other', AT)).toBe(
			first
		);
	});

	it('upgrades a schema_v 1 log and carries a legacy bulk_pool_id unchanged', () => {
		const legacy: DistributionLog = {
			...loan(),
			schema_v: 1,
			bulk_pool_id: `bulk_return_pool:${ULID}`
		};
		const next = applyBulkEntryToLog(legacy, { entry_id: ENTRY_A, qty: '1' }, 'staff:dst', AT);
		expect(next.schema_v).toBe(2);
		expect(next.bulk_pool_id).toBe(legacy.bulk_pool_id);
	});

	it('throws when qty exceeds the outstanding quantity', () => {
		expect(() =>
			applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty: '6' }, 'staff:dst', AT)
		).toThrow(/exceeds outstanding/);
		const partial = applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty: '4' }, 'staff:dst', AT);
		expect(() =>
			applyBulkEntryToLog(partial, { entry_id: ENTRY_B, qty: '2' }, 'staff:dst', AT)
		).toThrow(/exceeds outstanding/);
	});

	it('throws for a loan that is not active or partially_returned', () => {
		const full = applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty: '5' }, 'staff:dst', AT);
		expect(() =>
			applyBulkEntryToLog(full, { entry_id: ENTRY_B, qty: '1' }, 'staff:dst', AT)
		).toThrow(/Cannot apply/);
		const consumable = createDistributionLog(
			{
				ticket_id: TICKET_ID,
				item_id: 'item:rice',
				qty: '5',
				recipient_type: 'outside',
				is_returnable: false,
				is_override: false
			},
			ctx,
			ULID
		);
		expect(() =>
			applyBulkEntryToLog(consumable, { entry_id: ENTRY_A, qty: '1' }, 'staff:dst', AT)
		).toThrow(/Cannot apply/);
	});

	it('rejects a malformed entry id or a non-positive qty', () => {
		expect(() =>
			applyBulkEntryToLog(loan(), { entry_id: 'bulk_return_entry:x', qty: '1' }, 'staff:dst', AT)
		).toThrow();
		for (const qty of ['0', '-1', '1.5']) {
			expect(() =>
				applyBulkEntryToLog(loan(), { entry_id: ENTRY_A, qty }, 'staff:dst', AT)
			).toThrow();
		}
	});
});

describe('revertBulkEntryFromLog', () => {
	const ENTRY_A = 'bulk_return_entry:01J0000000000000000000000A';
	const ENTRY_B = 'bulk_return_entry:01J0000000000000000000000B';
	const AT = '2026-10-22T01:00:00.000Z';
	const AT2 = '2026-10-22T02:00:00.000Z';
	const fresh = createDistributionLog(
		{
			ticket_id: TICKET_ID,
			item_id: 'item:wheelchair',
			qty: '5',
			recipient_type: 'outside',
			is_returnable: true,
			is_override: false
		},
		ctx,
		ULID
	);
	const both = applyBulkEntryToLog(
		applyBulkEntryToLog(fresh, { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT),
		{ entry_id: ENTRY_B, qty: '3' },
		'staff:dst',
		AT
	);

	it('removes one entry and drops a returned loan back to partially_returned', () => {
		const next = revertBulkEntryFromLog(both, { entry_id: ENTRY_B, qty: '3' }, 'staff:wh', AT2);
		expect(next).toMatchObject({
			status: 'partially_returned',
			qty_returned: '2',
			clear_reason: 'bulk_dropoff',
			applied_bulk_entry_ids: [ENTRY_A],
			returned_at: AT2,
			returned_by: 'staff:wh',
			updated_at: AT2,
			schema_v: 2
		});
		expect(next).not.toHaveProperty('bulk_pool_id');
	});

	it('returns the loan to active with qty_returned 0 after the last entry is reverted', () => {
		const one = revertBulkEntryFromLog(both, { entry_id: ENTRY_B, qty: '3' }, 'staff:wh', AT2);
		const none = revertBulkEntryFromLog(one, { entry_id: ENTRY_A, qty: '2' }, 'staff:wh', AT2);
		expect(none).toMatchObject({
			status: 'active',
			qty_returned: '0',
			applied_bulk_entry_ids: []
		});
		expect(distributionLogDocSchema.safeParse(none).success).toBe(true);
	});

	it('can apply again after a full revert', () => {
		const one = revertBulkEntryFromLog(
			applyBulkEntryToLog(fresh, { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT),
			{ entry_id: ENTRY_A, qty: '2' },
			'staff:wh',
			AT2
		);
		const again = applyBulkEntryToLog(one, { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT2);
		expect(again).toMatchObject({ status: 'partially_returned', qty_returned: '2' });
	});

	it('is idempotent when the entry is not applied', () => {
		expect(revertBulkEntryFromLog(fresh, { entry_id: ENTRY_A, qty: '2' }, 'staff:wh', AT)).toBe(
			fresh
		);
		const one = applyBulkEntryToLog(fresh, { entry_id: ENTRY_A, qty: '2' }, 'staff:dst', AT);
		expect(revertBulkEntryFromLog(one, { entry_id: ENTRY_B, qty: '3' }, 'staff:wh', AT)).toBe(one);
	});

	it('throws when qty exceeds qty_returned', () => {
		expect(() =>
			revertBulkEntryFromLog(both, { entry_id: ENTRY_A, qty: '6' }, 'staff:wh', AT2)
		).toThrow(/exceeds qty_returned/);
	});

	it('throws when the log is not partially_returned or returned', () => {
		const odd: DistributionLog = { ...fresh, applied_bulk_entry_ids: [ENTRY_A] };
		expect(() =>
			revertBulkEntryFromLog(odd, { entry_id: ENTRY_A, qty: '1' }, 'staff:wh', AT2)
		).toThrow(/Cannot revert/);
	});
});
